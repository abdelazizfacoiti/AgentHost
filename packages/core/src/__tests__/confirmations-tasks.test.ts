import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  acceptConfirmation,
  activeApprovalCoversRisk,
  clearActiveTaskApproval,
  consumeConfirmation,
  fingerprintToolInput,
  listConfirmations,
  prepareConfirmation,
  readActiveTaskApproval,
  readRunState,
  rejectConfirmation,
  requestStop,
  clearStop,
  beginTakeover,
  endTakeover,
  evaluateRunStateGate
} from "../index.js";
import { createTask, loadTask, transitionTask, updateTask } from "../tasks.js";
import { classifyShellCommand } from "../safety/shell-classifier.js";
import { getPolicyProfile } from "../policies.js";

const roots: string[] = [];
async function tempHome(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-core-state-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("confirmation tokens", () => {
  it("binds tool, profile, arguments, and target while ignoring dryRun/token fields", () => {
    const base = { path: "/tmp/a", text: "hello" };
    const withExecutionFields = { ...base, dryRun: true, confirmationToken: "conf_12345678" };
    expect(fingerprintToolInput("file.write", base)).toBe(fingerprintToolInput("file.write", withExecutionFields));
    expect(fingerprintToolInput("file.write", base)).not.toBe(fingerprintToolInput("file.write", { ...base, text: "other" }));
  });

  it("requires acceptance, consumes once, and preserves mismatch rejection", async () => {
    const home = await tempHome();
    const token = await prepareConfirmation({
      agentHostDir: home,
      tool: "file.write",
      profile: "general",
      riskLevel: "medium",
      args: { path: "/tmp/a", text: "hello" },
      summary: "Write /tmp/a",
      targetFingerprint: "target-a"
    });

    await expect(consumeConfirmation({
      agentHostDir: home,
      tokenId: token.tokenId,
      tool: "file.write",
      profile: "general",
      args: { path: "/tmp/a", text: "hello" },
      targetFingerprint: "target-a",
      allowPending: false
    })).rejects.toMatchObject({ code: "confirmation_not_approved" });

    await acceptConfirmation(home, token.tokenId);
    await expect(consumeConfirmation({
      agentHostDir: home,
      tokenId: token.tokenId,
      tool: "file.write",
      profile: "general",
      args: { path: "/tmp/a", text: "different" },
      targetFingerprint: "target-a",
      allowPending: false
    })).rejects.toMatchObject({ code: "confirmation_input_mismatch" });

    const accepted = await listConfirmations(home);
    expect(accepted[0]?.status).toBe("accepted");

    await consumeConfirmation({
      agentHostDir: home,
      tokenId: token.tokenId,
      tool: "file.write",
      profile: "general",
      args: { path: "/tmp/a", text: "hello" },
      targetFingerprint: "target-a",
      allowPending: false
    });
    await expect(consumeConfirmation({
      agentHostDir: home,
      tokenId: token.tokenId,
      tool: "file.write",
      profile: "general",
      args: { path: "/tmp/a", text: "hello" },
      targetFingerprint: "target-a",
      allowPending: false
    })).rejects.toMatchObject({ code: "confirmation_token_not_found" });
  });

  it("rejects tokens instead of leaving them pending", async () => {
    const home = await tempHome();
    const token = await prepareConfirmation({
      agentHostDir: home,
      tool: "shell.run",
      profile: "general",
      riskLevel: "high",
      args: { command: "echo", args: ["hi"] },
      summary: "Run echo"
    });
    const rejected = await rejectConfirmation(home, token.tokenId);
    expect(rejected.status).toBe("rejected");
    await expect(consumeConfirmation({
      agentHostDir: home,
      tokenId: token.tokenId,
      tool: "shell.run",
      profile: "general",
      args: { command: "echo", args: ["hi"] },
      allowPending: true
    })).rejects.toMatchObject({ code: "confirmation_token_rejected" });
  });
});

describe("active task approvals", () => {
  it("caps coverage at the requested risk and ignores expired approvals", async () => {
    const home = await tempHome();
    await mkdir(path.join(home, "tasks", "approvals"), { recursive: true });
    await writeFile(path.join(home, "tasks", "approvals", "active.json"), JSON.stringify({
      approvalId: "a1",
      taskId: "task_1",
      maxRisk: "low",
      origin: "cli",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    }));
    const approval = await readActiveTaskApproval(home);
    expect(activeApprovalCoversRisk(approval, "low")).toBe(true);
    expect(activeApprovalCoversRisk(approval, "medium")).toBe(false);
    expect(activeApprovalCoversRisk(approval, "high")).toBe(false);

    await writeFile(path.join(home, "tasks", "approvals", "active.json"), JSON.stringify({
      approvalId: "a2",
      taskId: "task_1",
      maxRisk: "medium",
      origin: "cli",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() - 1).toISOString()
    }));
    expect(await readActiveTaskApproval(home)).toBeUndefined();
  });
});

