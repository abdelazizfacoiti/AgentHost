import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getDefaultPolicy, loadTask, type AuditLogEntry } from "@agenthost/core";
import type { AgentHostMcpContext } from "../context.js";
import { createTaskTools } from "../tools/tasks.js";

const roots: string[] = [];
async function tempHome(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-tasks-tools-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function makeContext(home: string): AgentHostMcpContext {
  return {
    sessionId: "tasks-tools-session",
    config: { agentHostDir: home, configPath: path.join(home, "config.json"), logFile: path.join(home, "logs", "audit.jsonl") },
    policy: getDefaultPolicy(),
    grants: { listActiveGrants: () => [] },
    logger: { log: async (_entry: AuditLogEntry) => undefined }
  } as unknown as AgentHostMcpContext;
}

function tool(name: string) {
  const found = createTaskTools().find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`missing tool ${name}`);
  return found;
}

describe("task definition of done", () => {
  it("refuses completion until every criterion is verified", async () => {
    const home = await tempHome();
    const context = makeContext(home);
    const created = await tool("task.create").handler({
      goal: "Look up three domain prices",
      definitionOfDone: ["Prices recorded for all three domains", "Ranking ordered by yearly price"]
    } as never, context);
    expect(created.ok).toBe(true);
    const taskId = created.data!.taskId;

    const denied = await tool("task.update_status").handler({ taskId, status: "completed" } as never, context);
    expect(denied.ok).toBe(false);
    expect(denied.error?.code).toBe("definition_of_done_unverified");
    expect(denied.error?.details).toMatchObject({ missing: ["Prices recorded for all three domains", "Ranking ordered by yearly price"] });
    expect((await loadTask(home, taskId))?.status).toBe("active");

    const partial = await tool("task.update_status").handler({
      taskId,
      status: "completed",
      verifiedCriteria: ["Prices recorded for all three domains"]
    } as never, context);
    expect(partial.ok).toBe(false);
    expect(partial.error?.details).toMatchObject({ missing: ["Ranking ordered by yearly price"] });

    const done = await tool("task.update_status").handler({
      taskId,
      status: "completed",
      verifiedCriteria: ["Prices recorded for all three domains", "Ranking ordered by yearly price"]
    } as never, context);
    expect(done.ok).toBe(true);
    expect(done.data?.status).toBe("completed");
    expect(done.data?.events.filter((event: { kind: string }) => event.kind === "verification")).toHaveLength(2);
    expect(done.observations?.join(" ")).toContain("Definition of done verified (2/2)");
  });

  it("allows completion without criteria but reports that it is unverified", async () => {
    const home = await tempHome();
    const context = makeContext(home);
    const created = await tool("task.create").handler({ goal: "Quick check" } as never, context);
    const done = await tool("task.update_status").handler({ taskId: created.data!.taskId, status: "completed" } as never, context);
    expect(done.ok).toBe(true);
    expect(done.data?.status).toBe("completed");
    expect(done.observations?.join(" ")).toContain("No definition of done was recorded");
  });
});
