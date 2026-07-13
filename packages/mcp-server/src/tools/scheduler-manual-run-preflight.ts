import { activationHash, activationReadinessSnapshotHash, futureControlsSnapshot, MANUAL_RUN_PREFLIGHT_ACKNOWLEDGEMENTS, manualRunContractHash, manualRunDeliveryPlan, manualRunPreflightHash, manualRunTaskPlan, PREFLIGHT_EXPECTED_UNSUPPORTED_BLOCKERS, preflightSnapshot, schedulerReadiness, toolFailure, toolSuccess, type ScheduledJobManualRunContract, type ScheduledJobManualRunPreflight, type ScheduledJobManualRunPreflightSnapshot } from "@agenthost/core";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AnyAgentHostToolDefinition, AgentHostToolDefinition } from "../tool-runner.js";

const contractId = z.string().trim().regex(/^manual_run_contract_[A-Za-z0-9_-]+$/);
const preflightId = z.string().trim().regex(/^manual_run_preflight_[A-Za-z0-9_-]+$/);
const input = z.object({ manualRunContractId: contractId }).strict();
const getInput = z.object({ preflightId }).strict();
const listInput = z.object({ manualRunContractId: contractId.optional(), status: z.enum(["pass", "warn", "blocked", "archived"]).optional(), limit: z.number().int().min(1).max(100).optional() }).strict();
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

function store(context: AgentHostMcpContext) { if (!context.scheduler) throw new Error("scheduler_unavailable"); return context.scheduler; }
function fail(tool: string, error: unknown) { const code = error instanceof Error ? error.message : "scheduler_manual_run_preflight_failed"; return toolFailure({ tool, riskLevel: "low", error: { code, message: code.replaceAll("_", " ") }, observations: ["Read-only preflight only; no manual run, replay session, tool, file, timer, notification, message, or token was created."] }); }
function contractHashMatches(contract: ScheduledJobManualRunContract) { const { contractHash: _ignored, ...body } = contract; return manualRunContractHash(body) === contract.contractHash; }
function activationHashMatches(activation: Awaited<ReturnType<ReturnType<typeof store>["getActivation"]>>) { const { activationHash: _ignored, ...body } = activation; return activationHash(body) === activation.activationHash; }
function unique(values: string[]) { return [...new Set(values)]; }
function actionableReadinessBlockers(codes: string[]) { return codes.filter((code) => !PREFLIGHT_EXPECTED_UNSUPPORTED_BLOCKERS.has(code)); }
function snapshot(inputValue: Omit<ScheduledJobManualRunPreflightSnapshot, "redacted">) { return preflightSnapshot(inputValue); }

