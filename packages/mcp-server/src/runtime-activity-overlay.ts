import type { OverlayManager } from "@agenthost/app-overlay";
import { runtimeActivityLabel, type OverlayWidget, type RuntimeActivityRecord, type RuntimeActivityRendererBinding, type RuntimeActivityScreenshotSuppression } from "@agenthost/core";
import type { RuntimeActivityService } from "./runtime-activity-service.js";

export interface RuntimeActivityOverlayOptions {
  enabled: boolean;
  position: "top_left" | "top_center" | "top_right" | "bottom_left" | "bottom_center" | "bottom_right";
  reducedMotion: boolean;
  terminalAutoHideMs: number;
  maxLabelChars: number;
  showElapsed: boolean;
  showProgress: boolean;
  interactiveControls: boolean;
  screenshotSuppression: boolean;
  multiTaskSummary: boolean;
}

export class RuntimeActivityOverlayController {
  readonly #manager: OverlayManager;
  readonly #activity: RuntimeActivityService;
  readonly #options: RuntimeActivityOverlayOptions;
  #unsubscribe: (() => void) | undefined;
  #overlayId: string | undefined;
  #rendererEpoch: number | undefined;
  #renderQueue: Promise<void> = Promise.resolve();
  #captureQueue: Promise<unknown> = Promise.resolve();
  #terminalTimer: ReturnType<typeof setTimeout> | undefined;
  #closed = false;

  constructor(manager: OverlayManager, activity: RuntimeActivityService, options: RuntimeActivityOverlayOptions) {
    this.#manager = manager;
    this.#activity = activity;
    this.#options = options;
  }

