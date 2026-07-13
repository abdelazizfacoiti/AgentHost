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
import { createSchedulerManualRunTools } from "../tools/scheduler-manual-run.js";
import { createSchedulerManualRunPreflightTools } from "../tools/scheduler-manual-run-preflight.js";
import { WorkflowStore } from "../workflow-store.js";

class MemoryLogger implements AuditLogger { entries: AuditLogEntry[] = []; async log(entry: AuditLogEntry) { this.entries.push(entry); } }

async function context(): Promise<AgentHostMcpContext> {
  const agentHostDir = `/tmp/agenthost-manual-preflight-${randomUUID()}`;
  const policy = getPolicyProfile("dev");
  const config: AgentHostConfig = { agentHostDir, configPath: `${agentHostDir}/config.json`, logFile: `${agentHostDir}/logs/test.jsonl`, profile: "dev", policy };
  const workflowTrace = new WorkflowStore(agentHostDir); const scheduler = new SchedulerStore(agentHostDir);
  await Promise.all([workflowTrace.ensureStructure(), scheduler.ensureStructure()]);
  return { sessionId: "manual_preflight", config, policy, registry: createBaseCapabilityRegistry(), adapters: createAdapterRegistry(), logger: new MemoryLogger(), confirmations: new ConfirmationManager(), grants: new GrantStore({ persistentGrants: [] }), forge: new ForgeStore(agentHostDir), workflowTrace, scheduler, linux: {} as AgentHostMcpContext["linux"] };
}

