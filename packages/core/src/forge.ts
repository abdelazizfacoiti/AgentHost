import { z } from "zod";
import { evaluateSafety } from "./safety/risk-classifier.js";
import { classifyPath, normalizePathForPolicy } from "./safety/path-policy.js";
import { classifyShellCommand } from "./safety/shell-classifier.js";
import { getDefaultPolicy } from "./policies.js";
import type {
  CapabilityGrant,
  DataSensitivity,
  RuntimePolicy,
  RiskLevel,
  SafetyInput,
  ToolForgeGrantProposal,
  ToolForgeGrantProposalResult,
  ToolForgeManifest,
  ToolForgePermissionRequest,
  ToolForgeRuntimePermissionRequest,
  ToolForgePermissionReview,
  ToolForgeRequirements,
  ToolForgeReviewResult,
  ToolForgeToolDeclaration,
  ToolForgeValidationIssue,
  ToolForgeValidationResult
} from "./types.js";

const MANIFEST_ID_PATTERN = /^[a-z][a-z0-9._-]{2,127}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const FORGE_ROOTS = ["~/.agenthost", "~/.agenthost/outputs", "~/Desktop/agenthost-output"] as const;
const FORGE_REVIEW_POLICY: RuntimePolicy = {
  ...getDefaultPolicy(),
  allowFileWriteRoots: [...FORGE_ROOTS]
};
const RISK_ORDER: RiskLevel[] = ["observe", "low", "medium", "high", "blocked"];

const requirementsSchema = z
  .object({
    requiresDryRun: z.boolean().optional(),
    requiresConfirmationToken: z.boolean().optional(),
    requiresApproval: z.boolean().optional()
  })
  .strict();

const runtimePermissionSchema = z.object({
  id: z.string().trim().min(1).max(200),
  toolNames: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
  capabilities: z.array(z.enum(["pure_compute", "read_runtime_input", "write_runtime_output", "use_manifest_metadata", "use_registration_metadata", "read_sandbox_file", "write_sandbox_file", "list_sandbox_files", "read_user_file", "write_user_file", "network_fetch", "shell_command", "gui_action", "private_data_read", "communication_send"])).min(1).max(30),
  allowedOperations: z.array(z.enum(["const", "input", "object", "array", "concat", "length"])).min(1).max(30),
  maxInputBytes: z.number().int().positive().max(64 * 1024).optional(),
  maxOutputBytes: z.number().int().positive().max(64 * 1024).optional(),
  maxRuntimeMs: z.number().int().positive().max(5_000).optional(),
  sandboxRoots: z.array(z.enum(["run", "temp"])).max(2).optional(),
  outputRoots: z.array(z.literal("run")).max(1).optional(),
  requiresDryRun: z.boolean().optional(), requiresConfirmationToken: z.boolean().optional(), requiresApproval: z.boolean().optional()
}).strict();

const manifestToolSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(1000),
    inputSchema: z.unknown().optional(),
    outputSchema: z.unknown().optional(),
    riskLevel: z.enum(["observe", "low", "medium", "high", "blocked"]),
    actionType: z.enum([
      "observe",
      "inspect",
      "app_launch",
      "shell_command",
      "file_read",
      "file_write",
      "file_delete",
      "gui_click",
      "gui_type",
      "accessibility_action",
      "accessibility_set_value",
      "accessibility_focus",
      "browser_action",
      "communication_send",
      "upload",
      "system_change",
      "unknown"
    ]),
    strategy: z
      .enum([
        "app_adapter",
        "official_api",
        "cli_or_script",
        "browser_automation",
        "accessibility",
        "gui_control",
        "guide_only"
      ])
      .optional()
  })
  .strict();

const permissionRequestSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(1000).optional(),
    generatedToolId: z.string().trim().min(1).max(200).optional(),
    tools: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
    strategies: z
      .array(
        z.enum([
          "app_adapter",
          "official_api",
          "cli_or_script",
          "browser_automation",
          "accessibility",
          "gui_control",
          "guide_only"
        ])
      )
      .max(20)
      .optional(),
    actionTypes: z
      .array(
        z.enum([
          "observe",
          "inspect",
          "app_launch",
          "shell_command",
          "file_read",
          "file_write",
          "file_delete",
          "gui_click",
          "gui_type",
          "accessibility_action",
          "accessibility_set_value",
          "accessibility_focus",
          "browser_action",
          "communication_send",
          "upload",
          "system_change",
          "unknown"
        ])
      )
      .max(50)
      .optional(),
    appNames: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
    appSensitivities: z
      .array(
        z.enum([
          "normal",
          "communication",
          "financial",
          "credential_or_security",
          "system_settings",
          "unknown"
        ])
      )
      .max(20)
      .optional(),
    fileRoots: z.array(z.string().trim().min(1).max(1000)).max(100).optional(),
    commandAllowlist: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
    networkDomains: z.array(z.string().trim().min(1).max(300)).max(100).optional(),
    oauthScopes: z.array(z.string().trim().min(1).max(300)).max(100).optional(),
    dataSensitivity: z.enum(["none", "low", "sensitive", "secret"]).optional(),
    canReadPrivateData: z.boolean().optional(),
    canWriteFiles: z.boolean().optional(),
    canRunShell: z.boolean().optional(),
    canUseGui: z.boolean().optional(),
    canSendMessages: z.boolean().optional(),
    canDeleteData: z.boolean().optional(),
    canUploadFiles: z.boolean().optional(),
    requiresDryRun: z.boolean().optional(),
    requiresConfirmationToken: z.boolean().optional(),
    requiresApproval: z.boolean().optional()
  })
  .strict();

const manifestSchema = z
  .object({
    schemaVersion: z.literal("agenthost.forge.v1"),
    id: z.string().trim().min(1).max(128),
    displayName: z.string().trim().min(1).max(200),
    version: z.string().trim().min(1).max(32),
    description: z.string().trim().min(1).max(2000),
    kind: z.enum(["tool", "adapter", "skill", "workflow"]),
    source: z.enum(["generated", "user", "built-in"]),
    tools: z.array(manifestToolSchema).max(100),
    requestedPermissions: z.array(permissionRequestSchema).max(100),
    runtimePermissions: z.array(runtimePermissionSchema).max(100).optional(),
    riskDeclaration: z.enum(["observe", "low", "medium", "high", "blocked"]),
    dataSensitivityDeclaration: z.enum(["none", "low", "sensitive", "secret"]),
    requirements: requirementsSchema.default({})
  })
  .strict();

function dedupeStrings(values: string[] | undefined): string[] | undefined {
  if (values === undefined) {
    return undefined;
  }

  const normalized = values.map((value) => value.trim()).filter((value) => value.length > 0);
  return normalized.length === 0 ? undefined : [...new Set(normalized)];
}

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;
}

function issue(code: string, message: string, path?: string): ToolForgeValidationIssue {
  return path === undefined ? { code, message } : { code, message, path };
}

function normalizeRequirements(input: ToolForgeRequirements): ToolForgeRequirements {
  return {
    ...(input.requiresDryRun === undefined ? {} : { requiresDryRun: input.requiresDryRun }),
    ...(input.requiresConfirmationToken === undefined
      ? {}
      : { requiresConfirmationToken: input.requiresConfirmationToken }),
    ...(input.requiresApproval === undefined ? {} : { requiresApproval: input.requiresApproval })
  };
}

