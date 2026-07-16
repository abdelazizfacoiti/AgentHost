import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RuntimeActivityStore } from "../runtime-activity-store.js";
import { RuntimeActivityService } from "../runtime-activity-service.js";
import { ControlRoomStore } from "../control-room-store.js";

describe("runtime activity store and projections", () => {
  it("deduplicates active direct work, enforces owner isolation, and persists redacted records", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-runtime-activity-"));
    const store = new RuntimeActivityStore(root, { ownerSessionId: "owner" });
    await store.ensureStructure();
    const service = new RuntimeActivityService(store);
    const first = service.startDirectTool("browser.list_tabs", "owner");
    const duplicate = service.startDirectTool("browser.list_tabs", "owner");
    expect(duplicate.activityId).toBe(first.activityId);
    expect(store.get(first.activityId)).toMatchObject({ ownerSessionId: "owner", source: "browser", state: "preparing", redacted: true });
    expect(store.get("activity_other")).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const persisted = await readFile(path.join(root, "runtime-activity", "records.jsonl"), "utf8");
    expect(persisted).not.toMatch(/raw prompt|page text|secret-token/i);
    expect(persisted).toContain(first.activityId);
  });

  it("does not claim completion for failed work and records approval/block states safely", () => {
    const store = new RuntimeActivityStore("/tmp/agenthost-runtime-activity-memory", { ownerSessionId: "owner" });
    const service = new RuntimeActivityService(store);
    const approval = service.startDirectTool("desktop.click", "owner");
    const waiting = service.finishDirectTool(approval.activityId, { ok: false, preview: false, riskLevel: "high", error: { code: "confirmation_required", message: "confirmation required" } });
    expect(waiting.state).toBe("waiting_for_approval");
    const blocked = service.startDirectTool("browser.get_page_context", "owner");
    expect(service.finishDirectTool(blocked.activityId, { ok: false, preview: false, riskLevel: "high", error: { code: "protected_page_blocked", message: "blocked" } }).state).toBe("blocked");
    const failed = service.startDirectTool("system.get_info", "owner");
    expect(service.finishDirectTool(failed.activityId, { ok: false, preview: false, riskLevel: "observe", error: { code: "backend_failed", message: "failed" } }).terminalVerification?.verified).toBe(false);
  });

  it("normalizes screenshot activity separately from generic desktop work", () => {
    const store = new RuntimeActivityStore("/tmp/agenthost-runtime-activity-source", { ownerSessionId: "owner" });
    const service = new RuntimeActivityService(store);
    const start = service.startDirectTool("desktop.screenshot", "owner");
    expect(store.get(start.activityId)?.source).toBe("screenshot");
  });

  it("projects runtime activity into Control Room without a duplicate direct task", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-runtime-control-room-"));
    const store = new RuntimeActivityStore(root, { ownerSessionId: "owner" });
    await store.ensureStructure();
    const service = new RuntimeActivityService(store);
    service.startDirectTool("desktop.get_active_window", "owner");
    const controlRoom = new ControlRoomStore(root, { runtimeActivity: { projection: async () => service.projection() } }, { ownerSessionId: "owner" });
    await controlRoom.ensureStructure();
    const tasks = (await controlRoom.provider().tasks({ limit: 20 })).tasks;
    expect(tasks.filter((task) => task.source === "runtime_activity")).toHaveLength(1);
    expect(tasks.filter((task) => task.source === "direct_activity")).toHaveLength(0);
    expect((await controlRoom.provider().health()).runtimeActivity).toMatchObject({ activeCount: 1, redacted: true });
  });
});
