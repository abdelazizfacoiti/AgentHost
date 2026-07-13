import {
  activationHash,
  manualRunAcknowledgementHash,
  manualRunContractHash,
  manualRunPreflightHash,
  manualRunRequestHash,
  manualRunRequestApprovalDefaults,
  manualRunRequestReviewHash,
  manualRunRequestReviewHashMatches,
  PREFLIGHT_EXPECTED_UNSUPPORTED_BLOCKERS,
  schedulerHash,
  toolFailure,
  toolSuccess,
  type ScheduledJobManualRunRequest,
  type ScheduledJobManualRunRequestReview,
  type ScheduledJobManualRunPreflight
} from "@agenthost/core";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AnyAgentHostToolDefinition, AgentHostToolDefinition } from "../tool-runner.js";
import { evaluateManualRunPreflight } from "./scheduler-manual-run-preflight.js";
import { normalizeManualRunRequest, safeRequest } from "./scheduler-manual-run-audit.js";

const requestId = z.string().trim().regex(/^manual_run_request_[A-Za-z0-9_-]+$/);
const reviewId = z.string().trim().regex(/^manual_run_request_review_[A-Za-z0-9_-]+$/);
const reviewInput = z.object({ manualRunRequestId: requestId, decision: z.enum(["analyze", "approve", "reject"]), reviewer: z.string().trim().min(1).max(120).optional() }).strict();
const applyInput = z.object({ reviewId }).strict();
const requestInput = z.object({ manualRunRequestId: requestId, reviewer: z.string().trim().min(1).max(120).optional() }).strict();
const getReviewInput = z.object({ reviewId }).strict();
const listReviewInput = z.object({ manualRunRequestId: requestId.optional(), status: z.enum(["pending", "approved", "rejected", "blocked", "applied", "revoked", "archived"]).optional(), limit: z.number().int().min(1).max(100).optional() }).strict();
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

function store(context: AgentHostMcpContext) { if (!context.scheduler) throw new Error("scheduler_unavailable"); return context.scheduler; }
function fail(tool: string, error: unknown) { const code = error instanceof Error ? error.message : "scheduler_manual_run_request_review_failed"; return toolFailure({ tool, riskLevel: "low", error: { code, message: code.replaceAll("_", " ") }, observations: ["Review metadata only; no execution, run session, replay session, timer, worker, file, notification, message, or token was created."] }); }
function unique(values: string[]) { return [...new Set(values)]; }
function contractHashMatches(contract: { contractHash: string }) { const { contractHash: _ignored, ...body } = contract; return manualRunContractHash(body as never) === contract.contractHash; }
function activationHashMatches(activation: { activationHash: string }) { const { activationHash: _ignored, ...body } = activation; return activationHash(body as never) === activation.activationHash; }
function preflightHashMatches(preflight: ScheduledJobManualRunPreflight) { const { preflightHash: _ignored, ...body } = preflight; return manualRunPreflightHash(body) === preflight.preflightHash; }
function requestHashMatches(request: ScheduledJobManualRunRequest) { const { requestHash: _ignored, ...body } = request; return manualRunRequestHash(body) === request.requestHash; }
function acknowledgementHashMatches(record: { acknowledgementHash: string }) { const { acknowledgementHash: _ignored, ...body } = record; return manualRunAcknowledgementHash(body as never) === record.acknowledgementHash; }
function snapshotHash(snapshot: { status?: string; valid: boolean; requiredGrantIds: string[]; missingGrantIds: string[] }) { return schedulerHash({ status: snapshot.status, valid: snapshot.valid, requiredGrantIds: snapshot.requiredGrantIds, missingGrantIds: snapshot.missingGrantIds }); }
function safeReview(review: ScheduledJobManualRunRequestReview) { return { ...review, blockers: [...review.blockers], warnings: [...review.warnings], futureExecutionControls: { ...review.futureExecutionControls } }; }
function rehashReview(review: ScheduledJobManualRunRequestReview) { const { reviewHash: _ignored, ...body } = review; review.reviewHash = manualRunRequestReviewHash(body); return review; }

