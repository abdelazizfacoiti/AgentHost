import { randomUUID } from "node:crypto";
import { createAdapterRegistry, createBaseCapabilityRegistry, getPolicyProfile, MANUAL_RUN_ACKNOWLEDGEMENT_IDS, schedulerHash, type AgentHostConfig, type AuditLogEntry, type AuditLogger, type ScheduledJobSpec } from "@agenthost/core";
import { describe, expect, it } from "vitest";
import { ConfirmationManager } from "../confirmation.js";
import type { AgentHostMcpContext } from "../context.js";
import { ForgeStore } from "../forge-store.js";
import { GrantStore } from "../grants.js";
import { SchedulerStore } from "../scheduler-store.js";
import { runTool } from "../tool-runner.js";
import { createSchedulerActivationTools } from "../tools/scheduler-activation.js";
import { createSchedulerManualRunTools } from "../tools/scheduler-manual-run.js";
import { createSchedulerManualRunPreflightTools } from "../tools/scheduler-manual-run-preflight.js";
import { createSchedulerManualRunAuditTools } from "../tools/scheduler-manual-run-audit.js";
import { createSchedulerManualRunRequestLifecycleTools } from "../tools/scheduler-manual-run-request-lifecycle.js";
import { createSchedulerManualRunApprovalDiagnosticsTools } from "../tools/scheduler-manual-run-approval-diagnostics.js";
import { WorkflowStore } from "../workflow-store.js";

class MemoryLogger implements AuditLogger { entries: AuditLogEntry[] = []; async log(entry: AuditLogEntry) { this.entries.push(entry); } }

async function context(): Promise<AgentHostMcpContext> {
  const agentHostDir = `/tmp/agenthost-manual-request-review-${randomUUID()}`;
  const policy = getPolicyProfile("dev");
  const config: AgentHostConfig = { agentHostDir, configPath: `${agentHostDir}/config.json`, logFile: `${agentHostDir}/logs/test.jsonl`, profile: "dev", policy };
  const workflowTrace = new WorkflowStore(agentHostDir); const scheduler = new SchedulerStore(agentHostDir);
  await Promise.all([workflowTrace.ensureStructure(), scheduler.ensureStructure()]);
  return { sessionId: "manual_request_review", config, policy, registry: createBaseCapabilityRegistry(), adapters: createAdapterRegistry(), logger: new MemoryLogger(), confirmations: new ConfirmationManager(), grants: new GrantStore({ persistentGrants: [] }), forge: new ForgeStore(agentHostDir), workflowTrace, scheduler, linux: {} as AgentHostMcpContext["linux"] };
}

async function call(value: AgentHostMcpContext, name: string, input: unknown) {
  const tools = [...createSchedulerActivationTools(), ...createSchedulerManualRunTools(), ...createSchedulerManualRunPreflightTools(), ...createSchedulerManualRunAuditTools(), ...createSchedulerManualRunRequestLifecycleTools(), ...createSchedulerManualRunApprovalDiagnosticsTools()];
  const tool = tools.find((item) => item.name === name); if (tool === undefined) throw new Error(`tool_missing:${name}`); return runTool(tool, input, value);
}

async function job(value: AgentHostMcpContext, status: ScheduledJobSpec["status"] = "approved") {
  const trace = await value.workflowTrace!.createTrace({ sessionId: value.sessionId, name: "generic" });
  await value.workflowTrace!.stopTrace({ sessionId: value.sessionId, traceId: trace.traceId });
  const skill = await value.workflowTrace!.saveSkillFromTrace({ traceId: trace.traceId, name: "generic", description: "private@example.test" });
  const now = new Date().toISOString();
  const item: ScheduledJobSpec = { jobId: `job_${randomUUID()}`, name: "private@example.test", description: "private", createdAt: now, updatedAt: now, status, schedule: { kind: "recurring", everyMinutes: 60, timezone: "UTC" }, task: { type: "skill_replay_dryrun", skillId: skill.skillId, dataSensitivity: "none", parameterNames: [], requiredGrantIds: [] }, delivery: { kind: "local_log" }, parametersSummary: [], requiredGrants: [], requiredConfirmations: [], safetyRestrictions: [], retryPolicy: "none", maxAttempts: 1, version: 1, jobHash: "", executable: false, scheduledExecutionEnabled: false };
  item.jobHash = schedulerHash(item); await value.scheduler!.saveJob(item); return item;
}

