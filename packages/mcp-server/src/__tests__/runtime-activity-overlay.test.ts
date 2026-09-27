import { describe, expect, it } from "vitest";
import type { OverlayCapabilityReport, OverlayStateSnapshot, OverlayWidgetEvent } from "@agenthost/core";
import type { OverlayOperationResult, OverlayRenderRecord, OverlayRenderer, OverlayRendererDiagnostics } from "@agenthost/app-overlay";
import { OverlayManager } from "@agenthost/app-overlay";
import { RuntimeActivityStore } from "../runtime-activity-store.js";
import { RuntimeActivityService } from "../runtime-activity-service.js";
import { RuntimeActivityOverlayController } from "../runtime-activity-overlay.js";

const capabilities: OverlayCapabilityReport = { supported: true, renderer: "test", rendererStatus: "available", sessionType: "x11", displayAvailable: true, clickThrough: true, interactiveWidgets: false, multipleDisplays: true, globalOverlayAvailable: true, clickThroughAvailable: true, multiDisplayAvailable: true, animationAvailable: true, interactiveWidgetsAvailable: false, reason: "test", limitations: [] };

class FakeRenderer implements OverlayRenderer {
  readonly records = new Map<string, OverlayRenderRecord>();
  show(record: OverlayRenderRecord): OverlayOperationResult { this.records.set(record.overlayId, record); return { ok: true, reason: "visible_ack", acknowledged: true, rendererEpoch: 1, visibleWindowCount: 1, interactiveWindowCount: 0 }; }
  update(record: OverlayRenderRecord): OverlayOperationResult { if (!this.records.has(record.overlayId)) return { ok: false, reason: "overlay_not_found", acknowledged: false }; this.records.set(record.overlayId, record); return { ok: true, reason: "updated_ack", acknowledged: true, rendererEpoch: 1 }; }
  dismiss(id: string): OverlayOperationResult { this.records.delete(id); return { ok: true, reason: "dismissed_ack", acknowledged: true, rendererEpoch: 1 }; }
  clear(): OverlayOperationResult { this.records.clear(); return { ok: true, reason: "cleared_ack", acknowledged: true, rendererEpoch: 1 }; }
  emergencyHide(): OverlayOperationResult { this.records.clear(); return { ok: true, reason: "hidden_ack", acknowledged: true, rendererEpoch: 1 }; }
  state(): OverlayStateSnapshot { return { renderer: capabilities, overlays: [], pendingEvents: [], emergencyHidden: false }; }
  events(): OverlayWidgetEvent[] { return []; }
  capabilities(): OverlayCapabilityReport { return capabilities; }
  diagnostics(): OverlayRendererDiagnostics { return { requestedMode: "auto", effectiveBackend: "test", rendererStatus: "available", sessionType: "x11", displayPresent: true, waylandDisplayPresent: false, pythonExecutable: "test", rendererScriptPresent: true, childState: "running", handshake: "passed", runtimeState: "ready", rendererEpoch: 1, capabilities, activeOverlayCount: this.records.size, restartCount: 0, restartAllowed: false, recommendedAction: "healthy" }; }
  async close(): Promise<void> { this.records.clear(); }
}

async function flush(): Promise<void> { await new Promise((resolve) => setTimeout(resolve, 20)); }

