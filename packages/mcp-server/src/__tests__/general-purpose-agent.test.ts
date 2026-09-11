import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  classifyConsequenceTier,
  createBaseCapabilityRegistry,
  getPolicyProfile,
  isUntrustedSource,
  GENERAL_PURPOSE_CAPABILITIES,
  type AgentHostConfig
} from "@agenthost/core";
import { isSafeCss } from "@agenthost/app-browser";
import { describe, expect, it } from "vitest";
import { createAgentHostMcpServer } from "../server.js";
import { runTool } from "../tool-runner.js";
import { classifyShellCommand } from "@agenthost/core";
import { clearStop, isStopRequested, requestStop } from "../stop-flag.js";
import { approvalCoversRisk } from "../task-approval.js";

async function boot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-general-"));
  const config: AgentHostConfig = {
    agentHostDir: root,
    configPath: `${root}/config.json`,
    logFile: `${root}/logs/test.jsonl`,
    profile: "dev",
    policy: getPolicyProfile("dev")
  };
  await writeFile(config.configPath, JSON.stringify({ schemaVersion: 1 }), "utf8");
  const { context } = await createAgentHostMcpServer({ config, registry: createBaseCapabilityRegistry() });
  const { createSystemTools } = await import("../tools/system.js");
  const { createShellTools } = await import("../tools/shell.js");
  const { createFileTools } = await import("../tools/file.js");
  const { createComputerTools } = await import("../tools/computer.js");
  const { createAgentTools } = await import("../tools/agent.js");
  const { createTaskTools } = await import("../tools/tasks.js");
  const { createSkillTools } = await import("../tools/skills.js");
  const { applyProductionExecutionMetadata } = await import("../tool-metadata.js");
  // Full-server context (real policy, confirmations, stop flags) with a focused
  // tool subset so assertions stay hermetic while the central runner path is real.
  const tools = applyProductionExecutionMetadata([...createSystemTools(), ...createShellTools(), ...createFileTools(), ...createComputerTools(), ...createAgentTools(), ...createTaskTools(), ...createSkillTools()]);
  const byName = new Map(tools.map((tool) => [tool.name, tool] as const));
  const call = (name: string, input: unknown) => runTool(byName.get(name)! as never, input, context);
  return { root, config, context, tools, byName, call };
}

