import { randomUUID } from "node:crypto";
import { compareCapabilityRoutes, scoreCapabilityRoute, type CapabilityRouteCandidate, type CapabilityRouteFamily, type CapabilityRouteSelection } from "@agenthost/core";
import type { AdapterRegistrySnapshot, CapabilityRegistrySnapshot, PolicyProfileName, RiskLevel } from "@agenthost/core";
import type { BrowserBridgeAdapter } from "@agenthost/app-browser";
import { routeMetricFingerprint, RouteMetricsStore } from "./route-metrics-store.js";
import { BridgeProbeCache, DecisionCache } from "./decision-cache.js";

export interface AdaptiveActionRouterContext {
  registry: CapabilityRegistrySnapshot;
  adapters: AdapterRegistrySnapshot;
  profile: PolicyProfileName;
  browser?: BrowserBridgeAdapter;
  browserBridge?: { status(): Record<string, unknown> };
  /** Optional shared cache to deduplicate browser.detect() across concurrent callers. */
  bridgeProbeCache?: BridgeProbeCache;
  failureMemory?: {
    list(options?: { goalCategory?: string; appFamily?: string }): Promise<Array<{
      routeFamily: CapabilityRouteFamily;
      outcome: "verified_failure" | "verified_success";
    }>>;
  };
}
export interface RoutePreviewInput { goalCategory: string; appFamily?: string; riskLevel?: RiskLevel; protectedContext?: boolean; contextTokens?: number; requiresConfirmation?: boolean; }

