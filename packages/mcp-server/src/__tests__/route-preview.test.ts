import { describe, expect, it } from "vitest";
import { AdaptiveActionRouter, RouteProbeScheduler } from "../adaptive-action-router.js";
import { RouteMetricsStore } from "../route-metrics-store.js";
import { createBaseCapabilityRegistry, createAdapterRegistry } from "@agenthost/core";

describe("route preview", () => {
  it("returns bounded advisory route metadata and never executes", async () => {
    const store = new RouteMetricsStore("/tmp/agenthost-route-preview");
    await store.ensureStructure();
    const router = new AdaptiveActionRouter(store);
    const result = await router.preview({ registry: createBaseCapabilityRegistry(), adapters: createAdapterRegistry(), profile: "dev" }, { goalCategory: "browser_navigation" });
    expect(result.executable).toBe(false);
    expect(result.actionsExecuted).toBe(false);
    expect(result.confirmationTokensCreated).toBe(false);
    expect(result.fallbackBudget).toBe(2);
  });

  it("bounds read-only probes and preserves order", async () => {
    const scheduler = new RouteProbeScheduler(4, 100);
    const results = await scheduler.run([async () => "first", async () => { throw new Error("blocked"); }]);
    expect(results[0]).toEqual({ ok: true, value: "first" });
    expect(results[1]).toMatchObject({ ok: false, reason: "blocked" });
  });
});
