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
import { WorkflowStore } from "../workflow-store.js";

class MemoryLogger implements AuditLogger { entries: AuditLogEntry[] = []; async log(entry: AuditLogEntry) { this.entries.push(entry); } }

async function context(): Promise<AgentHostMcpContext> {
  const agentHostDir = `/tmp/agenthost-manual-audit-${randomUUID()}`;
  const policy = getPolicyProfile("dev");
  const config: AgentHostConfig = { agentHostDir, configPath: `${agentHostDir}/config.json`, logFile: `${agentHostDir}/logs/test.jsonl`, profile: "dev", policy };
  const workflowTrace = new WorkflowStore(agentHostDir); const scheduler = new SchedulerStore(agentHostDir);
  await Promise.all([workflowTrace.ensureStructure(), scheduler.ensureStructure()]);
  return { sessionId: "manual_audit", config, policy, registry: createBaseCapabilityRegistry(), adapters: createAdapterRegistry(), logger: new MemoryLogger(), confirmations: new ConfirmationManager(), grants: new GrantStore({ persistentGrants: [] }), forge: new ForgeStore(agentHostDir), workflowTrace, scheduler, linux: {} as AgentHostMcpContext["linux"] };
}

async function call(value: AgentHostMcpContext, name: string, input: unknown) {
  const tool = [...createSchedulerActivationTools(), ...createSchedulerManualRunTools(), ...createSchedulerManualRunPreflightTools(), ...createSchedulerManualRunAuditTools()].find((item) => item.name === name);
  if (tool === undefined) throw new Error("tool_missing");
  return runTool(tool, input, value);
}

async function job(value: AgentHostMcpContext, status: ScheduledJobSpec["status"] = "approved") {
  const trace = await value.workflowTrace!.createTrace({ sessionId: value.sessionId, name: "generic" });
  await value.workflowTrace!.stopTrace({ sessionId: value.sessionId, traceId: trace.traceId });
  const skill = await value.workflowTrace!.saveSkillFromTrace({ traceId: trace.traceId, name: "generic", description: "private@example.test" });
  const now = new Date().toISOString();
  const item: ScheduledJobSpec = { jobId: `job_${randomUUID()}`, name: "private@example.test", description: "private", createdAt: now, updatedAt: now, status, schedule: { kind: "recurring", everyMinutes: 60, timezone: "UTC" }, task: { type: "skill_replay_dryrun", skillId: skill.skillId, dataSensitivity: "none", parameterNames: [], requiredGrantIds: [] }, delivery: { kind: "local_log" }, parametersSummary: [], requiredGrants: [], requiredConfirmations: [], safetyRestrictions: [], retryPolicy: "none", maxAttempts: 1, version: 1, jobHash: "", executable: false, scheduledExecutionEnabled: false };
  item.jobHash = schedulerHash(item); await value.scheduler!.saveJob(item); return item;
}

async function activate(value: AgentHostMcpContext, jobId: string) {
  const requested = await call(value, "scheduler.job_activation_request", { jobId });
  const reviewId = (requested.data as { review: { reviewId: string } }).review.reviewId;
  await call(value, "scheduler.job_activation_review", { reviewId, decision: "approve" });
  return call(value, "scheduler.job_activation_apply_review", { reviewId });
}

async function preflight(value: AgentHostMcpContext) {
  const item = await job(value); await activate(value, item.jobId);
  const proposed = await call(value, "scheduler.manual_run_contract_propose", { jobId: item.jobId });
  const reviewId = (proposed.data as { review: { reviewId: string } }).review.reviewId;
  await call(value, "scheduler.manual_run_contract_review", { reviewId, decision: "approve" });
  const applied = await call(value, "scheduler.manual_run_contract_apply_review", { reviewId });
  const contractId = (applied.data as { contract: { runContractId: string } }).contract.runContractId;
  const checked = await call(value, "scheduler.manual_run_preflight_check", { manualRunContractId: contractId });
  const preflightId = (checked.data as { preflight: { preflightId: string } }).preflight.preflightId;
  return { item, contractId, preflightId };
}