function normalizeManifest(manifest: ToolForgeManifest): ToolForgeManifest {
  const { runtimePermissions, ...manifestBase } = manifest;
  return {
    ...manifestBase,
    id: manifest.id.trim(),
    displayName: manifest.displayName.trim(),
    version: manifest.version.trim(),
    description: manifest.description.trim(),
    tools: manifest.tools.map((tool) => ({
      name: tool.name.trim(),
      description: tool.description.trim(),
      riskLevel: tool.riskLevel,
      actionType: tool.actionType,
      ...(tool.inputSchema === undefined ? {} : { inputSchema: tool.inputSchema }),
      ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
      ...(tool.strategy === undefined ? {} : { strategy: tool.strategy })
    })),
    requestedPermissions: manifest.requestedPermissions.map((permission) => {
      const normalizedTools = dedupeStrings(permission.tools);
      const normalizedAppNames = dedupeStrings(permission.appNames);
      const normalizedFileRoots = dedupeStrings(permission.fileRoots);
      const normalizedCommandAllowlist = dedupeStrings(permission.commandAllowlist);
      const normalizedNetworkDomains = dedupeStrings(permission.networkDomains);
      const normalizedOauthScopes = dedupeStrings(permission.oauthScopes);

      return {
        ...permission,
        id: permission.id.trim(),
        ...(permission.description === undefined ? {} : { description: permission.description.trim() }),
        ...(permission.generatedToolId === undefined ? {} : { generatedToolId: permission.generatedToolId.trim() }),
        ...(normalizedTools === undefined ? {} : { tools: normalizedTools }),
        ...(permission.strategies === undefined ? {} : { strategies: [...new Set(permission.strategies)] }),
        ...(permission.actionTypes === undefined ? {} : { actionTypes: [...new Set(permission.actionTypes)] }),
        ...(normalizedAppNames === undefined ? {} : { appNames: normalizedAppNames }),
        ...(permission.appSensitivities === undefined
          ? {}
          : { appSensitivities: [...new Set(permission.appSensitivities)] }),
        ...(normalizedFileRoots === undefined ? {} : { fileRoots: normalizedFileRoots }),
        ...(normalizedCommandAllowlist === undefined ? {} : { commandAllowlist: normalizedCommandAllowlist }),
        ...(normalizedNetworkDomains === undefined ? {} : { networkDomains: normalizedNetworkDomains }),
        ...(normalizedOauthScopes === undefined ? {} : { oauthScopes: normalizedOauthScopes })
      };
    }),
    ...(runtimePermissions === undefined ? {} : { runtimePermissions: runtimePermissions.map((permission) => ({ ...permission, id: permission.id.trim(), toolNames: [...new Set(permission.toolNames)], capabilities: [...new Set(permission.capabilities)], allowedOperations: [...new Set(permission.allowedOperations)], ...(permission.sandboxRoots === undefined ? {} : { sandboxRoots: [...new Set(permission.sandboxRoots)] }), ...(permission.outputRoots === undefined ? {} : { outputRoots: [...new Set(permission.outputRoots)] }) })) }),
    requirements: normalizeRequirements(manifest.requirements)
  };
}

function parseManifestInput(input: unknown): { value?: ToolForgeManifest; errors: ToolForgeValidationIssue[] } {
  let parsedInput = input;

  if (typeof input === "string") {
    try {
      parsedInput = JSON.parse(input) as unknown;
    } catch {
      return {
        errors: [issue("manifest.invalid_json", "Manifest string must contain valid JSON.")]
      };
    }
  }

  const parsed = manifestSchema.safeParse(parsedInput);
  if (!parsed.success) {
    return {
      errors: parsed.error.issues.map((entry) =>
        issue("manifest.schema", entry.message, entry.path.length === 0 ? undefined : entry.path.join("."))
      )
    };
  }

  return {
    value: normalizeManifest(parsed.data as ToolForgeManifest),
    errors: []
  };
}

function validateManifestIdentity(manifest: ToolForgeManifest, errors: ToolForgeValidationIssue[]): void {
  if (!MANIFEST_ID_PATTERN.test(manifest.id)) {
    errors.push(issue("manifest.id.invalid", "Manifest id must match ^[a-z][a-z0-9._-]{2,127}$.", "id"));
  }

  if (!VERSION_PATTERN.test(manifest.version)) {
    errors.push(issue("manifest.version.invalid", "Manifest version must use x.y.z numeric semver format.", "version"));
  }
}

function validateToolDeclarations(manifest: ToolForgeManifest, errors: ToolForgeValidationIssue[]): void {
  const names = new Set<string>();

  for (const [index, tool] of manifest.tools.entries()) {
    if (names.has(tool.name)) {
      errors.push(issue("manifest.tool.duplicate", `Duplicate tool declaration: ${tool.name}.`, `tools.${index}.name`));
    }

    names.add(tool.name);
  }
}

