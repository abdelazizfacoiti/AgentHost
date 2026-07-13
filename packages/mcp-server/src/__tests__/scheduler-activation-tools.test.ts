import { randomUUID } from "node:crypto";
import { createAdapterRegistry, createBaseCapabilityRegistry, getPolicyProfile, schedulerHash, type AgentHostConfig, type AuditLogEntry, type AuditLogger, type ScheduledJobSpec } from "@agenthost/core";
import { describe, expect, it } from "vitest";
import { ConfirmationManager } from "../confirmation.js";
import type { AgentHostMcpContext } from "../context.js";
import { ForgeStore } from "../forge-store.js";
import { GrantStore } from "../grants.js";
import { SchedulerStore } from "../scheduler-store.js";
import { runTool } from "../tool-runner.js";
import { createSchedulerActivationTools } from "../tools/scheduler-activation.js";
import { WorkflowStore } from "../workflow-store.js";

class MemoryLogger implements AuditLogger { entries: AuditLogEntry[] = []; async log(entry: AuditLogEntry) { this.entries.push(entry); } }
async function context(): Promise<AgentHostMcpContext> { const agentHostDir = `/tmp/agenthost-scheduler-activation-${randomUUID()}`; const policy = getPolicyProfile("dev"); const config: AgentHostConfig = { agentHostDir, configPath: `${agentHostDir}/config.json`, logFile: `${agentHostDir}/logs/test.jsonl`, profile: "dev", policy }; const workflowTrace = new WorkflowStore(agentHostDir); const scheduler = new SchedulerStore(agentHostDir); await Promise.all([workflowTrace.ensureStructure(), scheduler.ensureStructure()]); return { sessionId: "session_scheduler", config, policy, registry: createBaseCapabilityRegistry(), adapters: createAdapterRegistry(), logger: new MemoryLogger(), confirmations: new ConfirmationManager(), grants: new GrantStore({ persistentGrants: [] }), forge: new ForgeStore(agentHostDir), workflowTrace, scheduler, linux: {} as AgentHostMcpContext["linux"] }; }
async function call(value: AgentHostMcpContext, name: string, input: unknown) { const tool = createSchedulerActivationTools().find((candidate) => candidate.name === name); if (tool === undefined) throw new Error("tool_missing"); return runTool(tool, input, value); }
async function approvedJob(value: AgentHostMcpContext, status: ScheduledJobSpec["status"] = "approved") { const trace = await value.workflowTrace!.createTrace({ sessionId: value.sessionId, name: "Generic schedule" }); await value.workflowTrace!.stopTrace({ sessionId: value.sessionId, traceId: trace.traceId }); const skill = await value.workflowTrace!.saveSkillFromTrace({ traceId: trace.traceId, name: "Safe inspect", description: "Generic" }); const timestamp = new Date().toISOString(); const job: ScheduledJobSpec = { jobId: `job_${randomUUID()}`, name: "private-name@example.test", description: "private description", createdAt: timestamp, updatedAt: timestamp, status, schedule: { kind: "recurring", everyMinutes: 60, timezone: "UTC" }, task: { type: "skill_replay_dryrun", skillId: skill.skillId, dataSensitivity: "none", parameterNames: [], requiredGrantIds: [] }, delivery: { kind: "local_log" }, parametersSummary: [], requiredGrants: [], requiredConfirmations: [], safetyRestrictions: [], retryPolicy: "none", maxAttempts: 1, version: 1, jobHash: "", executable: false, scheduledExecutionEnabled: false }; job.jobHash = schedulerHash(job); await value.scheduler!.saveJob(job); return job; }

