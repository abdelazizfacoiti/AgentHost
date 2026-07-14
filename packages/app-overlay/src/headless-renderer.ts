import type { OverlayCapabilityReport, OverlayStateSnapshot, OverlayWidgetEvent } from "@agenthost/core";
import type { OverlayOperationResult, OverlayRenderRecord, OverlayRenderer, OverlayRendererDiagnostics, OverlayRendererRestartResult } from "./renderer.js";

export class HeadlessOverlayRenderer implements OverlayRenderer {
  readonly #records = new Map<string, OverlayRenderRecord>();
  readonly #events: OverlayWidgetEvent[] = [];
  #emergencyHidden = false;
  readonly #report: OverlayCapabilityReport = { supported: false, renderer: "headless", rendererStatus: "headless", sessionType: "unknown", displayAvailable: false, clickThrough: false, interactiveWidgets: false, multipleDisplays: false, globalOverlayAvailable: false, clickThroughAvailable: false, multiDisplayAvailable: false, animationAvailable: false, interactiveWidgetsAvailable: false, reason: "Headless renderer stores deterministic state only.", limitations: ["No real overlay window is opened.", "Visual output unavailable until supported renderer is selected."] };

  capabilities() { return this.#report; }
  show(record: OverlayRenderRecord): OverlayOperationResult { this.#emergencyHidden = false; this.#records.set(record.overlayId, record); return { ok: true, reason: "headless_state_recorded" }; }
  update(record: OverlayRenderRecord): OverlayOperationResult { if (!this.#records.has(record.overlayId)) return { ok: false, reason: "overlay_not_found" }; this.#records.set(record.overlayId, record); return { ok: true, reason: "headless_state_updated" }; }
  dismiss(overlayId: string): OverlayOperationResult { this.#records.delete(overlayId); return { ok: true, reason: "overlay_dismissed" }; }
  clear(): OverlayOperationResult { this.#records.clear(); return { ok: true, reason: "overlays_cleared" }; }
  emergencyHide(): OverlayOperationResult { this.#records.clear(); this.#emergencyHidden = true; return { ok: true, reason: "emergency_hide_complete" }; }
  state(): OverlayStateSnapshot { return { renderer: this.#report, overlays: [], pendingEvents: [...this.#events], emergencyHidden: this.#emergencyHidden }; }
  events() { return [...this.#events]; }
  diagnostics(): OverlayRendererDiagnostics { return { requestedMode: "headless", effectiveBackend: "headless", rendererStatus: "headless", sessionType: "unknown", displayPresent: false, waylandDisplayPresent: false, pythonExecutable: "not_used", gtk3Available: false, rendererScriptPresent: false, childState: "stopped", handshake: "not_attempted", capabilities: this.#report, activeOverlayCount: this.#records.size, restartCount: 0, restartAllowed: false, recommendedAction: "Select auto or gtk3-x11 on supported X11 desktop, or keep headless." }; }
  restart(): OverlayRendererRestartResult { return { ok: false, reason: "headless_renderer_restart_not_supported", diagnostics: this.diagnostics() }; }
  pushEvent(event: OverlayWidgetEvent) { this.#events.push(event); if (this.#events.length > 100) this.#events.splice(0, this.#events.length - 100); }
}
