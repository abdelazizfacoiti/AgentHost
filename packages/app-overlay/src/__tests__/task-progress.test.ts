import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OverlayWidget } from "@agenthost/core";
import { HeadlessOverlayRenderer, OverlayManager, TaskProgressOverlay, type TaskProgressAction } from "../index.js";

function payloads(manager: OverlayManager): Array<Record<string, unknown>> {
  return manager.suppressionSnapshot().map((entry) => entry.payload as Record<string, unknown>);
}

function components(manager: OverlayManager, widgetIndex = 0): Array<Record<string, unknown>> {
  const payload = payloads(manager)[widgetIndex];
  return Array.isArray(payload?.components) ? (payload.components as Array<Record<string, unknown>>) : [];
}

function component(manager: OverlayManager, type: string, key?: string): Record<string, unknown> | undefined {
  return components(manager).find((entry) => entry.type === type && (key === undefined || entry.key === key));
}

function buttons(manager: OverlayManager): unknown[] {
  return components(manager).filter((entry) => entry.type === "button").map((entry) => entry.label);
}

function event(overlayId: string, name: string, ownerSessionId = "session-1") {
  return { eventId: `event_${name}`, overlayId, event: name as never, createdAt: new Date().toISOString(), ownerSessionId };
}

function createController(options: Partial<ConstructorParameters<typeof TaskProgressOverlay>[0]> = {}) {
  const manager = new OverlayManager(new HeadlessOverlayRenderer(), { sessionId: "session-1" }, { hideMarkerPath: null });
  const actions: TaskProgressAction[] = [];
  const controller = new TaskProgressOverlay({
    manager,
    taskId: "task-1",
    title: "Researching salaries",
    steps: [
      { id: "collect", label: "Collect review pages" },
      { id: "extract", label: "Extract salary bands" },
      { id: "compare", label: "Compare to offer" }
    ],
    heartbeatMs: 60_000,
    autoHideMs: 60_000,
    onAction: (action) => actions.push(action),
    ...options
  });
  return { manager, controller, actions };
}

