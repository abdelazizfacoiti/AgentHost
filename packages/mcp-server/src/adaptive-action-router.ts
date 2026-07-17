import { randomUUID } from "node:crypto";
import { compareCapabilityRoutes, scoreCapabilityRoute, type CapabilityRouteCandidate, type CapabilityRouteFamily, type CapabilityRouteSelection } from "@agenthost/core";
import type { AdapterRegistrySnapshot, CapabilityRegistrySnapshot, PolicyProfileName, RiskLevel } from "@agenthost/core";
import type { BrowserBridgeAdapter } from "@agenthost/app-browser";
import { RouteMetricsStore } from "./route-metrics-store.js";

export interface AdaptiveActionRouterContext { registry: CapabilityRegistrySnapshot; adapters: AdapterRegistrySnapshot; profile: PolicyProfileName; browser?: BrowserBridgeAdapter; }
export interface RoutePreviewInput { goalCategory: string; appFamily?: string; riskLevel?: RiskLevel; protectedContext?: boolean; contextTokens?: number; requiresConfirmation?: boolean; }

const ORDER: CapabilityRouteFamily[] = ["browser_bridge", "structured_browser", "native_adapter", "accessibility", "local_ocr", "screenshot_vision", "desktop_input", "guide_only"];
const available = (registry: CapabilityRegistrySnapshot, name: string): boolean => registry.listTools().some((item) => item.name === name);
async function boundedProbe<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("route_probe_timeout")), Math.max(50, Math.min(5_000, timeoutMs)));
    operation.then((value) => { clearTimeout(timer); resolve(value); }, (error: unknown) => { clearTimeout(timer); reject(error); });
  });
}

