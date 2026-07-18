import { describe, expect, it } from "vitest";
import { AdaptiveActionRouter, RouteProbeScheduler } from "../adaptive-action-router.js";
import { RouteMetricsStore } from "../route-metrics-store.js";
import { readFile } from "node:fs/promises";
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

  it("does not treat browser capability metadata as a live bridge", async () => {
    const store = new RouteMetricsStore("/tmp/agenthost-route-preview-no-browser");
    await store.ensureStructure();
    const router = new AdaptiveActionRouter(store);
    const result = await router.preview({ registry: createBaseCapabilityRegistry(), adapters: createAdapterRegistry(), profile: "dev" }, { goalCategory: "browser_navigation" });
    const browser = result.candidates.filter((item) => item.routeFamily === "browser_bridge" || item.routeFamily === "structured_browser");
    expect(browser.every((item) => item.health === "unavailable" && item.compatible === false)).toBe(true);
    expect(result.selectedRoute).not.toBe("browser_bridge");
  });

  it("prefers healthy Browser Bridge over governed fallbacks", async () => {
    const store = new RouteMetricsStore("/tmp/agenthost-route-preview-healthy-browser");
    await store.ensureStructure();
    const router = new AdaptiveActionRouter(store);
    const result = await router.preview({
      registry: createBaseCapabilityRegistry(),
      adapters: createAdapterRegistry(),
      profile: "dev",
      browser: { detect: async () => ({ enabled: true, paired: true, connected: true, reason: "paired" }) } as never
    }, { goalCategory: "browser_navigation" });
    expect(result.selectedRoute).toBe("browser_bridge");
  });

  it("fails browser routes closed on disconnected or incompatible live bridge state", async () => {
    for (const state of ["unpaired", "version_mismatch"]) {
      const store = new RouteMetricsStore(`/tmp/agenthost-route-preview-${state}`);
      await store.ensureStructure();
      const router = new AdaptiveActionRouter(store);
      const result = await router.preview({
        registry: createBaseCapabilityRegistry(),
        adapters: createAdapterRegistry(),
        profile: "dev",
        browser: { detect: async () => ({ enabled: true, paired: true, connected: true, reason: "reported connected" }) } as never,
        browserBridge: { status: () => ({ state }) }
      }, { goalCategory: "browser_navigation" });
      const browser = result.candidates.find((item) => item.routeFamily === "browser_bridge");
      expect(browser).toMatchObject({
        health: "unavailable",
        compatible: false,
        unavailableReason: state === "version_mismatch"
          ? "browser_extension_incompatible"
          : "browser_extension_disconnected"
      });
      expect(result.selectedRoute).not.toBe("browser_bridge");
    }
  });

  it("keeps guide mode terminal fallback for ordinary eligible work", async () => {
    const store = new RouteMetricsStore("/tmp/agenthost-route-preview-guide-order");
    await store.ensureStructure();
    const router = new AdaptiveActionRouter(store);
    const result = await router.preview({ registry: createBaseCapabilityRegistry(), adapters: createAdapterRegistry(), profile: "dev" }, { goalCategory: "local_observation" });
    expect(result.selectedRoute).not.toBe("guide_only");
  });

  it("forces guide mode for protected contexts", async () => {
    const store = new RouteMetricsStore("/tmp/agenthost-route-preview-protected");
    await store.ensureStructure();
    const router = new AdaptiveActionRouter(store);
    const result = await router.preview({ registry: createBaseCapabilityRegistry(), adapters: createAdapterRegistry(), profile: "dev" }, { goalCategory: "local_observation", protectedContext: true });
    expect(result.selectedRoute).toBe("guide_only");
  });

  it("never selects a route for blocked risk", async () => {
    const store = new RouteMetricsStore("/tmp/agenthost-route-preview-blocked");
    await store.ensureStructure();
    const router = new AdaptiveActionRouter(store);
    const result = await router.preview({
      registry: createBaseCapabilityRegistry(),
      adapters: createAdapterRegistry(),
      profile: "dev"
    }, { goalCategory: "local_observation", riskLevel: "blocked" });
    expect(result.selectedRoute).toBeUndefined();
    expect(result.reasonCode).toBe("no_safe_route");
    expect(result.candidates.every((candidate) => candidate.riskLevel === "blocked")).toBe(true);
  });

  it("persists bounded latency medians instead of latest-sample values", async () => {
    const store = new RouteMetricsStore("/tmp/agenthost-route-metrics-median");
    await store.ensureStructure();
    const base = { routeFamily: "accessibility" as const, goalCategory: "median_check", compatibilityFingerprint: "fixture", compatibilityVersion: "1" };
    await store.record({ ...base, outcome: "verified_success", probeMs: 100, executionMs: 200, verificationMs: 300 });
    await store.record({ ...base, outcome: "verified_success", probeMs: 500, executionMs: 600, verificationMs: 700 });
    const result = await store.record({ ...base, outcome: "verified_success", probeMs: 200, executionMs: 400, verificationMs: 500 });
    expect(result.medianProbeMs).toBe(200);
    expect(result.medianExecutionMs).toBe(400);
    expect(result.medianVerificationMs).toBe(500);
    expect(result.latencySamples?.probeMs?.length).toBeLessThanOrEqual(31);
  });

  it("persists route metric fingerprints, never raw route labels or URLs", async () => {
    const root = "/tmp/agenthost-route-metrics-redaction";
    const store = new RouteMetricsStore(root);
    await store.ensureStructure();
    await store.record({ routeFamily: "accessibility", goalCategory: "recipient@example.com secret message", appFamily: "private-app", compatibilityFingerprint: "https://private.example/path", outcome: "verified_success", compatibilityVersion: "1" });
    const saved = await readFile(`${root}/strategies/routes/metrics.json`, "utf8");
    expect(saved).not.toContain("recipient@example.com");
    expect(saved).not.toContain("private-app");
    expect(saved).not.toContain("https://private.example/path");
    expect(saved).toContain("goalCategoryFingerprint");
    expect(saved).toContain("compatibilityFingerprint");
  });

  it("rejects non-structural compatibility versions", async () => {
    const store = new RouteMetricsStore("/tmp/agenthost-route-metrics-version");
    await store.ensureStructure();
    await expect(store.record({
      routeFamily: "accessibility",
      goalCategory: "browser_navigation",
      compatibilityFingerprint: "fixture",
      outcome: "verified_success",
      compatibilityVersion: "private prompt"
    })).rejects.toThrow("compatibility_version_invalid");
  });

  it("keeps Control Room route summaries free of raw route labels", async () => {
    const store = new RouteMetricsStore("/tmp/agenthost-route-preview-summary");
    await store.ensureStructure();
    const router = new AdaptiveActionRouter(store);
    await router.preview({ registry: createBaseCapabilityRegistry(), adapters: createAdapterRegistry(), profile: "dev" }, { goalCategory: "recipient@example.com secret message" });
    expect(JSON.stringify(router.summary())).not.toContain("recipient@example.com");
  });

  it("redacts unsafe route labels in direct previews", async () => {
    const store = new RouteMetricsStore("/tmp/agenthost-route-preview-direct-redaction");
    await store.ensureStructure();
    const router = new AdaptiveActionRouter(store);
    const result = await router.preview({
      registry: createBaseCapabilityRegistry(),
      adapters: createAdapterRegistry(),
      profile: "dev"
    }, { goalCategory: "recipient@example.com private request", appFamily: "private-app" });
    expect(JSON.stringify(result)).not.toContain("recipient@example.com");
    expect(JSON.stringify(result)).not.toContain("private-app");
    expect(result.goalCategory).toBe("unknown");
  });

  it("bounds read-only probes and preserves order", async () => {
    const scheduler = new RouteProbeScheduler(4, 100);
    const results = await scheduler.run([async () => "first", async () => { throw new Error("blocked"); }]);
    expect(results[0]).toEqual({ ok: true, value: "first" });
    expect(results[1]).toMatchObject({ ok: false, reason: "blocked" });
  });

  it("cancels pending probes without waiting for their timeout", async () => {
    const scheduler = new RouteProbeScheduler(1, 5_000);
    const controller = new AbortController();
    const pending = scheduler.run([() => new Promise<string>(() => undefined)], controller.signal);
    controller.abort();
    await expect(pending).resolves.toEqual([{ ok: false, reason: "route_probe_cancelled" }]);
  });

  it("uses only redacted verified failure memory as route evidence", async () => {
    const store = new RouteMetricsStore("/tmp/agenthost-route-preview-failure-memory");
    await store.ensureStructure();
    const router = new AdaptiveActionRouter(store);
    const result = await router.preview({
      registry: createBaseCapabilityRegistry(),
      adapters: createAdapterRegistry(),
      profile: "dev",
      failureMemory: { list: async () => [{ routeFamily: "accessibility", outcome: "verified_failure" }] }
    }, { goalCategory: "local_observation" });
    expect(result.candidates.find((item) => item.routeFamily === "accessibility")?.verifiedFailures).toBe(1);
    expect(JSON.stringify(result)).not.toContain("private");
  });
});
