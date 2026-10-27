import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { getDefaultPolicy } from "./policies.js";
import { PHASE20_HARD_LIMITS, PHASE20_SUPPORTED_RUNTIME_CAPABILITIES } from "./runtime-grants.js";
import type { AgentHostConfig, CapabilityGrant, CapabilityGrantMatch, CapabilityGrantRequirements, ForgeRuntimeSandboxMode, ToolForgeRuntimeCapability, ToolForgeRuntimeOperation } from "./types.js";
import type { OverlayRendererMode, OverlayPublicConfig } from "./overlay.js";

const forgeRuntimeSandboxModeSchema = z.enum(["auto", "none", "bubblewrap", "firejail", "unshare"]);
const overlayRendererModeSchema = z.enum(["headless", "auto", "gtk3-x11", "gtk3-native", "webkit-gtk-react", "disabled"]);
const overlaySchema = z.object({
  rendererMode: overlayRendererModeSchema.optional(),
  mode: z.enum(["always", "on_change", "off"]).optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
  density: z.enum(["compact", "normal"]).optional(),
  reducedMotion: z.boolean().optional(),
  persistent: z.boolean().optional(),
  autoHideMs: z.number().int().min(0).max(86_400_000).optional(),
  /** Deprecated: accepted for older configs, ignored. Use persistent/autoHideMs. */
  terminalAutoHideMs: z.number().int().min(0).max(300_000).optional(),
  preferredPosition: z.enum(["top_left", "top_center", "top_right", "bottom_left", "bottom_center", "bottom_right"]).optional(),
  maxWidth: z.number().int().min(240).max(1200).optional(),
  multiMonitor: z.enum(["primary", "all"]).optional()
}).strict();
const executionSchema = z.object({ placement: z.enum(["foreground", "background"]).optional() }).strict();
const speechSchema = z.object({
  enabled: z.boolean().optional(),
  providerPreference: z.array(z.enum(["espeak-ng", "piper", "speech-dispatcher"])).min(1).max(3).optional(),
  defaultProvider: z.enum(["espeak-ng", "piper", "speech-dispatcher"]).optional(),
  artifactTtlMs: z.number().int().positive().max(86_400_000).optional(),
  maxTextChars: z.number().int().positive().max(20_000).optional(),
  maxDurationMs: z.number().int().positive().max(300_000).optional(),
  maxArtifactBytes: z.number().int().positive().max(50_000_000).optional(),
  synthesisTimeoutMs: z.number().int().positive().max(60_000).optional(),
  playbackTimeoutMs: z.number().int().positive().max(300_000).optional()
}).strict();

const automationStrategySchema = z.enum([
  "app_adapter",
  "official_api",
  "cli_or_script",
  "browser_automation",
  "accessibility",
  "gui_control",
  "guide_only"
]);

const actionTypeSchema = z.enum([
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
]);

const appSensitivitySchema = z.enum([
  "normal",
  "communication",
  "financial",
  "credential_or_security",
  "system_settings",
  "unknown"
]);

const dataSensitivitySchema = z.enum(["none", "low", "sensitive", "secret"]);
const riskLevelSchema = z.enum(["observe", "low", "medium", "high", "blocked"]);
const runtimeCapabilitySchema = z.enum(PHASE20_SUPPORTED_RUNTIME_CAPABILITIES as [ToolForgeRuntimeCapability, ...ToolForgeRuntimeCapability[]]);
const runtimeOperationSchema = z.enum(["const", "input", "object", "array", "concat", "length", "get", "equals", "if", "join", "sum", "map", "filter", "var", "manifest", "registration"] as [ToolForgeRuntimeOperation, ...ToolForgeRuntimeOperation[]]);
const boundedRuntimeLimit = (maximum: number) => z.number().int().positive().max(maximum);

const capabilityGrantSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    scope: z.enum(["session", "persistent"]),
    effect: z.enum(["allow", "deny", "guide_only"]),
    description: z.string().trim().min(1).max(500).optional(),
    createdAt: z.string().datetime().optional(),
    expiresAt: z.string().datetime().optional(),
    match: z
      .object({
        tools: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
        strategies: z.array(automationStrategySchema).max(20).optional(),
        actionTypes: z.array(actionTypeSchema).max(50).optional(),
        appNames: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
        appIds: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
        appSensitivities: z.array(appSensitivitySchema).max(20).optional(),
        dataSensitivities: z.array(dataSensitivitySchema).max(20).optional(),
        fileRoots: z.array(z.string().trim().min(1).max(1000)).max(100).optional(),
        commandAllowlist: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
        networkDomains: z.array(z.string().trim().min(1).max(300)).max(100).optional(),
        oauthScopes: z.array(z.string().trim().min(1).max(300)).max(100).optional(),
        generatedToolIds: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
        registrationIds: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
        runtimeToolNames: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
        runtimeCapabilities: z.array(runtimeCapabilitySchema).max(20).optional(),
        operationFamilies: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
        operations: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
        targetFingerprints: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(50).optional(),
        recipientFingerprints: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(50).optional(),
        contentFingerprints: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(50).optional(),
        artifactFingerprints: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(50).optional(),
        channels: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
        routes: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
        ownerSessionIds: z.array(z.string().trim().min(1).max(160)).max(20).optional()
      })
      .strict(),
    requirements: z
      .object({
        requiresDryRun: z.boolean().optional(),
        requiresConfirmationToken: z.boolean().optional(),
        requiresApproval: z.boolean().optional(),
        requiresExactTarget: z.boolean().optional(),
        maxRiskLevel: riskLevelSchema.optional(),
        allowedRoots: z.array(z.string().trim().min(1).max(1000)).max(100).optional(),
        sandboxRoots: z.array(z.enum(["run", "temp"])).max(2).optional(),
        outputRoots: z.array(z.enum(["run"])).max(1).optional(),
        maxInputBytes: boundedRuntimeLimit(PHASE20_HARD_LIMITS.maxInputBytes).optional(),
        maxOutputBytes: boundedRuntimeLimit(PHASE20_HARD_LIMITS.maxOutputBytes).optional(),
        maxRuntimeMs: boundedRuntimeLimit(PHASE20_HARD_LIMITS.maxRuntimeMs).optional(),
        allowedOperations: z.array(runtimeOperationSchema).max(50).optional()
      })
      .strict()
      .optional()
  })
  .strict();

const configFileSchema = z
  .object({
    schemaVersion: z.literal(1).optional(),
    agentHostDir: z.string().min(1).optional(),
    logFile: z.string().min(1).optional(),
    forgeRuntimeSandboxMode: forgeRuntimeSandboxModeSchema.optional(),
    overlayRendererMode: overlayRendererModeSchema.optional(),
    overlay: overlaySchema.optional(),
    execution: executionSchema.optional(),
    speech: speechSchema.optional(),
    optionalAdapters: z.record(z.object({ enabled: z.boolean() }).strict()).optional(),
    grants: z.array(capabilityGrantSchema).max(500).optional()
  })
  .strict();

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  configPath?: string;
}

function expandHome(input: string, homeDir: string): string {
  if (input === "~") {
    return homeDir;
  }

  if (input.startsWith("~/")) {
    return path.join(homeDir, input.slice(2));
  }

  return input;
}

function resolveLocalPath(input: string, homeDir: string): string {
  const expanded = expandHome(input, homeDir);
  return path.isAbsolute(expanded) ? expanded : path.resolve(expanded);
}

/** Dead pre-P1 config surfaces: accepted for older files, stripped before strict parsing. */
const LEGACY_CONFIG_KEYS = ["runtimeActivityOverlay", "browserBridge", "controlRoom", "profile"] as const;

async function readConfigFile(configPath: string): Promise<z.infer<typeof configFileSchema>> {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      for (const key of LEGACY_CONFIG_KEYS) delete (parsed as Record<string, unknown>)[key];
    }
    return configFileSchema.parse(parsed);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