async function approvedRequest(value: AgentHostMcpContext) {
  const item = await job(value);
  const activationRequest = await call(value, "scheduler.job_activation_request", { jobId: item.jobId });
  const activationReviewId = (activationRequest.data as { review: { reviewId: string } }).review.reviewId;
  await call(value, "scheduler.job_activation_review", { reviewId: activationReviewId, decision: "approve" });
  await call(value, "scheduler.job_activation_apply_review", { reviewId: activationReviewId });
  const proposed = await call(value, "scheduler.manual_run_contract_propose", { jobId: item.jobId });
  const contractReviewId = (proposed.data as { review: { reviewId: string } }).review.reviewId;
  await call(value, "scheduler.manual_run_contract_review", { reviewId: contractReviewId, decision: "approve" });
  const applied = await call(value, "scheduler.manual_run_contract_apply_review", { reviewId: contractReviewId });
  const contractId = (applied.data as { contract: { runContractId: string } }).contract.runContractId;
  const checked = await call(value, "scheduler.manual_run_preflight_check", { manualRunContractId: contractId });
  const preflightId = (checked.data as { preflight: { preflightId: string } }).preflight.preflightId;
  const acknowledged = await call(value, "scheduler.manual_run_acknowledge", { preflightId, acknowledgedItemIds: MANUAL_RUN_ACKNOWLEDGEMENT_IDS });
  const acknowledgementId = (acknowledged.data as { acknowledgement: { acknowledgementId: string } }).acknowledgement.acknowledgementId;
  const request = await call(value, "scheduler.manual_run_request_create", { acknowledgementId });
  return (request.data as { request: { manualRunRequestId: string } }).request.manualRunRequestId;
}

