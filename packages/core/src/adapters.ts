import type {
  AdapterCapabilityFilter,
  AdapterDetectionInput,
  AdapterDetectionResult,
  AdapterRegistrationResult,
  AdapterRegistrySnapshot,
  AdapterSummary,
  AppAdapter,
  AppCapability,
  AppDetectionResult,
  AppSensitivity,
  AutomationStrategy
} from "./types.js";
import { validateToolExecutionMetadata } from "./capabilities.js";

export function validateOptionalAdapterExecutionPolicy(adapter: AppAdapter): void {
  const policy = adapter.optionalExecutionPolicy;
  if (policy === undefined) {
    throw new Error(`Optional adapter ${adapter.id} is missing execution policy metadata.`);
  }
  if (policy.enabledByDefault !== false
    || !["experimental", "stable"].includes(policy.stability)
    || policy.subprocess.shell !== false
    || policy.environment.inherit !== false
    || policy.audit.redacted !== true
    || policy.audit.rawInput !== false
    || policy.audit.rawOutput !== false
    || policy.filesystem.broadFilesystem !== false
    || policy.execution.source !== "optional_adapter"
    || policy.execution.availability !== "available") {
    throw new Error(`Optional adapter ${adapter.id} has unsafe execution policy metadata.`);
  }
  validateToolExecutionMetadata(policy.execution, `${adapter.id}.optionalExecutionPolicy`);
  if (!Number.isInteger(policy.limits.maxRuntimeMs) || policy.limits.maxRuntimeMs <= 0 || policy.limits.maxRuntimeMs > 300_000
    || !Number.isInteger(policy.limits.maxOutputBytes) || policy.limits.maxOutputBytes <= 0 || policy.limits.maxOutputBytes > 10 * 1024 * 1024) {
    throw new Error(`Optional adapter ${adapter.id} has invalid execution limits.`);
  }
  if (!Array.isArray(policy.subprocess.commandAllowlist) || policy.subprocess.commandAllowlist.length > 32
    || policy.subprocess.commandAllowlist.some((command) => typeof command !== "string" || !/^[A-Za-z0-9._+-]{1,80}$/.test(command))) {
    throw new Error(`Optional adapter ${adapter.id} has an invalid subprocess allowlist.`);
  }
  if (policy.subprocess.required && policy.subprocess.commandAllowlist.length === 0) {
    throw new Error(`Optional adapter ${adapter.id} requires a subprocess command allowlist.`);
  }
  const forbiddenEnvironmentKeys = /(?:TOKEN|SECRET|PASSWORD|COOKIE|KEY|CREDENTIAL|AUTH|DISPLAY|WAYLAND|XAUTHORITY|DBUS)/i;
  if (!Array.isArray(policy.environment.allowlist) || policy.environment.allowlist.length > 64
    || policy.environment.allowlist.some((key) => typeof key !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(key) || forbiddenEnvironmentKeys.test(key))) {
    throw new Error(`Optional adapter ${adapter.id} has an unsafe environment allowlist.`);
  }
  if (!Array.isArray(policy.filesystem.allowedOutputRoots) || policy.filesystem.allowedOutputRoots.length > 16
    || policy.filesystem.allowedOutputRoots.some((root) => typeof root !== "string" || root.length === 0 || root.length > 500 || root.includes("..") || !(root.startsWith("$AGENTHOST_HOME/") || root.startsWith("$AGENTHOST_RUN/")))) {
    throw new Error(`Optional adapter ${adapter.id} has unsafe output roots.`);
  }
  if (policy.execution.executionClass === "state_changing" && policy.fingerprinting !== "required") {
    throw new Error(`Optional adapter ${adapter.id} requires reviewed target/input fingerprinting.`);
  }
}

const SENSITIVE_APP_CATEGORIES = new Set<AppSensitivity>([
  "communication",
  "financial",
  "credential_or_security",
  "system_settings"
]);

function normalizeAppKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function supportsPlatform(adapter: AppAdapter, platform: string): boolean {
  return adapter.supportedPlatforms.includes("*") || adapter.supportedPlatforms.includes(platform);
}

function copyCapability(capability: AppCapability, adapter: AppAdapter): AppCapability {
  const normalized: AppCapability = {
    ...capability,
    adapterId: capability.adapterId ?? adapter.id,
    strategy: "app_adapter"
  };

  const onlyAppId = adapter.appIds[0];

  if (normalized.appId === undefined && adapter.appIds.length === 1 && onlyAppId !== undefined) {
    normalized.appId = onlyAppId;
  }

  return normalized;
}

function summaryFor(adapter: AppAdapter): AdapterSummary {
  return {
    id: adapter.id,
    displayName: adapter.displayName,
    appIds: [...adapter.appIds],
    supportedPlatforms: [...adapter.supportedPlatforms],
    capabilityCount: adapter.getCapabilities().length
  };
}

