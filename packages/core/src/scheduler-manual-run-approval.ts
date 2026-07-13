import { schedulerHash } from "./scheduler.js";
import type { PolicyProfile, ScheduledJobManualRunApprovalDependencySnapshot, ScheduledJobManualRunApprovalRecoveryAction, ScheduledJobManualRunApprovalStaleDependency, ScheduledJobManualRunApprovalValidity, ScheduledJobManualRunRequest } from "./types.js";
import { schedulerPolicy } from "./scheduler.js";

export const MANUAL_RUN_APPROVAL_TTL_SECONDS = 900;
export const MANUAL_RUN_APPROVAL_EXPIRY_WARNING_SECONDS = 300;

export function manualRunApprovalPolicyHash(profile: PolicyProfile): string {
  const policy = schedulerPolicy(profile);
  return schedulerHash({ manualRunApprovalTtlSeconds: policy.manualRunApprovalTtlSeconds, manualRunApprovalExpiryWarningSeconds: policy.manualRunApprovalExpiryWarningSeconds, requireFreshApprovalAtExecution: policy.requireFreshApprovalAtExecution, requireFullRevalidationAfterExpiry: policy.requireFullRevalidationAfterExpiry, allowAutomaticRefresh: policy.allowAutomaticRefresh });
}

export function approvalDependencySnapshotHash(snapshot: ScheduledJobManualRunApprovalDependencySnapshot): string {
  const { capturedAt: _capturedAt, ...stable } = snapshot;
  return schedulerHash(stable);
}

export function recoveryActionsFor(dependencies: string[], status: ScheduledJobManualRunApprovalValidity["validityStatus"]): ScheduledJobManualRunApprovalRecoveryAction[] {
  const actions: ScheduledJobManualRunApprovalRecoveryAction[] = [];
  const add = (code: string, summary: string) => { if (!actions.some((item) => item.code === code)) actions.push({ code, summary, requiresNewApproval: true }); };
  if (status === "expired" || dependencies.includes("scheduler_approval_metadata_missing")) add("rebuild_approval_chain", "Rebuild preflight, acknowledgement, request, and review chain.");
  if (dependencies.some((item) => item.includes("job") || item.includes("contract"))) add("recreate_contract_chain", "Recreate contract and downstream review records from current job metadata.");
  if (dependencies.some((item) => item.includes("grant") || item.includes("readiness"))) add("recheck_grants_readiness", "Reacquire or recheck grants and rerun downstream readiness checks.");
  if (dependencies.some((item) => item.includes("activation"))) add("recreate_activation_chain", "Create a new activation lifecycle after current readiness review.");
  if (status === "revoked" || status === "archived" || dependencies.some((item) => item.includes("approval"))) add("create_fresh_request", "Create a fresh manual-run request lifecycle; historical records remain unchanged.");
  if (status === "stale" && dependencies.some((item) => /request|acknowledgement|preflight|review/.test(item))) add("create_fresh_request", "Create a fresh manual-run request lifecycle after current checks.");
  if (actions.length === 0 && status !== "valid" && status !== "expiring_soon") add("review_blockers", "Review redacted blockers before any new approval request.");
  return actions;
}

export function classifyApprovalValidity(input: { request: ScheduledJobManualRunRequest; now?: Date; staleDependencies?: ScheduledJobManualRunApprovalStaleDependency[]; blockers?: string[]; warnings?: string[]; policy: { manualRunApprovalExpiryWarningSeconds: number } }): ScheduledJobManualRunApprovalValidity {
  const now = input.now ?? new Date();
  const evaluatedAt = now.toISOString();
  const staleDependencies = input.staleDependencies ?? [];
  const blockers = [...new Set(input.blockers ?? [])];
  const warnings = [...new Set(input.warnings ?? [])];
  const revoked = input.request.approvalStatus === "approval_revoked" || input.request.revoked;
  const archived = input.request.approvalStatus === "approval_archived" || input.request.status === "archived";
  const blocked = input.request.approvalStatus === "approval_blocked" || input.request.status === "blocked" || blockers.length > 0;
  const approvedAtMs = input.request.approvedAt === undefined ? undefined : Date.parse(input.request.approvedAt);
  const expiresAtMs = input.request.expiresAt === undefined ? undefined : Date.parse(input.request.expiresAt);
  const missingApprovalMetadata = input.request.approvalStatus === "approval_approved" && (approvedAtMs === undefined || Number.isNaN(approvedAtMs) || expiresAtMs === undefined || Number.isNaN(expiresAtMs) || input.request.approvalDependencySnapshot === undefined);
  let validityStatus: ScheduledJobManualRunApprovalValidity["validityStatus"] = "stale";
  let remainingSeconds: number | undefined;
  if (archived) validityStatus = "archived";
  else if (revoked) validityStatus = "revoked";
  else if (blocked) validityStatus = "blocked";
  else if (input.request.approvalStatus !== "approval_approved") validityStatus = "stale";
  else if (missingApprovalMetadata || staleDependencies.length > 0) validityStatus = "stale";
  else if (expiresAtMs !== undefined && now.getTime() >= expiresAtMs) validityStatus = "expired";
  else if (expiresAtMs !== undefined) {
    remainingSeconds = Math.max(0, Math.floor((expiresAtMs - now.getTime()) / 1000));
    validityStatus = remainingSeconds <= input.policy.manualRunApprovalExpiryWarningSeconds ? "expiring_soon" : "valid";
    if (validityStatus === "expiring_soon") warnings.push("scheduler_approval_expiring_soon");
  }
  if (missingApprovalMetadata) blockers.push("scheduler_approval_metadata_missing");
  const recoveryActions = recoveryActionsFor([...staleDependencies.map((item) => item.reasonCode), ...blockers], validityStatus);
  return { manualRunRequestId: input.request.manualRunRequestId, ...(input.request.reviewId === undefined ? {} : { reviewId: input.request.reviewId }), approvalStatus: input.request.approvalStatus, validityStatus, evaluatedAt, ...(input.request.approvedAt === undefined ? {} : { approvedAt: input.request.approvedAt }), ...(input.request.expiresAt === undefined ? {} : { expiresAt: input.request.expiresAt }), ...(remainingSeconds === undefined ? {} : { remainingSeconds }), freshnessValid: validityStatus === "valid" || validityStatus === "expiring_soon", hashesValid: staleDependencies.length === 0, grantsValid: !staleDependencies.some((item) => item.name === "grants"), readinessValid: !staleDependencies.some((item) => item.name === "readiness"), activationValid: !staleDependencies.some((item) => item.name === "activation"), contractValid: !staleDependencies.some((item) => item.name === "contract"), preflightValid: !staleDependencies.some((item) => item.name === "preflight"), acknowledgementValid: !staleDependencies.some((item) => item.name === "acknowledgement"), jobValid: !staleDependencies.some((item) => item.name === "job"), stale: validityStatus === "stale" || validityStatus === "expired", revoked, blockers: [...new Set(blockers)], warnings: [...new Set(warnings)], staleDependencies, recoveryActions, recommendedNextAction: recoveryActions[0]?.summary ?? (validityStatus === "valid" || validityStatus === "expiring_soon" ? "No approval recovery needed; execution remains unsupported." : "Review approval diagnostics."), executionAuthorized: false, executable: false, actionsExecuted: false, confirmationTokensCreated: false };
}
