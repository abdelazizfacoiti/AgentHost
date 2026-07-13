import { schedulerHash } from "./scheduler.js";
import type { ScheduledJobFutureExecutionControls, ScheduledJobManualRunPreflight, ScheduledJobManualRunPreflightAcknowledgement, ScheduledJobManualRunPreflightSnapshot } from "./types.js";

export const MANUAL_RUN_PREFLIGHT_ACKNOWLEDGEMENTS: ScheduledJobManualRunPreflightAcknowledgement[] = [
  { acknowledgementId: "visible_local_run", statement: "I understand this is a visible local operator run only.", required: true, acknowledged: false },
  { acknowledgementId: "no_hidden_background", statement: "I understand hidden background execution is not allowed.", required: true, acknowledged: false },
  { acknowledgementId: "fresh_grants", statement: "I understand grants must be checked again at run time.", required: true, acknowledged: false },
  { acknowledgementId: "dryrun_confirmation", statement: "I understand state-changing steps require dry-run and confirmation.", required: true, acknowledged: false },
  { acknowledgementId: "delivery_restrictions", statement: "I understand delivery remains local or draft-only unless a future policy explicitly allows it.", required: true, acknowledged: false },
  { acknowledgementId: "stop_on_failure", statement: "I understand stop-on-failure is enforced.", required: true, acknowledged: false },
  { acknowledgementId: "no_retry", statement: "I understand retry is disabled by default.", required: true, acknowledged: false },
  { acknowledgementId: "cancellable", statement: "I understand the future run must remain cancellable before execution.", required: true, acknowledged: false },
  { acknowledgementId: "audit_logs", statement: "I understand audit logs are required for any future execution phase.", required: true, acknowledged: false },
  { acknowledgementId: "receipts", statement: "I understand original-tool receipts are required for any future execution phase.", required: true, acknowledged: false },
  { acknowledgementId: "checkpoints", statement: "I understand checkpoints are required to prove semantic success.", required: true, acknowledged: false }
];

export const PREFLIGHT_EXPECTED_UNSUPPORTED_BLOCKERS = new Set(["execution_unsupported", "activation_unsupported", "scheduler_execution_unsupported", "scheduler_activation_unsupported"]);

export function preflightSnapshot(input: Omit<ScheduledJobManualRunPreflightSnapshot, "redacted">): ScheduledJobManualRunPreflightSnapshot {
  return { ...input, redacted: true };
}

export function manualRunPreflightHash(input: Omit<ScheduledJobManualRunPreflight, "preflightHash">): string {
  return schedulerHash({
    preflightId: input.preflightId,
    manualRunContractId: input.manualRunContractId,
    jobId: input.jobId,
    jobVersion: input.jobVersion,
    activationId: input.activationId,
    status: input.status,
    readinessSnapshot: input.readinessSnapshot,
    activationSnapshot: input.activationSnapshot,
    contractSnapshot: input.contractSnapshot,
    grantSnapshot: input.grantSnapshot,
    deliverySnapshot: input.deliverySnapshot,
    futureControlsSnapshot: input.futureControlsSnapshot,
    requiredOperatorAcknowledgements: input.requiredOperatorAcknowledgements,
    blockers: input.blockers,
    warnings: input.warnings,
    recommendedNextAction: input.recommendedNextAction,
    executable: false,
    canRequestManualRun: input.canRequestManualRun,
    actionsExecuted: false,
    confirmationTokensCreated: false,
    manualRunSupported: false,
    scheduledExecutionEnabled: false,
    backgroundExecution: false
  });
}

export function futureControlsSnapshot(controls: ScheduledJobFutureExecutionControls): ScheduledJobManualRunPreflightSnapshot {
  const missing = Object.entries(controls).filter(([, value]) => value !== true).map(([key]) => key);
  return preflightSnapshot({ valid: missing.length === 0, status: "future_only", blockerCodes: [], warningCodes: missing.length === 0 ? ["future_execution_controls_only"] : ["future_control_missing"], requiredGrantIds: [], missingGrantIds: missing, controlStates: Object.fromEntries(Object.entries(controls).map(([key, value]) => [key, value === true])) });
}
