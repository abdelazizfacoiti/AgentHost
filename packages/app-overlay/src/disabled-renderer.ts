import type { OverlayCapabilityReport, OverlayStateSnapshot, OverlayWidgetEvent } from "@agenthost/core";
import type { OverlayOperationResult, OverlayRenderRecord, OverlayRenderer, OverlayRendererDiagnostics, OverlayRendererRestartResult } from "./renderer.js";

export class DisabledOverlayRenderer implements OverlayRenderer {
  readonly #report: OverlayCapabilityReport = { supported: false, available: false, visible: false, renderer: "disabled", rendererStatus: "unavailable", sessionType: "unknown", displayAvailable: false, clickThrough: false, interactiveWidgets: false, multipleDisplays: false, globalOverlayAvailable: false, clickThroughAvailable: false, multiDisplayAvailable: false, animationAvailable: false, interactiveWidgetsAvailable: false, reason: "overlay_disabled", limitations: ["Visual rendering is disabled by configuration."] };
  capabilities(): OverlayCapabilityReport { return this.#report; }
  show(_record: OverlayRenderRecord): OverlayOperationResult { return { ok: false, reason: "overlay_disabled", acknowledged: false, rendererEpoch: 0 }; }
  update(_record: OverlayRenderRecord): OverlayOperationResult { return { ok: false, reason: "overlay_disabled", acknowledged: false, rendererEpoch: 0 }; }
  dismiss(_overlayId: string): OverlayOperationResult { return { ok: true, reason: "overlay_disabled", acknowledged: true, rendererEpoch: 0 }; }
  clear(): OverlayOperationResult { return { ok: true, reason: "overlay_disabled", acknowledged: true, rendererEpoch: 0 }; }
  emergencyHide(): OverlayOperationResult { return { ok: true, reason: "overlay_disabled", acknowledged: true, rendererEpoch: 0 }; }
  state(): OverlayStateSnapshot { return { renderer: this.#report, overlays: [], pendingEvents: [], emergencyHidden: false }; }
  events(): OverlayWidgetEvent[] { return []; }
  drainEvents(): OverlayWidgetEvent[] { return []; }
  diagnostics(): OverlayRendererDiagnostics { return { requestedMode: "disabled", effectiveBackend: "disabled", rendererStatus: "unavailable", sessionType: "unknown", displayPresent: false, waylandDisplayPresent: false, pythonExecutable: "not_used", rendererScriptPresent: false, childState: "stopped", handshake: "not_attempted", runtimeState: "stopped", rendererEpoch: 0, capabilities: this.#report, activeOverlayCount: 0, restartCount: 0, restartAllowed: false, recommendedAction: "Enable overlay rendering or use headless mode." }; }
  restart(): OverlayRendererRestartResult { return { ok: false, reason: "overlay_disabled", diagnostics: this.diagnostics() }; }
}
