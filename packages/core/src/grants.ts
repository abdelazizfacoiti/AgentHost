import { normalizePathForPolicy } from "./safety/path-policy.js";
import type {
  AppSensitivity,
  CapabilityGrant,
  CapabilityGrantMatch,
  GrantDecision,
  GrantSummary,
  PermissionDefault,
  PolicyProfile,
  PolicyProfileSummary,
  RiskLevel,
  SafetyEvaluationContext,
  SafetyInput
} from "./types.js";

const STATE_CHANGING_ACTIONS: ReadonlySet<SafetyInput["actionType"]> = new Set([
  "app_launch",
  "shell_command",
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
]);

const RISK_ORDER: RiskLevel[] = ["observe", "low", "medium", "high", "blocked"];

export interface GrantEvaluationResult {
  decision: GrantDecision;
  blocked: boolean;
  guideOnly: boolean;
  reasons: string[];
  matchedRules: string[];
}

function riskRank(riskLevel: RiskLevel): number {
  return RISK_ORDER.indexOf(riskLevel);
}

function namesEqual(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function commandMatches(command: string, allowEntry: string): boolean {
  const normalizedCommand = command.trim();
  const normalizedAllow = allowEntry.trim();

  return normalizedCommand === normalizedAllow || normalizedCommand.startsWith(`${normalizedAllow} `);
}

function pathMatchesRoot(inputPath: string, roots: string[], context: SafetyEvaluationContext): boolean {
  const normalized = normalizePathForPolicy(inputPath, context);
  return roots.some((root) => {
    const normalizedRoot = normalizePathForPolicy(root, context);
    return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`);
  });
}

export function isGrantExpired(grant: CapabilityGrant): boolean {
  return grant.expiresAt !== undefined && Date.now() > Date.parse(grant.expiresAt);
}

function matchesStringList(candidate: string | undefined, values: string[] | undefined): boolean {
  if (values === undefined || values.length === 0) {
    return true;
  }

  if (candidate === undefined) {
    return false;
  }

  return values.some((value) => namesEqual(candidate, value));
}

function matchesExactList<T extends string>(candidate: T | undefined, values: readonly T[] | undefined): boolean {
  if (values === undefined || values.length === 0) {
    return true;
  }

  return candidate !== undefined && values.includes(candidate);
}

function toAppSensitivity(value: string): AppSensitivity {
  switch (value) {
    case "normal":
    case "communication":
    case "financial":
    case "credential_or_security":
    case "system_settings":
    case "unknown":
      return value;
    default:
      return "unknown";
  }
}

function grantMatches(
  grant: CapabilityGrant,
  input: SafetyInput,
  appSensitivity: AppSensitivity,
  context: SafetyEvaluationContext
): boolean {
  const match: CapabilityGrantMatch = grant.match;

  if (!matchesStringList(input.tool, match.tools)) {
    return false;
  }

  if (!matchesExactList(input.strategy, match.strategies)) {
    return false;
  }

  if (!matchesExactList(input.actionType, match.actionTypes)) {
    return false;
  }

  if (!matchesStringList(input.appName, match.appNames)) {
    return false;
  }

  if (!matchesStringList(input.appId, match.appIds)) {
    return false;
  }

  if (!matchesExactList(toAppSensitivity(appSensitivity), match.appSensitivities)) {
    return false;
  }

  if (!matchesExactList(input.dataSensitivity, match.dataSensitivities)) {
    return false;
  }

  if (match.fileRoots !== undefined && match.fileRoots.length > 0) {
    if (input.filePath === undefined || !pathMatchesRoot(input.filePath, match.fileRoots, context)) {
      return false;
    }
  }

  if (match.commandAllowlist !== undefined && match.commandAllowlist.length > 0) {
    if (input.shellCommand === undefined || !match.commandAllowlist.some((entry) => commandMatches(input.shellCommand!, entry))) {
      return false;
    }
  }

  if (match.generatedToolIds !== undefined && match.generatedToolIds.length > 0) {
    if (input.generatedToolId === undefined || !match.generatedToolIds.includes(input.generatedToolId)) {
      return false;
    }
  }

  if (
    grant.requirements?.allowedRoots !== undefined &&
    grant.requirements.allowedRoots.length > 0 &&
    (input.filePath === undefined || !pathMatchesRoot(input.filePath, grant.requirements.allowedRoots, context))
  ) {
    return false;
  }

  return true;
}

export function isStateChangingAction(actionType: SafetyInput["actionType"]): boolean {
  return STATE_CHANGING_ACTIONS.has(actionType);
}

export function policyDefaultForInput(policy: PolicyProfile, input: SafetyInput): PermissionDefault {
  if (input.tool === "desktop.screenshot") {
    return policy.defaults.screenshots;
  }

  if (input.tool === "window.focus") {
    return policy.allowGenericClick ? "allow" : policy.defaults.windowFocus;
  }

  if (input.tool === "desktop.hotkey") {
    return policy.allowGenericType ? "allow" : policy.defaults.guiHotkey;
  }

  if (input.generatedTool === true) {
    return policy.defaults.generatedTools;
  }

  if (input.dataSensitivity === "sensitive" || input.dataSensitivity === "secret") {
    return policy.defaults.privateDataReads;
  }

  switch (input.actionType) {
    case "observe":
    case "inspect":
      return input.actionType === "inspect" ? policy.defaults.accessibilityRead : "allow";
    case "app_launch":
      return policy.defaults.appOpen;
    case "shell_command":
      return policy.defaults.shell;
    case "file_read":
      return policy.defaults.fileRead;
    case "file_write":
    case "file_delete":
      return input.destructive ? policy.defaults.destructiveActions : policy.defaults.fileWrite;
    case "gui_click":
      return policy.allowGenericClick ? "allow" : policy.defaults.guiClick;
    case "gui_type":
      return policy.allowGenericType ? "allow" : policy.defaults.guiType;
    case "accessibility_action":
    case "accessibility_set_value":
    case "accessibility_focus":
      return policy.defaults.accessibilityActions;
    case "browser_action":
      return policy.defaults.browserAutomation;
    case "communication_send":
      return policy.defaults.communicationActions;
    case "upload":
      return policy.defaults.externalSendsUploads;
    case "system_change":
      return policy.defaults.destructiveActions;
    case "unknown":
      return "approval_required";
  }
}

export function evaluateGrantDecision(
  input: SafetyInput,
  policy: PolicyProfile,
  grants: CapabilityGrant[],
  appSensitivity: AppSensitivity,
  context: SafetyEvaluationContext = {}
): GrantEvaluationResult {
  const matchedGrants = grants.filter((grant) => !isGrantExpired(grant) && grantMatches(grant, input, appSensitivity, context));
  const matchedGrantIds = matchedGrants.map((grant) => grant.id);
  const allowedByGrantIds = matchedGrants.filter((grant) => grant.effect === "allow").map((grant) => grant.id);
  const deniedByGrantIds = matchedGrants.filter((grant) => grant.effect === "deny").map((grant) => grant.id);
  const guideOnlyByGrantIds = matchedGrants.filter((grant) => grant.effect === "guide_only").map((grant) => grant.id);
  const reasons: string[] = [];
  const matchedRules: string[] = [];

  let requiresDryRun = policy.requireDryRunForStateChanging && isStateChangingAction(input.actionType);
  let requiresConfirmationToken = policy.requireConfirmationForStateChanging && isStateChangingAction(input.actionType);
  let requiresApproval = false;
  let requiresExactTarget = policy.requireExactTargetForStateChanging && isStateChangingAction(input.actionType);
  let blockedByDefault = false;
  let guideOnlyByDefault = false;
  let blockedByGrant = false;
  let guideOnlyByGrant = false;

  const defaultPermission = policyDefaultForInput(policy, input);
  if (defaultPermission === "deny") {
    blockedByDefault = true;
    reasons.push(`Profile ${policy.name} denies this capability by default.`);
    matchedRules.push(`profile.default.${input.actionType}.deny`);
  } else if (defaultPermission === "guide_only") {
    guideOnlyByDefault = true;
    reasons.push(`Profile ${policy.name} routes this capability to guide mode by default.`);
    matchedRules.push(`profile.default.${input.actionType}.guide_only`);
  } else if (defaultPermission === "approval_required") {
    requiresApproval = true;
    reasons.push(`Profile ${policy.name} requires approval for this capability by default.`);
    matchedRules.push(`profile.default.${input.actionType}.approval_required`);
  }

  for (const grant of matchedGrants) {
    matchedRules.push(`grant.${grant.id}.${grant.effect}`);

    if (grant.effect === "deny") {
      blockedByGrant = true;
      reasons.push(`Grant ${grant.id} denies this action.`);
    } else if (grant.effect === "guide_only") {
      guideOnlyByGrant = true;
      reasons.push(`Grant ${grant.id} routes this action to guide mode.`);
    } else if (grant.requirements?.maxRiskLevel !== undefined && riskRank(grant.requirements.maxRiskLevel) < riskRank("blocked")) {
      reasons.push(`Grant ${grant.id} allows the capability within its declared risk cap.`);
    }

    if (grant.requirements?.requiresDryRun === true) {
      requiresDryRun = true;
    }

    if (grant.requirements?.requiresConfirmationToken === true) {
      requiresConfirmationToken = true;
    }

    if (grant.requirements?.requiresApproval === true) {
      requiresApproval = true;
    }

    if (grant.requirements?.requiresExactTarget === true) {
      requiresExactTarget = true;
    }
  }

  if (allowedByGrantIds.length > 0) {
    blockedByDefault = false;
    guideOnlyByDefault = false;
  }

  const blocked = blockedByDefault || blockedByGrant;
  const guideOnly = guideOnlyByDefault || guideOnlyByGrant;

  return {
    decision: {
      matchedGrantIds,
      allowedByGrantIds,
      deniedByGrantIds,
      guideOnlyByGrantIds,
      requiresDryRun,
      requiresConfirmationToken,
      requiresApproval,
      requiresExactTarget
    },
    blocked,
    guideOnly,
    reasons,
    matchedRules
  };
}

export function summarizePolicyProfile(profile: PolicyProfile): PolicyProfileSummary {
  return {
    name: profile.name,
    description: profile.description,
    enabled: profile.enabled,
    defaults: { ...profile.defaults },
    requireDryRunForStateChanging: profile.requireDryRunForStateChanging,
    requireConfirmationForStateChanging: profile.requireConfirmationForStateChanging,
    requireExactTargetForStateChanging: profile.requireExactTargetForStateChanging
  };
}

export function summarizeGrant(grant: CapabilityGrant): GrantSummary {
  return {
    id: grant.id,
    scope: grant.scope,
    effect: grant.effect,
    ...(grant.description === undefined ? {} : { description: grant.description }),
    ...(grant.createdAt === undefined ? {} : { createdAt: grant.createdAt }),
    ...(grant.expiresAt === undefined ? {} : { expiresAt: grant.expiresAt }),
    active: !isGrantExpired(grant),
    match: {
      ...grant.match,
      ...(grant.match.tools === undefined ? {} : { tools: [...grant.match.tools] }),
      ...(grant.match.strategies === undefined ? {} : { strategies: [...grant.match.strategies] }),
      ...(grant.match.actionTypes === undefined ? {} : { actionTypes: [...grant.match.actionTypes] }),
      ...(grant.match.appNames === undefined ? {} : { appNames: [...grant.match.appNames] }),
      ...(grant.match.appIds === undefined ? {} : { appIds: [...grant.match.appIds] }),
      ...(grant.match.appSensitivities === undefined ? {} : { appSensitivities: [...grant.match.appSensitivities] }),
      ...(grant.match.dataSensitivities === undefined ? {} : { dataSensitivities: [...grant.match.dataSensitivities] }),
      ...(grant.match.fileRoots === undefined ? {} : { fileRoots: [...grant.match.fileRoots] }),
      ...(grant.match.commandAllowlist === undefined ? {} : { commandAllowlist: [...grant.match.commandAllowlist] }),
      ...(grant.match.networkDomains === undefined ? {} : { networkDomains: [...grant.match.networkDomains] }),
      ...(grant.match.oauthScopes === undefined ? {} : { oauthScopes: [...grant.match.oauthScopes] }),
      ...(grant.match.generatedToolIds === undefined
        ? {}
        : { generatedToolIds: [...grant.match.generatedToolIds] }),
      ...(grant.match.registrationIds === undefined ? {} : { registrationIds: [...grant.match.registrationIds] }),
      ...(grant.match.runtimeToolNames === undefined ? {} : { runtimeToolNames: [...grant.match.runtimeToolNames] }),
      ...(grant.match.runtimeCapabilities === undefined ? {} : { runtimeCapabilities: [...grant.match.runtimeCapabilities] })
    },
    ...(grant.requirements === undefined
      ? {}
      : {
          requirements: {
            ...grant.requirements,
            ...(grant.requirements.allowedRoots === undefined
              ? {}
              : { allowedRoots: [...grant.requirements.allowedRoots] }),
            ...(grant.requirements.allowedOperations === undefined ? {} : { allowedOperations: [...grant.requirements.allowedOperations] }),
            ...(grant.requirements.sandboxRoots === undefined ? {} : { sandboxRoots: [...grant.requirements.sandboxRoots] }),
            ...(grant.requirements.outputRoots === undefined ? {} : { outputRoots: [...grant.requirements.outputRoots] })
          }
        })
  };
}
