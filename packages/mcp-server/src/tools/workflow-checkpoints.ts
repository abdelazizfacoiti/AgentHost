import {
  checkpointTemplateSummary,
  resolveWorkflowCheckpointTemplates,
  toolFailure,
  toolSuccess,
  type WorkflowCheckpointTemplate,
  type CheckpointStrategy,
  type WorkflowSkill
} from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import { aggregateCheckpoints, evaluateCheckpoint } from "./checkpoint.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";

const skillId = z.string().trim().regex(/^skill_[A-Za-z0-9_-]+$/).max(100);
const input = z.object({ skillId, parameters: z.record(z.unknown()).optional(), templateIds: z.array(z.string().trim().min(1).max(100)).max(50).optional() }).strict();
const dryRunInput = input.extend({ evaluate: z.boolean().optional() }).strict();

function store(context: AgentHostMcpContext) { if (context.workflowTrace === undefined) throw new Error("workflow_store_unavailable"); return context.workflowTrace; }
function fail(name: string, error: unknown) { const code = error instanceof Error ? error.message : "workflow_checkpoint_operation_failed"; return toolFailure({ tool: name, riskLevel: "low", error: { code, message: code.replaceAll("_", " ") }, observations: ["Checkpoint template values omitted."] }); }
function selected(skill: WorkflowSkill, ids?: string[]): WorkflowCheckpointTemplate[] {
  const templates = skill.checkpointTemplates ?? [];
  if (ids === undefined) return templates;
  const found = templates.filter((template) => ids.includes(template.templateId));
  if (found.length !== ids.length) throw new Error("checkpoint_template_not_found");
  return found;
}
function prepare(skill: WorkflowSkill, parameters: Record<string, unknown>, activeGrantIds: string[], ids?: string[]) {
  const templates = selected(skill, ids);
  const resolved = resolveWorkflowCheckpointTemplates({ templates, parameters: skill.parameters, bindings: parameters });
  const summaries = resolved.map(({ template }) => {
    const reasons: string[] = [];
    if (template.sensitivity === "secret") reasons.push("secret_checkpoint_blocked");
    const missing = template.requiredGrants.filter((grant) => !activeGrantIds.includes(grant));
    if (template.sensitivity === "private" && template.requiredGrants.length === 0) reasons.push("private_checkpoint_grant_required");
    if (missing.length > 0) reasons.push("checkpoint_grant_missing");
    return checkpointTemplateSummary(template, reasons);
  });
  return { resolved, summaries, missingGrantIds: [...new Set(summaries.flatMap((summary) => summary.requiredGrants.filter((grant) => !activeGrantIds.includes(grant))))] };
}

export function createWorkflowCheckpointTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const bind: AgentHostToolDefinition<z.infer<typeof input>, unknown, AgentHostMcpContext> = {
    name: "workflow.skill_bind_checkpoints", description: "Validates and redacts workflow checkpoint template bindings without evaluation or actions.", riskLevel: "low", inputSchema: input,
    mcpInputSchema: { type: "object", properties: { skillId: { type: "string" }, parameters: { type: "object" }, templateIds: { type: "array", items: { type: "string" }, maxItems: 50 } }, required: ["skillId"], additionalProperties: false }, inputSummary: "Bind workflow checkpoint templates", auditInputSummary: (value) => `Bind checkpoint templates for ${value.skillId}; parameter values omitted.`, auditOutputSummary: (out) => out.ok ? "Checkpoint template bindings validated without evaluation." : out.error?.code ?? "Checkpoint binding failed.", safety: { actionType: "inspect" },
    async handler(value, context) { try { const bindings = value.parameters ?? {}; const skill = await store(context).getSkill(value.skillId); const data = prepare(skill, bindings, context.grants.listActiveGrants().map((grant) => grant.id), value.templateIds); return toolSuccess({ tool: "workflow.skill_bind_checkpoints", riskLevel: "low", preview: true, data: { skillId: skill.skillId, executable: false, actionsExecuted: false, parameterNames: Object.keys(bindings), missingGrantIds: data.missingGrantIds, templates: data.summaries }, observations: ["Bindings checked only; no checkpoint or workflow action executed."] }); } catch (error) { return fail("workflow.skill_bind_checkpoints", error); } }
  };
  const dryRun: AgentHostToolDefinition<z.infer<typeof dryRunInput>, unknown, AgentHostMcpContext> = {
    name: "workflow.skill_checkpoints_dryrun", description: "Previews or read-only evaluates bound workflow checkpoints without skill action replay.", riskLevel: "low", inputSchema: dryRunInput,
    mcpInputSchema: { type: "object", properties: { skillId: { type: "string" }, parameters: { type: "object" }, templateIds: { type: "array", items: { type: "string" }, maxItems: 50 }, evaluate: { type: "boolean" } }, required: ["skillId"], additionalProperties: false }, inputSummary: "Dry-run workflow checkpoints", auditInputSummary: (value) => `Dry-run checkpoint templates for ${value.skillId}; parameter values omitted.`, auditOutputSummary: (out) => out.ok ? "Checkpoint template dry-run completed without workflow actions." : out.error?.code ?? "Checkpoint dry-run failed.", safety: { actionType: "inspect" },
    async handler(value, context) { try { const bindings = value.parameters ?? {}; const skill = await store(context).getSkill(value.skillId); const prepared = prepare(skill, bindings, context.grants.listActiveGrants().map((grant) => grant.id), value.templateIds); const results = value.evaluate === true ? await Promise.all(prepared.resolved.map(async ({ template, checkpoint }) => {
      const summary = prepared.summaries.find((item) => item.templateId === template.templateId)!;
      if (summary.blocked) return { checkpointId: checkpoint.checkpointId!, kind: checkpoint.kind, strategy: summary.strategy as CheckpointStrategy, status: "blocked" as const, description: "Checkpoint template blocked.", evidence: { source: summary.strategy as CheckpointStrategy, summary: "Checkpoint template blocked before evidence collection." }, blockedReasons: summary.blockedReasons, warnings: [], durationMs: 0 };
      return evaluateCheckpoint(checkpoint as never, context);
    })) : undefined;
    return toolSuccess({ tool: "workflow.skill_checkpoints_dryrun", riskLevel: "low", preview: value.evaluate !== true, data: { skillId: skill.skillId, executable: false, actionsExecuted: false, evaluated: value.evaluate === true, missingGrantIds: prepared.missingGrantIds, templates: prepared.summaries, ...(results === undefined ? {} : { status: aggregateCheckpoints(results, "all"), results }) }, observations: [value.evaluate === true ? "Read-only checkpoints evaluated; no workflow action executed." : "Preview only; no checkpoint or workflow action executed."] }); } catch (error) { return fail("workflow.skill_checkpoints_dryrun", error); } }
  };
  return [bind, dryRun];
}