function normalizeGrantMatch(match: z.infer<typeof capabilityGrantSchema>["match"]): CapabilityGrantMatch {
  return {
    ...(match.tools === undefined ? {} : { tools: match.tools }),
    ...(match.strategies === undefined ? {} : { strategies: match.strategies }),
    ...(match.actionTypes === undefined ? {} : { actionTypes: match.actionTypes }),
    ...(match.appNames === undefined ? {} : { appNames: match.appNames }),
    ...(match.appIds === undefined ? {} : { appIds: match.appIds }),
    ...(match.appSensitivities === undefined ? {} : { appSensitivities: match.appSensitivities }),
    ...(match.dataSensitivities === undefined ? {} : { dataSensitivities: match.dataSensitivities }),
    ...(match.fileRoots === undefined ? {} : { fileRoots: match.fileRoots }),
    ...(match.commandAllowlist === undefined ? {} : { commandAllowlist: match.commandAllowlist }),
    ...(match.networkDomains === undefined ? {} : { networkDomains: match.networkDomains }),
    ...(match.oauthScopes === undefined ? {} : { oauthScopes: match.oauthScopes }),
    ...(match.generatedToolIds === undefined ? {} : { generatedToolIds: match.generatedToolIds }),
    ...(match.registrationIds === undefined ? {} : { registrationIds: match.registrationIds }),
    ...(match.runtimeToolNames === undefined ? {} : { runtimeToolNames: match.runtimeToolNames }),
    ...(match.runtimeCapabilities === undefined ? {} : { runtimeCapabilities: match.runtimeCapabilities }),
    ...(match.operationFamilies === undefined ? {} : { operationFamilies: match.operationFamilies }),
    ...(match.operations === undefined ? {} : { operations: match.operations }),
    ...(match.targetFingerprints === undefined ? {} : { targetFingerprints: match.targetFingerprints }),
    ...(match.recipientFingerprints === undefined ? {} : { recipientFingerprints: match.recipientFingerprints }),
    ...(match.contentFingerprints === undefined ? {} : { contentFingerprints: match.contentFingerprints }),
    ...(match.artifactFingerprints === undefined ? {} : { artifactFingerprints: match.artifactFingerprints }),
    ...(match.channels === undefined ? {} : { channels: match.channels }),
    ...(match.routes === undefined ? {} : { routes: match.routes }),
    ...(match.ownerSessionIds === undefined ? {} : { ownerSessionIds: match.ownerSessionIds })
  };
}

function normalizeGrantRequirements(
  requirements: z.infer<typeof capabilityGrantSchema>["requirements"]
): CapabilityGrantRequirements | undefined {
  if (requirements === undefined) {
    return undefined;
  }

  return {
    ...(requirements.requiresDryRun === undefined ? {} : { requiresDryRun: requirements.requiresDryRun }),
    ...(requirements.requiresConfirmationToken === undefined
      ? {}
      : { requiresConfirmationToken: requirements.requiresConfirmationToken }),
    ...(requirements.requiresApproval === undefined ? {} : { requiresApproval: requirements.requiresApproval }),
    ...(requirements.requiresExactTarget === undefined ? {} : { requiresExactTarget: requirements.requiresExactTarget }),
    ...(requirements.maxRiskLevel === undefined ? {} : { maxRiskLevel: requirements.maxRiskLevel }),
    ...(requirements.allowedRoots === undefined ? {} : { allowedRoots: requirements.allowedRoots }),
    ...(requirements.sandboxRoots === undefined ? {} : { sandboxRoots: requirements.sandboxRoots }),
    ...(requirements.outputRoots === undefined ? {} : { outputRoots: requirements.outputRoots }),
    ...(requirements.maxInputBytes === undefined ? {} : { maxInputBytes: requirements.maxInputBytes }),
    ...(requirements.maxOutputBytes === undefined ? {} : { maxOutputBytes: requirements.maxOutputBytes }),
    ...(requirements.maxRuntimeMs === undefined ? {} : { maxRuntimeMs: requirements.maxRuntimeMs }),
    ...(requirements.allowedOperations === undefined ? {} : { allowedOperations: requirements.allowedOperations })
  };
}

function normalizeGrant(grant: z.infer<typeof capabilityGrantSchema>): CapabilityGrant {
  const requirements = normalizeGrantRequirements(grant.requirements);

  return {
    id: grant.id,
    scope: grant.scope,
    effect: grant.effect,
    ...(grant.description === undefined ? {} : { description: grant.description }),
    ...(grant.createdAt === undefined ? {} : { createdAt: grant.createdAt }),
    ...(grant.expiresAt === undefined ? {} : { expiresAt: grant.expiresAt }),
    match: normalizeGrantMatch(grant.match),
    ...(requirements === undefined ? {} : { requirements })
  };
}