  start(): void { this.#unsubscribe = this.#activity.subscribe((record) => { this.#renderQueue = this.#renderQueue.then(() => this.#render(record)).catch(() => undefined); }); }
  async close(): Promise<void> { this.#closed = true; this.#unsubscribe?.(); if (this.#terminalTimer !== undefined) clearTimeout(this.#terminalTimer); if (this.#overlayId !== undefined) await this.#manager.dismiss(this.#overlayId).catch(() => undefined); this.#overlayId = undefined; this.#rendererEpoch = undefined; }
  /** Immediately hide the working widget (task done/stopped). The overlay must never outlive the work. */
  async hideNow(): Promise<void> {
    if (this.#terminalTimer !== undefined) {
      clearTimeout(this.#terminalTimer);
      this.#terminalTimer = undefined;
    }
    if (this.#overlayId !== undefined) {
      await this.#manager.dismiss(this.#overlayId).catch(() => undefined);
      this.#overlayId = undefined;
      this.#rendererEpoch = undefined;
    }
  }
  async onRendererRestart(): Promise<void> { this.#activity.store().clearRendererBindings(); this.#overlayId = undefined; this.#rendererEpoch = undefined; await this.#renderQueue; const active = this.#activity.store().list({ limit: 1 })[0]; if (active !== undefined) { this.#renderQueue = this.#renderQueue.then(() => this.#render(active)).catch(() => undefined); await this.#renderQueue; } }
  async projection(): Promise<{ visible: boolean; rendererStatus: "available" | "degraded" | "headless" | "unavailable"; suppression: RuntimeActivityScreenshotSuppression }> { const diagnostics = await this.#manager.diagnostics(); return { visible: this.#overlayId !== undefined && this.#manager.isOverlayLive(this.#overlayId) && diagnostics.rendererStatus === "available" && diagnostics.capabilities.visible !== false, rendererStatus: diagnostics.rendererStatus, suppression: this.#activity.store().list({ limit: 1 })[0]?.screenshotSuppression ?? "none" }; }

  async withScreenshotSuppressed<T>(capture: () => Promise<T>): Promise<T> {
    const coordinator = this.#manager as OverlayManager & { withScreenshotSuppressed?: <R>(capture: () => Promise<R>) => Promise<R> };
    if (coordinator.withScreenshotSuppressed !== undefined) return await coordinator.withScreenshotSuppressed(capture);
    const previous = this.#captureQueue;
    const run = previous.catch(() => undefined).then(() => this.#captureUnsafe(capture));
    this.#captureQueue = run.then(() => undefined, () => undefined);
    return await run;
  }

  async #captureUnsafe<T>(capture: () => Promise<T>): Promise<T> {
    await this.#renderQueue;
    if (!this.#options.screenshotSuppression || this.#overlayId === undefined) return await capture();
    this.#activity.setSuppression("requested");
    const overlayId = this.#overlayId;
    const dismissed = await this.#manager.dismiss(overlayId);
    this.#overlayId = undefined;
    this.#rendererEpoch = undefined;
    if (!dismissed.ok || this.#manager.isOverlayLive(overlayId)) { this.#activity.setSuppression("failed"); throw new Error("runtime_activity_suppression_not_acknowledged"); }
    this.#activity.setSuppression("suppressed");
    this.#activity.setSuppression("capturing");
    try { return await capture(); }
    finally {
      this.#activity.setSuppression("restoring");
      this.#renderQueue = this.#renderQueue.then(async () => { const record = this.#activity.store().list({ limit: 1 })[0]; if (record !== undefined) await this.#render(record); }).catch(() => undefined);
      await this.#renderQueue;
      this.#activity.setSuppression(this.#overlayId === undefined ? "failed" : "restored");
    }
  }

  async #render(record?: RuntimeActivityRecord): Promise<void> {
    if (this.#closed || !this.#options.enabled) return;
    if (this.#terminalTimer !== undefined && (record === undefined || !["completed", "failed", "cancelled"].includes(record.state))) {
      clearTimeout(this.#terminalTimer);
      this.#terminalTimer = undefined;
    }
    const candidate = record ?? this.#activity.store().list({ limit: 1 })[0];
    const diagnostics = await this.#manager.diagnostics();
    if (diagnostics.rendererStatus !== "available") {
      if (this.#overlayId !== undefined) await this.#manager.dismiss(this.#overlayId).catch(() => undefined);
      this.#overlayId = undefined;
      this.#rendererEpoch = undefined;
      if (candidate !== undefined && candidate.warningCode !== "renderer_unavailable") this.#activity.store().update(candidate.activityId, { warningCode: "renderer_unavailable" });
      return;
    }
    if (candidate === undefined) { if (this.#overlayId !== undefined) await this.#manager.dismiss(this.#overlayId).catch(() => undefined); this.#overlayId = undefined; return; }
    if (["requested", "suppressed", "capturing"].includes(candidate.screenshotSuppression)) {
      if (this.#overlayId !== undefined) await this.#manager.dismiss(this.#overlayId).catch(() => undefined);
      this.#overlayId = undefined;
      this.#rendererEpoch = undefined;
      return;
    }
    const activeCount = this.#activity.store().list({ limit: 50 }).filter((item) => !["completed", "failed", "cancelled"].includes(item.state)).length;
    if (["completed", "failed", "cancelled"].includes(candidate.state) && this.#terminalTimer === undefined) this.#terminalTimer = setTimeout(() => { this.#terminalTimer = undefined; if (this.#overlayId !== undefined) void this.#manager.dismiss(this.#overlayId); this.#overlayId = undefined; }, Math.min(300_000, Math.max(0, this.#options.terminalAutoHideMs)));
    const progress = candidate.progress?.kind === "exact" && this.#options.showProgress ? candidate.progress : undefined;
    const actionLabel = runtimeActivityLabel(candidate.actionKey, this.#options.maxLabelChars);
    const detail = typeof candidate.detail === "string" && candidate.detail.trim().length > 0
      ? candidate.detail.slice(0, Math.max(1, Math.min(120, this.#options.maxLabelChars)))
      : undefined;
    const components = [
      { type: "heading" as const, text: "AgentHost working" },
      { type: "status_badge" as const, status: candidate.state === "blocked" || candidate.state === "failed" ? "danger" as const : candidate.state === "waiting_for_approval" || candidate.state === "paused" ? "warning" as const : candidate.state === "completed" ? "success" as const : "info" as const, text: candidate.state.replaceAll("_", " ") },
      { type: "key_value" as const, key: "Action", value: detail === undefined ? actionLabel : `${actionLabel} ${detail}` },
      ...(this.#options.multiTaskSummary && activeCount > 1 ? [{ type: "key_value" as const, key: "Active tasks", value: String(Math.min(50, activeCount)) }] : []),
      ...(this.#options.showElapsed ? [{ type: "key_value" as const, key: "Elapsed", value: `${Math.floor(candidate.elapsedMs / 1000)}s` }] : []),
      ...(progress === undefined ? [] : [{ type: "progress" as const, value: progress.percent / 100, label: `${progress.completed}/${progress.total}` }]),
      ...(candidate.blockerCode === undefined ? [] : [{ type: "warning" as const, text: "Blocked by policy" }]),
      ...(candidate.warningCode === undefined ? [] : [{ type: "warning" as const, text: "Recovery required" }])
    ];
    const widget: OverlayWidget = {
      title: "AgentHost working",
      components,
      placement: this.#options.position,
      displayPolicy: this.#options.multiTaskSummary ? "primary" : "primary",
      sensitivity: "public",
      interaction: { interactive: this.#options.interactiveControls && candidate.controlCapabilities.length > 0, focus: "never", dismissible: false, allowedEvents: [] },
      animation: { kind: "fade", durationMs: this.#options.reducedMotion ? 0 : 180, reducedMotion: this.#options.reducedMotion ? "instant" : "fade" }
    };
    if (this.#overlayId !== undefined) { await this.#manager.dismiss(this.#overlayId).catch(() => undefined); this.#overlayId = undefined; this.#rendererEpoch = undefined; }
    const result = await this.#manager.showWidget(widget);
    if (!result.ok || result.overlay === undefined || !this.#manager.isOverlayLive(result.overlay.overlayId)) { this.#overlayId = undefined; this.#rendererEpoch = undefined; this.#activity.store().update(candidate.activityId, { warningCode: result.errors[0] ?? "overlay_render_not_acknowledged" }); return; }
    this.#overlayId = result.overlay.overlayId;
    this.#rendererEpoch = this.#manager.rendererEpoch();
    const binding: RuntimeActivityRendererBinding = { overlayId: this.#overlayId, rendererEpoch: this.#rendererEpoch, boundAt: new Date().toISOString(), visible: true, acknowledged: true };
    this.#activity.setRendererBinding(candidate.activityId, binding);
    if (candidate.warningCode !== undefined) this.#activity.store().update(candidate.activityId, { clearWarning: true });
  }
}
