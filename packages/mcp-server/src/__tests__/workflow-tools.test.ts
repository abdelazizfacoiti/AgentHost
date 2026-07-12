import { randomUUID } from "node:crypto";
import {
  createAdapterRegistry,
  createBaseCapabilityRegistry,
  getPolicyProfile,
  type AgentHostConfig,
  type AuditLogEntry,
  type AuditLogger
} from "@agenthost/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ConfirmationManager } from "../confirmation.js";
import type { AgentHostMcpContext } from "../context.js";
import { ForgeStore } from "../forge-store.js";
import { GrantStore } from "../grants.js";
import { runTool, type AgentHostToolDefinition } from "../tool-runner.js";
import { createWorkflowTools } from "../tools/workflow.js";
import { WorkflowStore } from "../workflow-store.js";

class MemoryLogger implements AuditLogger {
  entries: AuditLogEntry[] = [];
  async log(entry: AuditLogEntry): Promise<void> { this.entries.push(entry); }
}

async function context(): Promise<AgentHostMcpContext> {
  const agentHostDir = `/tmp/agenthost-workflow-${randomUUID()}`;
  const policy = getPolicyProfile("dev");
  const config: AgentHostConfig = { agentHostDir, configPath: `${agentHostDir}/config.json`, logFile: `${agentHostDir}/logs/test.jsonl`, profile: "dev", policy };
  const workflowTrace = new WorkflowStore(agentHostDir); await workflowTrace.ensureStructure();
  return {
    sessionId: "session_workflow", config, policy, registry: createBaseCapabilityRegistry(), adapters: createAdapterRegistry(), logger: new MemoryLogger(),
    confirmations: new ConfirmationManager(), grants: new GrantStore({ persistentGrants: [] }), forge: new ForgeStore(agentHostDir), workflowTrace,
    linux: {} as AgentHostMcpContext["linux"]
  };
}

async function call(contextValue: AgentHostMcpContext, name: string, input: unknown) {
  const tool = createWorkflowTools().find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error("tool_missing");
  return runTool(tool, input, contextValue);
}

