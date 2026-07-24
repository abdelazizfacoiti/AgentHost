import { randomUUID } from "node:crypto";
import { HeadlessOverlayRenderer, VisualSurfaceCoordinator } from "@agenthost/app-overlay";
import { describe, expect, it } from "vitest";
import { RuntimeActivityOverlayController } from "../runtime-activity-overlay.js";
import { RuntimeActivityService } from "../runtime-activity-service.js";
import { RuntimeActivityStore } from "../runtime-activity-store.js";
import { runVisualRuntimeSmoke } from "../visual-runtime-smoke.js";

describe("visual runtime smoke", () => {
  it("uses authoritative runtime activity and completes without machine actions", async () => {
    const root = `/tmp/agenthost-visual-runtime-smoke-${randomUUID()}`;
    const ownerSessionId = "visual-smoke-test";
    const overlay = new VisualSurfaceCoordinator(
      new HeadlessOverlayRenderer(),
      { sessionId: ownerSessionId }
    );
    const store = new RuntimeActivityStore(root, { ownerSessionId });
    await store.ensureStructure();
    const activity = new RuntimeActivityService(store);
    const controller = new RuntimeActivityOverlayController(overlay, activity, {
      enabled: true,
      position: "top_left",
      reducedMotion: true,
      terminalAutoHideMs: 0,
      maxLabelChars: 80,
      showElapsed: true,
      showProgress: true,
      interactiveControls: false,
      screenshotSuppression: true,
      multiTaskSummary: true
    });
    controller.start();
    const result = await runVisualRuntimeSmoke(activity, overlay, {
      requireVisible: false,
      timeoutMs: 500
    });
    expect(result).toMatchObject({
      status: "completed",
      rendererStatus: "headless",
      visible: false,
      verified: true,
      actionsExecuted: false,
      confirmationTokensCreated: false
    });
    expect(store.get(result.activityId)?.terminalVerification?.verified).toBe(true);
    const events = store.events();
    expect(events.some((event) => event.state === "preparing" && event.labelKey === "checking_available_methods")).toBe(true);
    expect(events.some((event) => event.state === "inspecting" && event.labelKey === "verifying_result")).toBe(true);
    expect(events.some((event) => event.state === "completed")).toBe(true);
    expect(store.get(result.activityId)?.progress).toMatchObject({ kind: "exact", completed: 1, total: 2, percent: 50 });
    await controller.close();
    await overlay.close();
  });

  it("fails closed when visible rendering is required from headless backend", async () => {
    const root = `/tmp/agenthost-visual-runtime-smoke-visible-${randomUUID()}`;
    const ownerSessionId = "visual-smoke-visible-test";
    const overlay = new VisualSurfaceCoordinator(
      new HeadlessOverlayRenderer(),
      { sessionId: ownerSessionId }
    );
    const store = new RuntimeActivityStore(root, { ownerSessionId });
    await store.ensureStructure();
    const activity = new RuntimeActivityService(store);
    await expect(runVisualRuntimeSmoke(activity, overlay, {
      requireVisible: true,
      timeoutMs: 100
    })).rejects.toThrow("visual_renderer_unavailable");
    expect(store.list({ includeTerminal: true })[0]).toMatchObject({
      state: "failed",
      terminalVerification: { verified: false }
    });
    await overlay.close();
  });
});
