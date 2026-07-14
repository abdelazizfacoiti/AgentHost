import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { getPolicyProfile } from "./policies.js";
import { PHASE20_HARD_LIMITS, PHASE20_SUPPORTED_RUNTIME_CAPABILITIES } from "./runtime-grants.js";
import type { AgentHostConfig, CapabilityGrant, CapabilityGrantMatch, CapabilityGrantRequirements, ForgeRuntimeSandboxMode, PolicyProfileName, ToolForgeRuntimeCapability, ToolForgeRuntimeOperation } from "./types.js";
import type { OverlayRendererMode } from "./overlay.js";

const policyProfileNameSchema = z.enum([
  "strict",
  "dev",
  "gui-dev",
  "demo-unlocked-local",
  "private-data",
  "autopilot-future-disabled-by-default"
]);

const forgeRuntimeSandboxModeSchema = z.enum(["auto", "none", "bubblewrap", "firejail", "unshare"]);
const overlayRendererModeSchema = z.enum(["headless", "auto", "gtk3-x11"]);
const browserBridgeSchema = z.object({ enabled: z.boolean().optional(), port: z.number().int().min(1024).max(65535).optional(), pairingTokenFile: z.string().min(1).optional() }).strict();

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
        runtimeCapabilities: z.array(runtimeCapabilitySchema).max(20).optional()
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
    agentHostDir: z.string().min(1).optional(),
    logFile: z.string().min(1).optional(),
    profile: policyProfileNameSchema.optional(),
    forgeRuntimeSandboxMode: forgeRuntimeSandboxModeSchema.optional(),
    overlayRendererMode: overlayRendererModeSchema.optional(),
    browserBridge: browserBridgeSchema.optional(),
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

async function readConfigFile(configPath: string): Promise<z.infer<typeof configFileSchema>> {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
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
    ...(match.runtimeCapabilities === undefined ? {} : { runtimeCapabilities: match.runtimeCapabilities })
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
  const configPath = resolveLocalPath(options.configPath ?? path.join(initialAgentHostDir, "config.json"), homeDir);
  const fileConfig = await readConfigFile(configPath);

  const agentHostDir = resolveLocalPath(env.AGENTHOST_HOME ?? fileConfig.agentHostDir ?? initialAgentHostDir, homeDir);
  const profile = (env.AGENTHOST_PROFILE ?? fileConfig.profile ?? "strict") as PolicyProfileName;
  const parsedProfile = policyProfileNameSchema.parse(profile);
  const forgeRuntimeSandboxMode = forgeRuntimeSandboxModeSchema.parse(
    (env.AGENTHOST_FORGE_RUNTIME_SANDBOX_MODE ?? fileConfig.forgeRuntimeSandboxMode ?? "auto") as ForgeRuntimeSandboxMode
  );
  const overlayRendererMode = overlayRendererModeSchema.parse(
    (env.AGENTHOST_OVERLAY_MODE ?? fileConfig.overlayRendererMode ?? "headless") as OverlayRendererMode
  );
  const grants = (fileConfig.grants ?? []).map((grant) => normalizeGrant(grant));
  const browserEnabled = env.AGENTHOST_BROWSER_BRIDGE_ENABLED === undefined ? fileConfig.browserBridge?.enabled ?? false : env.AGENTHOST_BROWSER_BRIDGE_ENABLED === "1";
  const browserPort = env.AGENTHOST_BROWSER_BRIDGE_PORT === undefined ? fileConfig.browserBridge?.port ?? 43117 : Number(env.AGENTHOST_BROWSER_BRIDGE_PORT);
  const browserBridge = { enabled: browserEnabled, port: z.number().int().min(1024).max(65535).parse(browserPort), pairingTokenFile: resolveLocalPath(env.AGENTHOST_BROWSER_PAIRING_TOKEN_FILE ?? fileConfig.browserBridge?.pairingTokenFile ?? path.join(agentHostDir, "browser", "pairing-token"), homeDir) };
  const logFile = resolveLocalPath(
    env.AGENTHOST_LOG_FILE ?? fileConfig.logFile ?? path.join(agentHostDir, "logs", "agenthost.jsonl"),
    homeDir
  );

  return {
    agentHostDir,
    configPath,
    logFile,
    profile: parsedProfile,
    forgeRuntimeSandboxMode,
    overlayRendererMode,
    browserBridge,
    optionalAdapters: fileConfig.optionalAdapters ?? {},
    policy: getPolicyProfile(parsedProfile, { grants })
  };
}