describe("workflow tools", () => {
  it("starts, captures redacted summaries, stops, and saves a draft skill", async () => {
    const value = await context();
    const started = await call(value, "workflow.trace_start", { name: "Private workflow", description: "mail a@b.test" });
    expect(started.ok).toBe(true);
    const traceId = (started.data as { traceId: string }).traceId;
    const privateTool: AgentHostToolDefinition<{ text: string }, { text: string }, AgentHostMcpContext> = {
      name: "browser.fill_text", description: "test", riskLevel: "medium", inputSchema: z.object({ text: z.string() }), mcpInputSchema: {}, inputSummary: "Fill text",
      auditInputSummary: (input) => `textLength=${input.text.length}`,
      auditOutputSummary: () => "Result content intentionally omitted.",
      async handler(input) { return { ok: true, tool: "browser.fill_text", riskLevel: "medium", approval: { required: false, status: "not_required" }, data: { text: input.text }, observations: [], error: null }; }
    };
    await runTool(privateTool, { text: "super-secret message" }, value);
    const stopped = await call(value, "workflow.trace_stop", { traceId, outcome: "success" });
    expect(stopped.ok).toBe(true);
    const trace = await call(value, "workflow.trace_get", { traceId });
    const serialized = JSON.stringify(trace.data);
    expect(serialized).not.toContain("super-secret message");
    expect(serialized).not.toContain("a@b.test");
    const skill = await call(value, "workflow.skill_save_from_trace", { traceId, name: "Draft", description: "Generic workflow" });
    expect(skill.ok).toBe(true);
    expect((skill.data as { status: string }).status).toBe("draft");
    const dryRun = await call(value, "workflow.skill_run_dryrun", { skillId: (skill.data as { skillId: string }).skillId });
    expect(dryRun.ok).toBe(true);
    expect((dryRun.data as { executable: boolean }).executable).toBe(false);
  });

  it("archives traces and skills, and exposes all fixed workflow tools", async () => {
    const value = await context();
    const names = createWorkflowTools().map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["workflow.trace_start", "workflow.skill_run_dryrun"]));
    const started = await call(value, "workflow.trace_start", { name: "Archive test" });
    const traceId = (started.data as { traceId: string }).traceId;
    await call(value, "workflow.trace_stop", { traceId });
    const saved = await call(value, "workflow.skill_save_from_trace", { traceId, name: "Archive skill", description: "Generic" });
    const skillId = (saved.data as { skillId: string }).skillId;
    const archivedSkill = await call(value, "workflow.skill_archive", { skillId });
    expect((archivedSkill.data as { status: string }).status).toBe("archived");
    const listedSkills = await call(value, "workflow.skill_list", { status: "archived" });
    expect((listedSkills.data as { skills: unknown[] }).skills).toHaveLength(1);
    const archived = await call(value, "workflow.trace_archive", { traceId });
    expect((archived.data as { status: string }).status).toBe("archived");
    const listedTraces = await call(value, "workflow.trace_list", { status: "archived" });
    expect((listedTraces.data as { traces: unknown[] }).traces).toHaveLength(1);
    await expect(call(value, "workflow.skill_save_from_trace", { traceId, name: "x", description: "x" })).resolves.toMatchObject({ ok: false });
  });

  it("binds reviewable checkpoint templates without executing actions", async () => {
    const value = await context();
    const started = await call(value, "workflow.trace_start", { name: "Checkpoint skill" });
    const traceId = (started.data as { traceId: string }).traceId;
    await call(value, "workflow.trace_stop", { traceId });
    const saved = await call(value, "workflow.skill_save_from_trace", {
      traceId, name: "Check files", description: "Generic", parameters: [{ name: "outputPath", type: "string", required: true }],
      checkpointTemplates: [{ templateId: "output_exists", name: "Output exists", description: "Check output", kind: "file_exists", strategy: "file", sensitivity: "public", expectedTemplate: { path: "{{outputPath}}" }, parameters: ["outputPath"], requiredGrants: [], safetyNotes: [] }]
    });
    const skillId = (saved.data as { skillId: string }).skillId;
    const bound = await call(value, "workflow.skill_bind_checkpoints", { skillId, parameters: { outputPath: "/tmp/private-output" } });
    expect(bound).toMatchObject({ ok: true, preview: true, data: { actionsExecuted: false, templates: [{ templateId: "output_exists", expectedFields: ["path"], redacted: true }] } });
    expect(JSON.stringify(bound)).not.toContain("private-output");
    const preview = await call(value, "workflow.skill_checkpoints_dryrun", { skillId, parameters: { outputPath: "/tmp/private-output" } });
    expect(preview).toMatchObject({ ok: true, preview: true, data: { evaluated: false, actionsExecuted: false } });
    (value.linux as any).fileExists = async ({ path }: { path: string }) => ({ path, exists: true });
    const evaluated = await call(value, "workflow.skill_checkpoints_dryrun", { skillId, parameters: { outputPath: "/tmp/private-output" }, evaluate: true });
    expect(evaluated).toMatchObject({ ok: true, data: { evaluated: true, actionsExecuted: false, status: "passed" } });
    expect(value.linux).not.toHaveProperty("click");
    await expect(call(value, "workflow.skill_bind_checkpoints", { skillId, parameters: { unknown: "x" } })).resolves.toMatchObject({ ok: false, error: { code: "checkpoint_parameter_unknown" } });
    await expect(call(value, "workflow.skill_bind_checkpoints", { skillId, parameters: {} })).resolves.toMatchObject({ ok: false, error: { code: "checkpoint_parameter_missing" } });
  });

  it("blocks secret and ungranted private templates before evaluation", async () => {
    const value = await context();
    const started = await call(value, "workflow.trace_start", { name: "Protected checkpoints" }); const traceId = (started.data as { traceId: string }).traceId;
    await call(value, "workflow.trace_stop", { traceId });
    const saved = await call(value, "workflow.skill_save_from_trace", { traceId, name: "Protected", description: "Generic", checkpointTemplates: [
      { templateId: "secret_check", name: "Secret", description: "Never inspect", kind: "manual_check", strategy: "manual", sensitivity: "secret", expectedTemplate: {}, parameters: [], requiredGrants: [], safetyNotes: [] },
      { templateId: "private_check", name: "Private", description: "Needs grant", kind: "manual_check", strategy: "manual", sensitivity: "private", expectedTemplate: {}, parameters: [], requiredGrants: ["grant_private"], safetyNotes: [] }
    ] });
    const result = await call(value, "workflow.skill_checkpoints_dryrun", { skillId: (saved.data as { skillId: string }).skillId, evaluate: true });
    expect(result).toMatchObject({ ok: true, data: { actionsExecuted: false, status: "blocked", templates: [{ blockedReasons: ["secret_checkpoint_blocked"] }, { blockedReasons: ["checkpoint_grant_missing"] }] } });
  });
});
