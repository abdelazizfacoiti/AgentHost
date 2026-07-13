import { schedulerHash, schedulerPolicy } from "./scheduler.js";
import type { PolicyProfile, ScheduledJobActivationPolicySnapshot, ScheduledJobActivationRequest, ScheduledJobActivationReview, ScheduledJobFutureExecutionControls, ScheduledJobReadiness, ScheduledJobSpec } from "./types.js";

export const FUTURE_EXECUTION_CONTROLS: ScheduledJobFutureExecutionControls = { visibleLifecycleRequired: true, cancellationRequired: true, pauseDisableRequired: true, runReceiptsRequired: true, auditLogsRequired: true, freshGrantsRequired: true, dryRunBeforeRunRequired: true, confirmationForStateChangingRequired: true, checkpointVerificationRequired: true, stopOnFailureRequired: true, noRetryByDefault: true, noHiddenBackgroundWork: true };

export function activationPolicySnapshot(policy: PolicyProfile): ScheduledJobActivationPolicySnapshot {
  const value = schedulerPolicy(policy);
  return { allowSchedulerSpecs: value.allowSchedulerSpecs, allowJobActivation: value.allowJobActivation, allowScheduledExecution: value.allowScheduledExecution, allowBackgroundWorkers: value.allowBackgroundWorkers, allowExternalDelivery: value.allowExternalDelivery, allowNotifications: value.allowNotifications, requireReviewForActivation: value.requireReviewForActivation, requireApprovalForJobActivation: value.requireApprovalForJobActivation, requireExplicitUserActivation: value.requireExplicitUserActivation };
}

export function activationReadinessSummary(readiness: ScheduledJobReadiness): ScheduledJobActivationRequest["readinessSummary"] {
  return { jobStatus: readiness.jobStatus, scheduleValid: readiness.scheduleValid, taskValid: readiness.taskValid, deliveryValid: readiness.deliveryValid, grantsSatisfied: readiness.grantsSatisfied, requiredGrants: [...readiness.requiredGrants], missingGrants: [...readiness.missingGrants], blockers: readiness.blockers.map((item) => ({ code: item.code, message: item.message })), warnings: [...readiness.warnings] };
}

export function activationReadinessSnapshotHash(job: ScheduledJobSpec, readiness: ScheduledJobReadiness, policy: PolicyProfile): string {
  return schedulerHash({ jobId: job.jobId, jobVersion: job.version, jobHash: job.jobHash, readiness: activationReadinessSummary(readiness), policy: activationPolicySnapshot(policy), futureExecutionControls: FUTURE_EXECUTION_CONTROLS });
}

export function activationHash(request: Omit<ScheduledJobActivationRequest, "activationHash">): string {
  return schedulerHash({ activationRequestId: request.activationRequestId, jobId: request.jobId, jobVersion: request.jobVersion, jobHash: request.jobHash, status: request.status, readinessSnapshotHash: request.readinessSnapshotHash, activationPolicySnapshot: request.activationPolicySnapshot, requiredGrants: request.requiredGrants, missingGrants: request.missingGrants, blockers: request.blockers, futureExecutionControls: request.futureExecutionControls, executable: request.executable, scheduledExecutionEnabled: request.scheduledExecutionEnabled, actualExecutionSupported: request.actualExecutionSupported });
}

export function activationBlockers(readiness: ScheduledJobReadiness): string[] {
  return [...new Set(readiness.blockers.map((item) => item.code))];
}

export function activationReviewRecord(input: { reviewId: string; request: ScheduledJobActivationRequest; action: ScheduledJobActivationReview["action"]; status: ScheduledJobActivationReview["status"]; readiness: ScheduledJobReadiness; policyFindings: string[]; reviewer?: string; now: string }): ScheduledJobActivationReview {
  return { reviewId: input.reviewId, activationRequestId: input.request.activationRequestId, jobId: input.request.jobId, action: input.action, status: input.status, createdAt: input.now, updatedAt: input.now, jobVersion: input.request.jobVersion, jobHash: input.request.jobHash, activationHash: input.request.activationHash, beforeSummary: { status: input.request.status, jobVersion: input.request.jobVersion }, afterSummary: { status: input.status, executable: false, scheduledExecutionEnabled: false, actualExecutionSupported: false }, readinessSummary: activationReadinessSummary(input.readiness), policyFindings: [...input.policyFindings], requiredGrants: [...input.readiness.requiredGrants], missingGrants: [...input.readiness.missingGrants], blockedReasons: activationBlockers(input.readiness), ...(input.reviewer === undefined ? {} : { reviewer: "redacted" }) };
}