async function evaluate(context: AgentHostMcpContext, runContractId: string) {
  const scheduler = store(context);
  const contract = await scheduler.getManualRunContract(runContractId);
  const job = await scheduler.getJob(contract.jobId);
  const activation = contract.activationRequestId === undefined ? undefined : await scheduler.getActivation(contract.activationRequestId).catch(() => undefined);
  const skill = job.task.skillId === undefined ? undefined : await context.workflowTrace?.getSkill(job.task.skillId).catch(() => undefined);
  const activeGrantIds = context.grants.listActiveGrants().map((grant) => grant.id);
  const availableTools = context.registry.listTools().map((tool) => tool.name);
  const activationSummary = activation === undefined ? undefined : { activationRequestId: activation.activationRequestId, status: activation.status, jobVersion: activation.jobVersion, updatedAt: activation.updatedAt, executable: false as const, scheduledExecutionEnabled: false as const, actualExecutionSupported: false as const };
  const readiness = schedulerReadiness({ job, policy: context.policy, activeGrantIds, ...(skill === undefined ? {} : { skill }), ...(activationSummary === undefined ? {} : { activation: activationSummary }), availableTools });
  const task = manualRunTaskPlan({ job, ...(skill === undefined ? {} : { skill }), activeGrantIds, availableTools });
  const delivery = manualRunDeliveryPlan(job);
  const currentReadinessHash = activationReadinessSnapshotHash(job, readiness, context.policy);
  const blockers: string[] = [];
  const warnings: string[] = ["Manual execution remains unsupported; this checklist grants no execution permission."];
  const addBlocker = (condition: boolean, code: string) => { if (condition) blockers.push(code); };
  const policy = context.policy.scheduler;
  addBlocker(policy?.allowSchedulerSpecs === false, "scheduler_specs_disabled");
  addBlocker(job.status !== "approved", "scheduler_manual_run_job_not_approved");
  addBlocker(job.status === "archived", "scheduler_job_archived");
  addBlocker(job.status === "disabled", "scheduler_job_disabled");
  addBlocker(contract.status !== "approved", "scheduler_manual_run_contract_not_approved");
  addBlocker(contract.status === "archived", "scheduler_manual_run_contract_archived");
  addBlocker(!contractHashMatches(contract), "scheduler_manual_run_contract_hash_mismatch");
  addBlocker(contract.jobVersion !== job.version, "scheduler_manual_run_job_version_stale");
  addBlocker(contract.jobHash !== job.jobHash, "scheduler_manual_run_job_hash_stale");
  const activationRequired = policy?.requireApprovalForJobActivation ?? true;
  addBlocker(activationRequired && activation === undefined, "scheduler_activation_approved_required");
  addBlocker(activationRequired && activation !== undefined && activation.status !== "activation_approved", "scheduler_activation_not_approved");
  addBlocker(activation !== undefined && activation.jobId !== job.jobId, "scheduler_activation_job_mismatch");
  addBlocker(activation !== undefined && activation.jobVersion !== job.version, "scheduler_activation_version_stale");
  addBlocker(activation !== undefined && activation.jobHash !== job.jobHash, "scheduler_activation_job_hash_stale");
  addBlocker(activation !== undefined && !activationHashMatches(activation), "scheduler_activation_hash_mismatch");
  addBlocker(activation !== undefined && contract.activationHash !== undefined && activation.activationHash !== contract.activationHash, "scheduler_activation_snapshot_stale");
  addBlocker(contract.readinessSnapshotHash !== currentReadinessHash, "scheduler_readiness_snapshot_stale");
  addBlocker(!readiness.scheduleValid, "scheduler_schedule_invalid");
  addBlocker(!readiness.taskValid, "scheduler_task_invalid");
  addBlocker(!readiness.deliveryValid, "scheduler_delivery_invalid");
  addBlocker(!readiness.grantsSatisfied || readiness.missingGrants.length > 0, "scheduler_grant_missing");
  addBlocker(contract.missingGrants.length > 0, "scheduler_grant_missing");
  addBlocker(job.task.dataSensitivity === "secret", "scheduler_secret_task_blocked");
  addBlocker(job.task.dataSensitivity === "sensitive" && job.task.requiredGrantIds.length === 0, "scheduler_private_grant_required");
  addBlocker(job.delivery.kind === "external_send_blocked" || delivery.blocked, "scheduler_external_delivery_blocked");
  addBlocker(task.plannerBlockers.length > 0, "scheduler_task_plan_blocked");
  addBlocker(actionableReadinessBlockers(readiness.blockers.map((item) => item.code)).length > 0, "scheduler_readiness_blocked");
  addBlocker((activation?.blockers.length ?? 0) > 0, "scheduler_activation_blocked");
  if (job.delivery.kind === "draft_message_future" || job.delivery.kind === "draft_email_future") warnings.push("scheduler_future_draft_delivery_high_risk");
  if (task.steps.some((step) => step.wouldRequireConfirmation)) warnings.push("scheduler_state_changing_confirmation_required");
  const blockerCodes = unique([...blockers, ...actionableReadinessBlockers(readiness.blockers.map((item) => item.code)), ...task.plannerBlockers, ...(activation?.blockers ?? [])]);
  const actionableWarnings = warnings.filter((code) => code !== "Manual execution remains unsupported; this checklist grants no execution permission.");
  const status: ScheduledJobManualRunPreflight["status"] = blockerCodes.length > 0 ? "blocked" : actionableWarnings.length > 0 ? "warn" : "pass";
  const readinessSnapshot = snapshot({ valid: readiness.scheduleValid && readiness.taskValid && readiness.deliveryValid && readiness.grantsSatisfied, status: readiness.jobStatus, version: job.version, hash: contract.readinessSnapshotHash, currentHash: currentReadinessHash, hashMatches: contract.readinessSnapshotHash === currentReadinessHash, blockerCodes: unique(readiness.blockers.map((item) => item.code)), warningCodes: [...readiness.warnings], requiredGrantIds: [...readiness.requiredGrants], missingGrantIds: [...readiness.missingGrants], nextRunPreviewAvailable: readiness.nextRunPreview !== undefined });
  const activationSnapshot = snapshot({ valid: activation === undefined ? !activationRequired : activation.status === "activation_approved", ...(activation === undefined ? {} : { status: activation.status, version: activation.jobVersion, hash: activation.activationHash, currentHash: activation.activationHash, hashMatches: activationHashMatches(activation) && activation.jobHash === job.jobHash }), blockerCodes: [...(activation?.blockers ?? [])], warningCodes: [...(activation?.warnings ?? [])], requiredGrantIds: [...(activation?.requiredGrants ?? [])], missingGrantIds: [...(activation?.missingGrants ?? [])] });
  const contractSnapshot = snapshot({ valid: contract.status === "approved" && contractHashMatches(contract), status: contract.status, version: contract.jobVersion, hash: contract.contractHash, currentHash: contract.contractHash, hashMatches: contractHashMatches(contract), blockerCodes: [...contract.blockers], warningCodes: [...contract.warnings], requiredGrantIds: [...contract.requiredGrants], missingGrantIds: [...contract.missingGrants] });
  const grantSnapshot = snapshot({ valid: readiness.missingGrants.length === 0, status: readiness.grantsSatisfied ? "satisfied" : "missing", blockerCodes: readiness.missingGrants.length === 0 ? [] : ["scheduler_grant_missing"], warningCodes: [], requiredGrantIds: [...readiness.requiredGrants], missingGrantIds: [...readiness.missingGrants] });
  const deliverySnapshot = snapshot({ valid: readiness.deliveryValid && !delivery.blocked, status: delivery.kind, blockerCodes: [...delivery.blockedReasons], warningCodes: delivery.risk === "high" ? ["scheduler_future_delivery_high_risk"] : [], requiredGrantIds: [], missingGrantIds: [] });
  const controls = contract.futureControls;
  const controlsSnapshot = futureControlsSnapshot(controls);
  const outputBase = { preflightId: `manual_run_preflight_${randomUUID()}`, manualRunContractId: contract.runContractId, jobId: job.jobId, jobVersion: job.version, ...(activation === undefined ? {} : { activationId: activation.activationRequestId }), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status, executable: false as const, canRequestManualRun: "future_only" as const, actionsExecuted: false as const, confirmationTokensCreated: false as const, manualRunSupported: false as const, scheduledExecutionEnabled: false as const, backgroundExecution: false as const, readinessSnapshot, activationSnapshot, contractSnapshot, grantSnapshot, deliverySnapshot, futureControlsSnapshot: controlsSnapshot, requiredOperatorAcknowledgements: MANUAL_RUN_PREFLIGHT_ACKNOWLEDGEMENTS.map((item) => ({ ...item })), blockers: blockerCodes, warnings: unique(warnings), recommendedNextAction: blockerCodes.length > 0 ? "resolve_blockers_then_recheck_preflight" : "keep_inert_until_future_manual_execution_is_explicitly_supported" } satisfies Omit<ScheduledJobManualRunPreflight, "preflightHash">;
  const preflight: ScheduledJobManualRunPreflight = { ...outputBase, preflightHash: "" };
  preflight.preflightHash = manualRunPreflightHash(outputBase);
  return preflight;
}