describe("manual-run request approval lifecycle", () => {
  it("reviews and applies valid request as metadata only", async () => {
    const value = await context(); const requestId = await approvedRequest(value);
    const reviewed = await call(value, "scheduler.manual_run_request_review", { manualRunRequestId: requestId, decision: "approve", reviewer: "private@example.test" });
    expect(reviewed).toMatchObject({ ok: true, data: { request: { approvalStatus: "approval_pending", approvalMode: "review_only", executionAuthorized: false, executable: false }, review: { status: "approved" } } });
    expect(JSON.stringify(reviewed)).not.toContain("private@example.test");
    const reviewId = (reviewed.data as { review: { reviewId: string } }).review.reviewId;
    const applied = await call(value, "scheduler.manual_run_request_apply_review", { reviewId });
    expect(applied).toMatchObject({ ok: true, data: { request: { approvalStatus: "approval_approved", executionAuthorized: false, executable: false, runSessionCreated: false, replaySessionCreated: false, actionsExecuted: false, confirmationTokensCreated: false }, review: { status: "applied" } } });
    expect(value.confirmations).not.toHaveProperty("tokens");
  });

  it("blocks missing request, stale hashes, disabled job, missing grants, and external delivery", async () => {
    const missing = await context();
    await expect(call(missing, "scheduler.manual_run_request_review", { manualRunRequestId: `manual_run_request_${randomUUID()}`, decision: "approve" })).resolves.toMatchObject({ ok: false, error: { code: "scheduler_manual_run_request_not_found" } });
    const stale = await context(); const staleId = await approvedRequest(stale); const staleRequest = await stale.scheduler!.getManualRunRequest(staleId); staleRequest.requestHash = "tampered"; await stale.scheduler!.saveManualRunRequest(staleRequest);
    expect(await call(stale, "scheduler.manual_run_request_review", { manualRunRequestId: staleId, decision: "approve" })).toMatchObject({ ok: true, data: { review: { status: "blocked", blockers: expect.arrayContaining(["scheduler_manual_run_request_hash_stale"]) }, request: { approvalStatus: "approval_blocked" } } });
    const disabled = await context(); const disabledId = await approvedRequest(disabled); const disabledRequest = await disabled.scheduler!.getManualRunRequest(disabledId); const disabledJob = await disabled.scheduler!.getJob(disabledRequest.jobId); disabledJob.status = "disabled"; await disabled.scheduler!.saveJob(disabledJob);
    expect(await call(disabled, "scheduler.manual_run_request_review", { manualRunRequestId: disabledId, decision: "approve" })).toMatchObject({ ok: true, data: { review: { status: "blocked", blockers: expect.arrayContaining(["scheduler_job_disabled"]) } } });
    const external = await context(); const externalId = await approvedRequest(external); const externalRequest = await external.scheduler!.getManualRunRequest(externalId); const externalJob = await external.scheduler!.getJob(externalRequest.jobId); externalJob.delivery = { kind: "external_send_blocked" }; externalJob.jobHash = schedulerHash(externalJob); await external.scheduler!.saveJob(externalJob);
    expect(await call(external, "scheduler.manual_run_request_review", { manualRunRequestId: externalId, decision: "approve" })).toMatchObject({ ok: true, data: { review: { status: "blocked", blockers: expect.arrayContaining(["scheduler_external_delivery_blocked"]) } } });
  });

  it("rejects non-approved apply and supports idempotent revoke", async () => {
    const value = await context(); const requestId = await approvedRequest(value); const rejected = await call(value, "scheduler.manual_run_request_review", { manualRunRequestId: requestId, decision: "reject" });
    const rejectedReviewId = (rejected.data as { review: { reviewId: string } }).review.reviewId;
    expect(rejected).toMatchObject({ ok: true, data: { request: { approvalStatus: "approval_rejected" }, review: { status: "rejected" } } });
    await expect(call(value, "scheduler.manual_run_request_apply_review", { reviewId: rejectedReviewId })).resolves.toMatchObject({ ok: false, error: { code: "scheduler_manual_run_request_review_not_approved" } });
    const approve = await call(value, "scheduler.manual_run_request_review", { manualRunRequestId: requestId, decision: "approve" });
    expect(approve).toMatchObject({ ok: true, data: { review: { status: "blocked" } } });
  });

  it("revokes approved metadata, archives terminal review, and redacts listings", async () => {
    const value = await context(); const requestId = await approvedRequest(value); const reviewed = await call(value, "scheduler.manual_run_request_review", { manualRunRequestId: requestId, decision: "approve" }); const reviewId = (reviewed.data as { review: { reviewId: string } }).review.reviewId; await call(value, "scheduler.manual_run_request_apply_review", { reviewId });
    const revoked = await call(value, "scheduler.manual_run_request_revoke", { manualRunRequestId: requestId });
    expect(revoked).toMatchObject({ ok: true, data: { request: { approvalStatus: "approval_revoked", revoked: true, executionAuthorized: false } } });
    expect(await call(value, "scheduler.manual_run_request_revoke", { manualRunRequestId: requestId })).toMatchObject({ ok: true, data: { request: { approvalStatus: "approval_revoked" } } });
    expect(await call(value, "scheduler.manual_run_request_review", { manualRunRequestId: requestId, decision: "approve" })).toMatchObject({ ok: true, data: { review: { status: "blocked" }, request: { approvalStatus: "approval_revoked" } } });
    const revokeReviewId = (revoked.data as { review: { reviewId: string } }).review.reviewId;
    expect(await call(value, "scheduler.manual_run_request_review_archive", { reviewId: revokeReviewId })).toMatchObject({ ok: true, data: { request: { approvalStatus: "approval_archived" }, review: { status: "archived" } } });
    const listed = await call(value, "scheduler.manual_run_request_review_list", { manualRunRequestId: requestId });
    expect(listed).toMatchObject({ ok: true, data: { reviews: expect.any(Array) } }); expect(JSON.stringify(listed)).not.toContain("private@example.test");
    expect(await call(value, "scheduler.manual_run_request_review_get", { reviewId: revokeReviewId })).toMatchObject({ ok: true, data: { review: { reviewId: revokeReviewId } } });
  });

  it("records bounded expiry and explains stale approval without refresh", async () => {
    const value = await context(); const requestId = await approvedRequest(value);
    const reviewed = await call(value, "scheduler.manual_run_request_review", { manualRunRequestId: requestId, decision: "approve" });
    const reviewId = (reviewed.data as { review: { reviewId: string } }).review.reviewId;
    const applied = await call(value, "scheduler.manual_run_request_apply_review", { reviewId });
    expect(applied).toMatchObject({ ok: true, data: { request: { approvalStatus: "approval_approved", executionAuthorized: false, executable: false, expiresAt: expect.any(String), approvalDependencySnapshot: expect.any(Object) } } });
    const valid = await call(value, "scheduler.manual_run_request_approval_validity", { manualRunRequestId: requestId });
    expect(valid).toMatchObject({ ok: true, data: { validity: { validityStatus: "valid", executionAuthorized: false, executable: false, actionsExecuted: false, confirmationTokensCreated: false } } });
    const explained = await call(value, "scheduler.manual_run_request_approval_explain", { manualRunRequestId: requestId });
    expect(explained).toMatchObject({ ok: true, data: { explanation: { redacted: true, recoveryActions: [] } } });
    const stored = await value.scheduler!.getManualRunRequest(requestId); stored.expiresAt = new Date(Date.now() - 1000).toISOString(); await value.scheduler!.saveManualRunRequest(stored);
    expect(await call(value, "scheduler.manual_run_request_approval_validity", { manualRunRequestId: requestId })).toMatchObject({ ok: true, data: { validity: { validityStatus: "expired", stale: true } } });
    expect(value.confirmations).not.toHaveProperty("tokens");
  });
});
