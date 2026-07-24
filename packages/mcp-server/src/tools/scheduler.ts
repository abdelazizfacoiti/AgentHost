import { randomUUID } from "node:crypto";
import { z } from "zod";
import { schedulerHash, schedulerPolicy, schedulerTaskFindings, toolFailure, toolSuccess, validateSchedulerSchedule, type ScheduledJobDeliveryPolicy, type ScheduledJobSchedule, type ScheduledJobSpec, type ScheduledJobTask } from "@agenthost/core";
import type { AgentHostMcpContext } from "../context.js";
import type { AnyAgentHostToolDefinition, AgentHostToolDefinition } from "../tool-runner.js";

const jobId = z.string().trim().regex(/^job_[A-Za-z0-9_-]+$/u);
const reviewId = z.string().trim().regex(/^job_review_[A-Za-z0-9_-]+$/u);
const schedule = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("once"), runAt: z.string().min(1), timezone: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("delayed"), delayMinutes: z.number().int().min(1).max(525_600), timezone: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("recurring"), everyMinutes: z.number().int().min(1), timezone: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("cron"), expression: z.string().trim().min(1).max(100), timezone: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("calendar"), unit: z.enum(["hourly", "daily", "weekdays", "monthly", "yearly"]), at: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u).optional(), timezone: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("condition_watch_future"), timezone: z.string().min(1) }).strict()
]);
const task = z.object({ type: z.enum(["skill_replay_dryrun", "skill_replay_stepwise_future", "browser_research_future", "file_check_future", "shell_safe_future", "notification_future", "custom_future"]), skillId: z.string().trim().regex(/^skill_[A-Za-z0-9_-]+$/u).optional(), dataSensitivity: z.enum(["none", "low", "sensitive", "secret"]), requiredGrantIds: z.array(z.string().trim().min(1)).max(50).optional() }).strict();
const delivery = z.object({ kind: z.enum(["local_log", "local_file", "desktop_notification_future", "draft_message_future", "draft_email_future", "external_send_blocked"]), outputName: z.string().trim().regex(/^[A-Za-z0-9_-]+\.(txt|json)$/u).optional() }).strict();
const proposeInput = z.object({ operation: z.enum(["create", "update"]), jobId: jobId.optional(), name: z.string().trim().min(1).max(120), description: z.string().trim().min(1).max(500), schedule, task, parameters: z.record(z.unknown()).optional(), delivery, changeSummary: z.string().trim().min(1).max(500) }).strict();
const reviewInput = z.object({ reviewId, decision: z.enum(["analyze", "approve", "reject"]), reviewer: z.string().trim().min(1).max(120).optional() }).strict();
const idInput = z.object({ jobId }).strict();
const applyInput = z.object({ reviewId }).strict();
const listInput = z.object({ status: z.enum(["draft", "review_required", "approved", "rejected", "archived", "disabled", "paused", "cancelled"]).optional(), limit: z.number().int().min(1).max(100).optional() }).strict();

function store(context: AgentHostMcpContext) { if (!context.scheduler) throw new Error("scheduler_unavailable"); return context.scheduler; }
function fail(tool: string, error: unknown) { const code = error instanceof Error ? error.message : "scheduler_failed"; return toolFailure({ tool, riskLevel: "low", error: { code, message: code.replaceAll("_", " ") }, observations: ["No scheduled job ran; scheduler records remain metadata-only."] }); }
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
function safe(job: ScheduledJobSpec) { const { parametersSummary, ownerSessionId: _ownerSessionId, ...rest } = job; return { ...rest, name: "[redacted]", description: "[redacted]", parametersSummary: parametersSummary.map((item) => ({ name: "[redacted]", provided: item.provided, redacted: true as const })), task: { ...job.task, parameterNames: parametersSummary.map(() => "[redacted]") } }; }
function safeReview(review: object) { const { ownerSessionId: _ownerSessionId, ...rest } = review as Record<string, unknown>; return rest; }
async function safeWithActivation(context: AgentHostMcpContext, job: ScheduledJobSpec) { const activation = await store(context).latestActivationSummary(job.jobId); return { ...safe(job), ...(activation === undefined ? {} : { activation }) }; }

