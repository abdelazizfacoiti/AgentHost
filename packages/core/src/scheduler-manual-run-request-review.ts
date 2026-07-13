import { schedulerHash } from "./scheduler.js";
import type { ScheduledJobManualRunRequest, ScheduledJobManualRunRequestReview } from "./types.js";

export function legacyManualRunApprovalStatus(status: ScheduledJobManualRunRequest["status"]): ScheduledJobManualRunRequest["approvalStatus"] {
  if (status === "blocked") return "approval_blocked";
  if (status === "rejected") return "approval_rejected";
  if (status === "archived") return "approval_archived";
  return "review_required";
}

export function manualRunRequestApprovalDefaults(input: Partial<ScheduledJobManualRunRequest> & Pick<ScheduledJobManualRunRequest, "status">) {
  return {
    approvalStatus: input.approvalStatus ?? legacyManualRunApprovalStatus(input.status),
    approvalMode: "review_only" as const,
    executionAuthorized: false as const,
    executable: false as const,
    runSessionCreated: false as const,
    replaySessionCreated: false as const,
    actionsExecuted: false as const,
    confirmationTokensCreated: false as const,
    ...(input.reviewId === undefined ? {} : { reviewId: input.reviewId }),
    revoked: input.revoked ?? false,
    ...(input.approvedAt === undefined ? {} : { approvedAt: input.approvedAt }),
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    ...(input.approvalDependencySnapshot === undefined ? {} : { approvalDependencySnapshot: input.approvalDependencySnapshot }),
    ...(input.approvalPolicyHash === undefined ? {} : { approvalPolicyHash: input.approvalPolicyHash }),
    ...(input.revokedAt === undefined ? {} : { revokedAt: input.revokedAt }),
    ...(input.approvalArchivedAt === undefined ? {} : { approvalArchivedAt: input.approvalArchivedAt })
  };
}

export function manualRunRequestReviewHash(input: Omit<ScheduledJobManualRunRequestReview, "reviewHash">): string {
  return schedulerHash({
    reviewId: input.reviewId,
    manualRunRequestId: input.manualRunRequestId,
    acknowledgementId: input.acknowledgementId,
    preflightId: input.preflightId,
    manualRunContractId: input.manualRunContractId,
    jobId: input.jobId,
    jobVersion: input.jobVersion,
    status: input.status,
    decision: input.decision,
    requestHash: input.requestHash,
    acknowledgementHash: input.acknowledgementHash,
    preflightHash: input.preflightHash,
    contractHash: input.contractHash,
    jobHash: input.jobHash,
    readinessHash: input.readinessHash,
    activationHash: input.activationHash,
    grantSnapshotHash: input.grantSnapshotHash,
    blockers: input.blockers,
    warnings: input.warnings,
    futureExecutionControls: input.futureExecutionControls
  });
}

export function manualRunRequestReviewHashMatches(review: ScheduledJobManualRunRequestReview): boolean {
  const { reviewHash: _ignored, ...body } = review;
  return manualRunRequestReviewHash(body) === review.reviewHash;
}