describe("scheduler manual-run acknowledgement and request audit", () => {
  it("acknowledges complete preflight and creates audit-only request", async () => {
    const value = await context(); const ready = await preflight(value);
    const acknowledgement = await call(value, "scheduler.manual_run_acknowledge", { preflightId: ready.preflightId, acknowledgedItemIds: MANUAL_RUN_ACKNOWLEDGEMENT_IDS, operatorIntent: "private@example.test" });
    expect(acknowledgement).toMatchObject({ ok: true, preview: true, data: { acknowledgement: { status: "acknowledged", executable: false, actionsExecuted: false, confirmationTokensCreated: false, operatorIntentSummary: "redacted" } } });
    expect(JSON.stringify(acknowledgement)).not.toContain("private@example.test");
    const acknowledgementId = (acknowledgement.data as { acknowledgement: { acknowledgementId: string } }).acknowledgement.acknowledgementId;
    const request = await call(value, "scheduler.manual_run_request_create", { acknowledgementId });
    expect(request).toMatchObject({ ok: true, preview: true, data: { request: { status: "requested", requestMode: "audit_only", manualRunRequestSupported: "request_only", executable: false, runSessionCreated: false, replaySessionCreated: false, actionsExecuted: false, confirmationTokensCreated: false } } });
    expect(JSON.stringify(request)).not.toContain("private@example.test");
    const requestId = (request.data as { request: { manualRunRequestId: string } }).request.manualRunRequestId;
    expect(await call(value, "scheduler.manual_run_acknowledgement_get", { acknowledgementId })).toMatchObject({ ok: true, data: { acknowledgement: { acknowledgementId } } });
    expect(await call(value, "scheduler.manual_run_acknowledgement_list", { preflightId: ready.preflightId })).toMatchObject({ ok: true, data: { acknowledgements: [{ acknowledgementId }] } });
    expect(await call(value, "scheduler.manual_run_request_get", { manualRunRequestId: requestId })).toMatchObject({ ok: true, data: { request: { manualRunRequestId: requestId } } });
    expect(await call(value, "scheduler.manual_run_request_list", { manualRunContractId: ready.contractId })).toMatchObject({ ok: true, data: { requests: [{ manualRunRequestId: requestId }] } });
    expect(await call(value, "scheduler.manual_run_acknowledgement_archive", { acknowledgementId })).toMatchObject({ ok: true, data: { acknowledgement: { status: "archived" } } });
    expect(await call(value, "scheduler.manual_run_request_archive", { manualRunRequestId: requestId })).toMatchObject({ ok: true, data: { request: { status: "archived" } } });
    expect((value.linux as object)).not.toHaveProperty("runSafeCommand"); expect(value.confirmations).not.toHaveProperty("tokens");
  });

  it("blocks missing items, blocked preflight, stale hash, and disabled job", async () => {
    const missing = await context(); const missingReady = await preflight(missing);
    expect(await call(missing, "scheduler.manual_run_acknowledge", { preflightId: missingReady.preflightId, acknowledgedItemIds: [] })).toMatchObject({ ok: true, data: { acknowledgement: { status: "blocked", missingAcknowledgements: expect.arrayContaining([MANUAL_RUN_ACKNOWLEDGEMENT_IDS[0]]) } } });
    const blocked = await context(); const blockedReady = await preflight(blocked); const blockedPreflight = await blocked.scheduler!.getManualRunPreflight(blockedReady.preflightId); blockedPreflight.status = "blocked"; await blocked.scheduler!.saveManualRunPreflight(blockedPreflight);
    expect(await call(blocked, "scheduler.manual_run_acknowledge", { preflightId: blockedReady.preflightId, acknowledgedItemIds: MANUAL_RUN_ACKNOWLEDGEMENT_IDS })).toMatchObject({ ok: true, data: { acknowledgement: { status: expect.stringMatching(/^(blocked|stale)$/) } } });
    const stale = await context(); const staleReady = await preflight(stale); const stalePreflight = await stale.scheduler!.getManualRunPreflight(staleReady.preflightId); stalePreflight.preflightHash = "tampered"; await stale.scheduler!.saveManualRunPreflight(stalePreflight);
    expect(await call(stale, "scheduler.manual_run_acknowledge", { preflightId: staleReady.preflightId, acknowledgedItemIds: MANUAL_RUN_ACKNOWLEDGEMENT_IDS })).toMatchObject({ ok: true, data: { acknowledgement: { status: "stale", blockers: expect.arrayContaining(["scheduler_preflight_hash_stale"]) } } });
    const disabled = await context(); const disabledReady = await preflight(disabled); const disabledJob = await disabled.scheduler!.getJob(disabledReady.item.jobId); disabledJob.status = "disabled"; await disabled.scheduler!.saveJob(disabledJob);
    expect(await call(disabled, "scheduler.manual_run_acknowledge", { preflightId: disabledReady.preflightId, acknowledgedItemIds: MANUAL_RUN_ACKNOWLEDGEMENT_IDS })).toMatchObject({ ok: true, data: { acknowledgement: { status: expect.stringMatching(/^(blocked|stale)$/) } } });
  });

  it("blocks request when acknowledgement becomes stale", async () => {
    const value = await context(); const ready = await preflight(value); const acknowledgement = await call(value, "scheduler.manual_run_acknowledge", { preflightId: ready.preflightId, acknowledgedItemIds: MANUAL_RUN_ACKNOWLEDGEMENT_IDS });
    const acknowledgementId = (acknowledgement.data as { acknowledgement: { acknowledgementId: string } }).acknowledgement.acknowledgementId; const record = await value.scheduler!.getManualRunAcknowledgement(acknowledgementId); record.status = "stale"; await value.scheduler!.saveManualRunAcknowledgement(record);
    expect(await call(value, "scheduler.manual_run_request_create", { acknowledgementId })).toMatchObject({ ok: true, data: { request: { status: "blocked", executable: false, blockers: expect.arrayContaining(["scheduler_acknowledgement_not_acknowledged"]) } } });
    const changed = await context(); const changedReady = await preflight(changed); const changedAcknowledgement = await call(changed, "scheduler.manual_run_acknowledge", { preflightId: changedReady.preflightId, acknowledgedItemIds: MANUAL_RUN_ACKNOWLEDGEMENT_IDS }); const changedAcknowledgementId = (changedAcknowledgement.data as { acknowledgement: { acknowledgementId: string } }).acknowledgement.acknowledgementId; const changedJob = await changed.scheduler!.getJob(changedReady.item.jobId); changedJob.delivery = { kind: "external_send_blocked" }; changedJob.jobHash = schedulerHash(changedJob); await changed.scheduler!.saveJob(changedJob); expect(await call(changed, "scheduler.manual_run_request_create", { acknowledgementId: changedAcknowledgementId })).toMatchObject({ ok: true, data: { request: { status: "blocked", blockers: expect.arrayContaining(["scheduler_external_delivery_blocked"]) } } });
  });
});