function validateFileRoots(
  permission: ToolForgePermissionRequest,
  errors: ToolForgeValidationIssue[]
): void {
  for (const [index, fileRoot] of (permission.fileRoots ?? []).entries()) {
    const normalizedRoot = normalizePathForPolicy(fileRoot, { agentHostDir: "/tmp/agenthost-forge" });
    const pathDecision = classifyPath(fileRoot, FORGE_REVIEW_POLICY, {
      agentHostDir: "/tmp/agenthost-forge",
      access: "write"
    });

    if (
      fileRoot === "/" ||
      fileRoot === "~" ||
      fileRoot === "~/" ||
      pathDecision.riskLevel === "blocked" ||
      !FORGE_ROOTS.some((allowedRoot) => normalizedRoot.startsWith(normalizePathForPolicy(allowedRoot)))
    ) {
      errors.push(
        issue(
          "manifest.permission.file_root_rejected",
          `Requested file root is not allowed for generated tools: ${fileRoot}.`,
          `requestedPermissions.${permission.id}.fileRoots.${index}`
        )
      );
    }
  }
}

function validateCommandAllowlist(
  permission: ToolForgePermissionRequest,
  errors: ToolForgeValidationIssue[],
  warnings: ToolForgeValidationIssue[],
  dangerousPermissions: string[],
  blockedPermissions: string[]
): void {
  for (const command of permission.commandAllowlist ?? []) {
    const decision = classifyShellCommand(command, FORGE_REVIEW_POLICY, { agentHostDir: "/tmp/agenthost-forge" });

    if (decision.riskLevel === "blocked") {
      blockedPermissions.push(permission.id);
      errors.push(
        issue(
          "manifest.permission.command_blocked",
          `Requested shell command allowlist entry is blocked: ${command}.`,
          `requestedPermissions.${permission.id}.commandAllowlist`
        )
      );
      continue;
    }

    if (decision.riskLevel === "high") {
      dangerousPermissions.push(permission.id);
      warnings.push(
        issue(
          "manifest.permission.command_high_risk",
          `Requested shell command allowlist entry is high-risk: ${command}.`,
          `requestedPermissions.${permission.id}.commandAllowlist`
        )
      );
    }
  }
}

function validatePermissionRequest(
  permission: ToolForgePermissionRequest,
  manifest: ToolForgeManifest,
  errors: ToolForgeValidationIssue[],
  warnings: ToolForgeValidationIssue[],
  dangerousPermissions: string[],
  blockedPermissions: string[]
): void {
  if (!MANIFEST_ID_PATTERN.test(permission.id)) {
    errors.push(
      issue(
        "manifest.permission.id.invalid",
        "Permission id must match ^[a-z][a-z0-9._-]{2,127}$.",
        `requestedPermissions.${permission.id}.id`
      )
    );
  }

  if (
    permission.generatedToolId !== undefined &&
    permission.generatedToolId !== manifest.id &&
    !MANIFEST_ID_PATTERN.test(permission.generatedToolId)
  ) {
    errors.push(
      issue(
        "manifest.permission.generated_tool_id.invalid",
        "generatedToolId must be omitted or match the generated tool id format.",
        `requestedPermissions.${permission.id}.generatedToolId`
      )
    );
  }

  if (permission.appSensitivities?.includes("credential_or_security")) {
    blockedPermissions.push(permission.id);
    errors.push(
      issue(
        "manifest.permission.credential_rejected",
        "Generated tool manifests cannot request credential_or_security app access in Phase 13.",
        `requestedPermissions.${permission.id}.appSensitivities`
      )
    );
  }

  validateFileRoots(permission, errors);
  validateCommandAllowlist(permission, errors, warnings, dangerousPermissions, blockedPermissions);

  if (permission.canReadPrivateData === true && permission.dataSensitivity === "secret") {
    blockedPermissions.push(permission.id);
    errors.push(
      issue(
        "manifest.permission.secret_rejected",
        "Secret data access cannot be requested by generated tools in Phase 13.",
        `requestedPermissions.${permission.id}.dataSensitivity`
      )
    );
  }

  const hasDangerousEffect =
    permission.canSendMessages === true || permission.canDeleteData === true || permission.canUploadFiles === true;

  if (hasDangerousEffect) {
    dangerousPermissions.push(permission.id);

    if (manifest.riskDeclaration !== "high" && manifest.riskDeclaration !== "blocked") {
      errors.push(
        issue(
          "manifest.permission.risk_underdeclared",
          "Sending, deleting, or uploading requires a manifest riskDeclaration of high or blocked.",
          `requestedPermissions.${permission.id}`
        )
      );
    } else {
      warnings.push(
        issue(
          "manifest.permission.high_risk",
          "Sending, deleting, or uploading stays high-risk and needs explicit future review.",
          `requestedPermissions.${permission.id}`
        )
      );
    }
  }
}

