import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendTaskEvent, createTask, readRunState, toolSuccess } from "@agenthost/core";
import { HeadlessOverlayRenderer, OverlayManager } from "@agenthost/app-overlay";
import { TaskActivityOverlay } from "../task-overlay.js";

const SESSION = "task-overlay-test";
const directories: string[] = [];

async function tempHome(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenthost-task-overlay-"));
  directories.push(directory);
  return directory;
}

function event(overlayId: string, name: string) {
  return { eventId: `event_${name}_${overlayId}`, overlayId, event: name as never, createdAt: new Date().toISOString(), ownerSessionId: SESSION };
}

function component(manager: OverlayManager, type: string): Record<string, unknown> | undefined {
  const payload = manager.suppressionSnapshot()[0]?.payload as Record<string, unknown> | undefined;
  const components = Array.isArray(payload?.components) ? payload.components as Array<Record<string, unknown>> : [];
  return components.find((entry) => entry.type === type);
}

function buttons(manager: OverlayManager): unknown[] {
  const payload = manager.suppressionSnapshot()[0]?.payload as Record<string, unknown> | undefined;
  const components = Array.isArray(payload?.components) ? payload.components as Array<Record<string, unknown>> : [];
  return components.filter((entry) => entry.type === "button").map((entry) => entry.label);
}

function createController(home: string) {
  const manager = new OverlayManager(new HeadlessOverlayRenderer(), { sessionId: SESSION }, { hideMarkerPath: null });
  const overlay = new TaskActivityOverlay({ manager, agentHostDir: home, heartbeatMs: 60_000 });
  return { manager, overlay };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("TaskActivityOverlay", () => {
  it("restores the current active task on startup and renders its criteria", async () => {
    const home = await tempHome();
    const task = await createTask(home, "Research the offer", ["Collect pages", "Extract salary bands"]);
    const { manager, overlay } = createController(home);
    try {
      await overlay.initialize();
      expect(overlay.snapshot()).toMatchObject({ taskId: task.taskId, status: "running" });
      const payload = manager.suppressionSnapshot()[0]?.payload as Record<string, unknown>;
      expect(payload.title).toContain("Research the offer");
      expect(component(manager, "checklist")).toMatchObject({
        items: [
          { label: "Collect pages", state: "active" },
          { label: "Extract salary bands", state: "pending" }
        ]
      });
    } finally {
      await overlay.close();
      await manager.close();
    }
  });

  it("updates criteria as verification events arrive", async () => {
    const home = await tempHome();
    const task = await createTask(home, "Research the offer", ["Collect pages", "Extract salary bands"]);
    const { manager, overlay } = createController(home);
    try {
      await overlay.initialize();
      const updated = await appendTaskEvent(home, task.taskId, "verification", "Definition of done met: Collect pages");
      await overlay.observe("task.add_event", toolSuccess({ tool: "task.add_event", riskLevel: "low", data: updated }));
      expect(component(manager, "checklist")).toMatchObject({
        items: [
          { label: "Collect pages", state: "done" },
          { label: "Extract salary bands", state: "active" }
        ]
      });
    } finally {
      await overlay.close();
      await manager.close();
    }
  });

  it("pauses globally and finishes a stopped card with an explicit dismiss control", async () => {
    const home = await tempHome();
    const task = await createTask(home, "Research the offer");
    const { manager, overlay } = createController(home);
    try {
      await overlay.initialize();
      manager.pushEvent(event(task.taskId, "pause"));
      expect(await overlay.pollOnce()).toEqual(["pause"]);
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(overlay.snapshot().status).toBe("paused");
      expect(buttons(manager)).toEqual(["Resume", "Stop"]);
      expect((await readRunState(home)).pause).toMatchObject({
        requested: true,
        reason: `agent_task_overlay_pause:${task.taskId}`
      });

      manager.pushEvent(event(task.taskId, "resume"));
      expect(await overlay.pollOnce()).toEqual(["resume"]);
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(overlay.snapshot().status).toBe("running");
      expect((await readRunState(home)).pause.requested).toBe(false);

      manager.pushEvent(event(task.taskId, "emergency_stop_requested"));
      expect(await overlay.pollOnce()).toEqual(["stop"]);
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(overlay.snapshot().status).toBe("stopped");
      expect((await readRunState(home)).stop.requested).toBe(true);
      expect(buttons(manager)).toEqual(["Dismiss"]);

      manager.pushEvent(event(task.taskId, "dismissed"));
      expect(await overlay.pollOnce()).toEqual(["dismiss"]);
      expect(overlay.snapshot().dismissed).toBe(true);
      expect((await manager.state()).overlays).toHaveLength(0);
    } finally {
      await overlay.close();
      await manager.close();
    }
  });
});
