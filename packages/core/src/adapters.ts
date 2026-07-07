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