async function safety(input: z.infer<typeof proposeInput>, context: AgentHostMcpContext) {
  const policy = schedulerPolicy(context.policy);
  const findings = [...validateSchedulerSchedule(input.schedule as ScheduledJobSchedule, policy), ...schedulerTaskFindings({ ...input.task, parameterNames: Object.keys(input.parameters ?? {}), requiredGrantIds: input.task.requiredGrantIds ?? [] } as ScheduledJobTask, input.delivery as ScheduledJobDeliveryPolicy)];
  if (!policy.allowSchedulerSpecs) findings.push("scheduler_specs_disabled");
  if (input.task.type === "skill_replay_dryrun") {
    if (!input.task.skillId) findings.push("scheduler_skill_required");
    else try {
      const skill = await context.workflowTrace?.getSkill(input.task.skillId);
      if (!skill) findings.push("scheduler_skill_missing");
      else {
        const active = context.grants.listActiveGrants().map((grant) => grant.id);
        for (const grant of skill.requiredGrants) if (!active.includes(grant)) findings.push("scheduler_grant_missing");
        if (skill.steps.some((step) => step.blocked || /send|submit|upload|delete|archive|pay|buy/iu.test(step.actionType))) findings.push("scheduler_blocked_action");
      }
    } catch { findings.push("scheduler_skill_missing"); }
  }
  return [...new Set(findings)];
}

type LifecycleReviewAction = "archive" | "disable" | "pause" | "resume" | "cancel" | "remove";
async function mutationReview(context: AgentHostMcpContext, job: ScheduledJobSpec, action: LifecycleReviewAction) {
  const timestamp = new Date().toISOString();
  const review = {
    reviewId: `job_review_${randomUUID()}`,
    jobId: job.jobId,
    action,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: "applied" as const,
    version: job.version,
    jobHash: job.jobHash,
    afterSummary: { jobId: job.jobId, status: job.status, scheduleKind: job.schedule.kind, metadataOnly: true },
    safety: { scheduleFindings: [], taskFindings: ["scheduler_execution_disabled"], deliveryFindings: [], blockedReasons: [], requiredGrantIds: job.requiredGrants, missingGrantIds: [] },
    ownerSessionId: context.sessionId
  };
  await store(context).saveReview(review);
  return review;
}