/** Generic bounded probe helper. Supplied probes must remain read-only; no action is invoked here. */
export class RouteProbeScheduler {
  readonly #maxConcurrent: number;
  readonly #timeoutMs: number;
  constructor(maxConcurrent = 4, timeoutMs = 5_000) { this.#maxConcurrent = Math.max(1, Math.min(4, Math.floor(maxConcurrent))); this.#timeoutMs = Math.max(50, Math.min(5_000, Math.floor(timeoutMs))); }
  async run<T>(probes: Array<() => Promise<T>>, signal?: AbortSignal): Promise<Array<{ ok: boolean; value?: T; reason?: string }>> {
    const results: Array<{ ok: boolean; value?: T; reason?: string }> = Array.from({ length: probes.length }, () => ({ ok: false, reason: "route_probe_not_started" }));
    let cursor = 0;
    const worker = async () => {
      while (cursor < probes.length) {
        if (signal?.aborted === true) return;
        const index = cursor++;
        const probe = probes[index];
        if (probe === undefined) return;
        try { results[index] = { ok: true, value: await boundedProbe(probe(), this.#timeoutMs) }; }
        catch (error) { results[index] = { ok: false, reason: error instanceof Error ? error.message.slice(0, 120) : "route_probe_failed" }; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.#maxConcurrent, probes.length) }, () => worker()));
    return results;
  }
}

export class AdaptiveActionRouter {
  readonly #metrics: RouteMetricsStore;
  #last: CapabilityRouteSelection | undefined;
  constructor(metrics: RouteMetricsStore) { this.#metrics = metrics; }
  async preview(context: AdaptiveActionRouterContext, input: RoutePreviewInput): Promise<CapabilityRouteSelection> {
    const candidates = await this.#candidates(context, input);
    const ranked = candidates.map((candidate) => { scoreCapabilityRoute(candidate); return candidate; }).sort(compareCapabilityRoutes);
    const selected = input.protectedContext === true && input.riskLevel !== "blocked" ? ranked.find((item) => item.routeFamily === "guide_only") : ranked.find((item) => Number.isFinite(item.finalCost));
    const reasonCode = selected === undefined ? "no_safe_route" : selected.routeFamily === "guide_only" ? "protected_or_unsupported_context" : selected.verificationStrength === "strong" ? "healthy_verified_route" : "bounded_safe_route";
    const result: CapabilityRouteSelection = { routeSelectionId: `route_selection_${randomUUID()}`, ...(selected === undefined ? {} : { selectedRoute: selected.routeFamily }), goalCategory: input.goalCategory, ...(input.appFamily === undefined ? {} : { appFamily: input.appFamily }), reasonCode, fallbackBudget: 2, candidates: ranked.slice(0, 8), alternatives: ranked.filter((item) => item.routeFamily !== selected?.routeFamily).slice(0, 3).map((item) => ({ routeFamily: item.routeFamily, reasonCode: item.health === "unavailable" ? "unavailable" : "deferred_lower_rank" })), fallbacks: [], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), executable: false, actionsExecuted: false, confirmationTokensCreated: false };
    this.#last = result;
    return result;
  }
  summary(): Record<string, unknown> { const value = this.#last; return value === undefined ? { status: "idle", routeSelection: undefined, redacted: true } : { status: "selected", routeSelection: { selectedRoute: value.selectedRoute, goalCategory: value.goalCategory, reasonCode: value.reasonCode, fallbackBudget: value.fallbackBudget, alternatives: value.alternatives, createdAt: value.createdAt, redacted: true }, redacted: true }; }
  async recordVerifiedOutcome(input: Parameters<RouteMetricsStore["record"]>[0]): Promise<void> { if (input.outcome === "verified_success" || input.outcome === "verified_failure") await this.#metrics.record(input); }
  async #candidates(context: AdaptiveActionRouterContext, input: RoutePreviewInput): Promise<CapabilityRouteCandidate[]> {
    const risk = input.riskLevel ?? "observe";
    const requiresConfirmation = input.requiresConfirmation === true;
    let hasBrowser = available(context.registry, "browser.detect");
    if (hasBrowser && context.browser !== undefined) {
      try {
        const state = await boundedProbe(context.browser.detect(), 500);
        hasBrowser = state.enabled === true && state.paired === true && state.connected === true;
      } catch { hasBrowser = false; }
    }
    const metricRecords = await this.#metrics.list();
    const hasStructured = available(context.registry, "browser.get_page_context");
    const hasAccessibility = available(context.registry, "accessibility.get_tree");
    const hasVision = available(context.registry, "vision.find_target") || available(context.registry, "vision.analyze_image");
    const hasDesktop = available(context.registry, "desktop.click") || available(context.registry, "desktop.pointer");
    const hasAdapter = context.adapters.listAdapters().length > 0;
    const base = (routeFamily: CapabilityRouteFamily, healthy: boolean, verificationStrength: "strong" | "medium" | "weak", probeTier: 0 | 1 | 2 | 3 | 4 | 5, estimates: [number, number, number, number], reason?: string): CapabilityRouteCandidate => {
      const metric = metricRecords.find((item) => item.routeFamily === routeFamily && item.goalCategory === input.goalCategory && item.appFamily === input.appFamily);
      const attempts = metric?.attempts ?? 0;
      const failures = metric?.verifiedFailures ?? 0;
      const successes = metric?.verifiedSuccesses ?? 0;
      const failureProbability = healthy ? (attempts === 0 ? 0.1 : Math.min(1, (failures + 1) / (attempts + 2))) : 1;
      return { routeFamily, goalCategory: input.goalCategory, ...(input.appFamily === undefined ? {} : { appFamily: input.appFamily }), prerequisites: [], health: healthy ? (metric?.status === "degraded" ? "degraded" : "healthy") : "unavailable", compatible: healthy, probeTier, estimatedProbeMs: metric?.medianProbeMs ?? estimates[0], estimatedSetupMs: estimates[1], estimatedExecutionMs: metric?.medianExecutionMs ?? estimates[2], estimatedVerificationMs: metric?.medianVerificationMs ?? estimates[3], verificationStrength, verifiedSuccesses: successes, verifiedFailures: failures, consecutiveVerifiedFailures: metric?.consecutiveVerifiedFailures ?? 0, failureProbability, recoveryCostMs: 3_000, contextTokens: input.contextTokens ?? 500, riskLevel: risk, requiresConfirmation, ...(reason === undefined ? {} : { unavailableReason: reason }), tieBreakKey: `${ORDER.indexOf(routeFamily).toString().padStart(2, "0")}:${routeFamily}` };
    };
    return [
      base("browser_bridge", hasBrowser, "strong", 1, [20, 20, 80, 80], "browser_bridge_unavailable"),
      base("structured_browser", hasStructured, "strong", 2, [40, 30, 100, 100], "structured_browser_unavailable"),
      base("native_adapter", hasAdapter, "strong", 1, [20, 40, 100, 120], "native_adapter_unavailable"),
      base("accessibility", hasAccessibility, "medium", 2, [50, 40, 140, 180], "accessibility_unavailable"),
      base("local_ocr", hasVision, "medium", 3, [120, 50, 180, 220], "local_ocr_unavailable"),
      base("screenshot_vision", hasVision, "medium", 4, [220, 80, 220, 260], "screenshot_vision_unavailable"),
      base("desktop_input", hasDesktop, "weak", 5, [80, 50, 120, 300], "desktop_input_unavailable"),
      base("guide_only", true, "strong", 5, [0, 0, 0, 200], "guide_only")
    ];
  }
}
