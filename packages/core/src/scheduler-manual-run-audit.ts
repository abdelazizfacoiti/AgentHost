import { schedulerHash } from "./scheduler.js";
import { MANUAL_RUN_PREFLIGHT_ACKNOWLEDGEMENTS } from "./scheduler-manual-run-preflight.js";
import type { ScheduledJobManualRunAcknowledgement, ScheduledJobManualRunRequest } from "./types.js";

export const MANUAL_RUN_ACKNOWLEDGEMENT_IDS = MANUAL_RUN_PREFLIGHT_ACKNOWLEDGEMENTS.map((item) => item.acknowledgementId);

export function manualRunAcknowledgementHash(input: Omit<ScheduledJobManualRunAcknowledgement, "acknowledgementHash">): string {
  return schedulerHash({ acknowledgementId: input.acknowledgementId, preflightId: input.preflightId, manualRunContractId: input.manualRunContractId, jobId: input.jobId, jobVersion: input.jobVersion, status: input.status, acknowledgedItems: input.acknowledgedItems, missingAcknowledgements: input.missingAcknowledgements, operatorIntentSummary: input.operatorIntentSummary, preflightHash: input.preflightHash, contractHash: input.contractHash, jobHash: input.jobHash, readinessHash: input.readinessHash, blockers: input.blockers, warnings: input.warnings, executable: false, actionsExecuted: false, confirmationTokensCreated: false });
}

export function manualRunRequestHash(input: Omit<ScheduledJobManualRunRequest, "requestHash">): string {
  return schedulerHash({ manualRunRequestId: input.manualRunRequestId, acknowledgementId: input.acknowledgementId, preflightId: input.preflightId, manualRunContractId: input.manualRunContractId, jobId: input.jobId, jobVersion: input.jobVersion, status: input.status, requestMode: "audit_only", manualRunRequestSupported: input.manualRunRequestSupported, executable: false, runSessionCreated: false, replaySessionCreated: false, actionsExecuted: false, confirmationTokensCreated: false, requiredFutureControls: input.requiredFutureControls, blockers: input.blockers, warnings: input.warnings });
}

export function missingManualRunAcknowledgements(acknowledgedItems: string[]): string[] {
  const set = new Set(acknowledgedItems);
  return MANUAL_RUN_ACKNOWLEDGEMENT_IDS.filter((id) => !set.has(id));
}