export async function loadAgentHostConfig(options: LoadConfigOptions = {}): Promise<AgentHostConfig> {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const defaultAgentHostDir = path.join(homeDir, ".agenthost");
  const initialAgentHostDir = resolveLocalPath(env.AGENTHOST_HOME ?? defaultAgentHostDir, homeDir);
  const configPath = resolveLocalPath(options.configPath ?? env.AGENTHOST_CONFIG ?? path.join(initialAgentHostDir, "config.json"), homeDir);
  const fileConfig = await readConfigFile(configPath);

  const agentHostDir = resolveLocalPath(env.AGENTHOST_HOME ?? fileConfig.agentHostDir ?? initialAgentHostDir, homeDir);
  const forgeRuntimeSandboxMode = forgeRuntimeSandboxModeSchema.parse(
    (env.AGENTHOST_FORGE_RUNTIME_SANDBOX_MODE ?? fileConfig.forgeRuntimeSandboxMode ?? "auto") as ForgeRuntimeSandboxMode
  );
  const overlayRendererMode = overlayRendererModeSchema.parse(
    (env.AGENTHOST_OVERLAY_MODE ?? fileConfig.overlay?.rendererMode ?? fileConfig.overlayRendererMode ?? "auto") as OverlayRendererMode
  );
  const overlay: OverlayPublicConfig = {
    rendererMode: overlayRendererMode,
    mode: fileConfig.overlay?.mode ?? "always",
    theme: fileConfig.overlay?.theme ?? "system",
    density: fileConfig.overlay?.density ?? "normal",
    reducedMotion: fileConfig.overlay?.reducedMotion ?? false,
    persistent: fileConfig.overlay?.persistent ?? true,
    autoHideMs: fileConfig.overlay?.autoHideMs ?? (fileConfig.overlay?.persistent === false ? 15_000 : 0),
    preferredPosition: fileConfig.overlay?.preferredPosition ?? "top_right",
    maxWidth: fileConfig.overlay?.maxWidth ?? 520,
    multiMonitor: fileConfig.overlay?.multiMonitor ?? "primary"
  };
  const grants = (fileConfig.grants ?? []).map((grant) => normalizeGrant(grant));
  const placement = z.enum(["foreground", "background"]).parse(env.AGENTHOST_EXECUTION_PLACEMENT ?? fileConfig.execution?.placement ?? "foreground");
  const execution = { placement };
  const speech = {
    enabled: fileConfig.speech?.enabled ?? true,
    providerPreference: fileConfig.speech?.providerPreference ?? ["espeak-ng", "piper", "speech-dispatcher"] as Array<"espeak-ng" | "piper" | "speech-dispatcher">,
    ...(fileConfig.speech?.defaultProvider === undefined ? {} : { defaultProvider: fileConfig.speech.defaultProvider }),
    artifactTtlMs: fileConfig.speech?.artifactTtlMs ?? 900_000,
    maxTextChars: fileConfig.speech?.maxTextChars ?? 4_000,
    maxDurationMs: fileConfig.speech?.maxDurationMs ?? 120_000,
    maxArtifactBytes: fileConfig.speech?.maxArtifactBytes ?? 20_000_000,
    synthesisTimeoutMs: fileConfig.speech?.synthesisTimeoutMs ?? 30_000,
    playbackTimeoutMs: fileConfig.speech?.playbackTimeoutMs ?? 300_000
  };
  const logFile = resolveLocalPath(
    env.AGENTHOST_LOG_FILE ?? fileConfig.logFile ?? path.join(agentHostDir, "logs", "agenthost.jsonl"),
    homeDir
  );

  return {
    schemaVersion: 1,
    agentHostDir,
    configPath,
    logFile,
    forgeRuntimeSandboxMode,
    overlayRendererMode,
    overlay,
    execution,
    speech,
    optionalAdapters: fileConfig.optionalAdapters ?? {},
    policy: getDefaultPolicy({ grants })
  };
}
