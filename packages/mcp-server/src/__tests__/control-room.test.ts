import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ControlRoomStore } from "../control-room-store.js";

describe("ControlRoomStore", () => {
  it("records redacted direct activity and projects bounded tasks", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-control-room-store-"));
    const store = new ControlRoomStore(root);
    await store.ensureStructure();
    await store.recordToolActivity({ sessionId: "session_test", timestamp: new Date().toISOString(), tool: "system.get_info", strategy: "app_adapter", riskLevel: "observe", preview: false, ok: true, durationMs: 4, confirmation: false });
    const report = await store.provider().tasks({ limit: 10 });
    expect(report.tasks).toHaveLength(1);
    expect(report.tasks[0]).toMatchObject({ source: "direct_activity", executable: false, actionsExecuted: true, redacted: true });
    const events = await store.provider().timeline(report.tasks[0]!.taskId, { limit: 10 });
    expect(events.events[0]).toMatchObject({ tool: "system.get_info" });
  });

  it("keeps screenshot reporting opaque and metadata-only", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-control-room-shot-"));
    const store = new ControlRoomStore(root);
    await store.ensureStructure();
    store.recordScreenshot({ screenshotId: "shot_test", sessionId: "session_test", capturedAt: new Date().toISOString(), captureKind: "full_screen", imageWidth: 100, imageHeight: 50, sensitivity: "public", thumbnailAvailable: false, retention: "available", redacted: true });
    const result = await store.provider().screenshot("shot_test");
    expect(result).toEqual(expect.objectContaining({ screenshotId: "shot_test", thumbnailAvailable: false, redacted: true }));
    expect(result).not.toHaveProperty("imagePath");
  });
});