function safe(preflight: ScheduledJobManualRunPreflight) { return { ...preflight, requiredOperatorAcknowledgements: preflight.requiredOperatorAcknowledgements.map((item) => ({ ...item })) }; }

export function createSchedulerManualRunPreflightTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const check: AgentHostToolDefinition<z.infer<typeof input>, unknown, AgentHostMcpContext> = { name: "scheduler.manual_run_preflight_check", description: "Checks a redacted operator preflight for a future manual-run contract without execution.", riskLevel: "observe", inputSchema: input, mcpInputSchema: schema({ manualRunContractId: { type: "string" } }, ["manualRunContractId"]), inputSummary: "Check manual-run operator preflight", auditInputSummary: (value) => `Preflight manual contract ${value.manualRunContractId}`, auditOutputSummary: (result) => result.ok ? "Returned preflight status and blocker counts only." : result.error?.code ?? "Preflight blocked.", safety: { actionType: "observe" }, async handler(value, context) { try { const preflight = await evaluate(context, value.manualRunContractId); await store(context).saveManualRunPreflight(preflight); return toolSuccess({ tool: "scheduler.manual_run_preflight_check", riskLevel: "observe", preview: true, data: { preflight: safe(preflight) }, observations: ["Read-only operator checklist; no manual run or permission was created."] }); } catch (error) { return fail("scheduler.manual_run_preflight_check", error); } } };
  const get: AgentHostToolDefinition<z.infer<typeof getInput>, unknown, AgentHostMcpContext> = { name: "scheduler.manual_run_preflight_get", description: "Gets one redacted manual-run operator preflight.", riskLevel: "observe", inputSchema: getInput, mcpInputSchema: schema({ preflightId: { type: "string" } }, ["preflightId"]), inputSummary: "Get manual-run operator preflight", auditInputSummary: (value) => `Get manual preflight ${value.preflightId}`, safety: { actionType: "observe" }, async handler(value, context) { try { const preflight = await store(context).getManualRunPreflight(value.preflightId); return toolSuccess({ tool: "scheduler.manual_run_preflight_get", riskLevel: "observe", data: { preflight: safe(preflight) }, observations: ["Read-only preflight metadata."] }); } catch (error) { return fail("scheduler.manual_run_preflight_get", error); } } };
  const list: AgentHostToolDefinition<z.infer<typeof listInput>, unknown, AgentHostMcpContext> = { name: "scheduler.manual_run_preflight_list", description: "Lists redacted manual-run operator preflights.", riskLevel: "observe", inputSchema: listInput, mcpInputSchema: schema({ manualRunContractId: { type: "string" }, status: { type: "string" }, limit: { type: "integer" } }), inputSummary: "List manual-run operator preflights", auditInputSummary: () => "List manual preflight metadata", async handler(value, context) { try { const records = await store(context).listManualRunPreflights({ ...(value.manualRunContractId === undefined ? {} : { manualRunContractId: value.manualRunContractId }), ...(value.status === undefined ? {} : { status: value.status }) }); return toolSuccess({ tool: "scheduler.manual_run_preflight_list", riskLevel: "observe", data: { preflights: records.slice(0, value.limit ?? 50).map(safe) }, observations: ["Read-only preflight metadata list."] }); } catch (error) { return fail("scheduler.manual_run_preflight_list", error); } } };
  const archive: AgentHostToolDefinition<z.infer<typeof getInput>, unknown, AgentHostMcpContext> = { name: "scheduler.manual_run_preflight_archive", description: "Archives a manual-run operator preflight without deleting it.", riskLevel: "low", inputSchema: getInput, mcpInputSchema: schema({ preflightId: { type: "string" } }, ["preflightId"]), inputSummary: "Archive manual-run operator preflight", auditInputSummary: (value) => `Archive manual preflight ${value.preflightId}`, safety: { actionType: "inspect" }, async handler(value, context) { try { const scheduler = store(context); const preflight = await scheduler.getManualRunPreflight(value.preflightId); if (preflight.status !== "archived") { preflight.status = "archived"; preflight.archivedAt = new Date().toISOString(); preflight.updatedAt = preflight.archivedAt; await scheduler.saveManualRunPreflight(preflight); } return toolSuccess({ tool: "scheduler.manual_run_preflight_archive", riskLevel: "low", data: { preflight: safe(preflight) }, observations: ["Preflight archived; no manual run occurred."] }); } catch (error) { return fail("scheduler.manual_run_preflight_archive", error); } } };
  return [check, get, list, archive];
}