function matchesApp(adapter: AppAdapter, input: AdapterDetectionInput): boolean {
  if (adapter.matchesApp?.(input)) {
    return true;
  }

  const appKeys = new Set(adapter.appIds.map(normalizeAppKey));
  const candidateKeys = [input.appId, input.appName]
    .filter((value): value is string => typeof value === "string")
    .map(normalizeAppKey);

  return candidateKeys.some((candidate) => candidate.length > 0 && appKeys.has(candidate));
}

function matchesFilter(capability: AppCapability, filter: AdapterCapabilityFilter | undefined): boolean {
  if (filter?.adapterId !== undefined && capability.adapterId !== filter.adapterId) {
    return false;
  }

  if (filter?.appId !== undefined && capability.appId !== undefined) {
    return normalizeAppKey(capability.appId) === normalizeAppKey(filter.appId);
  }

  return filter?.appId === undefined;
}

function uniqueStrategies(strategies: AutomationStrategy[]): AutomationStrategy[] {
  return [...new Set(strategies)];
}

export class AdapterRegistry implements AdapterRegistrySnapshot {
  readonly #adapters = new Map<string, AppAdapter>();
  readonly #platform: string;

  constructor(options: { platform?: string } = {}) {
    this.#platform = options.platform ?? process.platform;
  }

  register(adapter: AppAdapter): AdapterRegistrationResult {
    if (this.#adapters.has(adapter.id)) {
      throw new Error(`Adapter is already registered: ${adapter.id}`);
    }

    // Optional adapters are an execution boundary. Validate their declared
    // containment before platform filtering or registration so an unsafe
    // adapter can never enter the live registry by accident.
    validateOptionalAdapterExecutionPolicy(adapter);

    if (!supportsPlatform(adapter, this.#platform)) {
      return {
        registered: false,
        skipped: true,
        adapterId: adapter.id,
        reason: `Adapter ${adapter.id} does not support platform ${this.#platform}.`
      };
    }

    this.#adapters.set(adapter.id, adapter);

    return {
      registered: true,
      skipped: false,
      adapterId: adapter.id,
      reason: `Registered adapter ${adapter.id}.`
    };
  }

  unregister(adapterId: string): boolean {
    return this.#adapters.delete(adapterId);
  }

  get(adapterId: string): AppAdapter | undefined {
    return this.#adapters.get(adapterId);
  }

  listAdapters(): AdapterSummary[] {
    return [...this.#adapters.values()].map(summaryFor);
  }

  listCapabilities(filter?: AdapterCapabilityFilter): AppCapability[] {
    return [...this.#adapters.values()]
      .flatMap((adapter) => adapter.getCapabilities().map((capability) => copyCapability(capability, adapter)))
      .filter((capability) => matchesFilter(capability, filter));
  }

  detectForApp(input: AdapterDetectionInput): AdapterDetectionResult {
    const adapters = [...this.#adapters.values()].filter((adapter) => matchesApp(adapter, input));
    const adapterIds = new Set(adapters.map((adapter) => adapter.id));
    const capabilities = this.listCapabilities().filter((capability) => adapterIds.has(capability.adapterId ?? ""));
    const result: AdapterDetectionResult = {
      appName: input.appName,
      adapterAvailable: adapters.length > 0,
      adapters: adapters.map(summaryFor),
      capabilities,
      recommendedStrategy: adapters.length > 0 ? "app_adapter" : "guide_only",
      reason:
        adapters.length > 0
          ? `Found ${adapters.length} registered adapter${adapters.length === 1 ? "" : "s"} for ${input.appName}.`
          : `No registered adapter matches ${input.appName}.`
    };

    if (input.appId !== undefined) {
      result.appId = input.appId;
    }

    return result;
  }
}

export function createAdapterRegistry(options: { platform?: string } = {}): AdapterRegistry {
  return new AdapterRegistry(options);
}

export function applyAdapterDetectionToAppResult<T extends AppDetectionResult>(
  appResult: T,
  adapterResult: AdapterDetectionResult
): T {
  if (!adapterResult.adapterAvailable) {
    return appResult;
  }

  const merged: T = {
    ...appResult,
    adapterAvailable: true,
    adapterIds: adapterResult.adapters.map((adapter) => adapter.id),
    adapterCapabilities: adapterResult.capabilities,
    reason: `${appResult.reason} ${adapterResult.reason}`
  };

  const shouldOfferAdapter = appResult.found;

  if (shouldOfferAdapter) {
    merged.availableStrategies = uniqueStrategies(["app_adapter", ...appResult.availableStrategies]);
  }

  if (shouldOfferAdapter && !SENSITIVE_APP_CATEGORIES.has(appResult.appSensitivity)) {
    merged.recommendedStrategy = "app_adapter";
  }

  return merged;
}