describe("general-purpose computer agent", () => {
  it("exposes new capability tools with live parity metadata", async () => {
    const { tools } = await boot();
    const names = tools.map((tool) => tool.name);
    for (const expected of [
      "computer.observe_state",
      "file.copy", "file.move", "file.delete",
      "agent.status", "agent.stop", "agent.resume", "agent.takeover_begin", "agent.takeover_end", "agent.discover_capabilities",
      "task.create", "task.status", "task.update", "task.log_event", "task.pause", "task.resume", "task.complete", "task.execute_plan",
      "skills.list", "skills.get"
    ]) {
      expect(names).toContain(expected);
    }
    const find = (name: string) => tools.find((tool) => tool.name === name)?.execution;
    expect(find("computer.observe_state")).toMatchObject({ executionClass: "read_only" });
    expect(find("file.copy")).toMatchObject({ executionClass: "state_changing", requiresExactTarget: true });
    expect(find("file.delete")).toMatchObject({ executionClass: "state_changing", requiresExactTarget: true });
    expect(find("task.create")).toMatchObject({ executionClass: "metadata_only" });
    expect(find("task.execute_plan")).toMatchObject({ executionClass: "state_changing", requiresDryRun: true, requiresConfirmationToken: true });
    expect(find("agent.stop")).toMatchObject({ executionClass: "metadata_only" });
  });

  it("classifies consequences by effect instead of taxing every state change", () => {
    expect(classifyConsequenceTier({ riskLevel: "low" }).tier).toBe("low");
    expect(classifyConsequenceTier({ riskLevel: "medium" }).tier).toBe("medium");
    expect(classifyConsequenceTier({ riskLevel: "high" }).tier).toBe("high");
    expect(classifyConsequenceTier({ riskLevel: "low", destructive: true }).tier).toBe("critical");
    expect(classifyConsequenceTier({ riskLevel: "low", externalEffect: true }).tier).toBe("high");
    expect(classifyConsequenceTier({ riskLevel: "blocked" }).riskLevel).toBe("blocked");
    expect(GENERAL_PURPOSE_CAPABILITIES.filesystem).toBe("allow");
    expect(isUntrustedSource("web_page")).toBe(true);
    expect(isUntrustedSource("user_instruction")).toBe(false);
  });

  it("treats general shell operations as approval-gated, keeping truly dangerous ones blocked", () => {
    const policy = getPolicyProfile("dev");
    expect(classifyShellCommand("rm /tmp/scratch.txt", policy).riskLevel).toBe("high");
    expect(classifyShellCommand("rm /tmp/scratch.txt", policy).matchedRules).toContain("shell.destructive_file_command");
    expect(classifyShellCommand("bash -c 'ls /tmp'", policy).riskLevel).toBe("high");
    expect(classifyShellCommand("bash -c 'ls /tmp'", policy).matchedRules).toContain("shell.shell_wrapper");
    expect(classifyShellCommand("sudo ls", policy).blocked).toBe(true);
    expect(classifyShellCommand("mkfs.ext4 /dev/sda1", policy).blocked).toBe(true);
    expect(classifyShellCommand("ls /tmp", policy).blocked).toBe(false);
  });

  it("allows multi-selector CSS while keeping password/file/hidden selectors out", () => {
    expect(isSafeCss("a, button")).toBe(true);
    expect(isSafeCss("input[type=password]")).toBe(false);
  });

  it("copies a file through dry-run then exact-target confirmation (multi-tool composition)", async () => {
    const { root, call } = await boot();
    const source = path.join(root, "in.txt");
    const dest = path.join(root, "out", "copy.txt");
    await writeFile(source, "invoice totals: 42", "utf8");
    const preview = await call("file.copy", { source, destination: dest, dryRun: true });
    expect(preview.ok).toBe(true);
    expect(preview.preview).toBe(true);
    const token = (preview.data as { confirmationToken?: string }).confirmationToken;
    expect(typeof token).toBe("string");
    const executed = await call("file.copy", { source, destination: dest, confirmationToken: token });
    expect(executed.ok).toBe(true);
    expect(await readFile(dest, "utf8")).toBe("invoice totals: 42");
  });

  it("refuses recursive delete and gates single-path delete by confirmation", async () => {
    const { call } = await boot();
    const refused = await call("file.delete", { path: "/tmp/agenthost-nope", recursive: true });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(["recursive_delete_unsupported", "action_unsupported"]).toContain(refused.error?.code);
    const gated = await call("file.delete", { path: "/tmp/agenthost-nope" });
    expect(gated.ok).toBe(false);
  });

  it("runs task lifecycle: create, log recovery, pause, resume, complete", async () => {
    const { call } = await boot();
    const created = await call("task.create", { goal: "Organize invoices by month and report totals" });
    expect(created.ok).toBe(true);
    const taskId = (created.data as { taskId: string }).taskId;
    expect((await call("task.log_event", { taskId, kind: "error", summary: "Download failed once; retrying" })).ok).toBe(true);
    expect((await call("task.update", { taskId, phase: "act", currentAction: "download invoices" })).ok).toBe(true);
    expect((await call("task.pause", { taskId })).ok).toBe(true);
    const resumed = await call("task.resume", { taskId });
    expect(resumed.ok).toBe(true);
    const status = await call("task.status", { taskId });
    expect(status.ok).toBe(true);
    expect((status.data as { events: unknown[] }).events.length).toBeGreaterThanOrEqual(3);
    expect((await call("task.complete", { taskId })).ok).toBe(true);
  });

  it("serves combinable skills and rejects unknown ones", async () => {
    const { call } = await boot();
    const list = await call("skills.list", {});
    expect(list.ok).toBe(true);
    const names = ((list.data as { skills: Array<{ name: string }> }).skills).map((skill) => skill.name);
    expect(names).toEqual(expect.arrayContaining(["software-development", "web-research", "file-management", "browser-work"]));
    const detail = await call("skills.get", { name: "file-management" });
    expect(detail.ok).toBe(true);
    expect((detail.data as { verification: unknown[] }).verification.length).toBeGreaterThan(0);
    const missing = await call("skills.get", { name: "nope" });
    expect(missing.ok).toBe(false);
  });

  it("enforces emergency stop independent of the model and resumes cleanly", async () => {
    const { root, call } = await boot();
    expect(await isStopRequested(root)).toBe(false);
    expect((await call("agent.stop", {})).ok).toBe(true);
    expect(await isStopRequested(root)).toBe(true);
    const halted = await call("shell.run_safe", { command: "ls", args: ["/tmp"] });
    expect(halted.ok).toBe(false);
    if (!halted.ok) expect(halted.error?.code).toBe("emergency_stop_requested");
    // Stop-exempt control plane still works while stopped.
    expect((await call("agent.status", {})).ok).toBe(true);
    expect((await call("task.create", { goal: "still trackable while stopped" })).ok).toBe(true);
    expect((await call("agent.resume", {})).ok).toBe(true);
    await clearStop(root);
    const gated = await call("shell.run_safe", { command: "ls", args: ["/tmp"] });
    expect(gated.ok).toBe(false);
    if (!gated.ok) expect(gated.error?.code).not.toBe("emergency_stop_requested");
  });

  it("observes windows and tabs in one call and waits without fixed sleeps", async () => {
    const { call } = await boot();
    const full = await call("computer.observe_state", { includeWindows: true, includeBrowserTabs: true });
    expect(full.ok).toBe(true);
    expect((full.data as Record<string, unknown>)).toHaveProperty("activeWindow");
    const matched = await call("computer.wait_for", { timeoutMs: 2000 });
    expect(matched.ok).toBe(true);
    const timeout = await call("computer.wait_for", {
      expectedActiveWindow: { appName: "definitely-not-the-active-app-agenthost" },
      timeoutMs: 400
    });
    expect(timeout.ok).toBe(false);
    if (!timeout.ok) expect(timeout.error?.code).toBe("wait_timeout");
  });

  it("chains routine actions server-side under operator task approval", async () => {
    const { root, call } = await boot();
    const { approveTaskScope, activeTaskApproval, clearTaskApproval } = await import("../task-approval.js");
    const created = await call("task.create", { goal: "speed test" });
    const taskId = (created.data as { taskId: string }).taskId;
    // No approval: single call without token is gated.
    const gated = await call("file.copy", { source: "/tmp/x", destination: "/tmp/y" });
    expect(gated.ok).toBe(false);
    // Operator approves (operator path, not an MCP tool).
    const approval = await approveTaskScope(root, taskId, "medium", "cli");
    expect(await activeTaskApproval(root)).toMatchObject({ taskId });
    expect(approvalCoversRisk(approval, "medium")).toBe(true);
    expect(approvalCoversRisk(approval, "high")).toBe(false);
    // Same call now executes in one turn: dry-run chained server-side.
    const source = `${root}/pre.txt`;
    const dest = `${root}/pre-copy.txt`;
    await writeFile(source, "fast", "utf8");
    const executed = await call("file.copy", { source, destination: dest });
    expect(executed.ok).toBe(true);
    expect((executed.observations ?? []).join(" ")).toContain("pre-approval");
    expect(await readFile(dest, "utf8")).toBe("fast");
    // High-consequence effects still need per-action confirmation.
    const del = await call("file.delete", { path: `${root}/pre.txt` });
    expect(del.ok).toBe(false);
    await clearTaskApproval(root);
    expect(await activeTaskApproval(root)).toBeUndefined();
  });

  it("requests stop flags directly and observes computer state after resume", async () => {
    const { root, call } = await boot();
    await requestStop(root, "test");
    expect(await isStopRequested(root)).toBe(true);
    await clearStop(root);
    const observed = await call("computer.observe_state", {});
    expect(observed.ok).toBe(true);
    expect(observed.data).toHaveProperty("activeWindow");
    const discovered = await call("agent.discover_capabilities", {});
    expect(discovered.ok).toBe(true);
    expect((discovered.data as { families: string[] }).families).toContain("browser");
  });
});
