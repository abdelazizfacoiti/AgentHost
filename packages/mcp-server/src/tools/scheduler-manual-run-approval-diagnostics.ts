import { DEFAULT_SCHEDULER_POLICY, classifyApprovalValidity, manualRunApprovalPolicyHash, manualRunRequestReviewHashMatches, schedulerHash, toolFailure, toolSuccess, type ScheduledJobManualRunApprovalAuditExplanation, type ScheduledJobManualRunApprovalStaleDependency, type ScheduledJobManualRunApprovalValidity, type ScheduledJobManualRunRequest } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AnyAgentHostToolDefinition, AgentHostToolDefinition } from "../tool-runner.js";
import { normalizeManualRunRequest, safeRequest } from "./scheduler-manual-run-audit.js";
import { reviewDependencies } from "./scheduler-manual-run-request-lifecycle.js";

const requestId = z.string().trim().regex(/^manual_run_request_[A-Za-z0-9_-]+$/);
const idInput = z.object({ manualRunRequestId: requestId }).strict();
const listInput = z.object({ status: z.enum(["valid", "expiring_soon", "expired", "stale", "revoked", "archived", "blocked"]).optional(), limit: z.number().int().min(1).max(100).optional() }).strict();
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

function store(context: AgentHostMcpContext) { if (!context.scheduler) throw new Error("scheduler_unavailable"); return context.scheduler; }
function fail(tool: string, error: unknown) { const code = error instanceof Error ? error.message : "scheduler_manual_run_approval_diagnostics_failed"; return toolFailure({ tool, riskLevel: "low", error: { code, message: code.replaceAll("_", " ") }, observations: ["Read-only approval diagnostics; no refresh, execution, session, timer, worker, file, message, notification, or token was created."] }); }
function safeValidity(value: ScheduledJobManualRunApprovalValidity) { return { ...value, blockers: [...value.blockers], warnings: [...value.warnings], staleDependencies: value.staleDependencies.map((item) => ({ name: item.name, reasonCode: item.reasonCode })), recoveryActions: value.recoveryActions.map((item) => ({ ...item })) }; }

async function evaluate(context: AgentHostMcpContext, raw: ScheduledJobManualRunRequest) {
  const request = normalizeManualRunRequest(raw);
  const deps = await reviewDependencies(context, request, false);
  const staleDependencies: ScheduledJobManualRunApprovalStaleDependency[] = [];
  const expected = request.approvalDependencySnapshot;
  const compare = (name: string, expectedFingerprint: string | undefined, currentFingerprint: string | undefined, reasonCode = `scheduler_${name}_stale`) => { if (expectedFingerprint === undefined && currentFingerprint === undefined) return; if (expectedFingerprint === undefined || currentFingerprint === undefined || expectedFingerprint !== currentFingerprint) staleDependencies.push({ name, ...(expectedFingerprint === undefined ? {} : { expectedFingerprint }), ...(currentFingerprint === undefined ? {} : { currentFingerprint }), reasonCode }); };
  if (expected === undefined) staleDependencies.push({ name: "approval", reasonCode: "scheduler_approval_metadata_missing" });
  else {
    compare("request", expected.requestHash, request.requestHash, "scheduler_request_stale");
    compare("acknowledgement", expected.acknowledgementHash, deps.acknowledgement.acknowledgementHash, "scheduler_acknowledgement_stale");
    compare("preflight", expected.preflightHash, deps.storedPreflight.preflightHash, "scheduler_preflight_stale");
    compare("contract", expected.contractHash, deps.contract.contractHash, "scheduler_contract_stale");
    compare("job", expected.jobHash, deps.job.jobHash, "scheduler_job_stale");
    if (expected.jobVersion !== deps.job.version) staleDependencies.push({ name: "job", expectedFingerprint: String(expected.jobVersion), currentFingerprint: String(deps.job.version), reasonCode: "scheduler_job_version_stale" });
    compare("activation", expected.activationHash, deps.activation?.activationHash, "scheduler_activation_stale");
    compare("readiness", expected.readinessHash, deps.readinessHash, "scheduler_readiness_stale");
    compare("grants", expected.grantSnapshotHash, deps.grantSnapshotHash, "scheduler_grants_stale");
    compare("delivery", expected.deliveryHash, schedulerHash(deps.job.delivery), "scheduler_delivery_stale");
    compare("future_controls", expected.futureControlsHash, schedulerHash(deps.contract.futureControls), "scheduler_future_controls_stale");
    compare("policy", expected.policyHash, manualRunApprovalPolicyHash(context.policy), "scheduler_policy_stale");
    if (request.reviewId !== undefined) {
      const review = await store(context).getManualRunRequestReview(request.reviewId).catch(() => undefined);
      if (review === undefined || !manualRunRequestReviewHashMatches(review)) staleDependencies.push({ name: "review", reasonCode: "scheduler_review_stale" });
    }
  }
  const policy = context.policy.scheduler ?? DEFAULT_SCHEDULER_POLICY;
  const structuralBlockers = deps.blockers.filter((code) => !/(stale|changed|mismatch)/.test(code));
  const validity = classifyApprovalValidity({ request, policy, staleDependencies, blockers: structuralBlockers, warnings: deps.warnings });
  return { request, deps, validity };
}

