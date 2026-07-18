import { describe, expect, it } from "vitest";
import { AdapterRegistry, applyAdapterDetectionToAppResult, validateOptionalAdapterExecutionPolicy, type AppAdapter } from "../index.js";

function createMockAdapter(overrides: Partial<AppAdapter> = {}): AppAdapter {
  return {
    id: "test.mock",
    displayName: "Test Mock Adapter",
    appIds: ["gimp", "mock-paint"],
    supportedPlatforms: ["linux"],
    getCapabilities: () => [
      {
        id: "mock.export",
        appId: "gimp",
        strategy: "app_adapter",
        riskLevel: "low",
        description: "Mock export capability.",
        safety: {
          actionType: "inspect"
        }
      }
    ],
    async execute(): Promise<never> {
      throw new Error("Mock adapter execution must not be called in Phase 5.");
    },
    optionalExecutionPolicy: {
      enabledByDefault: false,
      stability: "experimental",
      execution: {
        executionClass: "state_changing",
        externalEffect: true,
        requiresDryRun: true,
        requiresConfirmationToken: true,
        requiresExactTarget: true,
        source: "optional_adapter",
        availability: "available"
      },
      fingerprinting: "required",
      subprocess: { required: false, shell: false, commandAllowlist: [] },
      environment: { allowlist: [], inherit: false },
      limits: { maxRuntimeMs: 5_000, maxOutputBytes: 64 * 1024 },
      filesystem: { allowedOutputRoots: ["$AGENTHOST_HOME/outputs"], broadFilesystem: false },
      audit: { redacted: true, rawInput: false, rawOutput: false }
    },
    ...overrides
  };
}