function validateRuntimePermissionRequest(permission: ToolForgeRuntimePermissionRequest, manifest: ToolForgeManifest, errors: ToolForgeValidationIssue[], blocked: string[]): void {
  if (!MANIFEST_ID_PATTERN.test(permission.id)) errors.push(issue("manifest.runtime_permission.id.invalid", "Runtime permission id is invalid.", `runtimePermissions.${permission.id}.id`));
  for (const toolName of permission.toolNames) if (!manifest.tools.some((tool) => tool.name === toolName)) errors.push(issue("manifest.runtime_permission.tool_missing", `Runtime permission references unknown tool ${toolName}.`, `runtimePermissions.${permission.id}.toolNames`));
  const deferred = permission.capabilities.filter((capability) => !["pure_compute", "read_runtime_input", "write_runtime_output", "use_manifest_metadata", "use_registration_metadata"].includes(capability));
  if (deferred.length > 0) { blocked.push(permission.id); errors.push(issue("manifest.runtime_permission.unsupported", "Requested runtime capability is deferred or blocked in Phase 20.", `runtimePermissions.${permission.id}.capabilities`)); }
  const required = new Set<string>(["pure_compute", "write_runtime_output"]);
  if (permission.allowedOperations.includes("input")) required.add("read_runtime_input");
  if (permission.allowedOperations.includes("manifest")) required.add("use_manifest_metadata");
  if (permission.allowedOperations.includes("registration")) required.add("use_registration_metadata");
  for (const capability of required) if (!permission.capabilities.includes(capability as ToolForgeRuntimePermissionRequest["capabilities"][number])) errors.push(issue("manifest.runtime_permission.capability_missing", `Runtime operation requires ${capability}.`, `runtimePermissions.${permission.id}.capabilities`));
}

export function validateToolForgeManifest(input: unknown): ToolForgeValidationResult {
  const { value: manifest, errors } = parseManifestInput(input);
  const warnings: ToolForgeValidationIssue[] = [];
  const dangerousPermissions: string[] = [];
  const blockedPermissions: string[] = [];

  if (manifest === undefined) {
    return {
      valid: false,
      errors,
      warnings,
      dangerousPermissions,
      blockedPermissions
    };
  }

  validateManifestIdentity(manifest, errors);
  validateToolDeclarations(manifest, errors);

  for (const permission of manifest.requestedPermissions) {
    validatePermissionRequest(permission, manifest, errors, warnings, dangerousPermissions, blockedPermissions);
  }
  for (const permission of manifest.runtimePermissions ?? []) validateRuntimePermissionRequest(permission, manifest, errors, blockedPermissions);

  return {
    valid: errors.length === 0,
    ...(errors.length === 0 ? { manifest } : {}),
    errors,
    warnings,
    dangerousPermissions: [...new Set(dangerousPermissions)],
    blockedPermissions: [...new Set(blockedPermissions)]
  };
}

function mergeRequirements(manifest: ToolForgeManifest, permission: ToolForgePermissionRequest): ToolForgeRequirements {
  return {
    requiresDryRun: permission.requiresDryRun ?? manifest.requirements.requiresDryRun ?? true,
    requiresConfirmationToken:
      permission.requiresConfirmationToken ?? manifest.requirements.requiresConfirmationToken ?? true,
    requiresApproval: permission.requiresApproval ?? manifest.requirements.requiresApproval ?? false
  };
}