async function call(value: AgentHostMcpContext, name: string, input: unknown) {
  const tool = [...createSchedulerActivationTools(), ...createSchedulerManualRunTools(), ...createSchedulerManualRunPreflightTools()].find((item) => item.name === name);
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

async function approvedContract(value: AgentHostMcpContext) {
  const item = await job(value); await activate(value, item.jobId);
  const proposed = await call(value, "scheduler.manual_run_contract_propose", { jobId: item.jobId });
  const reviewId = (proposed.data as { review: { reviewId: string } }).review.reviewId;
  await call(value, "scheduler.manual_run_contract_review", { reviewId, decision: "approve" });
  const applied = await call(value, "scheduler.manual_run_contract_apply_review", { reviewId });
  return { item, contractId: (applied.data as { contract: { runContractId: string } }).contract.runContractId };
}

describe("scheduler manual-run operator preflight", () => {
  it("returns pass/warn checklist while remaining non-executable", async () => {
    const value = await context(); const { contractId } = await approvedContract(value);
    const result = await call(value, "scheduler.manual_run_preflight_check", { manualRunContractId: contractId });
    expect(result).toMatchObject({ ok: true, preview: true, data: { preflight: { status: expect.stringMatching(/^(pass|warn)$/), executable: false, canRequestManualRun: "future_only", manualRunSupported: false, scheduledExecutionEnabled: false, backgroundExecution: false, actionsExecuted: false, confirmationTokensCreated: false } } });
    const preflight = (result.data as { preflight: { preflightId: string; requiredOperatorAcknowledgements: unknown[] } }).preflight;
    expect(preflight.requiredOperatorAcknowledgements).toHaveLength(11);
    expect(JSON.stringify(result)).not.toContain("private@example.test");
    expect(await value.scheduler!.listManualRunPreflights({})).toHaveLength(1);
    expect((value.linux as object)).not.toHaveProperty("runSafeCommand");
    expect(value.confirmations).not.toHaveProperty("tokens");
  });

  it("blocks non-approved contracts, stale jobs, and missing activation", async () => {
    for (const status of ["draft", "rejected", "blocked", "archived"] as const) {
      const value = await context(); const { contractId } = await approvedContract(value); const contract = await value.scheduler!.getManualRunContract(contractId); contract.status = status; await value.scheduler!.saveManualRunContract(contract);
      await expect(call(value, "scheduler.manual_run_preflight_check", { manualRunContractId: contractId })).resolves.toMatchObject({ ok: true, data: { preflight: { status: "blocked", blockers: expect.arrayContaining([expect.stringContaining("contract")] ) } } });
    }
    const stale = await context(); const staleRun = await approvedContract(stale); const staleJob = await stale.scheduler!.getJob(staleRun.item.jobId); staleJob.version += 1; await stale.scheduler!.saveJob(staleJob);
    await expect(call(stale, "scheduler.manual_run_preflight_check", { manualRunContractId: staleRun.contractId })).resolves.toMatchObject({ ok: true, data: { preflight: { status: "blocked", blockers: expect.arrayContaining(["scheduler_manual_run_job_version_stale"]) } } });
    const revoked = await context(); const revokedRun = await approvedContract(revoked); const revokedContract = await revoked.scheduler!.getManualRunContract(revokedRun.contractId); const activation = await revoked.scheduler!.getActivation(revokedContract.activationRequestId!); activation.status = "activation_revoked"; await revoked.scheduler!.saveActivation(activation);
    await expect(call(revoked, "scheduler.manual_run_preflight_check", { manualRunContractId: revokedRun.contractId })).resolves.toMatchObject({ ok: true, data: { preflight: { status: "blocked", blockers: expect.arrayContaining(["scheduler_activation_not_approved"]) } } });
  });

  it("blocks disabled jobs, missing grants, and external delivery", async () => {
    const disabled = await context(); const disabledRun = await approvedContract(disabled); const disabledJob = await disabled.scheduler!.getJob(disabledRun.item.jobId); disabledJob.status = "disabled"; await disabled.scheduler!.saveJob(disabledJob);
    await expect(call(disabled, "scheduler.manual_run_preflight_check", { manualRunContractId: disabledRun.contractId })).resolves.toMatchObject({ ok: true, data: { preflight: { status: "blocked", blockers: expect.arrayContaining(["scheduler_job_disabled"]) } } });
    const grants = await context(); const grantsRun = await approvedContract(grants); const grantJob = await grants.scheduler!.getJob(grantsRun.item.jobId); grantJob.requiredGrants = ["grant_missing"]; grantJob.task.requiredGrantIds = ["grant_missing"]; grantJob.jobHash = schedulerHash(grantJob); await grants.scheduler!.saveJob(grantJob);
    await expect(call(grants, "scheduler.manual_run_preflight_check", { manualRunContractId: grantsRun.contractId })).resolves.toMatchObject({ ok: true, data: { preflight: { status: "blocked", blockers: expect.arrayContaining(["scheduler_grant_missing"]) } } });
    const external = await context(); const externalRun = await approvedContract(external); const externalJob = await external.scheduler!.getJob(externalRun.item.jobId); externalJob.delivery = { kind: "external_send_blocked" }; externalJob.jobHash = schedulerHash(externalJob); await external.scheduler!.saveJob(externalJob);
    await expect(call(external, "scheduler.manual_run_preflight_check", { manualRunContractId: externalRun.contractId })).resolves.toMatchObject({ ok: true, data: { preflight: { status: "blocked", blockers: expect.arrayContaining(["scheduler_external_delivery_blocked"]) } } });
  });

  it("gets, lists, and archives redacted preflight records", async () => {
    const value = await context(); const { contractId } = await approvedContract(value); const checked = await call(value, "scheduler.manual_run_preflight_check", { manualRunContractId: contractId });
    const id = (checked.data as { preflight: { preflightId: string } }).preflight.preflightId;
    expect(await call(value, "scheduler.manual_run_preflight_get", { preflightId: id })).toMatchObject({ ok: true, data: { preflight: { preflightId: id } } });
    expect(await call(value, "scheduler.manual_run_preflight_list", { manualRunContractId: contractId })).toMatchObject({ ok: true, data: { preflights: [{ preflightId: id }] } });
    expect(await call(value, "scheduler.manual_run_preflight_archive", { preflightId: id })).toMatchObject({ ok: true, data: { preflight: { preflightId: id, status: "archived", executable: false } } });
  });
});