describe("AdapterRegistry", () => {
  it("rejects optional adapters without explicit execution policy", () => {
    const missingPolicy = createMockAdapter();
    delete missingPolicy.optionalExecutionPolicy;
    expect(() => validateOptionalAdapterExecutionPolicy(missingPolicy)).toThrow(/execution policy/);
    const missingPolicyForRegistry = createMockAdapter();
    delete missingPolicyForRegistry.optionalExecutionPolicy;
    expect(() => new AdapterRegistry({ platform: "linux" }).register(missingPolicyForRegistry)).toThrow(/execution policy/);
  });

  it("rejects unsafe optional-adapter environment, roots, and limits", () => {
    const unsafeEnvironment = createMockAdapter();
    unsafeEnvironment.optionalExecutionPolicy = {
      ...unsafeEnvironment.optionalExecutionPolicy!,
      environment: { allowlist: ["API_KEY"], inherit: false }
    };
    expect(() => validateOptionalAdapterExecutionPolicy(unsafeEnvironment)).toThrow(/environment/);

    const unsafeRoot = createMockAdapter();
    unsafeRoot.optionalExecutionPolicy = {
      ...unsafeRoot.optionalExecutionPolicy!,
      filesystem: { allowedOutputRoots: ["/tmp"], broadFilesystem: false }
    };
    expect(() => validateOptionalAdapterExecutionPolicy(unsafeRoot)).toThrow(/output roots/);

    const unsafeLimits = createMockAdapter();
    unsafeLimits.optionalExecutionPolicy = {
      ...unsafeLimits.optionalExecutionPolicy!,
      limits: { maxRuntimeMs: 300_001, maxOutputBytes: 64 * 1024 }
    };
    expect(() => validateOptionalAdapterExecutionPolicy(unsafeLimits)).toThrow(/limits/);
  });

  it("registers and lists supported adapters", () => {
    const registry = new AdapterRegistry({ platform: "linux" });
    const result = registry.register(createMockAdapter());

    expect(result).toMatchObject({
      registered: true,
      skipped: false,
      adapterId: "test.mock"
    });
    expect(registry.listAdapters()).toEqual([
      {
        id: "test.mock",
        displayName: "Test Mock Adapter",
        appIds: ["gimp", "mock-paint"],
        supportedPlatforms: ["linux"],
        capabilityCount: 1
      }
    ]);
  });

  it("rejects duplicate adapter ids", () => {
    const registry = new AdapterRegistry({ platform: "linux" });

    registry.register(createMockAdapter());

    expect(() => registry.register(createMockAdapter())).toThrow(/already registered/);
  });

  it("skips unsupported platform adapters", () => {
    const registry = new AdapterRegistry({ platform: "linux" });
    const result = registry.register(createMockAdapter({ id: "test.darwin", supportedPlatforms: ["darwin"] }));

    expect(result).toMatchObject({
      registered: false,
      skipped: true,
      adapterId: "test.darwin"
    });
    expect(registry.listAdapters()).toEqual([]);
  });

  it("unregisters adapters", () => {
    const registry = new AdapterRegistry({ platform: "linux" });

    registry.register(createMockAdapter());

    expect(registry.unregister("test.mock")).toBe(true);
    expect(registry.unregister("test.mock")).toBe(false);
    expect(registry.listAdapters()).toEqual([]);
  });

  it("detects apps and lists adapter capabilities", () => {
    const registry = new AdapterRegistry({ platform: "linux" });

    registry.register(createMockAdapter());

    expect(registry.detectForApp({ appName: "GIMP", appId: "gimp" })).toMatchObject({
      adapterAvailable: true,
      recommendedStrategy: "app_adapter",
      adapters: [
        {
          id: "test.mock"
        }
      ],
      capabilities: [
        {
          id: "mock.export",
          adapterId: "test.mock",
          appId: "gimp",
          strategy: "app_adapter"
        }
      ]
    });
    expect(registry.listCapabilities({ appId: "gimp" })).toHaveLength(1);
    expect(registry.listCapabilities({ adapterId: "missing" })).toEqual([]);
  });

  it("supports adapter-provided app matching", () => {
    const registry = new AdapterRegistry({ platform: "linux" });
    const adapter = createMockAdapter({
      id: "test.matcher",
      appIds: ["custom"],
      matchesApp: (input) => input.appName === "Friendly Name"
    });

    registry.register(adapter);

    expect(registry.detectForApp({ appName: "Friendly Name" })).toMatchObject({
      adapterAvailable: true,
      adapters: [
        {
          id: "test.matcher"
        }
      ]
    });
  });

  it("merges adapter availability into app detection results", () => {
    const registry = new AdapterRegistry({ platform: "linux" });
    registry.register(createMockAdapter());

    const appResult = {
      found: true,
      appId: "gimp",
      displayName: "GIMP",
      adapterAvailable: false,
      availableStrategies: ["cli_or_script", "guide_only"] as ["cli_or_script", "guide_only"],
      recommendedStrategy: "guide_only" as const,
      appSensitivity: "normal" as const,
      reason: "Found command on PATH."
    };
    const merged = applyAdapterDetectionToAppResult(appResult, registry.detectForApp({ appName: "GIMP", appId: "gimp" }));

    expect(merged).toMatchObject({
      adapterAvailable: true,
      adapterIds: ["test.mock"],
      recommendedStrategy: "app_adapter"
    });
    expect(merged.availableStrategies).toEqual(["app_adapter", "cli_or_script", "guide_only"]);
  });

  it("keeps sensitive adapter-backed apps guide-only by default", () => {
    const registry = new AdapterRegistry({ platform: "linux" });
    registry.register(createMockAdapter({ id: "test.mail", appIds: ["gmail"] }));

    const appResult = {
      found: true,
      appId: "gmail",
      displayName: "Gmail",
      adapterAvailable: false,
      availableStrategies: ["guide_only"] as ["guide_only"],
      recommendedStrategy: "guide_only" as const,
      appSensitivity: "communication" as const,
      reason: "Found app."
    };
    const merged = applyAdapterDetectionToAppResult(appResult, registry.detectForApp({ appName: "Gmail", appId: "gmail" }));

    expect(merged.adapterAvailable).toBe(true);
    expect(merged.availableStrategies).toContain("app_adapter");
    expect(merged.recommendedStrategy).toBe("guide_only");
  });
});