function buildGrantMatch(manifest: ToolForgeManifest, permission: ToolForgePermissionRequest): CapabilityGrant["match"] {
  const tools = new Set<string>(permission.tools ?? []);
  const actionTypes = new Set(permission.actionTypes ?? []);
  const strategies = new Set(permission.strategies ?? []);
  const dataSensitivities = new Set<DataSensitivity>();

  if (permission.canRunShell) {
    tools.add("shell.run_safe");
    actionTypes.add("shell_command");
  }

  if (permission.canWriteFiles) {
    tools.add("file.write");
    tools.add("file.ensure_dir");
    actionTypes.add("file_write");
  }

  if (permission.canUseGui) {
    strategies.add("gui_control");
  }

  if (permission.canSendMessages) {
    actionTypes.add("communication_send");
  }

  if (permission.canDeleteData) {
    actionTypes.add("file_delete");
  }

  if (permission.canUploadFiles) {
    actionTypes.add("upload");
  }

  if (permission.canReadPrivateData && permission.dataSensitivity === undefined) {
    dataSensitivities.add("sensitive");
  }

  if (permission.dataSensitivity !== undefined) {
    dataSensitivities.add(permission.dataSensitivity);
  }

  return {
    generatedToolIds: [permission.generatedToolId ?? manifest.id],
    ...(tools.size === 0 ? {} : { tools: [...tools] }),
    ...(strategies.size === 0 ? {} : { strategies: [...strategies] }),
    ...(actionTypes.size === 0 ? {} : { actionTypes: [...actionTypes] }),
    ...(permission.appNames === undefined ? {} : { appNames: permission.appNames }),
    ...(permission.appSensitivities === undefined ? {} : { appSensitivities: permission.appSensitivities }),
    ...(permission.fileRoots === undefined ? {} : { fileRoots: permission.fileRoots }),
    ...(permission.commandAllowlist === undefined ? {} : { commandAllowlist: permission.commandAllowlist }),
    ...(permission.networkDomains === undefined ? {} : { networkDomains: permission.networkDomains }),
    ...(permission.oauthScopes === undefined ? {} : { oauthScopes: permission.oauthScopes }),
    ...(dataSensitivities.size === 0 ? {} : { dataSensitivities: [...dataSensitivities] })
  };
}

function proposeGrantForPermission(
  manifest: ToolForgeManifest,
  permission: ToolForgePermissionRequest,
  scope: "session" | "persistent",
  expiresAt?: string
): ToolForgeGrantProposal {
  const requirements = mergeRequirements(manifest, permission);
  const match = buildGrantMatch(manifest, permission);

  const grantRequirements = {
    ...(requirements.requiresDryRun === undefined ? {} : { requiresDryRun: requirements.requiresDryRun }),
    ...(requirements.requiresConfirmationToken === undefined
      ? {}
      : { requiresConfirmationToken: requirements.requiresConfirmationToken }),
    ...(requirements.requiresApproval === undefined ? {} : { requiresApproval: requirements.requiresApproval }),
    ...(permission.fileRoots === undefined ? {} : { allowedRoots: permission.fileRoots })
  };

  return {
    permissionId: permission.id,
    grant: {
      id: `forge.${manifest.id}.${permission.id}`,
      scope,
      effect: "allow",
      description: permission.description ?? `Generated-tool grant proposal for ${manifest.displayName}.`,
      ...(expiresAt === undefined ? {} : { expiresAt }),
      match,
      ...(Object.keys(grantRequirements).length === 0 ? {} : { requirements: grantRequirements })
    },
    reasons: [
      `Generated tool id ${permission.generatedToolId ?? manifest.id} must match.`,
      "No proposed grant is applied automatically in Phase 13."
    ]
  };
}