type ReviewDependencies = Awaited<ReturnType<typeof reviewDependencies>>;
async function reviewDependencies(context: AgentHostMcpContext, request: ScheduledJobManualRunRequest) {
  const scheduler = store(context);
  const normalized = normalizeManualRunRequest(request);
  const acknowledgement = await scheduler.getManualRunAcknowledgement(normalized.acknowledgementId);
  const storedPreflight = await scheduler.getManualRunPreflight(normalized.preflightId);
  const contract = await scheduler.getManualRunContract(normalized.manualRunContractId);
  const job = await scheduler.getJob(normalized.jobId);
  const activation = contract.activationRequestId === undefined ? undefined : await scheduler.getActivation(contract.activationRequestId).catch(() => undefined);
  const currentPreflight = await evaluateManualRunPreflight(context, normalized.manualRunContractId);
  const blockers: string[] = [];
  const warnings = [...currentPreflight.warnings];
  const add = (condition: boolean, code: string) => { if (condition) blockers.push(code); };
  const activationRequired = context.policy.scheduler?.requireApprovalForJobActivation ?? true;
  add(normalized.status !== "requested", "scheduler_manual_run_request_not_requested");
  add(normalized.approvalStatus === "approval_approved", "scheduler_manual_run_request_already_approved");
  add(normalized.approvalStatus === "approval_rejected" || normalized.approvalStatus === "approval_blocked", "scheduler_manual_run_request_approval_terminal");
  add(normalized.approvalStatus === "approval_revoked", "scheduler_manual_run_request_revoked");
  add(normalized.approvalStatus === "approval_archived" || normalized.status === "archived", "scheduler_manual_run_request_archived");
  add(!requestHashMatches(normalized), "scheduler_manual_run_request_hash_stale");
  add(acknowledgement.status !== "acknowledged", "scheduler_acknowledgement_not_acknowledged");
  add(!acknowledgementHashMatches(acknowledgement), "scheduler_acknowledgement_hash_stale");
  add(acknowledgement.preflightHash !== storedPreflight.preflightHash, "scheduler_acknowledgement_preflight_mismatch");
  add(acknowledgement.contractHash !== contract.contractHash, "scheduler_acknowledgement_contract_mismatch");
  add(acknowledgement.jobHash !== job.jobHash, "scheduler_acknowledgement_job_mismatch");
  add(acknowledgement.readinessHash !== storedPreflight.readinessSnapshot.currentHash, "scheduler_acknowledgement_readiness_mismatch");
  add(storedPreflight.status !== "pass" && storedPreflight.status !== "warn", "scheduler_preflight_not_current");
  add(!preflightHashMatches(storedPreflight), "scheduler_preflight_hash_stale");
  add(contract.status !== "approved", "scheduler_manual_run_contract_not_approved");
  add(!contractHashMatches(contract), "scheduler_manual_run_contract_hash_stale");
  add(job.status !== "approved", "scheduler_manual_run_job_not_approved");
  add(job.status === "disabled", "scheduler_job_disabled");
  add(job.status === "archived", "scheduler_job_archived");
  add(normalized.jobVersion !== job.version || contract.jobVersion !== job.version, "scheduler_manual_run_job_version_stale");
  add(normalized.jobVersion !== contract.jobVersion || normalized.jobId !== contract.jobId, "scheduler_manual_run_request_dependency_mismatch");
  add(contract.jobHash !== job.jobHash || normalized.jobVersion !== job.version, "scheduler_manual_run_job_hash_stale");
  add(activationRequired && (activation === undefined || activation.status !== "activation_approved"), "scheduler_activation_not_approved");
  add(activation !== undefined && (activation.jobId !== job.jobId || activation.jobVersion !== job.version || activation.jobHash !== job.jobHash), "scheduler_activation_dependency_stale");
  add(activation !== undefined && !activationHashMatches(activation), "scheduler_activation_hash_stale");
  add(contract.activationHash !== undefined && activation !== undefined && contract.activationHash !== activation.activationHash, "scheduler_activation_snapshot_stale");
  add(currentPreflight.blockers.some((code) => !PREFLIGHT_EXPECTED_UNSUPPORTED_BLOCKERS.has(code)), "scheduler_manual_run_readiness_blocked");
  add(currentPreflight.status === "blocked", "scheduler_manual_run_preflight_blocked");
  add(storedPreflight.readinessSnapshot.currentHash !== currentPreflight.readinessSnapshot.currentHash, "scheduler_readiness_hash_stale");
  add(storedPreflight.contractSnapshot.hash !== currentPreflight.contractSnapshot.hash, "scheduler_contract_snapshot_stale");
  add(storedPreflight.activationSnapshot.hash !== currentPreflight.activationSnapshot.hash, "scheduler_activation_snapshot_stale");
  add(storedPreflight.grantSnapshot.requiredGrantIds.join("\u0000") !== currentPreflight.grantSnapshot.requiredGrantIds.join("\u0000") || storedPreflight.grantSnapshot.missingGrantIds.join("\u0000") !== currentPreflight.grantSnapshot.missingGrantIds.join("\u0000"), "scheduler_grant_snapshot_stale");
  add(currentPreflight.grantSnapshot.missingGrantIds.length > 0, "scheduler_grant_missing");
  add(contract.missingGrants.length > 0, "scheduler_grant_missing");
  add(job.delivery.kind === "external_send_blocked", "scheduler_external_delivery_blocked");
  add(job.task.dataSensitivity === "secret", "scheduler_secret_task_blocked");
  add(job.task.dataSensitivity === "sensitive" && job.task.requiredGrantIds.length === 0, "scheduler_private_grant_required");
  add(contract.blockers.length > 0, "scheduler_manual_run_contract_blocked");
  const grantSnapshotHash = snapshotHash(currentPreflight.grantSnapshot);
  if (currentPreflight.warnings.length > 0) warnings.push(...currentPreflight.warnings);
  return { normalized, acknowledgement, storedPreflight, contract, job, activation, currentPreflight, blockers: unique(blockers), warnings: unique(warnings), readinessHash: currentPreflight.readinessSnapshot.currentHash, activationSnapshotHash: currentPreflight.activationSnapshot.hash, grantSnapshotHash };
}