describe("scheduler activation tools", () => {
  it("requests, reviews, applies, revokes, and archives metadata only", async () => {
    const value = await context(); const job = await approvedJob(value);
    const requested = await call(value, "scheduler.job_activation_request", { jobId: job.jobId, requestedBy: "private@example.test" });
    expect(requested).toMatchObject({ ok: true, preview: true, data: { activation: { status: "activation_review_required", executable: false, scheduledExecutionEnabled: false, actualExecutionSupported: false }, review: { status: "pending" } } });
    expect(JSON.stringify(requested)).not.toContain("private@example.test");
    const reviewId = (requested.data as { review: { reviewId: string } }).review.reviewId;
    expect(await call(value, "scheduler.job_activation_review", { reviewId, decision: "approve" })).toMatchObject({ ok: true, data: { review: { status: "approved" } } });
    const applied = await call(value, "scheduler.job_activation_apply_review", { reviewId });
    expect(applied).toMatchObject({ ok: true, data: { activation: { status: "activation_approved", executable: false, scheduledExecutionEnabled: false, actualExecutionSupported: false } } });
    const activationRequestId = (applied.data as { activation: { activationRequestId: string } }).activation.activationRequestId;
    expect(await call(value, "scheduler.job_activation_revoke", { activationRequestId })).toMatchObject({ ok: true, data: { activation: { status: "activation_revoked" } } });
    expect(await call(value, "scheduler.job_activation_archive", { activationRequestId })).toMatchObject({ ok: true, data: { activation: { status: "activation_archived" } } });
    expect((value.linux as object)).not.toHaveProperty("runSafeCommand"); expect(JSON.stringify((value.logger as MemoryLogger).entries)).not.toContain("private@example.test");
  });

  it("blocks non-approved jobs and readiness blockers", async () => {
    for (const status of ["draft", "rejected", "archived", "disabled"] as const) { const value = await context(); const job = await approvedJob(value, status); await expect(call(value, "scheduler.job_activation_request", { jobId: job.jobId })).resolves.toMatchObject({ ok: false, error: { code: "scheduler_activation_job_not_approved" } }); }
    const value = await context(); const job = await approvedJob(value); job.requiredGrants = ["missing_grant"]; await value.scheduler!.saveJob(job); const request = await call(value, "scheduler.job_activation_request", { jobId: job.jobId }); const reviewId = (request.data as { review: { reviewId: string } }).review.reviewId; await expect(call(value, "scheduler.job_activation_review", { reviewId, decision: "approve" })).resolves.toMatchObject({ ok: true, data: { review: { status: "blocked", blockedReasons: expect.arrayContaining(["scheduler_grant_missing"]) } } }); await expect(call(value, "scheduler.job_activation_apply_review", { reviewId })).resolves.toMatchObject({ ok: false, error: { code: "scheduler_activation_review_not_approved" } });
  });

  it("lists redacted records and keeps readiness non-executable after approval", async () => {
    const value = await context(); const job = await approvedJob(value); const request = await call(value, "scheduler.job_activation_request", { jobId: job.jobId }); const reviewId = (request.data as { review: { reviewId: string } }).review.reviewId; await call(value, "scheduler.job_activation_review", { reviewId, decision: "approve" }); await call(value, "scheduler.job_activation_apply_review", { reviewId });
    const activationRequestId = (request.data as { activation: { activationRequestId: string } }).activation.activationRequestId; const get = await call(value, "scheduler.job_activation_get", { activationRequestId }); const list = await call(value, "scheduler.job_activation_list", { jobId: job.jobId });
    expect(get).toMatchObject({ ok: true, data: { activation: { status: "activation_approved" } } }); expect(list).toMatchObject({ ok: true, data: { activations: [{ activationRequestId }] } }); expect(JSON.stringify([get, list])).not.toContain("private description");
    const schedulerTools = (await import("../tools/scheduler.js")).createSchedulerTools(); const jobGet = schedulerTools.find((candidate) => candidate.name === "scheduler.job_get")!; const jobList = schedulerTools.find((candidate) => candidate.name === "scheduler.job_list")!; expect(await runTool(jobGet, { jobId: job.jobId }, value)).toMatchObject({ ok: true, data: { activation: { activationRequestId, status: "activation_approved" } } }); const jobs = await runTool(jobList, {}, value); expect(jobs.ok).toBe(true); expect((jobs.data as { jobs: Array<{ activation?: { status: string }; description: string }> }).jobs[0]).toMatchObject({ activation: { status: "activation_approved" }, description: "[redacted]" });
    const readinessTool = (await import("../tools/scheduler-readiness.js")).createSchedulerReadinessTools().find((candidate) => candidate.name === "scheduler.job_readiness")!; const readiness = await runTool(readinessTool, { jobId: job.jobId }, value); expect(readiness).toMatchObject({ ok: true, data: { executableNow: false, scheduledExecutionEnabled: false, actualExecutionSupported: false, activationStatus: "activation_approved" } }); expect(value.confirmations).not.toHaveProperty("tokens");
  });
});