const ORDER: CapabilityRouteFamily[] = ["browser_bridge", "structured_browser", "native_adapter", "accessibility", "local_ocr", "screenshot_vision", "desktop_input", "guide_only"];
const available = (registry: CapabilityRegistrySnapshot, name: string): boolean => registry.listTools().some((item) => item.name === name);
const SAFE_PROJECTION_LABEL = /^[a-z][a-z0-9_.-]{0,79}$/u;
const SAFE_APP_FAMILIES = new Set(["browser", "communication", "office", "development", "media", "system", "unknown"]);
function safeProjectionLabel(value: string | undefined): string | undefined {
  return value !== undefined && SAFE_PROJECTION_LABEL.test(value) ? value : undefined;
}
function safeAppFamily(value: string | undefined): string | undefined {
  return value !== undefined && SAFE_APP_FAMILIES.has(value) ? value : undefined;
}
async function boundedProbe<T>(operation: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("route_probe_timeout")), Math.max(50, Math.min(5_000, timeoutMs)));
    const abort = (): void => { clearTimeout(timer); reject(new Error("route_probe_cancelled")); };
    if (signal?.aborted === true) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    const cleanup = (): void => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    operation.then((value) => { cleanup(); resolve(value); }, (error: unknown) => { cleanup(); reject(error); });
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
        try { results[index] = { ok: true, value: await boundedProbe(probe(), this.#timeoutMs, signal) }; }
        catch (error) { results[index] = { ok: false, reason: error instanceof Error ? error.message.slice(0, 120) : "route_probe_failed" }; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.#maxConcurrent, probes.length) }, () => worker()));
    return results;
  }
}

export class AdaptiveActionRouter {
  readonly #metrics: RouteMetricsStore;
  readonly #decisionCache = new DecisionCache<CapabilityRouteSelection>({ ttlMs: 1_000, maxEntries: 32 });
  #last: CapabilityRouteSelection | undefined;
  constructor(metrics: RouteMetricsStore) { this.#metrics = metrics; }
  async preview(context: AdaptiveActionRouterContext, input: RoutePreviewInput): Promise<CapabilityRouteSelection> {
    const cacheKey = `${input.goalCategory}|${input.appFamily ?? ""}|${input.riskLevel ?? ""}|${input.protectedContext ?? false}|${input.contextTokens ?? 0}|${input.requiresConfirmation ?? false}`;
    const cached = this.#decisionCache.get(cacheKey);
    if (cached !== undefined) return cached;
    
    const probeStartedAt = Date.now();
    const candidates = await this.#candidates(context, input);
    const ranked = candidates.map((candidate) => { scoreCapabilityRoute(candidate); return candidate; }).sort(compareCapabilityRoutes);
    // Guide mode is a terminal fallback, not a cheaper normal route. Protected
    // contexts still force it; ordinary work must use an eligible capability
    // whenever one exists.
    const protectedOrHighRisk = input.protectedContext === true || input.riskLevel === "high";
    const selected = input.riskLevel === "blocked"
      ? undefined
      : protectedOrHighRisk
        ? ranked.find((item) => item.routeFamily === "guide_only")
        : ranked.find((item) => item.routeFamily !== "guide_only" && Number.isFinite(item.finalCost))
          ?? ranked.find((item) => item.routeFamily === "guide_only" && Number.isFinite(item.finalCost));
    const reasonCode = selected === undefined ? "no_safe_route" : selected.routeFamily === "guide_only" ? "protected_or_unsupported_context" : selected.verificationStrength === "strong" ? "healthy_verified_route" : "bounded_safe_route";
    const metricStatus = selected === undefined ? "unused" : selected.health === "degraded" ? "degraded" : selected.health === "unavailable" ? "expired" : "active";
    const latencyClass = selected === undefined || selected.finalCost === undefined || !Number.isFinite(selected.finalCost)
      ? undefined
      : selected.finalCost <= 500 ? "instant" : selected.finalCost <= 1_200 ? "short" : selected.finalCost <= 3_000 ? "moderate" : "long";
    const projectedCandidates = ranked.slice(0, 8).map((candidate) => {
      const { appFamily: candidateAppFamily, ...candidateWithoutAppFamily } = candidate;
      return {
        ...candidateWithoutAppFamily,
        ...(safeProjectionLabel(candidate.goalCategory) === undefined
          ? { goalCategory: "unknown" }
          : { goalCategory: candidate.goalCategory }),
        ...(safeAppFamily(candidateAppFamily) === undefined
          ? {}
          : { appFamily: candidateAppFamily })
      };
    });
    const result: CapabilityRouteSelection = {
      routeSelectionId: `route_selection_${randomUUID()}`,
      ...(selected === undefined ? {} : { selectedRoute: selected.routeFamily }),
      goalCategory: safeProjectionLabel(input.goalCategory) ?? "unknown",
      ...(safeAppFamily(input.appFamily) === undefined ? {} : { appFamily: input.appFamily }),
      reasonCode,
      fallbackBudget: 2,
      candidates: projectedCandidates,
      alternatives: ranked.filter((item) => item.routeFamily !== selected?.routeFamily).slice(0, 3).map((item) => ({ routeFamily: item.routeFamily, reasonCode: item.health === "unavailable" ? "unavailable" : "deferred_lower_rank" })),
      fallbacks: [],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      executable: false,
      actionsExecuted: false,
      confirmationTokensCreated: false,
      probeSummary: {
        attempted: context.browser === undefined ? 0 : 1,
        succeeded: candidates.some((item) => item.routeFamily === "browser_bridge" && item.health !== "unavailable") ? 1 : 0,
        failed: context.browser === undefined || candidates.some((item) => item.routeFamily === "browser_bridge" && item.health === "unavailable") ? 1 : 0,
        cached: 0,
        durationMs: Math.min(5_000, Math.max(0, Date.now() - probeStartedAt))
      },
      ...(latencyClass === undefined ? {} : { latencyClass }),
      verificationStatus: selected === undefined ? "not_started" : selected.requiresConfirmation ? "required" : "not_started",
      metricStatus,
      compatibilityFingerprint: routeMetricFingerprint(`${input.goalCategory}|${input.appFamily ?? ""}|${selected?.routeFamily ?? "none"}`)
    };
    this.#last = result;
    this.#decisionCache.set(cacheKey, result);
    return result;
  }
  summary(): Record<string, unknown> { const value = this.#last; return value === undefined ? { status: "idle", routeSelection: undefined, redacted: true } : { status: "selected", routeSelection: { selectedRoute: value.selectedRoute, reasonCode: value.reasonCode, fallbackBudget: value.fallbackBudget, alternatives: value.alternatives, ...(value.probeSummary === undefined ? {} : { probeSummary: value.probeSummary }), ...(value.latencyClass === undefined ? {} : { latencyClass: value.latencyClass }), ...(value.verificationStatus === undefined ? {} : { verificationStatus: value.verificationStatus }), ...(value.metricStatus === undefined ? {} : { metricStatus: value.metricStatus }), createdAt: value.createdAt, redacted: true }, redacted: true }; }
  async recordVerifiedOutcome(input: Parameters<RouteMetricsStore["record"]>[0]): Promise<void> { if (input.outcome === "verified_success" || input.outcome === "verified_failure") await this.#metrics.record(input); }
  async #candidates(context: AdaptiveActionRouterContext, input: RoutePreviewInput): Promise<CapabilityRouteCandidate[]> {
    const risk = input.riskLevel ?? "observe";
    const requiresConfirmation = input.requiresConfirmation === true;
    let hasBrowser = context.browser !== undefined && available(context.registry, "browser.detect");
    let browserUnavailableReason = "browser_bridge_unavailable";
    if (hasBrowser && context.browser !== undefined) {
      try {
        // Use shared BridgeProbeCache when available to avoid firing a new
        // 500ms probe when the result is already fresh (e.g. from a concurrent
        // strategy.select call in the same agent turn).
        const probeResult = context.bridgeProbeCache !== undefined
          ? await context.bridgeProbeCache.get(() => boundedProbe(context.browser!.detect(), 500))
          : await boundedProbe(context.browser.detect(), 500);
        const bridgeState = String(context.browserBridge?.status().state ?? "");
        hasBrowser = probeResult.enabled === true
          && probeResult.paired === true
          && probeResult.connected === true
          && (bridgeState === "" || bridgeState === "paired");
        if (!hasBrowser) {
          browserUnavailableReason = bridgeState === "version_mismatch" || bridgeState === "protocol_mismatch"
            ? "browser_extension_incompatible"
            : bridgeState === "pairing_revoked"
              ? "browser_pairing_revoked"
              : probeResult.paired === false
                ? "browser_pairing_incomplete"
                : "browser_extension_disconnected";
        }
      } catch {
        hasBrowser = false;
        browserUnavailableReason = "browser_health_probe_failed";
      }
    }
    const metricRecords = await this.#metrics.list();
    const failureRecords = await context.failureMemory?.list({ goalCategory: input.goalCategory, ...(input.appFamily === undefined ? {} : { appFamily: input.appFamily }) }).catch(() => []) ?? [];
    // Structured browser routes use same paired bridge in current runtime.
    // Capability metadata alone must not make disconnected browser routes look healthy.
    const hasStructured = hasBrowser && available(context.registry, "browser.get_page_context");
    const hasAccessibility = available(context.registry, "accessibility.get_tree");
    // Keep local OCR and fresh screenshot grounding distinct. OCR is a bounded
    // text probe; screenshot vision requires an explicit fresh-evidence handoff.
    const hasLocalOcr = available(context.registry, "vision.find_text") || available(context.registry, "vision.analyze_image");
    const hasScreenshotVision = available(context.registry, "vision.prepare_pointer_action");
    const hasDesktop = available(context.registry, "desktop.click") || available(context.registry, "desktop.pointer");
    const hasAdapter = context.adapters.listAdapters().length > 0;
    const base = (routeFamily: CapabilityRouteFamily, healthy: boolean, verificationStrength: "strong" | "medium" | "weak", probeTier: 0 | 1 | 2 | 3 | 4 | 5, estimates: [number, number, number, number], reason?: string): CapabilityRouteCandidate => {
      const goalCategoryFingerprint = routeMetricFingerprint(input.goalCategory);
      const appFamilyFingerprint = input.appFamily === undefined ? undefined : routeMetricFingerprint(input.appFamily);
      const metric = metricRecords.find((item) => item.routeFamily === routeFamily && item.goalCategoryFingerprint === goalCategoryFingerprint && item.appFamilyFingerprint === appFamilyFingerprint);
      const attempts = metric?.attempts ?? 0;
      const memoryFailures = failureRecords.filter((item) => item.routeFamily === routeFamily && item.outcome === "verified_failure").length;
      const memorySuccesses = failureRecords.filter((item) => item.routeFamily === routeFamily && item.outcome === "verified_success").length;
      const failures = (metric?.verifiedFailures ?? 0) + memoryFailures;
      const successes = (metric?.verifiedSuccesses ?? 0) + memorySuccesses;
      const evidenceAttempts = attempts + memoryFailures + memorySuccesses;
      const failureProbability = healthy ? (evidenceAttempts === 0 ? 0.1 : Math.min(1, (failures + 1) / (evidenceAttempts + 2))) : 1;
      return { routeFamily, goalCategory: input.goalCategory, ...(input.appFamily === undefined ? {} : { appFamily: input.appFamily }), prerequisites: [], health: healthy ? (metric?.status === "degraded" ? "degraded" : "healthy") : "unavailable", compatible: healthy, probeTier, estimatedProbeMs: metric?.medianProbeMs ?? estimates[0], estimatedSetupMs: estimates[1], estimatedExecutionMs: metric?.medianExecutionMs ?? estimates[2], estimatedVerificationMs: metric?.medianVerificationMs ?? estimates[3], verificationStrength, verifiedSuccesses: successes, verifiedFailures: failures, consecutiveVerifiedFailures: metric?.consecutiveVerifiedFailures ?? 0, failureProbability, recoveryCostMs: 3_000, contextTokens: input.contextTokens ?? 500, riskLevel: risk, requiresConfirmation, ...(reason === undefined ? {} : { unavailableReason: reason }), tieBreakKey: `${ORDER.indexOf(routeFamily).toString().padStart(2, "0")}:${routeFamily}` };
    };
    return [
      base("browser_bridge", hasBrowser, "strong", 1, [20, 20, 80, 80], browserUnavailableReason),
      base("structured_browser", hasStructured, "strong", 2, [40, 30, 100, 100], hasBrowser ? "structured_browser_unavailable" : browserUnavailableReason),
      base("native_adapter", hasAdapter, "strong", 1, [20, 40, 100, 120], "native_adapter_unavailable"),
      base("accessibility", hasAccessibility, "medium", 2, [50, 40, 140, 180], "accessibility_unavailable"),
      base("local_ocr", hasLocalOcr, "medium", 3, [120, 50, 180, 220], "local_ocr_unavailable"),
      base("screenshot_vision", hasScreenshotVision, "medium", 4, [220, 80, 220, 260], "screenshot_vision_unavailable"),
      base("desktop_input", hasDesktop, "weak", 5, [80, 50, 120, 300], "desktop_input_unavailable"),
      base("guide_only", true, "strong", 5, [0, 0, 0, 200], "guide_only")
    ];
  }
}
