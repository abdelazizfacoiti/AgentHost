import type { OverlayOwner, OverlayTargetResolver } from "./manager.js";
import type { OverlayRenderer, OverlayRendererRestartResult } from "./renderer.js";
import { OverlayManager as BaseOverlayManager } from "./manager.js";
import type { VisualSurfaceProtocolEnvelope } from "@agenthost/core";
import { redactVisualSurface, validateVisualSurface, visualSurfacePriorityValue } from "@agenthost/core";
import { normalizeTrustedVisualComponents } from "./component-registry.js";

export interface VisualSurfaceCoordinatorOptions { maxActiveSurfaces?: number; reducedMotion?: boolean; targetResolver?: OverlayTargetResolver | undefined; }

/** Single ephemeral projection authority. Persistent session data stays in MCP stores. */
export class VisualSurfaceCoordinator extends BaseOverlayManager {
  readonly #surfaces = new Map<string, VisualSurfaceProtocolEnvelope>();
  readonly #options: { maxActiveSurfaces: number; reducedMotion: boolean; targetResolver?: OverlayTargetResolver | undefined };
  #captureQueue: Promise<unknown> = Promise.resolve();
  #suppressed = false;
  constructor(renderer: OverlayRenderer, owner: OverlayOwner, options: VisualSurfaceCoordinatorOptions = {}) {
    super(renderer, owner);
    this.#options = { maxActiveSurfaces: Math.min(12, Math.max(1, options.maxActiveSurfaces ?? 8)), reducedMotion: options.reducedMotion ?? false, targetResolver: options.targetResolver };
  }
  async showSurface(surface: VisualSurfaceProtocolEnvelope, targetResolver = this.#options.targetResolver): Promise<{ ok: boolean; surfaceId: string; visible: boolean; errors: string[] }> {
    if (surface === null || typeof surface !== "object") return { ok: false, surfaceId: "invalid", visible: false, errors: ["visual_surface_invalid"] };
    if (this.#suppressed) return { ok: false, surfaceId: typeof surface.surfaceId === "string" ? surface.surfaceId : "invalid", visible: false, errors: ["visual_surface_suppressed"] };
    const safeSurface = surface.content !== null && typeof surface.content === "object" ? redactVisualSurface(surface) : surface;
    const validation = validateVisualSurface(safeSurface);
    if (!validation.ok || safeSurface.ownerSessionId !== this.ownerSessionId()) return { ok: false, surfaceId: safeSurface.surfaceId, visible: false, errors: [...validation.errors, ...(safeSurface.ownerSessionId !== this.ownerSessionId() ? ["surface_owner_mismatch"] : [])] };
    const active = [...this.#surfaces.values()].filter((item) => item.state !== "hidden" && Date.parse(item.expiresAt) > Date.now());
    if (!this.#surfaces.has(safeSurface.surfaceId) && active.length >= this.#options.maxActiveSurfaces) {
      const lowest = active.sort((a, b) => visualSurfacePriorityValue(a.priority) - visualSurfacePriorityValue(b.priority) || a.createdAt.localeCompare(b.createdAt) || a.surfaceId.localeCompare(b.surfaceId))[0];
      if (lowest === undefined || visualSurfacePriorityValue(lowest.priority) >= visualSurfacePriorityValue(safeSurface.priority)) return { ok: false, surfaceId: safeSurface.surfaceId, visible: false, errors: ["visual_surface_concurrency_limit"] };
      await this.dismissSurface(lowest.surfaceId);
    }
    const allowedEvents = safeSurface.approvedIntents.filter((event): event is "continue" | "pause" | "resume" | "cancel" | "acknowledge" | "show_details" | "hide" | "retry_visual_render" | "inspect_diagnostics" | "open_control_room" | "review_prepared_action" => ["continue", "pause", "resume", "cancel", "acknowledge", "show_details", "hide", "retry_visual_render", "inspect_diagnostics", "open_control_room", "review_prepared_action"].includes(event));
    const result = await this.showWidget({ widgetId: safeSurface.surfaceId, title: safeSurface.content.title, components: normalizeTrustedVisualComponents(safeSurface.content.components), ...(safeSurface.target === undefined ? {} : { target: safeSurface.target }), placement: safeSurface.placement, ...(safeSurface.style === undefined ? {} : { style: safeSurface.style }), ...(safeSurface.animation === undefined ? {} : { animation: safeSurface.animation }), interaction: { interactive: safeSurface.interactionMode === "bounded_interactive", focus: "never", dismissible: safeSurface.approvedIntents.includes("hide"), allowedEvents }, sensitivity: safeSurface.sensitivity, ttlMs: safeSurface.ttlMs }, targetResolver, this.#options.reducedMotion);
    if (!result.ok) return { ok: false, surfaceId: safeSurface.surfaceId, visible: false, errors: result.errors };
    const next: VisualSurfaceProtocolEnvelope = { ...safeSurface, state: "visible", updatedAt: new Date().toISOString(), expiresAt: result.overlay?.expiresAt ?? safeSurface.expiresAt, ...(result.overlay === undefined ? {} : { rendererEpoch: this.rendererEpoch() }) };
    this.#surfaces.set(safeSurface.surfaceId, next);
    const capabilities = await this.diagnostics();
    return { ok: true, surfaceId: safeSurface.surfaceId, visible: this.isOverlayLive(safeSurface.surfaceId) && capabilities.capabilities.visible !== false && capabilities.capabilities.available !== false, errors: [] };
  }
  async updateSurface(surfaceId: string, patch: Partial<VisualSurfaceProtocolEnvelope>): Promise<{ ok: boolean; visible: boolean; errors: string[] }> {
    const current = this.#surfaces.get(surfaceId);
    if (current === undefined || current.ownerSessionId !== this.ownerSessionId()) return { ok: false, visible: false, errors: ["surface_binding_missing"] };
    const next = { ...current, ...patch, surfaceId, ownerSessionId: this.ownerSessionId(), updatedAt: new Date().toISOString() } as VisualSurfaceProtocolEnvelope;
    const validation = validateVisualSurface(next);
    if (!validation.ok) return { ok: false, visible: false, errors: validation.errors };
    await this.dismissSurface(surfaceId);
    const shown = await this.showSurface(next);
    return { ok: shown.ok, visible: shown.visible, errors: shown.errors };
  }
  async dismissSurface(surfaceId: string): Promise<{ ok: boolean; reason: string }> { this.#surfaces.delete(surfaceId); return await super.dismiss(surfaceId); }
  override async clear() { this.#surfaces.clear(); return await super.clear(); }
  override async emergencyHide() { this.#surfaces.clear(); return await super.emergencyHide(); }
  override async close() { this.#surfaces.clear(); await super.close(); }
  surfaceSnapshot(): VisualSurfaceProtocolEnvelope[] { if (this.#suppressed) return []; return [...this.#surfaces.values()].filter((item) => item.state !== "hidden" && Date.parse(item.expiresAt) > Date.now()).sort((a, b) => visualSurfacePriorityValue(b.priority) - visualSurfacePriorityValue(a.priority) || a.createdAt.localeCompare(b.createdAt) || a.surfaceId.localeCompare(b.surfaceId)); }
  surfaceState(): { surfaces: VisualSurfaceProtocolEnvelope[]; suppressed: boolean } { return { surfaces: this.surfaceSnapshot(), suppressed: this.#suppressed }; }
  async withScreenshotSuppressed<T>(capture: () => Promise<T>): Promise<T> {
    const previous = this.#captureQueue;
    const run = previous.catch(() => undefined).then(async () => {
      const snapshot = super.suppressionSnapshot();
      this.#suppressed = true;
      try {
        await super.clear();
        if ((await super.state()).overlays.length > 0) throw new Error("screenshot_surface_unknown");
        return await capture();
      } finally {
        this.#suppressed = false;
        await super.restoreSuppressionSnapshot(snapshot);
      }
    });
    this.#captureQueue = run.then(() => undefined, () => undefined);
    return await run;
  }
  override async restartRenderer(): Promise<OverlayRendererRestartResult> {
    const snapshot = this.surfaceSnapshot();
    const result = await super.restartRenderer();
    if (!result.ok) return result;
    for (const surface of snapshot) { const next: VisualSurfaceProtocolEnvelope = { ...surface, state: "draft", updatedAt: new Date().toISOString() }; delete next.rendererEpoch; await this.showSurface(next).catch(() => undefined); }
    return result;
  }
  ownerSessionId(): string { return this.ownerId(); }
}