export function createSchedulerTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const propose: AgentHostToolDefinition<z.infer<typeof proposeInput>, unknown, AgentHostMcpContext> = {
    name: "scheduler.job_propose", description: "Creates inert redacted scheduled-job proposal.", riskLevel: "low", inputSchema: proposeInput,
    mcpInputSchema: schema({ operation: { type: "string" }, jobId: { type: "string" }, name: { type: "string" }, description: { type: "string" }, schedule: { type: "object" }, task: { type: "object" }, parameters: { type: "object" }, delivery: { type: "object" }, changeSummary: { type: "string" } }, ["operation", "name", "description", "schedule", "task", "delivery", "changeSummary"]),
    inputSummary: "Propose scheduled job", auditInputSummary: () => "Propose scheduled job; payload omitted.", safety: { actionType: "inspect" },
    async handler(input, context) {
      try {
        const scheduler = store(context);
        if (input.operation === "update" && !input.jobId) throw new Error("scheduler_job_id_required");
        const existing = input.jobId ? await scheduler.getJob(input.jobId) : undefined;
        const timestamp = new Date().toISOString();
        const id = existing?.jobId ?? `job_${randomUUID()}`;
        const required = [...(input.task.requiredGrantIds ?? [])];
        const parameterCount = Object.keys(input.parameters ?? {}).length;
        const candidate: ScheduledJobSpec = { jobId: id, name: "[redacted]", description: "[redacted]", createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp, status: "review_required", schedule: input.schedule as ScheduledJobSchedule, task: { ...input.task, parameterNames: Array.from({ length: parameterCount }, () => "[redacted]"), requiredGrantIds: required } as ScheduledJobTask, delivery: input.delivery as ScheduledJobDeliveryPolicy, parametersSummary: Array.from({ length: parameterCount }, () => ({ name: "[redacted]", provided: true, redacted: true as const })), requiredGrants: required, requiredConfirmations: [], safetyRestrictions: ["Inert specification only; scheduler execution is disabled."], retryPolicy: "none", maxAttempts: 1, version: (existing?.version ?? 0) + 1, jobHash: "", executable: false, scheduledExecutionEnabled: false, ownerSessionId: context.sessionId };
        candidate.jobHash = schedulerHash(candidate);
        const findings = await safety(input, context);
        const review = { reviewId: `job_review_${randomUUID()}`, jobId: id, action: input.operation, createdAt: timestamp, updatedAt: timestamp, status: "pending" as const, version: candidate.version, jobHash: candidate.jobHash, afterSummary: { jobId: id, status: candidate.status, scheduleKind: candidate.schedule.kind, taskType: candidate.task.type, delivery: candidate.delivery.kind }, safety: { scheduleFindings: findings.filter((item) => item.includes("schedule") || item.includes("timezone") || item.includes("frequency") || item.includes("condition") || item.includes("cron") || item.includes("calendar")), taskFindings: findings.filter((item) => item.includes("task") || item.includes("skill") || item.includes("grant") || item.includes("action")), deliveryFindings: findings.filter((item) => item.includes("delivery")), blockedReasons: findings, requiredGrantIds: required, missingGrantIds: findings.filter((item) => item === "scheduler_grant_missing"), ownerSessionId: context.sessionId } };
        candidate.reviewId = review.reviewId;
        candidate.jobHash = schedulerHash(candidate);
        review.jobHash = candidate.jobHash;
        await scheduler.saveJob(candidate);
        await scheduler.saveReview(review);
        return toolSuccess({ tool: "scheduler.job_propose", riskLevel: "low", preview: true, data: { job: safe(candidate), review: safeReview(review) }, observations: ["Inert job spec and pending review created; no timer or worker exists."] });
      } catch (error) { return fail("scheduler.job_propose", error); }
    }
  };
  const review: AgentHostToolDefinition<z.infer<typeof reviewInput>, unknown, AgentHostMcpContext> = { name: "scheduler.job_review", description: "Reviews inert scheduled-job safety.", riskLevel: "low", inputSchema: reviewInput, mcpInputSchema: schema({ reviewId: { type: "string" }, decision: { type: "string" }, reviewer: { type: "string" } }, ["reviewId", "decision"]), inputSummary: "Review scheduled job", safety: { actionType: "inspect" }, async handler(input, context) { try { const scheduler = store(context); const record = await scheduler.getReview(input.reviewId); if (record.status !== "pending" && input.decision !== "analyze") throw new Error("scheduler_review_not_pending"); if (input.decision === "reject") { record.status = "rejected"; record.action = "reject"; } else if (input.decision === "approve") { if (record.safety.blockedReasons.length) record.status = "blocked"; else { record.status = "approved"; record.action = "approve"; } } record.updatedAt = new Date().toISOString(); if (input.reviewer) record.reviewer = "redacted"; await scheduler.saveReview(record); return toolSuccess({ tool: "scheduler.job_review", riskLevel: "low", data: safeReview(record), observations: ["Review only; no job executed."] }); } catch (error) { return fail("scheduler.job_review", error); } } };
  const apply: AgentHostToolDefinition<z.infer<typeof applyInput>, unknown, AgentHostMcpContext> = { name: "scheduler.job_apply_review", description: "Applies approved inert job review.", riskLevel: "low", inputSchema: applyInput, mcpInputSchema: schema({ reviewId: { type: "string" } }, ["reviewId"]), inputSummary: "Apply scheduled job review", safety: { actionType: "inspect" }, async handler(input, context) { try { const scheduler = store(context); const record = await scheduler.getReview(input.reviewId); if (record.status !== "approved") throw new Error("scheduler_review_not_approved"); const job = await scheduler.getJob(record.jobId); if (job.jobHash !== record.jobHash) throw new Error("scheduler_job_changed"); job.status = "approved"; job.updatedAt = new Date().toISOString(); await scheduler.saveJob(job); record.status = "applied"; record.updatedAt = job.updatedAt; await scheduler.saveReview(record); return toolSuccess({ tool: "scheduler.job_apply_review", riskLevel: "low", data: safe(job), observations: ["Approved inert spec stored; execution remains disabled."] }); } catch (error) { return fail("scheduler.job_apply_review", error); } } };
  const get: AgentHostToolDefinition<z.infer<typeof idInput>, unknown, AgentHostMcpContext> = { name: "scheduler.job_get", description: "Gets redacted scheduled job.", riskLevel: "observe", inputSchema: idInput, mcpInputSchema: schema({ jobId: { type: "string" } }, ["jobId"]), inputSummary: "Get scheduled job", safety: { actionType: "observe" }, async handler(input, context) { try { return toolSuccess({ tool: "scheduler.job_get", riskLevel: "observe", data: await safeWithActivation(context, await store(context).getJob(input.jobId)) }); } catch (error) { return fail("scheduler.job_get", error); } } };
  const list: AgentHostToolDefinition<z.infer<typeof listInput>, unknown, AgentHostMcpContext> = { name: "scheduler.job_list", description: "Lists redacted scheduled jobs.", riskLevel: "observe", inputSchema: listInput, mcpInputSchema: schema({ status: { type: "string" }, limit: { type: "integer" } }), inputSummary: "List scheduled jobs", safety: { actionType: "observe" }, async handler(input, context) { try { return toolSuccess({ tool: "scheduler.job_list", riskLevel: "observe", data: { jobs: await Promise.all((await store(context).listJobs(input.status)).slice(0, input.limit ?? 50).map((job) => safeWithActivation(context, job))) } }); } catch (error) { return fail("scheduler.job_list", error); } } };

  const lifecycle = (name: "scheduler.job_archive" | "scheduler.job_disable" | "scheduler.job_pause" | "scheduler.job_resume" | "scheduler.job_cancel" | "scheduler.job_remove", status: ScheduledJobSpec["status"]): AnyAgentHostToolDefinition<AgentHostMcpContext> => ({ name, description: "Updates inert scheduled-job lifecycle metadata.", riskLevel: "low", inputSchema: idInput, mcpInputSchema: schema({ jobId: { type: "string" } }, ["jobId"]), inputSummary: "Update scheduled job metadata", safety: { actionType: "inspect" }, async handler(input, context) { try { const job = await store(context).transition(input.jobId, status); const review = await mutationReview(context, job, name === "scheduler.job_remove" ? "remove" : name.slice("scheduler.job_".length) as "archive" | "disable" | "pause" | "resume" | "cancel"); return toolSuccess({ tool: name, riskLevel: "low", data: { job: safe(job), review: safeReview(review) }, observations: ["Lifecycle metadata changed; no timer, worker, tool, or delivery was created."] }); } catch (error) { return fail(name, error); } } });
  return [propose, review, apply, get, list, lifecycle("scheduler.job_archive", "archived"), lifecycle("scheduler.job_disable", "disabled"), lifecycle("scheduler.job_pause", "paused"), lifecycle("scheduler.job_resume", "review_required"), lifecycle("scheduler.job_cancel", "cancelled"), lifecycle("scheduler.job_remove", "archived")];
}
