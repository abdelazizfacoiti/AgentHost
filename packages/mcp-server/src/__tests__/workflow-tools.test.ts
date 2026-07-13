import { randomUUID } from "node:crypto";
import {
  createAdapterRegistry,
  createBaseCapabilityRegistry,
  getPolicyProfile,
  toolSuccess,
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
import { WorkflowReplayStore } from "../workflow-replay-store.js";
import { ToolReceiptManager } from "../tool-receipts.js";

class MemoryLogger implements AuditLogger {
  entries: AuditLogEntry[] = [];
  async log(entry: AuditLogEntry): Promise<void> { this.entries.push(entry); }
}

async function context(): Promise<AgentHostMcpContext> {
  const agentHostDir = `/tmp/agenthost-workflow-${randomUUID()}`;
  const policy = getPolicyProfile("dev");
  const config: AgentHostConfig = { agentHostDir, configPath: `${agentHostDir}/config.json`, logFile: `${agentHostDir}/logs/test.jsonl`, profile: "dev", policy };
  const workflowTrace = new WorkflowStore(agentHostDir); await workflowTrace.ensureStructure();
  const workflowReplay = new WorkflowReplayStore(agentHostDir); await workflowReplay.ensureStructure();
  return {
    sessionId: "session_workflow", config, policy, registry: createBaseCapabilityRegistry(), adapters: createAdapterRegistry(), logger: new MemoryLogger(),
    confirmations: new ConfirmationManager(), grants: new GrantStore({ persistentGrants: [] }), forge: new ForgeStore(agentHostDir), workflowTrace, workflowReplay, receipts: new ToolReceiptManager(),
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
    const privateResult = await runTool(privateTool, { text: "super-secret message" }, value);
    expect(privateResult.receipt).toMatchObject({ tool: "browser.fill_text", sessionId: value.sessionId, executionStatus: "executed" });
    expect(JSON.stringify(privateResult.receipt)).not.toContain("super-secret message");
    expect(JSON.stringify((value.logger as MemoryLogger).entries)).not.toContain("receiptSignature");
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
    const proposed = await call(value, "workflow.skill_checkpoint_template_propose", { skillId, operation: "update", changeSummary: "Approve file checkpoint", template: { templateId: "output_exists", name: "Output exists", description: "Check output", kind: "file_exists", strategy: "file", sensitivity: "public", expectedTemplate: { path: "{{outputPath}}" }, parameters: ["outputPath"], requiredGrants: [], safetyNotes: [] } });
    const reviewId = (proposed.data as { reviewId: string }).reviewId;
    await call(value, "workflow.skill_checkpoint_template_review", { reviewId, decision: "approve" });
    await call(value, "workflow.skill_checkpoint_template_apply", { reviewId });
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
    const result = await call(value, "workflow.skill_checkpoints_dryrun", { skillId: (saved.data as { skillId: string }).skillId, evaluate: true, reviewMode: true });
    expect(result).toMatchObject({ ok: true, preview: true, data: { actionsExecuted: false, evaluated: false, templates: [{ blockedReasons: ["secret_checkpoint_blocked"] }, { blockedReasons: ["checkpoint_grant_missing"] }] } });
  });

  it("proposes, reviews, applies, versions, archives, and redacts checkpoint templates", async () => {
    const value = await context();
    const started = await call(value, "workflow.trace_start", { name: "Review lifecycle" });
    const traceId = (started.data as { traceId: string }).traceId;
    await call(value, "workflow.trace_stop", { traceId });
    const saved = await call(value, "workflow.skill_save_from_trace", { traceId, name: "Skill", description: "Generic", parameters: [{ name: "target", type: "string", required: true }] });
    const skillId = (saved.data as { skillId: string }).skillId;
    const proposed = await call(value, "workflow.skill_checkpoint_template_propose", { skillId, operation: "create", changeSummary: "Add file check", template: { templateId: "file_check", name: "File", description: "Check", kind: "file_exists", strategy: "file", sensitivity: "public", expectedTemplate: { path: "{{target}}" }, parameters: ["target"], requiredGrants: [], safetyNotes: [] } });
    expect(proposed).toMatchObject({ ok: true, preview: true, data: { status: "pending", afterSummary: { expectedTemplateRedacted: true } } });
    expect(JSON.stringify(proposed)).not.toContain("{{target}}");
    const reviewId = (proposed.data as { reviewId: string }).reviewId;
    await expect(call(value, "workflow.skill_checkpoint_template_apply", { reviewId })).resolves.toMatchObject({ ok: false, error: { code: "checkpoint_review_not_approved" } });
    expect(await call(value, "workflow.skill_checkpoint_template_review", { reviewId, decision: "approve" })).toMatchObject({ ok: true, data: { status: "approved" } });
    expect(await call(value, "workflow.skill_checkpoint_template_apply", { reviewId })).toMatchObject({ ok: true, data: { status: "applied" } });
    const skill = await call(value, "workflow.skill_get", { skillId });
    expect(skill).toMatchObject({ ok: true, data: { checkpointTemplates: [{ templateId: "file_check", status: "approved", version: 1, expectedTemplateRedacted: true }] } });
    expect(JSON.stringify(skill)).not.toContain("{{target}}");
    const update = await call(value, "workflow.skill_checkpoint_template_propose", { skillId, operation: "update", changeSummary: "Tune timeout", template: { templateId: "file_check", name: "File", description: "Check", kind: "file_exists", strategy: "file", sensitivity: "public", expectedTemplate: { path: "{{target}}" }, parameters: ["target"], requiredGrants: [], safetyNotes: [], timeoutMs: 1000 } });
    const updateId = (update.data as { reviewId: string }).reviewId;
    await call(value, "workflow.skill_checkpoint_template_review", { reviewId: updateId, decision: "approve" });
    await call(value, "workflow.skill_checkpoint_template_apply", { reviewId: updateId });
    const archived = await call(value, "workflow.skill_checkpoint_template_archive", { skillId, templateId: "file_check", changeSummary: "Retire" });
    expect(archived).toMatchObject({ ok: true, data: { status: "archived", version: 3 } });
    const listed = await call(value, "workflow.skill_checkpoint_template_list_reviews", { skillId });
    expect(listed).toMatchObject({ ok: true, data: { reviews: expect.any(Array) } });
    expect(value.confirmations).not.toHaveProperty("tokens");
  });

  it("blocks unsafe proposals and excludes unapproved templates by default", async () => {
    const value = await context(); const started = await call(value, "workflow.trace_start", { name: "Unsafe reviews" }); const traceId = (started.data as { traceId: string }).traceId;
    await call(value, "workflow.trace_stop", { traceId }); const saved = await call(value, "workflow.skill_save_from_trace", { traceId, name: "Skill", description: "Generic", parameters: [{ name: "path", type: "string", required: true }] }); const skillId = (saved.data as { skillId: string }).skillId;
    const secret = await call(value, "workflow.skill_checkpoint_template_propose", { skillId, operation: "create", changeSummary: "Secret", template: { templateId: "secret", name: "Secret", description: "Check", kind: "manual_check", strategy: "manual", sensitivity: "secret", expectedTemplate: {}, parameters: [], requiredGrants: [], safetyNotes: [] } });
    const secretId = (secret.data as { reviewId: string }).reviewId;
    expect(await call(value, "workflow.skill_checkpoint_template_review", { reviewId: secretId, decision: "approve" })).toMatchObject({ ok: true, data: { status: "blocked", blockedReasons: ["secret_checkpoint_blocked"] } });
    await expect(call(value, "workflow.skill_checkpoint_template_propose", { skillId, operation: "create", changeSummary: "Private", template: { templateId: "private", name: "Private", description: "Check", kind: "manual_check", strategy: "manual", sensitivity: "private", expectedTemplate: { text: "raw@private.test" }, parameters: [], requiredGrants: ["grant"], safetyNotes: [] } })).resolves.toMatchObject({ ok: false, error: { code: "checkpoint_template_private_literal_blocked" } });
    await expect(call(value, "workflow.skill_checkpoint_template_propose", { skillId, operation: "create", changeSummary: "Bad", template: { templateId: "bad", name: "Bad", description: "Check", kind: "file_exists", strategy: "file", sensitivity: "public", expectedTemplate: { path: "{{process.env.HOME}}" }, parameters: [], requiredGrants: [], safetyNotes: [] } })).resolves.toMatchObject({ ok: false, error: { code: "checkpoint_template_invalid_interpolation" } });
    const bound = await call(value, "workflow.skill_bind_checkpoints", { skillId, parameters: { path: "/tmp/x" } });
    expect(bound).toMatchObject({ ok: true, data: { templates: [] } });
  });

  it("builds ordered replay plan without executing actions or creating tokens", async () => {
    const value = await context();
    const trace = await value.workflowTrace!.createTrace({ sessionId: value.sessionId, name: "Replay" });
    await value.workflowTrace!.capture({ sessionId: value.sessionId, step: { stepId: "step_click", timestamp: new Date().toISOString(), tool: "browser.click_element", strategy: "browser", actionType: "click_element", riskLevel: "medium", inputSummary: "private text omitted", outputSummary: "result omitted", preview: false, ok: true } });
    await value.workflowTrace!.capture({ sessionId: value.sessionId, step: { stepId: "step_send", timestamp: new Date().toISOString(), tool: "browser.send_message", strategy: "browser", actionType: "tool_action", riskLevel: "high", inputSummary: "private text omitted", outputSummary: "result omitted", preview: false, ok: true } });
    await value.workflowTrace!.stopTrace({ sessionId: value.sessionId, traceId: trace.traceId });
    const saved = await call(value, "workflow.skill_save_from_trace", { traceId: trace.traceId, name: "Replay", description: "Generic", parameters: [{ name: "target", type: "string", required: true }] });
    const skillId = (saved.data as { skillId: string }).skillId;
    const missing = await call(value, "workflow.skill_replay_dryrun", { skillId, parameters: {}, evaluateCheckpoints: true });
    expect(missing).toMatchObject({ ok: true, preview: true, data: { actionsExecuted: false, confirmationTokensCreated: false, executable: false, steps: [{ stepId: "step_click", order: 1, stateChanging: true, wouldRequireDryRun: true, wouldRequireConfirmation: true }, { stepId: "step_send", order: 2, blocked: true, supported: false }], blockers: expect.any(Array) } });
    expect(JSON.stringify(missing)).not.toContain("private text omitted");
    expect((missing.data as { warnings: string[] }).warnings).toContain("Checkpoint evaluation deferred; Phase 33 does not evaluate checkpoints.");
    const approved = await call(value, "workflow.skill_checkpoint_template_propose", { skillId, operation: "create", changeSummary: "Add", template: { templateId: "exists", name: "Exists", description: "Check", kind: "file_exists", strategy: "file", sensitivity: "public", expectedTemplate: { path: "{{target}}" }, parameters: ["target"], requiredGrants: [], safetyNotes: [] } });
    const approvedId = (approved.data as { reviewId: string }).reviewId;
    await call(value, "workflow.skill_checkpoint_template_review", { reviewId: approvedId, decision: "approve" }); await call(value, "workflow.skill_checkpoint_template_apply", { reviewId: approvedId });
    const normal = await call(value, "workflow.skill_replay_dryrun", { skillId, parameters: { target: "/tmp/private-target" } });
    expect(normal).toMatchObject({ ok: true, data: { checkpoints: [{ templateId: "exists", status: "approved" }] } });
    expect((normal.data as { checkpoints: unknown[] }).checkpoints).toHaveLength(1);
    const reviewMode = await call(value, "workflow.skill_replay_dryrun", { skillId, parameters: { target: "/tmp/private-target" }, reviewMode: true });
    expect(reviewMode).toMatchObject({ ok: true, preview: true, data: { actionsExecuted: false } });
    expect(JSON.stringify(reviewMode)).not.toContain("private-target");
    await expect(call(value, "workflow.skill_replay_dryrun", { skillId, parameters: { unknown: "x" } })).resolves.toMatchObject({ ok: true, data: { blockers: expect.arrayContaining([expect.objectContaining({ code: "checkpoint_parameter_unknown" })]) } });
    expect(createWorkflowTools().map((tool) => tool.name)).toContain("workflow.skill_replay_dryrun");
  });

  it("runs controlled replay session one prepared step at a time without invoking it", async () => {
    const value = await context(); const trace = await value.workflowTrace!.createTrace({ sessionId: value.sessionId, name: "Step replay" });
    await value.workflowTrace!.capture({ sessionId: value.sessionId, step: { stepId: "step_click", timestamp: new Date().toISOString(), tool: "browser.click_element", strategy: "browser", actionType: "click_element", riskLevel: "medium", inputSummary: "omitted", outputSummary: "omitted", preview: false, ok: true } });
    await value.workflowTrace!.stopTrace({ sessionId: value.sessionId, traceId: trace.traceId });
    const skill = await call(value, "workflow.skill_save_from_trace", { traceId: trace.traceId, name: "Replay", description: "Generic" }); const skillId = (skill.data as { skillId: string }).skillId;
    const started = await call(value, "workflow.replay_session_start", { skillId, parameters: {} });
    expect(started).toMatchObject({ ok: true, preview: true, data: { status: "active", currentStepIndex: 0 } }); const replaySessionId = (started.data as { replaySessionId: string }).replaySessionId;
    const first = await call(value, "workflow.replay_step_prepare", { replaySessionId, underlyingInput: { elementId: "private-element" } });
    expect(first).toMatchObject({ ok: true, data: { tool: "browser.click_element", underlyingToolCall: { input: { dryRun: true }, inputOmitted: true } } });
    expect(JSON.stringify(await call(value, "workflow.replay_session_get", { replaySessionId }))).not.toContain("private-element");
    const previewReceipt = value.receipts!.issue({ sessionId: value.sessionId, tool: "browser.click_element", rawInput: { elementId: "private-element", dryRun: true }, result: toolSuccess({ tool: "browser.click_element", riskLevel: "medium", preview: true, data: {} }), riskLevel: "medium" });
    await expect(call(value, "workflow.replay_step_apply_result", { replaySessionId, preparedStepId: "wrong", receipt: previewReceipt })).resolves.toMatchObject({ ok: false, error: { code: "replay_receipt_mismatch" } });
    await call(value, "workflow.replay_step_apply_result", { replaySessionId, preparedStepId: "step_click", receipt: previewReceipt });
    const second = await call(value, "workflow.replay_step_prepare", { replaySessionId, underlyingInput: { elementId: "private-element" } });
    expect(second).toMatchObject({ ok: true, data: { requiresOriginalConfirmationToken: true } });
    const executionReceipt = value.receipts!.issue({ sessionId: value.sessionId, tool: "browser.click_element", rawInput: { elementId: "private-element", confirmationToken: "secret" }, result: toolSuccess({ tool: "browser.click_element", riskLevel: "medium", confirmation: { status: "tokenAccepted", used: true, accepted: true, executed: true, reason: "accepted" }, data: {} }), riskLevel: "medium" });
    await call(value, "workflow.replay_step_apply_result", { replaySessionId, preparedStepId: "step_click", receipt: executionReceipt });
    const verified = await call(value, "workflow.replay_step_verify", { replaySessionId });
    expect(verified).toMatchObject({ ok: true, data: { status: "completed", currentStepIndex: 1 } });
    expect(value.linux).not.toHaveProperty("click");
  });
});