describe("task lifecycle", () => {
  it("creates, updates, pauses, resumes, and freezes terminal tasks", async () => {
    const home = await tempHome();
    const task = await createTask(home, "Ship the change");
    expect(task.status).toBe("active");
    expect(await loadTask(home, task.taskId)).toMatchObject({ goal: "Ship the change" });

    const updated = await updateTask(home, task.taskId, { phase: "build", currentAction: "run tests" });
    expect(updated.phase).toBe("build");

    expect((await transitionTask(home, task.taskId, "paused")).status).toBe("paused");
    expect((await transitionTask(home, task.taskId, "active")).status).toBe("active");
    expect((await transitionTask(home, task.taskId, "completed")).status).toBe("completed");
    await expect(updateTask(home, task.taskId, { phase: "late" })).rejects.toMatchObject({ code: "task_terminal" });
    await expect(transitionTask(home, task.taskId, "active")).rejects.toMatchObject({ code: "task_terminal" });
  });

  it("clears active approval on create and terminal transition", async () => {
    const home = await tempHome();
    const approvalPath = path.join(home, "tasks", "approvals", "active.json");
    await mkdir(path.dirname(approvalPath), { recursive: true });
    await writeFile(approvalPath, JSON.stringify({ approvalId: "a", taskId: "old", maxRisk: "medium", expiresAt: new Date(Date.now() + 60_000).toISOString() }));

    const task = await createTask(home, "Fresh task");
    await expect(readActiveTaskApproval(home)).resolves.toBeUndefined();

    await mkdir(path.dirname(approvalPath), { recursive: true });
    await writeFile(approvalPath, JSON.stringify({ approvalId: "b", taskId: task.taskId, maxRisk: "medium", expiresAt: new Date(Date.now() + 60_000).toISOString() }));
    await transitionTask(home, task.taskId, "cancelled");
    await expect(readActiveTaskApproval(home)).resolves.toBeUndefined();
    await clearActiveTaskApproval(home);
  });
});

describe("shell control-plane protection", () => {
  it("blocks operator commands and control-plane paths but allows safe inspection", () => {
    const policy = getPolicyProfile("general");
    const home = "/home/operator";
    const context = { agentHostDir: path.join(home, ".agenthost") };

    expect(classifyShellCommand("agenthost task approve task_1", policy, context)).toMatchObject({ blocked: true });
    expect(classifyShellCommand("agenthost confirm conf_12345678", policy, context)).toMatchObject({ blocked: true });
    expect(classifyShellCommand("cat ~/.agenthost/config.json", policy, context)).toMatchObject({ blocked: true });
    expect(classifyShellCommand("python3 -c 'print(1)'", policy, context)).toMatchObject({ riskLevel: "high" });
    expect(classifyShellCommand("cat /tmp/notes.txt", policy, context)).toMatchObject({ blocked: false });
  });
});

describe("run-state flags", () => {
  it("fails closed on stop and takeover and clears explicitly", async () => {
    const home = await tempHome();
    expect((await readRunState(home)).stop.requested).toBe(false);

    await requestStop(home, "operator pressed stop");
    expect(evaluateRunStateGate(await readRunState(home))).toMatchObject({ allowed: false, code: "emergency_stop_requested" });
    await clearStop(home);
    expect((await readRunState(home)).stop.requested).toBe(false);

    await beginTakeover(home, "human at keyboard");
    expect(evaluateRunStateGate(await readRunState(home))).toMatchObject({ allowed: false, code: "human_takeover_active" });
    await endTakeover(home);
    expect(evaluateRunStateGate(await readRunState(home)).allowed).toBe(true);

    await writeFile(path.join(home, "run", "stop.requested"), "not json");
    expect(evaluateRunStateGate(await readRunState(home))).toMatchObject({ allowed: false, code: "emergency_stop_requested" });
  });
});