describe("TaskProgressOverlay", () => {
  it("renders essential progress information and step state", async () => {
    const { manager, controller } = createController();
    try {
      expect(await controller.start()).toBe(true);
      const badge = component(manager, "status_badge");
      expect(badge).toMatchObject({ status: "info", text: "Running" });
      expect(component(manager, "progress")).toMatchObject({ value: 0, label: "Step 1 / 3" });
      const checklist = component(manager, "checklist") as { items: Array<{ label: string; state: string; checked: boolean }> };
      expect(checklist.items.map((item) => item.state)).toEqual(["active", "pending", "pending"]);
      expect(checklist.items[0]).toMatchObject({ checked: false, label: "Collect review pages" });
      expect(component(manager, "key_value", "Elapsed")).toBeDefined();
      expect(buttons(manager)).toEqual(["Pause", "Stop"]);

      await controller.setStep("extract");
      expect(component(manager, "progress")).toMatchObject({ value: 1 / 3, label: "Step 2 / 3" });
      const next = component(manager, "checklist") as { items: Array<{ state: string }> };
      expect(next.items.map((item) => item.state)).toEqual(["done", "active", "pending"]);
    } finally {
      await controller.dismiss();
      await manager.close();
    }
  });

  it("applies cooperative pause, resume, and stop events", async () => {
    const { manager, controller, actions } = createController();
    try {
      await controller.start();
      manager.pushEvent(event("task-1", "pause"));
      expect(await controller.pollEvents()).toEqual(["pause"]);
      expect(controller.snapshot().status).toBe("pause_requested");
      expect(component(manager, "status_badge")).toMatchObject({ text: "Pausing after this step" });
      expect(buttons(manager)).toEqual(["Resume", "Stop"]);

      manager.pushEvent(event("task-1", "resume"));
      expect(await controller.pollEvents()).toEqual(["resume"]);
      expect(controller.snapshot().status).toBe("running");
      expect(buttons(manager)).toEqual(["Pause", "Stop"]);

      manager.pushEvent(event("task-1", "emergency_stop_requested"));
      expect(await controller.pollEvents()).toEqual(["stop"]);
      expect(controller.snapshot().status).toBe("stopping");
      expect(buttons(manager)).toEqual([]);

      await controller.stopped("Stopped by operator");
      expect(controller.snapshot().status).toBe("stopped");
      expect(buttons(manager)).toEqual(["Dismiss"]);
      expect(actions).toEqual(["pause", "resume", "stop"]);
    } finally {
      await controller.dismiss();
      await manager.close();
    }
  });

  it("shows the exact approval command and completes at one hundred percent", async () => {
    const { manager, controller } = createController();
    try {
      await controller.start();
      await controller.waitingForApproval("task-1");
      expect(component(manager, "status_badge")).toMatchObject({ status: "warning", text: "Waiting for approval" });
      expect(component(manager, "warning")).toMatchObject({ text: "Approval needed. Run: agenthost task approve task-1" });

      await controller.complete("Report is ready");
      expect(controller.snapshot().status).toBe("done");
      expect(component(manager, "status_badge")).toMatchObject({ status: "success", text: "Done" });
      expect(component(manager, "progress")).toMatchObject({ value: 1, label: "Step 3 / 3" });
      expect(component(manager, "text")).toMatchObject({ text: "Report is ready" });
      const checklist = component(manager, "checklist") as { items: Array<{ state: string }> };
      expect(checklist.items.every((item) => item.state === "done")).toBe(true);
      expect(buttons(manager)).toEqual(["Dismiss"]);
    } finally {
      await controller.dismiss();
      await manager.close();
    }
  });

  it("auto-hides terminal cards and dismisses on the close button event", async () => {
    const { manager, controller } = createController({ autoHideMs: 1_000 });
    try {
      await controller.start();
      await controller.complete();
      expect((await manager.state()).overlays).toHaveLength(1);
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      expect((await manager.state()).overlays).toHaveLength(0);
    } finally {
      await manager.close();
    }

    const second = createController();
    try {
      await second.controller.start();
      second.manager.pushEvent(event("task-1", "dismissed"));
      expect(await second.controller.pollEvents()).toEqual(["dismiss"]);
      expect((await second.manager.state()).overlays).toHaveLength(0);
    } finally {
      await second.manager.close();
    }
  });

  it("persists terminal cards by default and freezes elapsed time", async () => {
    let clock = 1_000;
    const manager = new OverlayManager(new HeadlessOverlayRenderer(), { sessionId: "session-1" }, { hideMarkerPath: null });
    const controller = new TaskProgressOverlay({ manager, taskId: "task-persist", title: "Persistent run", steps: [{ id: "only", label: "Work" }], heartbeatMs: 60_000, now: () => clock });
    try {
      await controller.start();
      clock += 5_000;
      await controller.setDetail("Reading");
      expect(controller.snapshot().elapsedMs).toBe(5_000);
      await controller.complete("Ready");
      expect((await manager.state()).overlays[0]).toMatchObject({ persistent: true });
      clock += 20_000;
      expect(controller.snapshot().elapsedMs).toBe(5_000);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect((await manager.state()).overlays).toHaveLength(1);
    } finally {
      await controller.dismiss();
      await manager.close();
    }
  });

  it("emergency-hides persistent cards through the cross-process hide marker", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agenthost-overlay-hide-"));
    const marker = path.join(directory, "overlay.hide");
    const manager = new OverlayManager(new HeadlessOverlayRenderer(), { sessionId: "session-1" }, { hideMarkerPath: marker });
    const controller = new TaskProgressOverlay({ manager, taskId: "task-hide", title: "Hide me", heartbeatMs: 60_000 });
    try {
      await controller.start();
      await controller.complete();
      expect((await manager.state()).overlays).toHaveLength(1);
      await writeFile(marker, "{}\n", "utf8");
      expect(await controller.pollEvents()).toEqual(["dismiss"]);
      expect((await manager.state()).overlays).toHaveLength(0);
    } finally {
      await controller.dismiss();
      await manager.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("routes overlaid events to the correct card when several cards share one manager", async () => {
    const manager = new OverlayManager(new HeadlessOverlayRenderer(), { sessionId: "session-1" }, { hideMarkerPath: null });
    const first = new TaskProgressOverlay({ manager, taskId: "task-a", title: "First task", heartbeatMs: 60_000 });
    const second = new TaskProgressOverlay({ manager, taskId: "task-b", title: "Second task", heartbeatMs: 60_000 });
    try {
      await first.start();
      await second.start();
      manager.pushEvent(event("task-a", "pause"));
      manager.pushEvent(event("task-b", "pause"));
      expect(await second.pollEvents()).toEqual(["pause"]);
      expect(await first.pollEvents()).toEqual(["pause"]);
      expect(first.snapshot().status).toBe("pause_requested");
      expect(second.snapshot().status).toBe("pause_requested");
    } finally {
      await first.dismiss();
      await second.dismiss();
      await manager.close();
    }
  });

  it("requires a widget id and an existing overlay for updates", async () => {
    const manager = new OverlayManager(new HeadlessOverlayRenderer(), { sessionId: "session-1" }, { hideMarkerPath: null });
    try {
      const widget: OverlayWidget = { title: "Missing", components: [], sensitivity: "public" };
      expect(await manager.updateWidget(widget)).toMatchObject({ ok: false, reason: "overlay_widget_id_required" });
      expect(await manager.updateWidget({ ...widget, widgetId: "absent" })).toMatchObject({ ok: false, reason: "overlay_not_found" });
    } finally {
      await manager.close();
    }
  });
});