function sampleSafetyInput(manifest: ToolForgeManifest, permission: ToolForgePermissionRequest): SafetyInput {
  const match = buildGrantMatch(manifest, permission);
  const actionType =
    match.actionTypes?.[0] ??
    permission.actionTypes?.[0] ??
    (permission.canRunShell
      ? "shell_command"
      : permission.canWriteFiles
        ? "file_write"
        : permission.canUseGui
          ? "gui_click"
          : "inspect");
  const tool =
    match.tools?.[0] ??
    permission.tools?.[0] ??
    (permission.canRunShell
      ? "shell.run_safe"
      : permission.canWriteFiles
        ? "file.write"
        : permission.canUseGui
          ? "desktop.click"
          : "forge.review_manifest");

  return {
    tool,
    actionType,
    generatedTool: true,
    generatedToolId: permission.generatedToolId ?? manifest.id,
    ...(match.strategies?.[0] === undefined ? {} : { strategy: match.strategies[0] }),
    ...(permission.appNames?.[0] === undefined ? {} : { appName: permission.appNames[0] }),
    ...(permission.appSensitivities?.[0] === undefined ? {} : { appId: permission.appSensitivities[0] }),
    ...(permission.fileRoots?.[0] === undefined ? {} : { filePath: permission.fileRoots[0] }),
    ...(permission.commandAllowlist?.[0] === undefined ? {} : { shellCommand: permission.commandAllowlist[0] }),
    ...(permission.dataSensitivity === undefined ? {} : { dataSensitivity: permission.dataSensitivity }),
    ...(permission.canSendMessages ? { communicative: true, externalEffect: true } : {}),
    ...(permission.canDeleteData ? { destructive: true } : {}),
    ...(permission.canUploadFiles ? { externalEffect: true } : {})
  };
}

function reviewPermission(
  manifest: ToolForgeManifest,
  permission: ToolForgePermissionRequest,
  policy: RuntimePolicy,
  grants: CapabilityGrant[],
  scope: "session" | "persistent",
  expiresAt?: string
): ToolForgePermissionReview {
  const proposal = proposeGrantForPermission(manifest, permission, scope, expiresAt);
  const decision = evaluateSafety(sampleSafetyInput(manifest, permission), policy, {
    agentHostDir: "/tmp/agenthost-forge",
    grants
  });
  const dangerous =
    permission.canRunShell === true ||
    permission.canUseGui === true ||
    permission.canSendMessages === true ||
    permission.canDeleteData === true ||
    permission.canUploadFiles === true;
  const blocked =
    decision.blocked ||
    permission.appSensitivities?.includes("credential_or_security") === true ||
    permission.dataSensitivity === "secret";

  return {
    permissionId: permission.id,
    summary: permission.description ?? `Permission request ${permission.id}`,
    riskLevel: maxRisk(decision.riskLevel, dangerous ? "high" : "low"),
    dangerous,
    blocked,
    matchedGrantIds: decision.grantDecision.matchedGrantIds,
    missingGrant: decision.grantDecision.allowedByGrantIds.length === 0,
    reasons: [...new Set(decision.reasons)],
    proposedGrant: proposal.grant
  };
}

