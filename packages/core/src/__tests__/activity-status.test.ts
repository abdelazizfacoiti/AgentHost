import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { activityStatusPath, readActivityStatus, writeActivityStatus } from "../activity-status.js";

const roots: string[] = [];

async function tempHome(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-activity-status-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("activity status", () => {
  it("round-trips redacted activity and overlay health", async () => {
    const home = await tempHome();
    const record = {
      schemaVersion: 1 as const,
      sessionId: "session_test",
      mode: "always" as const,
      tool: "computer.observe_state",
      phase: "finished" as const,
      outcome: "ok" as const,
      overlay: { started: true, visible: true },
      updatedAt: "2026-10-26T12:00:00.000Z"
    };
    await writeActivityStatus(home, record);
    expect(activityStatusPath(home)).toBe(path.join(home, "run", "activity.json"));
    expect(await readActivityStatus(home)).toEqual(record);
  });

  it("reports a missing or invalid status as unavailable", async () => {
    const home = await tempHome();
    expect(await readActivityStatus(home)).toBeUndefined();
    await writeActivityStatus(home, {
      schemaVersion: 1,
      sessionId: "session_test",
      mode: "off",
      tool: "desktop.click",
      phase: "started",
      overlay: { started: false, visible: false, timedOut: true, error: "overlay_show_timeout" },
      updatedAt: "2026-10-26T12:00:00.000Z"
    });
    expect(await readActivityStatus(home)).toMatchObject({
      mode: "off",
      overlay: { started: false, visible: false, timedOut: true, error: "overlay_show_timeout" }
    });
  });
});
