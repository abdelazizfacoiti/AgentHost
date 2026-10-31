import { describe, expect, it } from "vitest";
import { HeadlessOverlayRenderer, VisualSurfaceCoordinator } from "@agenthost/app-overlay";
import { toolFailure, toolSuccess, validateOverlayWidget, type OverlayWidget } from "@agenthost/core";
import { ActionTimeline, describeAction, type TimelineAlertState } from "../action-timeline.js";

function timeline(alerts?: () => Promise<TimelineAlertState>) {
  const manager = new VisualSurfaceCoordinator(new HeadlessOverlayRenderer(), { sessionId: "timeline-session" });
  let now = 1_000;
  const instance = new ActionTimeline(manager, {
    sessionId: "timeline-session",
    now: () => now,
    clock: (epochMs) => `t${epochMs}`,
    ...(alerts === undefined ? {} : { readAlerts: alerts, alertPollMs: 10 })
  });
  return { manager, instance, advance: (ms: number) => { now += ms; } };
}

function timelineEntries(widget: OverlayWidget) {
  const component = widget.components.find((entry) => entry.type === "timeline");
  return component?.type === "timeline" ? component.entries : [];
}

describe("action timeline", () => {
  it("labels actions from safe fields only", () => {
    expect(describeAction("desktop.type_text", { text: "my secret password", target: { appName: "firefox" } })).toBe("Type 18 chars · firefox");
    expect(describeAction("desktop.click", { x: 281, y: 295, target: { appName: "firefox" } })).toBe("Click (281,295) · firefox");
    expect(describeAction("app.open_url", { url: "https://www.avito.ma/fr/maroc?token=abc", browser: "firefox" })).toBe("Open avito.ma in firefox");
    expect(describeAction("shell.run", { command: "/usr/bin/xdotool", args: ["type", "secret"] })).toBe("Run xdotool");
    expect(describeAction("desktop.pointer", { direction: "down", amount: 5, x: 10, y: 20 })).toBe("Scroll down ×5 (10,20)");
    expect(describeAction("file.write", { path: "/home/user/notes/plan.md", content: "private" })).toBe("Write plan.md");
  });

  it("lists actions newest first with outcomes and durations", async () => {
    const { manager, instance, advance } = timeline();
    const finishClick = instance.begin("desktop.click", { x: 1, y: 2 });
    advance(400);
    await finishClick(toolSuccess({ tool: "desktop.click", riskLevel: "medium", data: {} }));
    const finishDelete = instance.begin("file.delete", { path: "/tmp/a.txt" });
    await finishDelete(toolFailure({ tool: "file.delete", riskLevel: "high", error: { code: "confirmation_required", message: "Needs approval" } }));
    const finishType = instance.begin("desktop.type_text", { text: "abc" });
    await finishType(toolFailure({ tool: "desktop.type_text", riskLevel: "medium", error: { code: "emergency_stop_requested", message: "Stopped" } }));

    expect(instance.entries()).toEqual([
      { label: "Type 3 chars", state: "halted", time: "t1400", detail: "emergency_stop_requested" },
      { label: "Delete a.txt", state: "waiting", time: "t1400", detail: "Waiting for your approval" },
      { label: "Click (1,2)", state: "done", time: "t1000", detail: "0.4s" }
    ]);
    const widget = instance.widget();
    expect(validateOverlayWidget(widget)).toEqual([]);
    expect((await manager.state()).overlays.map((overlay) => overlay.overlayId)).toContain(instance.widgetId);
    await instance.close();
    await manager.close();
  });

  it("caps the history and keeps the card valid at the limit", async () => {
    const { manager, instance } = timeline();
    for (let index = 0; index < 50; index += 1) await instance.begin("desktop.click", { x: index, y: index })(toolSuccess({ tool: "desktop.click", riskLevel: "medium", data: {} }));
    expect(instance.entries()).toHaveLength(40);
    expect(instance.entries()[0]?.label).toBe("Click (49,49)");
    expect(validateOverlayWidget(instance.widget())).toEqual([]);
    await instance.close();
    await manager.close();
  });

  it("pins approval and stop alerts above the timeline", async () => {
    let alerts: TimelineAlertState = { stopped: false, paused: false };
    const { manager, instance } = timeline(async () => alerts);
    alerts = { stopped: false, paused: false, attention: { source: "claude-code", reason: "permission" } };
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(instance.widget().components[0]).toEqual({ type: "status_badge", status: "warning", text: "Waiting for you" });
    expect(instance.widget().style?.semantic).toBe("warning");
    alerts = { stopped: true, paused: false };
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(instance.widget().components[0]).toEqual({ type: "status_badge", status: "danger", text: "Stopped" });
    expect(timelineEntries(instance.widget())).toEqual([]);
    await instance.close();
    await manager.close();
  });

  it("repaints after a screenshot suppression window instead of dropping the update", async () => {
    const { manager, instance } = timeline();
    await instance.begin("desktop.click", { x: 1, y: 1 })(toolSuccess({ tool: "desktop.click", riskLevel: "medium", data: {} }));
    await manager.withScreenshotSuppressed(async () => {
      await instance.begin("desktop.hotkey", { keys: ["ctrl", "t"] })(toolSuccess({ tool: "desktop.hotkey", riskLevel: "medium", data: {} }));
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const state = await manager.state();
    expect(state.overlays.some((overlay) => overlay.overlayId === instance.widgetId)).toBe(true);
    await instance.close();
    await manager.close();
  });
  it("releases the dock after idle time and does not claim space for an empty card", async () => {
    const manager = new VisualSurfaceCoordinator(new HeadlessOverlayRenderer(), { sessionId: "idle-session" });
    const instance = new ActionTimeline(manager, { sessionId: "idle-session", idleHideMs: 40, alertPollMs: 10, readAlerts: async () => ({ stopped: false, paused: false }) });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(instance.visible).toBe(false);
    await instance.begin("desktop.click", { x: 1, y: 1 })(toolSuccess({ tool: "desktop.click", riskLevel: "medium", data: {} }));
    expect(instance.visible).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(instance.visible).toBe(false);
    await instance.close();
    await manager.close();
  });
});