describe("global runtime activity overlay", () => {
  it("renders only after acknowledged show and binds authoritative activity", async () => {
    const renderer = new FakeRenderer();
    const manager = new OverlayManager(renderer, { sessionId: "owner" });
    const store = new RuntimeActivityStore("/tmp/agenthost-runtime-overlay-test", { ownerSessionId: "owner" });
    await store.ensureStructure();
    const service = new RuntimeActivityService(store);
    const controller = new RuntimeActivityOverlayController(manager, service, { enabled: true, position: "top_left", reducedMotion: true, terminalAutoHideMs: 1000, maxLabelChars: 80, showElapsed: true, showProgress: true, interactiveControls: false, screenshotSuppression: true, multiTaskSummary: true });
    controller.start();
    try {
      const record = service.begin({ taskId: "task_owner", source: "browser", labelKey: "opening_browser", actionKey: "opening_browser", operation: "open" });
      await flush();
      expect((await controller.projection()).visible).toBe(true);
      expect(store.get(record.activityId)?.rendererBinding).toMatchObject({ visible: true, acknowledged: true, rendererEpoch: 1 });
    } finally { await controller.close(); }
  });

  it("auto-hides failed terminal work and supports immediate hide", async () => {
    const renderer = new FakeRenderer();
    const manager = new OverlayManager(renderer, { sessionId: "owner" });
    const store = new RuntimeActivityStore("/tmp/agenthost-runtime-overlay-failed-test", { ownerSessionId: "owner" });
    await store.ensureStructure();
    const service = new RuntimeActivityService(store);
    const controller = new RuntimeActivityOverlayController(manager, service, { enabled: true, position: "top_left", reducedMotion: true, terminalAutoHideMs: 60, maxLabelChars: 80, showElapsed: true, showProgress: true, interactiveControls: false, screenshotSuppression: true, multiTaskSummary: true });
    controller.start();
    try {
      const record = service.begin({ taskId: "task_failed", source: "desktop", labelKey: "verifying_result", actionKey: "verifying_result", operation: "click" });
      await flush();
      expect((await controller.projection()).visible).toBe(true);
      service.finish(record.activityId, "failed", { verified: false, source: "tool_result" });
      await flush();
      expect((await controller.projection()).visible).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await flush();
      expect((await controller.projection()).visible).toBe(false);
      expect(renderer.records.size).toBe(0);
      const again = service.begin({ taskId: "task_hide_now", source: "desktop", labelKey: "reading_visible_text", actionKey: "reading_visible_text", operation: "type" });
      expect(again.activityId.length).toBeGreaterThan(0);
      await flush();
      expect((await controller.projection()).visible).toBe(true);
      await controller.hideNow();
      expect((await controller.projection()).visible).toBe(false);
    } finally { await controller.close(); }
  });

  it("hides overlay before screenshot capture and restores after capture", async () => {
    const renderer = new FakeRenderer();
    const manager = new OverlayManager(renderer, { sessionId: "owner" });
    const store = new RuntimeActivityStore("/tmp/agenthost-runtime-overlay-capture-test", { ownerSessionId: "owner" });
    await store.ensureStructure();
    const service = new RuntimeActivityService(store);
    const controller = new RuntimeActivityOverlayController(manager, service, { enabled: true, position: "top_left", reducedMotion: true, terminalAutoHideMs: 1000, maxLabelChars: 80, showElapsed: true, showProgress: true, interactiveControls: false, screenshotSuppression: true, multiTaskSummary: true });
    controller.start();
    service.begin({ taskId: "task_capture", source: "desktop", labelKey: "preparing_screenshot", actionKey: "preparing_screenshot", operation: "capture" });
    await flush();
    let visibleDuringCapture = true;
    await controller.withScreenshotSuppressed(async () => { visibleDuringCapture = (await controller.projection()).visible; return "captured"; });
    expect(visibleDuringCapture).toBe(false);
    await flush();
    expect((await controller.projection()).visible).toBe(true);
    await controller.close();
  });

  it("shows specific action detail in the working widget", async () => {
    const renderer = new FakeRenderer();
    const manager = new OverlayManager(renderer, { sessionId: "owner" });
    const store = new RuntimeActivityStore("/tmp/agenthost-runtime-overlay-detail-test", { ownerSessionId: "owner" });
    await store.ensureStructure();
    const service = new RuntimeActivityService(store);
    const controller = new RuntimeActivityOverlayController(manager, service, { enabled: true, position: "top_left", reducedMotion: true, terminalAutoHideMs: 1000, maxLabelChars: 80, showElapsed: true, showProgress: true, interactiveControls: false, screenshotSuppression: true, multiTaskSummary: true });
    controller.start();
    try {
      service.startDirectTool("desktop.click", "owner", { x: 520, y: 340, activeWindow: { windowId: "42" } });
      await flush();
      const payloads = [...renderer.records.values()].map((record) => JSON.stringify(record.payload));
      expect(payloads.some((payload) => payload.includes("Clicking target") && payload.includes("(520, 340)"))).toBe(true);
    } finally { await controller.close(); }
  });
});