function reviewBase(deps: ReviewDependencies, reviewIdValue: string, decision: ScheduledJobManualRunRequestReview["decision"], status: ScheduledJobManualRunRequestReview["status"], now: string, reviewer?: string): Omit<ScheduledJobManualRunRequestReview, "reviewHash"> {
  return { reviewId: reviewIdValue, manualRunRequestId: deps.normalized.manualRunRequestId, acknowledgementId: deps.normalized.acknowledgementId, preflightId: deps.normalized.preflightId, manualRunContractId: deps.normalized.manualRunContractId, jobId: deps.normalized.jobId, jobVersion: deps.job.version, createdAt: now, updatedAt: now, status, decision, requestHash: deps.normalized.requestHash, acknowledgementHash: deps.acknowledgement.acknowledgementHash, preflightHash: deps.storedPreflight.preflightHash, contractHash: deps.contract.contractHash, jobHash: deps.job.jobHash, ...(deps.readinessHash === undefined ? {} : { readinessHash: deps.readinessHash }), ...(deps.activationSnapshotHash === undefined ? {} : { activationHash: deps.activationSnapshotHash }), grantSnapshotHash: deps.grantSnapshotHash, blockers: [...deps.blockers], warnings: [...deps.warnings], futureExecutionControls: { ...deps.contract.futureControls }, ...(reviewer === undefined ? {} : { safeReviewerSummary: "redacted" as const }) };
}

export function createSchedulerManualRunRequestLifecycleTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const review: AgentHostToolDefinition<z.infer<typeof reviewInput>, unknown, AgentHostMcpContext> = { name: "scheduler.manual_run_request_review", description: "Reviews manual-run request approval metadata without execution.", riskLevel: "low", inputSchema: reviewInput, mcpInputSchema: schema({ manualRunRequestId: { type: "string" }, decision: { type: "string" }, reviewer: { type: "string" } }, ["manualRunRequestId", "decision"]), inputSummary: "Review manual-run request approval", auditInputSummary: (value) => `Review manual request ${value.manualRunRequestId}; decision ${value.decision}`, safety: { actionType: "inspect" }, async handler(value, context) { try { const scheduler = store(context); const request = normalizeManualRunRequest(await scheduler.getManualRunRequest(value.manualRunRequestId)); const deps = await reviewDependencies(context, request); const now = new Date().toISOString(); const status: ScheduledJobManualRunRequestReview["status"] = value.decision === "analyze" ? "pending" : value.decision === "reject" ? "rejected" : deps.blockers.length > 0 ? "blocked" : "approved"; const decision = value.decision === "analyze" ? "approve" : value.decision; const base = reviewBase(deps, `manual_run_request_review_${randomUUID()}`, decision, status, now, value.reviewer); const record: ScheduledJobManualRunRequestReview = { ...base, reviewHash: manualRunRequestReviewHash(base) }; if (value.decision === "approve" && ["review_required", "approval_pending"].includes(request.approvalStatus)) { request.approvalStatus = status === "approved" ? "approval_pending" : "approval_blocked"; request.reviewId = record.reviewId; request.updatedAt = now; await scheduler.saveManualRunRequest(request); } else if (value.decision === "reject" && ["review_required", "approval_pending"].includes(request.approvalStatus)) { request.approvalStatus = "approval_rejected"; request.reviewId = record.reviewId; request.updatedAt = now; await scheduler.saveManualRunRequest(request); } await scheduler.saveManualRunRequestReview(record); return toolSuccess({ tool: "scheduler.manual_run_request_review", riskLevel: "low", data: { request: safeRequest(request), review: safeReview(record) }, observations: ["Approval review metadata only; execution remains unauthorized."] }); } catch (error) { return fail("scheduler.manual_run_request_review", error); } } };
  const apply: AgentHostToolDefinition<z.infer<typeof applyInput>, unknown, AgentHostMcpContext> = { name: "scheduler.manual_run_request_apply_review", description: "Applies approved manual-run request metadata only.", riskLevel: "low", inputSchema: applyInput, mcpInputSchema: schema({ reviewId: { type: "string" } }, ["reviewId"]), inputSummary: "Apply manual-run request approval", auditInputSummary: (value) => `Apply manual request review ${value.reviewId}`, safety: { actionType: "inspect" }, async handler(value, context) { try { const scheduler = store(context); const review = await scheduler.getManualRunRequestReview(value.reviewId); if (review.status !== "approved") throw new Error("scheduler_manual_run_request_review_not_approved"); const request = normalizeManualRunRequest(await scheduler.getManualRunRequest(review.manualRunRequestId)); const deps = await reviewDependencies(context, request); if (deps.blockers.length > 0 || review.requestHash !== request.requestHash || review.jobHash !== deps.job.jobHash || !manualRunRequestReviewHashMatches(review)) throw new Error("scheduler_manual_run_request_review_stale"); const now = new Date().toISOString(); request.approvalStatus = "approval_approved"; request.reviewId = review.reviewId; request.approvedAt = now; request.updatedAt = now; await scheduler.saveManualRunRequest(request); review.status = "applied"; review.updatedAt = now; rehashReview(review); await scheduler.saveManualRunRequestReview(review); return toolSuccess({ tool: "scheduler.manual_run_request_apply_review", riskLevel: "low", data: { request: safeRequest(request), review: safeReview(review) }, observations: ["Approval applied as metadata only; execution remains unauthorized."] }); } catch (error) { return fail("scheduler.manual_run_request_apply_review", error); } } };
  const get: AgentHostToolDefinition<z.infer<typeof getReviewInput>, unknown, AgentHostMcpContext> = { name: "scheduler.manual_run_request_review_get", description: "Gets redacted manual-run request review metadata.", riskLevel: "observe", inputSchema: getReviewInput, mcpInputSchema: schema({ reviewId: { type: "string" } }, ["reviewId"]), inputSummary: "Get manual-run request review", auditInputSummary: (value) => `Get manual request review ${value.reviewId}`, safety: { actionType: "observe" }, async handler(value, context) { try { return toolSuccess({ tool: "scheduler.manual_run_request_review_get", riskLevel: "observe", data: { review: safeReview(await store(context).getManualRunRequestReview(value.reviewId)) }, observations: ["Read-only review metadata."] }); } catch (error) { return fail("scheduler.manual_run_request_review_get", error); } } };
  const list: AgentHostToolDefinition<z.infer<typeof listReviewInput>, unknown, AgentHostMcpContext> = { name: "scheduler.manual_run_request_review_list", description: "Lists redacted manual-run request reviews.", riskLevel: "observe", inputSchema: listReviewInput, mcpInputSchema: schema({ manualRunRequestId: { type: "string" }, status: { type: "string" }, limit: { type: "integer" } }), inputSummary: "List manual-run request reviews", auditInputSummary: () => "List manual request reviews", safety: { actionType: "observe" }, async handler(value, context) { try { const reviews = await store(context).listManualRunRequestReviews({ ...(value.manualRunRequestId === undefined ? {} : { manualRunRequestId: value.manualRunRequestId }), ...(value.status === undefined ? {} : { status: value.status }) }); return toolSuccess({ tool: "scheduler.manual_run_request_review_list", riskLevel: "observe", data: { reviews: reviews.slice(0, value.limit ?? 50).map(safeReview) }, observations: ["Read-only review metadata list."] }); } catch (error) { return fail("scheduler.manual_run_request_review_list", error); } } };
  const revoke: AgentHostToolDefinition<z.infer<typeof requestInput>, unknown, AgentHostMcpContext> = { name: "scheduler.manual_run_request_revoke", description: "Revokes approved manual-run request metadata without execution.", riskLevel: "low", inputSchema: requestInput, mcpInputSchema: schema({ manualRunRequestId: { type: "string" }, reviewer: { type: "string" } }, ["manualRunRequestId"]), inputSummary: "Revoke manual-run request approval", auditInputSummary: (value) => `Revoke manual request ${value.manualRunRequestId}`, safety: { actionType: "inspect" }, async handler(value, context) { try { const scheduler = store(context); const request = normalizeManualRunRequest(await scheduler.getManualRunRequest(value.manualRunRequestId)); if (request.approvalStatus === "approval_revoked") return toolSuccess({ tool: "scheduler.manual_run_request_revoke", riskLevel: "low", data: { request: safeRequest(request) }, observations: ["Revocation already recorded; no execution occurred."] }); if (request.approvalStatus !== "approval_approved") throw new Error("scheduler_manual_run_request_not_approved"); const now = new Date().toISOString(); const deps = await reviewDependencies(context, request); const base = reviewBase(deps, `manual_run_request_review_${randomUUID()}`, "revoke", "revoked", now, value.reviewer); const record: ScheduledJobManualRunRequestReview = { ...base, reviewHash: manualRunRequestReviewHash(base) }; request.approvalStatus = "approval_revoked"; request.revoked = true; request.revokedAt = now; request.reviewId = record.reviewId; request.updatedAt = now; await scheduler.saveManualRunRequest(request); await scheduler.saveManualRunRequestReview(record); return toolSuccess({ tool: "scheduler.manual_run_request_revoke", riskLevel: "low", data: { request: safeRequest(request), review: safeReview(record) }, observations: ["Approval revoked; no receipt, token, session, or execution was created."] }); } catch (error) { return fail("scheduler.manual_run_request_revoke", error); } } };
  const archive: AgentHostToolDefinition<z.infer<typeof getReviewInput>, unknown, AgentHostMcpContext> = { name: "scheduler.manual_run_request_review_archive", description: "Archives terminal manual-run request review metadata.", riskLevel: "low", inputSchema: getReviewInput, mcpInputSchema: schema({ reviewId: { type: "string" } }, ["reviewId"]), inputSummary: "Archive manual-run request review", auditInputSummary: (value) => `Archive manual request review ${value.reviewId}`, safety: { actionType: "inspect" }, async handler(value, context) { try { const scheduler = store(context); const review = await scheduler.getManualRunRequestReview(value.reviewId); if (review.status === "archived") return toolSuccess({ tool: "scheduler.manual_run_request_review_archive", riskLevel: "low", data: { review: safeReview(review) }, observations: ["Review already archived; no execution occurred."] }); if (!["approved", "rejected", "blocked", "applied", "revoked"].includes(review.status)) throw new Error("scheduler_manual_run_request_review_not_terminal"); const request = normalizeManualRunRequest(await scheduler.getManualRunRequest(review.manualRunRequestId)); const now = new Date().toISOString(); review.status = "archived"; review.decision = "archive"; review.updatedAt = now; review.archivedAt = now; rehashReview(review); request.approvalStatus = "approval_archived"; request.approvalArchivedAt = now; request.updatedAt = now; await scheduler.saveManualRunRequest(request); await scheduler.saveManualRunRequestReview(review); return toolSuccess({ tool: "scheduler.manual_run_request_review_archive", riskLevel: "low", data: { request: safeRequest(request), review: safeReview(review) }, observations: ["Review archived; records preserved and execution remains unsupported."] }); } catch (error) { return fail("scheduler.manual_run_request_review_archive", error); } } };
  return [review, apply, get, list, revoke, archive];
}