export function reviewToolForgeManifest(
  input: unknown,
  options: {
    policy: RuntimePolicy;
    grants?: CapabilityGrant[];
    scope?: "session" | "persistent";
    expiresAt?: string;
  }
): ToolForgeReviewResult {
  const validation = validateToolForgeManifest(input);

  if (!validation.valid || validation.manifest === undefined) {
    return {
      valid: false,
      riskLevel: "blocked",
      dataSensitivity: "secret",
      requestedCapabilities: [],
      dangerousPermissions: validation.dangerousPermissions,
      missingGrants: [],
      matchedGrantIds: [],
      sessionApprovalPossible: false,
      persistentApprovalAllowed: false,
      blockedReasons: validation.errors.map((entry) => entry.message),
      warnings: validation.warnings.map((entry) => entry.message),
      saferAlternatives: ["Use a narrower manifest with approved local file roots and no secret access."]
    };
  }

  const manifest = validation.manifest;
  const reviews = manifest.requestedPermissions.map((permission) =>
    reviewPermission(manifest, permission, options.policy, options.grants ?? [], options.scope ?? "session", options.expiresAt)
  );
  const blockedReasons = [
    ...validation.errors.map((entry) => entry.message),
    ...reviews.filter((review) => review.blocked).flatMap((review) => review.reasons)
  ];
  const matchedGrantIds = [...new Set(reviews.flatMap((review) => review.matchedGrantIds))];
  const missingGrants = reviews.filter((review) => review.missingGrant).map((review) => review.permissionId);
  const dangerFlags = new Set<string>(validation.dangerousPermissions);
  for (const review of reviews) {
    if (review.dangerous) {
      dangerFlags.add(review.permissionId);
    }
  }

  const saferAlternatives: string[] = [];

  if (manifest.requestedPermissions.some((permission) => permission.canUseGui === true)) {
    saferAlternatives.push("Prefer accessibility or app-adapter permissions before raw GUI control.");
  }

  if (manifest.requestedPermissions.some((permission) => permission.canRunShell === true)) {
    saferAlternatives.push("Prefer scoped file or adapter capabilities before shell access.");
  }

  if (manifest.requestedPermissions.some((permission) => permission.canReadPrivateData === true)) {
    saferAlternatives.push("Prefer non-sensitive sample data or guide mode when private-data access is unnecessary.");
  }

  const persistentApprovalAllowed =
    validation.errors.length === 0 &&
    !manifest.requestedPermissions.some(
      (permission) =>
        permission.canRunShell === true ||
        permission.canUseGui === true ||
        permission.canSendMessages === true ||
        permission.canDeleteData === true ||
        permission.canUploadFiles === true ||
        permission.dataSensitivity === "sensitive" ||
        permission.dataSensitivity === "secret" ||
        permission.appSensitivities?.some((value) => value !== "normal" && value !== "unknown") === true
    );

  return {
    valid: true,
    manifestId: manifest.id,
    displayName: manifest.displayName,
    kind: manifest.kind,
    riskLevel: maxRisk(
      manifest.riskDeclaration,
      reviews.reduce<RiskLevel>((current, review) => maxRisk(current, review.riskLevel), "observe")
    ),
    dataSensitivity: manifest.dataSensitivityDeclaration,
    requestedCapabilities: reviews,
    dangerousPermissions: [...dangerFlags],
    missingGrants,
    matchedGrantIds,
    sessionApprovalPossible: blockedReasons.length === 0,
    persistentApprovalAllowed,
    blockedReasons: [...new Set(blockedReasons)],
    warnings: validation.warnings.map((entry) => entry.message),
    saferAlternatives
  };
}

export function proposeToolForgeGrants(
  input: unknown,
  options: { scope?: "session" | "persistent"; expiresAt?: string } = {}
): ToolForgeGrantProposalResult {
  const validation = validateToolForgeManifest(input);

  if (!validation.valid || validation.manifest === undefined) {
    throw new Error("Cannot propose grants for an invalid manifest.");
  }

  const manifest = validation.manifest;

  return {
    manifestId: manifest.id,
    proposals: [...manifest.requestedPermissions.map((permission) => proposeGrantForPermission(manifest, permission, options.scope ?? "session", options.expiresAt)), ...(manifest.runtimePermissions ?? []).map((permission) => ({ permissionId: permission.id, reasons: ["Runtime capability declaration requires explicit grant."], grant: { id: `forge.runtime.${manifest.id}.${permission.id}`, scope: options.scope ?? "session", effect: "allow" as const, ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }), match: { generatedToolIds: [manifest.id], runtimeToolNames: permission.toolNames, runtimeCapabilities: permission.capabilities }, requirements: { requiresDryRun: permission.requiresDryRun ?? true, requiresConfirmationToken: permission.requiresConfirmationToken ?? true, requiresApproval: permission.requiresApproval ?? false, ...(permission.maxInputBytes === undefined ? {} : { maxInputBytes: permission.maxInputBytes }), ...(permission.maxOutputBytes === undefined ? {} : { maxOutputBytes: permission.maxOutputBytes }), ...(permission.maxRuntimeMs === undefined ? {} : { maxRuntimeMs: permission.maxRuntimeMs }), allowedOperations: permission.allowedOperations } } }))],
    warnings: validation.warnings.map((entry) => entry.message)
  };
}
