import { describe, expect, it } from "vitest";
import { strategyScore, type CapabilityStrategyDefinition } from "../index.js";

function strategy(overrides: Partial<CapabilityStrategyDefinition> = {}): CapabilityStrategyDefinition {
  return {
    strategyId: "test.strategy",
    schemaVersion: 1,
    name: "Test",
    description: "Test strategy.",
    goalCategory: "browser_navigation",
    goalVariants: [],
    supportedOperatingSystems: ["linux"],
    supportedApplications: [],
    supportedAdapters: [],
    compatibleAgentHostRange: "0.1.0",
    compatibleAdapterRanges: {},
    requiredCapabilities: [],
    prerequisiteChecks: [],
    preferredSteps: [],
    fallbackStrategyIds: [],
    verificationCheckpoints: [],
    expectedSafety: { executionClasses: ["read_only"], maxRiskLevel: "low", requiresDryRun: false, requiresConfirmation: false, exactTarget: false },
    expectedConfirmationBoundary: "never_automatic",
    knownFailureCodes: [],
    successCount: 0,
    failureCount: 0,
    consecutiveFailureCount: 0,
    confidence: 0.5,
    source: "built_in",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    invalidationConditions: [],
    status: "active",
    ...overrides
  };
}

const base = { goalCategory: "browser_navigation" as const, verifiedCheckpoint: false, recent: false };

describe("strategyScore episodic memory", () => {
  it("leaves the score unchanged without memory", () => {
    expect(strategyScore({ strategy: strategy(), ...base })).toBe(strategyScore({ strategy: strategy(), ...base, memory: { success: 0, failure: 0 } }));
  });
  it("rewards recorded success and punishes recorded failure", () => {
    const plain = strategyScore({ strategy: strategy(), ...base });
    expect(strategyScore({ strategy: strategy(), ...base, memory: { success: 3, failure: 0 } })).toBe(plain + 6);
    expect(strategyScore({ strategy: strategy(), ...base, memory: { success: 0, failure: 2 } })).toBe(plain - 12);
  });
  it("caps the success bonus so memory advises instead of deciding", () => {
    const plain = strategyScore({ strategy: strategy(), ...base });
    expect(strategyScore({ strategy: strategy(), ...base, memory: { success: 100, failure: 0 } })).toBe(plain + 8);
  });
});
