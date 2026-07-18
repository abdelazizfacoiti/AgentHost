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
    await store.recordScreenshot({ screenshotId: "shot_test", sessionId: "session_test", capturedAt: new Date().toISOString(), captureKind: "full_screen", imageWidth: 100, imageHeight: 50, sensitivity: "public", thumbnailAvailable: false, retention: "available", redacted: true });
    const result = await store.provider().screenshot("shot_test");
    expect(result).toEqual(expect.objectContaining({ screenshotId: "shot_test", thumbnailAvailable: false, redacted: true }));
    expect(result).not.toHaveProperty("imagePath");
  });

  it("keeps session-bound projections owner-scoped, deduplicates Forge activity, and includes inert scheduler metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-control-room-owner-"));
    const timestamp = new Date().toISOString();
    const store = new ControlRoomStore(root, {
      workflowTrace: { listTraces: async () => [
        { traceId: "trace_owner", sessionId: "owner", status: "stopped", createdAt: timestamp, updatedAt: timestamp, steps: [] },
        { traceId: "trace_other", sessionId: "other", status: "stopped", createdAt: timestamp, updatedAt: timestamp, steps: [] }
      ] },
      forge: { listRuntimeRuns: async () => [
        { runtimeRunId: "run_owner", sessionId: "owner", status: "passed", createdAt: timestamp, executableStillFalse: true },
        { runtimeRunId: "run_other", sessionId: "other", status: "passed", createdAt: timestamp, executableStillFalse: true }
      ] },
      scheduler: { listJobs: async () => [{ jobId: "job_inert", status: "draft", createdAt: timestamp, updatedAt: timestamp }] }
    }, { ownerSessionId: "owner" });
    await store.ensureStructure();
    await store.recordToolActivity({ sessionId: "owner", timestamp, tool: "forge.run_sandboxed_tool", riskLevel: "low", preview: false, ok: true, durationMs: 1, confirmation: false });
    await store.recordToolActivity({ sessionId: "other", timestamp, tool: "system.get_info", riskLevel: "observe", preview: false, ok: true, durationMs: 1, confirmation: false });
    const tasks = (await store.provider().tasks({ limit: 100 })).tasks;
    expect(tasks.map((task) => task.taskId)).toEqual(expect.arrayContaining(["workflow:trace_owner", "forge:run_owner", "scheduler:job_inert"]));
    expect(tasks.map((task) => task.taskId)).not.toEqual(expect.arrayContaining(["workflow:trace_other", "forge:run_other", "direct:other"]));
    expect(tasks.filter((task) => task.taskId === "direct:owner")).toHaveLength(0);
    expect(tasks.find((task) => task.taskId === "scheduler:job_inert")).toMatchObject({ executable: false, actionsExecuted: false, source: "scheduler_metadata" });
  });

  it("drops screenshot paths and cross-owner metadata before persistence/projection", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-control-room-shot-safe-"));
    const store = new ControlRoomStore(root, {}, { ownerSessionId: "owner" });
    await store.ensureStructure();
    await store.recordScreenshot({ screenshotId: "shot_safe", sessionId: "owner", capturedAt: new Date().toISOString(), captureKind: "full_screen", imageWidth: 100, imageHeight: 50, sensitivity: "public", thumbnailAvailable: true, retention: "available", redacted: true, imagePath: "/private/secret.png", imageHash: "private-hash" } as never);
    await store.recordScreenshot({ screenshotId: "shot_other", sessionId: "other", capturedAt: new Date().toISOString(), captureKind: "full_screen", imageWidth: 100, imageHeight: 50, sensitivity: "public", thumbnailAvailable: false, retention: "available", redacted: true });
    const result = await store.provider().screenshot("shot_safe");
    expect(result).toMatchObject({ thumbnailAvailable: false, redacted: true });
    expect(result).not.toHaveProperty("imagePath");
    expect(result).not.toHaveProperty("imageHash");
    await expect(store.provider().screenshot("shot_other")).rejects.toThrow("control_room_screenshot_not_found");
  });

  it("projects browser setup state without credentials or browser content", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-control-room-browser-"));
    const store = new ControlRoomStore(root, {
      browserSetup: {
        summary: async () => ({
          status: "waiting_for_approval",
          latest: {
            setupId: "browser_setup_safe",
            browserFamily: "firefox",
            state: "waiting_for_approval",
            recommendedNextAction: "Approve exact extension identity.",
            redacted: true
          },
          redacted: true
        })
      }
    });
    await store.ensureStructure();
    const health = await store.provider().health();
    expect(health).toMatchObject({
      browserSetup: {
        status: "waiting_for_approval",
        redacted: true
      }
    });
    expect(JSON.stringify(health)).not.toMatch(/sessionToken|refreshSecret|pairingToken|cookie/i);
  });

  it("projects bounded planning and capability-graph summaries only", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-control-room-planning-"));
    const store = new ControlRoomStore(root, {
      planning: { summary: () => ({ status: "previewed", goalCategory: "browser_setup", decisionLevel: 1, visualSurface: { surfaceType: "task_checklist", compact: false }, executable: false, actionsExecuted: false, confirmationTokensCreated: false, redacted: true }) },
      capabilityGraph: { summary: () => ({ nodeCount: 4, edgeCount: 3, versionFingerprint: "a".repeat(32), redacted: true }) }
    });
    await store.ensureStructure();
    const health = await store.provider().health();
    expect(health).toMatchObject({ planning: { goalCategory: "browser_setup", decisionLevel: 1, redacted: true }, capabilityGraph: { nodeCount: 4, redacted: true } });
    const projection = JSON.stringify({ planning: health.planning, capabilityGraph: health.capabilityGraph });
    expect(projection).not.toMatch(/prompt|page|coordinate|secret/i);
  });
});
