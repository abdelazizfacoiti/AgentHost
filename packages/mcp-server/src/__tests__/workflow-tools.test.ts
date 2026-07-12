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
});