function explanation(value: Awaited<ReturnType<typeof evaluate>>): ScheduledJobManualRunApprovalAuditExplanation {
  const { request, deps, validity } = value;
  const lifecycle = [
    { id: request.manualRunRequestId, kind: "request", status: request.approvalStatus, timestamp: request.createdAt },
    ...(request.reviewId === undefined ? [] : [{ id: request.reviewId, kind: "review", status: "applied", timestamp: request.approvedAt }]),
    { id: request.preflightId, kind: "preflight", status: deps.storedPreflight.status, timestamp: deps.storedPreflight.updatedAt },
    { id: request.acknowledgementId, kind: "acknowledgement", status: deps.acknowledgement.status, timestamp: deps.acknowledgement.updatedAt },
    { id: request.manualRunContractId, kind: "contract", status: deps.contract.status, timestamp: deps.contract.updatedAt },
    { id: request.jobId, kind: "job", status: deps.job.status, timestamp: deps.job.updatedAt }
  ];
  const dependencySummary = validity.staleDependencies.map((item) => ({ name: item.name, matches: false, reasonCode: item.reasonCode }));
  return { manualRunRequestId: request.manualRunRequestId, validity: safeValidity(validity), lifecycle, dependencySummary, recoveryActions: validity.recoveryActions, redacted: true };
}

export function createSchedulerManualRunApprovalDiagnosticsTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const validity: AgentHostToolDefinition<z.infer<typeof idInput>, unknown, AgentHostMcpContext> = { name: "scheduler.manual_run_request_approval_validity", description: "Evaluates bounded manual-run approval expiry and staleness without execution.", riskLevel: "observe", inputSchema: idInput, mcpInputSchema: schema({ manualRunRequestId: { type: "string" } }, ["manualRunRequestId"]), inputSummary: "Check manual-run approval validity", auditInputSummary: (value) => `Check approval validity ${value.manualRunRequestId}`, safety: { actionType: "observe" }, async handler(value, context) { try { const result = await evaluate(context, await store(context).getManualRunRequest(value.manualRunRequestId)); return toolSuccess({ tool: "scheduler.manual_run_request_approval_validity", riskLevel: "observe", data: { request: safeRequest(result.request), validity: safeValidity(result.validity) }, observations: ["Expiry and dependency diagnostics only; approval remains metadata-only."] }); } catch (error) { return fail("scheduler.manual_run_request_approval_validity", error); } } };
  const explain: AgentHostToolDefinition<z.infer<typeof idInput>, unknown, AgentHostMcpContext> = { name: "scheduler.manual_run_request_approval_explain", description: "Explains manual-run approval audit chain and safe recovery guidance.", riskLevel: "observe", inputSchema: idInput, mcpInputSchema: schema({ manualRunRequestId: { type: "string" } }, ["manualRunRequestId"]), inputSummary: "Explain manual-run approval", auditInputSummary: (value) => `Explain approval ${value.manualRunRequestId}`, safety: { actionType: "observe" }, async handler(value, context) { try { const result = await evaluate(context, await store(context).getManualRunRequest(value.manualRunRequestId)); return toolSuccess({ tool: "scheduler.manual_run_request_approval_explain", riskLevel: "observe", data: { explanation: explanation(result) }, observations: ["Safe audit explanation only; no approval refresh or execution occurred."] }); } catch (error) { return fail("scheduler.manual_run_request_approval_explain", error); } } };
  const list: AgentHostToolDefinition<z.infer<typeof listInput>, unknown, AgentHostMcpContext> = { name: "scheduler.manual_run_request_approval_list_stale", description: "Lists expired or stale manual-run approval metadata.", riskLevel: "observe", inputSchema: listInput, mcpInputSchema: schema({ status: { type: "string" }, limit: { type: "integer" } }), inputSummary: "List stale approvals", auditInputSummary: () => "List stale approval metadata", safety: { actionType: "observe" }, async handler(value, context) { try { const records = await store(context).listManualRunRequests(); const results = []; for (const record of records.slice(0, 100)) { const evaluated = await evaluate(context, record); if (["expired", "stale", "revoked", "archived", "blocked"].includes(evaluated.validity.validityStatus) && (value.status === undefined || evaluated.validity.validityStatus === value.status)) results.push({ request: safeRequest(evaluated.request), validity: safeValidity(evaluated.validity) }); if (results.length >= (value.limit ?? 50)) break; } return toolSuccess({ tool: "scheduler.manual_run_request_approval_list_stale", riskLevel: "observe", data: { approvals: results }, observations: ["Read-only stale approval list; no records changed."] }); } catch (error) { return fail("scheduler.manual_run_request_approval_list_stale", error); } } };
  return [validity, explain, list];
}
