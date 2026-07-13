export const RISK_LEVELS = ["observe", "low", "medium", "high", "blocked"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const APPROVAL_STATUSES = [
  "not_required",
  "required",
  "approved",
  "denied",
  "expired"
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const AUTOMATION_STRATEGIES = [
  "app_adapter",
  "official_api",
  "cli_or_script",
  "browser_automation",
  "accessibility",
  "gui_control",
  "guide_only"
] as const;
export type AutomationStrategy = (typeof AUTOMATION_STRATEGIES)[number];

export const APP_SENSITIVITIES = [
  "normal",
  "communication",
  "financial",
  "credential_or_security",
  "system_settings",
  "unknown"
] as const;
export type AppSensitivity = (typeof APP_SENSITIVITIES)[number];

export const ACTION_TYPES = [
  "observe",
  "inspect",
  "app_launch",
  "shell_command",
  "file_read",
  "file_write",
  "file_delete",
  "gui_click",
  "gui_type",
  "accessibility_action",
  "accessibility_set_value",
  "accessibility_focus",
  "browser_action",
  "communication_send",
  "upload",
  "system_change",
  "unknown"
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const WORKFLOW_TRACE_STATUSES = ["active", "stopped", "failed", "archived"] as const;
export type WorkflowTraceStatus = (typeof WORKFLOW_TRACE_STATUSES)[number];
export const WORKFLOW_SKILL_STATUSES = ["draft", "active", "archived"] as const;
export type WorkflowSkillStatus = (typeof WORKFLOW_SKILL_STATUSES)[number];
export const WORKFLOW_STRATEGIES = ["browser", "desktop", "pointer", "accessibility", "file", "shell", "app_adapter", "official_api", "guide", "forge_runtime", "unknown"] as const;
export type WorkflowStrategy = (typeof WORKFLOW_STRATEGIES)[number];
export const WORKFLOW_STEP_ACTIONS = ["open_url", "open_app", "wait_for_state", "find_element", "click_element", "fill_text_redacted", "extract_text_redacted", "accessibility_action", "pointer_action", "file_operation", "shell_operation", "adapter_action", "forge_runtime_action", "checkpoint", "guide_step", "tool_action"] as const;
export type WorkflowStepAction = (typeof WORKFLOW_STEP_ACTIONS)[number];
export const WORKFLOW_CHECKPOINT_KINDS = ["url_contains", "page_text_appears", "browser_element_exists", "active_browser_tab_matches", "app_window_active", "accessibility_element_exists", "file_exists", "directory_exists", "command_succeeded", "output_artifact_exists", "form_field_exists", "app_category_matches", "manual"] as const;
export type WorkflowCheckpointKind = (typeof WORKFLOW_CHECKPOINT_KINDS)[number];

export const DATA_SENSITIVITIES = ["none", "low", "sensitive", "secret"] as const;
export type DataSensitivity = (typeof DATA_SENSITIVITIES)[number];

export const VISION_MODES = ["ocr", "layout", "target_search"] as const;
export type VisionMode = (typeof VISION_MODES)[number];
export type VisionMatchMode = "exact" | "contains" | "fuzzy";
export interface VisionBounds { x: number; y: number; width: number; height: number; }
export interface VisionPoint { x: number; y: number; }
export interface VisionTextItem { id: string; text: string; redactedText: string; bounds: VisionBounds; center: VisionPoint; confidence: number; kind: "text"; page: number; block: number; paragraph: number; line: number; redacted: boolean; }
export interface VisionTextGroup { id: string; text: string; bounds: VisionBounds; center: VisionPoint; confidence: number; matchedTextIds: string[]; }
export interface VisionTargetCandidate { candidateId: string; label: string; kind: "text" | "button_candidate" | "input_candidate" | "region"; bounds: VisionBounds; center: VisionPoint; coordinateSpace: "image"; confidence: number; reason: string; matchedTextIds: string[]; riskHint: "normal" | "medium" | "high"; }
export interface VisionGroundingResult { supported: boolean; backend: "tesseract" | "unavailable"; mode: VisionMode; image?: { width: number; height: number; source: "agenthost_screenshot" | "agenthost_output" | "granted_path"; basename: string; pathRedacted: true; }; textItems: VisionTextItem[]; groups: VisionTextGroup[]; targetCandidates: VisionTargetCandidate[]; warnings: string[]; redactionCounts: Record<string, number>; truncated: boolean; reason: string; }
export const CHECKPOINT_KINDS = ["browser_url_contains", "browser_text_appears_redacted", "browser_element_exists", "browser_element_missing", "accessibility_element_exists", "accessibility_element_missing", "active_window_matches", "active_window_title_contains", "file_exists", "file_missing", "output_artifact_exists", "vision_text_appears", "vision_text_missing", "vision_target_exists", "manual_check"] as const;
export type CheckpointKind = (typeof CHECKPOINT_KINDS)[number];
export type CheckpointStrategy = "browser" | "accessibility" | "vision" | "file" | "desktop" | "manual";
export type CheckpointSensitivity = "public" | "private" | "secret";
export type CheckpointStatus = "passed" | "failed" | "unknown" | "timeout" | "blocked";
export interface CheckpointEvidenceSummary { source: CheckpointStrategy; matched?: boolean; count?: number; confidence?: number; summary: string; }
export interface Checkpoint { checkpointId?: string; kind: CheckpointKind; description: string; sensitivity: CheckpointSensitivity; expected: Record<string, unknown>; timeoutMs?: number; pollIntervalMs?: number; }
export interface CheckpointResult { checkpointId: string; kind: CheckpointKind; strategy: CheckpointStrategy; status: CheckpointStatus; description: string; evidence: CheckpointEvidenceSummary; blockedReasons: string[]; warnings: string[]; durationMs: number; }

export const TOOL_FORGE_MANIFEST_KINDS = ["tool", "adapter", "skill", "workflow"] as const;
export type ToolForgeManifestKind = (typeof TOOL_FORGE_MANIFEST_KINDS)[number];

export const TOOL_FORGE_MANIFEST_SOURCES = ["generated", "user", "built-in"] as const;
export type ToolForgeManifestSource = (typeof TOOL_FORGE_MANIFEST_SOURCES)[number];

export const PERMISSION_DEFAULTS = ["allow", "approval_required", "deny", "guide_only"] as const;
export type PermissionDefault = (typeof PERMISSION_DEFAULTS)[number];

export const GRANT_EFFECTS = ["allow", "deny", "guide_only"] as const;
export type GrantEffect = (typeof GRANT_EFFECTS)[number];

export const GRANT_SCOPES = ["session", "persistent"] as const;
export type GrantScope = (typeof GRANT_SCOPES)[number];

export type PolicyProfileName =
  | "strict"
  | "dev"
  | "gui-dev"
  | "demo-unlocked-local"
  | "private-data"
  | "autopilot-future-disabled-by-default";

export interface ApprovalInfo {
  required: boolean;
  status: ApprovalStatus;
  reason?: string;
}

export interface ToolError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  tool: string;
  riskLevel: RiskLevel;
  strategy?: AutomationStrategy;
  preview?: boolean;
  confirmation?: ToolConfirmationInfo;
  receipt?: ToolResultReceipt;
  grantDecision?: GrantDecision;
  approval: ApprovalInfo;
  data: T | null;
  observations: string[];
  error: ToolError | null;
}

export type ToolResultReceiptStatus = "preview" | "executed" | "failed" | "blocked";
export interface ToolResultReceiptPayload { receiptId: string; sessionId: string; tool: string; createdAt: string; expiresAt: string; resultFingerprint: string; inputFingerprint?: string; targetFingerprint?: string; riskLevel: RiskLevel; preview: boolean; confirmationStatus?: ConfirmationStatus; executionStatus: ToolResultReceiptStatus; replayBinding?: { replaySessionId: string; preparedStepId: string; prepareId: string; stepIndex: number; }; }
export interface ToolResultReceipt extends ToolResultReceiptPayload { receiptSignature: string; }
export interface ToolResultReceiptVerification { ok: boolean; reason: string; receipt?: ToolResultReceipt; }

export interface WorkflowSafetyDecisionSummary {
  allowed: boolean;
  blocked: boolean;
  guideOnly: boolean;
  matchedRules: string[];
  requiresDryRun: boolean;
  requiresConfirmationToken: boolean;
  requiresApproval: boolean;
  requiresExactTarget: boolean;
}

export interface WorkflowCheckpoint {
  checkpointId: string;
  sourceStepId?: string;
  kind: WorkflowCheckpointKind;
  expectationSummary: string;
  status: "pending" | "passed" | "failed" | "manual_required";
  resultSummary?: string;
  checkedAt?: string;
  reusable: boolean;
}

export interface WorkflowTraceStep {
  stepId: string;
  timestamp: string;
  tool: string;
  strategy: WorkflowStrategy;
  actionType: WorkflowStepAction;
  riskLevel: RiskLevel;
  appCategory?: string;
  appSensitivity?: AppSensitivity;
  inputSummary: string;
  outputSummary: string;
  preview: boolean;
  ok: boolean;
  errorSummary?: string;
  checkpointResult?: WorkflowCheckpoint;
  requiredGrantIds?: string[];
  safetyDecision?: WorkflowSafetyDecisionSummary;
}

export interface WorkflowTrace {
  traceId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  status: WorkflowTraceStatus;
  appCategories: string[];
  strategiesUsed: WorkflowStrategy[];
  steps: WorkflowTraceStep[];
  checkpoints: WorkflowCheckpoint[];
  requiredGrants: string[];
  safetyNotes: string[];
  summary?: string;
  sessionId?: string;
  stoppedAt?: string;
  archivedAt?: string;
  truncated?: boolean;
  droppedStepCount?: number;
}

export interface WorkflowSkillParameter {
  name: string;
  type: "string" | "number" | "boolean" | "json";
  required: boolean;
  sensitive: boolean;
  description?: string;
  usedByStepIds: string[];
}

export interface WorkflowSkillStep {
  stepId: string;
  tool: string;
  strategy: WorkflowStrategy;
  actionType: WorkflowStepAction;
  riskLevel: RiskLevel;
  inputSummary: string;
  checkpointIds: string[];
  requiredGrantIds: string[];
  requiresConfirmation: boolean;
  blocked: boolean;
  blockedReason?: string;
}

/** Reviewable, non-executable semantic checkpoint definition for a workflow skill. */
export interface WorkflowCheckpointTemplate {
  templateId: string;
  name: string;
  description: string;
  kind: CheckpointKind;
  strategy: CheckpointStrategy;
  sensitivity: CheckpointSensitivity;
  /** JSON values may use only {{declaredParameterName}} interpolation in strings. */
  expectedTemplate: Record<string, unknown>;
  parameters: string[];
  requiredGrants: string[];
  safetyNotes: string[];
  timeoutMs?: number;
  pollIntervalMs?: number;
  redactionPolicy?: "summary_only" | "counts_only";
  /** Phase 32 local review lifecycle. Missing legacy values normalize to review_required. */
  status?: "draft" | "review_required" | "approved" | "rejected" | "archived";
  version?: number;
  createdAt?: string;
  updatedAt?: string;
  approvedAt?: string;
  archivedAt?: string;
  templateHash?: string;
  reviewId?: string;
  changeSummary?: string;
}

export type WorkflowCheckpointTemplateReviewStatus = "pending" | "approved" | "rejected" | "blocked" | "applied" | "archived";
export type WorkflowCheckpointTemplateReviewAction = "create" | "update" | "approve" | "reject" | "archive";

/** Local, redacted review metadata. Candidate template stays internal to workflow storage. */
export interface WorkflowCheckpointTemplateReview {
  reviewId: string;
  skillId: string;
  templateId: string;
  action: WorkflowCheckpointTemplateReviewAction;
  createdAt: string;
  updatedAt: string;
  status: WorkflowCheckpointTemplateReviewStatus;
  version: number;
  templateHash: string;
  beforeSummary?: Record<string, unknown>;
  afterSummary: Record<string, unknown>;
  safetyFindings: string[];
  requiredGrantsSummary: string[];
  blockedReasons: string[];
  reviewer?: string;
}

export interface WorkflowSkill {
  skillId: string;
  name: string;
  description: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  status: WorkflowSkillStatus;
  supportedStrategies: WorkflowStrategy[];
  appCategories: string[];
  parameters: WorkflowSkillParameter[];
  steps: WorkflowSkillStep[];
  checkpoints: WorkflowCheckpoint[];
  /** Optional for backward-compatible persisted Phase 27 skills. */
  checkpointTemplates?: WorkflowCheckpointTemplate[];
  requiredGrants: string[];
  safetyRestrictions: string[];
  blockedActions: string[];
  sourceTraceId: string;
  archivedAt?: string;
}

export interface WorkflowSkillDryRunResult {
  skillId: string;
  version: number;
  executable: false;
  requiredGrants: string[];
  missingGrantIds: string[];
  steps: WorkflowSkillStep[];
  blockedSteps: WorkflowSkillStep[];
  confirmationStepIds: string[];
  safetyRestrictions: string[];
  missingParameters: string[];
  checkpointTemplates?: Array<{
    templateId: string;
    kind: CheckpointKind;
    strategy: CheckpointStrategy;
    sensitivity: CheckpointSensitivity;
    requiredGrants: string[];
    parameterNames: string[];
    blocked: boolean;
    blockedReasons: string[];
  }>;
}

export interface WorkflowSkillReplayBlocker { code: string; stepId?: string; templateId?: string; message: string; }
export interface WorkflowSkillReplayGrantSummary { grantId: string; active: boolean; source: "skill" | "step" | "checkpoint"; }
export interface WorkflowSkillReplayStepPreview {
  stepId: string; sourceStepId: string; order: number; tool: string; strategy: WorkflowStrategy; actionType: WorkflowStepAction; riskLevel: RiskLevel;
  stateChanging: boolean; wouldRequireDryRun: boolean; wouldRequireConfirmation: boolean; requiredGrants: string[];
  blocked: boolean; blockedReasons: string[]; inputSummary: string; expectedOutputSummary: string; parameterBindingsUsed: string[];
  supported: boolean; unsupportedReason?: string;
}
export interface WorkflowSkillReplayCheckpointPreview {
  templateId: string; kind: CheckpointKind; strategy: CheckpointStrategy; sensitivity: CheckpointSensitivity; status: "draft" | "review_required" | "approved" | "rejected" | "archived";
  requiredGrants: string[]; missingGrants: string[]; parameterNames: string[]; expectedFields: string[]; blocked: boolean; blockedReasons: string[]; previewOnly: true;
}
export interface WorkflowSkillReplayDryRun {
  dryRunId: string; skillId: string; skillVersion: number; createdAt: string; parametersSummary: Array<{ name: string; type: WorkflowSkillParameter["type"]; required: boolean; sensitive: boolean; provided: boolean; redacted: true }>;
  steps: WorkflowSkillReplayStepPreview[]; checkpoints: WorkflowSkillReplayCheckpointPreview[]; requiredGrants: WorkflowSkillReplayGrantSummary[]; missingGrants: string[];
  confirmationRequirements: string[]; blockers: WorkflowSkillReplayBlocker[]; warnings: string[]; executableInFuture: boolean; reason?: string;
  actionsExecuted: false; confirmationTokensCreated: false; previewOnly: true;
  /** Backward-compatible: replay execution still does not exist. */
  executable: false;
}

export type WorkflowReplaySessionStatus = "planned" | "active" | "paused" | "blocked" | "completed" | "cancelled" | "failed" | "archived";
export type WorkflowReplayStepState = "pending" | "prepared_dryrun" | "dryrun_applied" | "prepared_execute" | "prepared_observe" | "observe_applied" | "executed_applied" | "verified" | "failed" | "blocked";
export type WorkflowReplayDiagnosticCode = "waiting_for_prepare" | "waiting_for_original_tool_result" | "waiting_for_execution_prepare" | "waiting_for_checkpoint_verification" | "session_recoverable_with_parameters" | "session_recreate_required" | "needs_parameters" | "cancelled_by_user" | "archived" | "cannot_resume_ephemeral_missing" | "receipt_state_terminal" | "outstanding_prepare_invalidated" | "safe_to_archive" | "no_recovery_available" | "blocked_by_previous_step";
export interface WorkflowReplayDiagnosticSummary {
  sessionId: string; status: WorkflowReplaySessionStatus; currentStepIndex: number; currentStepState: WorkflowReplayStepState | "complete";
  continuable: boolean; recoverable: boolean; cancellationAvailable: boolean; allowedNextActions: string[]; nextRecommendedAction: string;
  diagnosticCode: WorkflowReplayDiagnosticCode; safeExplanation: string; blockerCount: number; warningCount: number;
  receiptState: "none" | "awaiting" | "active" | "reserved" | "consumed" | "unavailable"; ephemeralMaterialStatus: "available" | "missing" | "invalidated";
}
export interface WorkflowReplayStepResultSummary { stepId: string; tool: string; status: "prepared" | "dryrun_done" | "executed" | "failed"; ok: boolean; preview: boolean; confirmationAccepted: boolean; trusted?: boolean; receiptId?: string; errorCode?: string; summary: string; createdAt: string; }
export interface WorkflowReplayCheckpointResultSummary { stepId: string; status: "passed" | "failed" | "blocked" | "timeout"; summary: string; checkedAt: string; }
export interface WorkflowReplaySession {
  replaySessionId: string; skillId: string; skillVersion: number; createdAt: string; updatedAt: string; status: WorkflowReplaySessionStatus; currentStepIndex: number;
  parametersSummary: WorkflowSkillReplayDryRun["parametersSummary"]; dryRunSnapshot: WorkflowSkillReplayDryRun; dryRunSnapshotHash: string;
  stepResults: WorkflowReplayStepResultSummary[]; checkpointResults: WorkflowReplayCheckpointResultSummary[]; blockers: WorkflowSkillReplayBlocker[]; warnings: string[];
  /** Persisted transition state. Missing values from older sessions normalize to pending. */
  stepStates?: WorkflowReplayStepState[];
  archivedAt?: string; archivedFromStatus?: Exclude<WorkflowReplaySessionStatus, "archived">; lastDiagnosticCode?: WorkflowReplayDiagnosticCode;
}

export type ConfirmationStatus =
  | "previewGenerated"
  | "tokenUsed"
  | "tokenAccepted"
  | "tokenRejected";

export interface ToolConfirmationInfo {
  status: ConfirmationStatus;
  used: boolean;
  accepted: boolean;
  executed: boolean;
  reason: string;
  tokenId?: string;
  expiresAt?: string;
}

export interface ToolCapability {
  name: string;
  riskLevel: RiskLevel;
  description: string;
  strategy?: AutomationStrategy;
  inputSchema?: unknown;
  generated?: boolean;
}

export interface AppCapability {
  id: string;
  adapterId?: string;
  appId?: string;
  strategy: AutomationStrategy;
  riskLevel: RiskLevel;
  description: string;
  inputSchema?: unknown;
  safety: {
    actionType: ActionType;
    dataSensitivity?: DataSensitivity;
    externalEffect?: boolean;
    destructive?: boolean;
    communicative?: boolean;
  };
}

export interface CapabilityRegistrySnapshot {
  listStrategies(): AutomationStrategy[];
  listTools(): ToolCapability[];
  listAppCapabilities(): AppCapability[];
}

export interface PermissionDefaults {
  shell: PermissionDefault;
  fileRead: PermissionDefault;
  fileWrite: PermissionDefault;
  appOpen: PermissionDefault;
  screenshots: PermissionDefault;
  windowFocus: PermissionDefault;
  accessibilityRead: PermissionDefault;
  accessibilityActions: PermissionDefault;
  guiClick: PermissionDefault;
  guiType: PermissionDefault;
  guiHotkey: PermissionDefault;
  browserAutomation: PermissionDefault;
  communicationActions: PermissionDefault;
  privateDataReads: PermissionDefault;
  externalSendsUploads: PermissionDefault;
  destructiveActions: PermissionDefault;
  generatedTools: PermissionDefault;
}

export interface CapabilityGrantRequirements {
  requiresDryRun?: boolean;
  requiresConfirmationToken?: boolean;
  requiresApproval?: boolean;
  requiresExactTarget?: boolean;
  maxRiskLevel?: RiskLevel;
  allowedRoots?: string[];
  sandboxRoots?: Array<"run" | "temp">;
  outputRoots?: Array<"run">;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  maxRuntimeMs?: number;
  allowedOperations?: ToolForgeRuntimeOperation[];
}

export interface CapabilityGrantMatch {
  tools?: string[];
  strategies?: AutomationStrategy[];
  actionTypes?: ActionType[];
  appNames?: string[];
  appIds?: string[];
  appSensitivities?: AppSensitivity[];
  dataSensitivities?: DataSensitivity[];
  fileRoots?: string[];
  commandAllowlist?: string[];
  networkDomains?: string[];
  oauthScopes?: string[];
  generatedToolIds?: string[];
  registrationIds?: string[];
  runtimeToolNames?: string[];
  runtimeCapabilities?: ToolForgeRuntimeCapability[];
}

export interface CapabilityGrant {
  id: string;
  scope: GrantScope;
  effect: GrantEffect;
  description?: string;
  createdAt?: string;
  expiresAt?: string;
  match: CapabilityGrantMatch;
  requirements?: CapabilityGrantRequirements;
}

export interface PolicyProfile {
  name: PolicyProfileName;
  description: string;
  enabled: boolean;
  allowScreenshots: boolean;
  allowAppLaunch: boolean;
  allowShell: boolean;
  allowFileWriteRoots: string[];
  allowGenericClick: boolean;
  allowGenericType: boolean;
  allowEmailSend: boolean;
  allowUploads: boolean;
  requireApprovalForMediumRisk: boolean;
  blockHighRiskByDefault: boolean;
  requireDryRunForStateChanging: boolean;
  requireConfirmationForStateChanging: boolean;
  requireExactTargetForStateChanging: boolean;
  defaults: PermissionDefaults;
  grants: CapabilityGrant[];
  scheduler?: SchedulerPolicy;
}

export interface SchedulerPolicy { allowSchedulerSpecs: boolean; allowScheduledExecution: false; allowJobActivation: false; requireReviewForJobs: boolean; requireReviewForActivation: true; requireApprovalForJobActivation: true; allowBackgroundWorkers: false; allowExternalDelivery: false; allowNotifications: false; minRecurringIntervalMinutes: number; allowConditionWatch: false; requireExplicitUserActivation: true; requireVisibleJobLifecycle: true; requireCancellationSupport: true; requireRunReceipts: true; requireRunAuditLogs: true; manualRunApprovalTtlSeconds: number; manualRunApprovalExpiryWarningSeconds: number; requireFreshApprovalAtExecution: true; requireFullRevalidationAfterExpiry: true; allowAutomaticRefresh: false; }
export interface ScheduledJobNextRunPreview { nextRunAt: string; timezone: string; scheduleKind: string; scheduleSummary: string; previewOnly: true; }
export interface ScheduledJobReadinessBlocker { code: string; message: string; }
export type ScheduledJobActivationStatus = "inactive" | "activation_requested" | "activation_review_required" | "activation_approved" | "activation_rejected" | "activation_revoked" | "activation_archived";
export interface ScheduledJobFutureExecutionControls { visibleLifecycleRequired: true; cancellationRequired: true; pauseDisableRequired: true; runReceiptsRequired: true; auditLogsRequired: true; freshGrantsRequired: true; dryRunBeforeRunRequired: true; confirmationForStateChangingRequired: true; checkpointVerificationRequired: true; stopOnFailureRequired: true; noRetryByDefault: true; noHiddenBackgroundWork: true; }
export interface ScheduledJobActivationPolicySnapshot { allowSchedulerSpecs: boolean; allowJobActivation: false; allowScheduledExecution: false; allowBackgroundWorkers: false; allowExternalDelivery: false; allowNotifications: false; requireReviewForActivation: true; requireApprovalForJobActivation: true; requireExplicitUserActivation: true; }
export interface ScheduledJobActivationSummary { activationRequestId: string; status: ScheduledJobActivationStatus; jobVersion: number; updatedAt: string; executable: false; scheduledExecutionEnabled: false; actualExecutionSupported: false; }
export interface ScheduledJobReadiness { jobId: string; jobStatus: ScheduledJobStatus; readyForActivation: false; executableNow: false; scheduledExecutionEnabled: false; activationSupported: false; actualExecutionSupported: false; activationMode: "review_only"; activationMetadataEligible: boolean; activationStatus: ScheduledJobActivationStatus; activationRequestId?: string; scheduleValid: boolean; taskValid: boolean; deliveryValid: boolean; grantsSatisfied: boolean; requiredGrants: string[]; missingGrants: string[]; blockers: ScheduledJobReadinessBlocker[]; warnings: string[]; nextRunPreview?: ScheduledJobNextRunPreview; taskDryRunPreview?: { skillId: string; stepCount: number; blockers: string[]; missingGrants: string[]; confirmationRequirements: string[]; actionsExecuted: false; confirmationTokensCreated: false; }; policySummary: SchedulerPolicy; recommendedNextAction: string; }
export interface ScheduledJobActivationPreview extends ScheduledJobReadiness { futureRequirements: string[]; }
export type ScheduledJobStatus = "draft" | "review_required" | "approved" | "rejected" | "archived" | "disabled";
export type ScheduledJobSchedule = { kind: "once"; runAt: string; timezone: string; nextRunPreview?: string } | { kind: "recurring"; everyMinutes: number; timezone: string; nextRunPreview?: string } | { kind: "condition_watch_future"; timezone: string };
export type ScheduledJobTask = { type: "skill_replay_dryrun" | "skill_replay_stepwise_future" | "browser_research_future" | "file_check_future" | "shell_safe_future" | "notification_future" | "custom_future"; skillId?: string; dataSensitivity: DataSensitivity; parameterNames: string[]; requiredGrantIds: string[]; };
export type ScheduledJobDeliveryPolicy = { kind: "local_log" | "local_file" | "desktop_notification_future" | "draft_message_future" | "draft_email_future" | "external_send_blocked"; outputName?: string; };
export interface ScheduledJobSafetyReview { scheduleFindings: string[]; taskFindings: string[]; deliveryFindings: string[]; blockedReasons: string[]; requiredGrantIds: string[]; missingGrantIds: string[]; }
export interface ScheduledJobSpec { jobId: string; name: string; description: string; createdAt: string; updatedAt: string; status: ScheduledJobStatus; schedule: ScheduledJobSchedule; task: ScheduledJobTask; delivery: ScheduledJobDeliveryPolicy; parametersSummary: Array<{ name: string; provided: boolean; redacted: true }>; requiredGrants: string[]; requiredConfirmations: string[]; safetyRestrictions: string[]; retryPolicy: "none"; maxAttempts: 1; reviewId?: string; version: number; jobHash: string; executable: false; scheduledExecutionEnabled: false; archivedAt?: string; }
export interface ScheduledJobReview { reviewId: string; jobId: string; action: "create" | "update" | "approve" | "reject" | "archive" | "disable"; createdAt: string; updatedAt: string; status: "pending" | "approved" | "rejected" | "blocked" | "applied" | "archived"; version: number; jobHash: string; beforeSummary?: Record<string, unknown>; afterSummary: Record<string, unknown>; safety: ScheduledJobSafetyReview; reviewer?: string; }
export interface ScheduledJobActivationRequest { activationRequestId: string; jobId: string; jobVersion: number; jobHash: string; createdAt: string; updatedAt: string; requestedBy?: "redacted"; status: ScheduledJobActivationStatus; readinessSnapshotHash: string; readinessSummary: Pick<ScheduledJobReadiness, "jobStatus" | "scheduleValid" | "taskValid" | "deliveryValid" | "grantsSatisfied" | "requiredGrants" | "missingGrants" | "blockers" | "warnings">; activationPolicySnapshot: ScheduledJobActivationPolicySnapshot; requiredGrants: string[]; missingGrants: string[]; futureExecutionControls: ScheduledJobFutureExecutionControls; blockers: string[]; warnings: string[]; nextRunPreview?: ScheduledJobNextRunPreview; reviewId?: string; activationHash: string; executable: false; scheduledExecutionEnabled: false; actualExecutionSupported: false; revokedAt?: string; archivedAt?: string; }
export interface ScheduledJobActivationReview { reviewId: string; activationRequestId: string; jobId: string; action: "request" | "approve" | "reject" | "revoke" | "archive"; status: "pending" | "approved" | "rejected" | "blocked" | "applied" | "revoked" | "archived"; createdAt: string; updatedAt: string; jobVersion: number; jobHash: string; activationHash: string; beforeSummary?: Record<string, unknown>; afterSummary: Record<string, unknown>; readinessSummary: ScheduledJobActivationRequest["readinessSummary"]; policyFindings: string[]; requiredGrants: string[]; missingGrants: string[]; blockedReasons: string[]; reviewer?: "redacted"; }
export type ScheduledJobManualRunContractStatus = "draft" | "review_required" | "approved" | "rejected" | "blocked" | "archived";
export interface ScheduledJobManualRunFutureControls extends ScheduledJobFutureExecutionControls { manualUserInitiationRequired: true; policyGrantReadinessRecheckRequired: true; }
export interface ScheduledJobManualRunEligibility { eligibleForContract: boolean; jobApproved: boolean; activationApproved: boolean; scheduleValid: boolean; taskValid: boolean; deliveryValid: boolean; grantsKnown: boolean; blockers: string[]; warnings: string[]; }
export interface ScheduledJobManualRunTaskPlanSummary { kind: ScheduledJobTask["type"]; skillId?: string; stepCount: number; steps: Array<{ stepId: string; order: number; tool: string; strategy: string; actionType: string; riskLevel: string; stateChanging: boolean; wouldRequireDryRun: boolean; wouldRequireConfirmation: boolean; requiredGrants: string[]; blocked: boolean; blockedReasons: string[]; }>; checkpointCount: number; checkpoints: Array<{ templateId: string; kind: string; strategy: string; sensitivity: string; status: string; requiredGrants: string[]; missingGrants: string[]; blocked: boolean; blockedReasons: string[]; }>; plannerBlockers: string[]; plannerWarnings: string[]; actionsExecuted: false; replaySessionStarted: false; }
export interface ScheduledJobManualRunDeliveryPlanSummary { kind: ScheduledJobDeliveryPolicy["kind"]; futureOnly: true; risk: "low" | "high" | "blocked"; outputNamePresent: boolean; outputExtension?: "txt" | "json"; blocked: boolean; blockedReasons: string[]; }
export interface ScheduledJobManualRunContract { runContractId: string; jobId: string; jobVersion: number; jobHash: string; activationRequestId?: string; activationHash?: string; createdAt: string; updatedAt: string; status: ScheduledJobManualRunContractStatus; readinessSnapshotHash: string; taskPlanSummary: ScheduledJobManualRunTaskPlanSummary; deliveryPlanSummary: ScheduledJobManualRunDeliveryPlanSummary; checkpointPlanSummary: { count: number; blockedCount: number; redacted: true; }; requiredGrants: string[]; missingGrants: string[]; requiredConfirmations: string[]; eligibility: ScheduledJobManualRunEligibility; futureControls: ScheduledJobManualRunFutureControls; blockers: string[]; warnings: string[]; contractHash: string; reviewId?: string; executable: false; manualRunSupported: false; scheduledExecutionEnabled: false; backgroundExecution: false; actionsExecuted: false; confirmationTokensCreated: false; archivedAt?: string; }
export interface ScheduledJobManualRunReview { reviewId: string; runContractId: string; jobId: string; action: "create" | "approve" | "reject" | "archive"; status: "pending" | "approved" | "rejected" | "blocked" | "applied" | "archived"; createdAt: string; updatedAt: string; jobVersion: number; jobHash: string; activationHash?: string; contractHash: string; beforeSummary?: Record<string, unknown>; afterSummary: Record<string, unknown>; readinessFindings: string[]; taskFindings: string[]; deliveryFindings: string[]; grantFindings: string[]; blockedReasons: string[]; reviewer?: "redacted"; }
export type ScheduledJobManualRunPreflightStatus = "pass" | "warn" | "blocked" | "archived";
export interface ScheduledJobManualRunPreflightAcknowledgement { acknowledgementId: string; statement: string; required: true; acknowledged: false; }
export interface ScheduledJobManualRunPreflightSnapshot { valid: boolean; status?: string; version?: number; hash?: string; currentHash?: string; hashMatches?: boolean; blockerCodes: string[]; warningCodes: string[]; requiredGrantIds: string[]; missingGrantIds: string[]; nextRunPreviewAvailable?: boolean; controlStates?: Record<string, boolean>; redacted: true; }
export interface ScheduledJobManualRunPreflight { preflightId: string; manualRunContractId: string; jobId: string; jobVersion: number; activationId?: string; createdAt: string; updatedAt: string; status: ScheduledJobManualRunPreflightStatus; executable: false; canRequestManualRun: false | "future_only"; actionsExecuted: false; confirmationTokensCreated: false; manualRunSupported: false; scheduledExecutionEnabled: false; backgroundExecution: false; readinessSnapshot: ScheduledJobManualRunPreflightSnapshot; activationSnapshot: ScheduledJobManualRunPreflightSnapshot; contractSnapshot: ScheduledJobManualRunPreflightSnapshot; grantSnapshot: ScheduledJobManualRunPreflightSnapshot; deliverySnapshot: ScheduledJobManualRunPreflightSnapshot; futureControlsSnapshot: ScheduledJobManualRunPreflightSnapshot; requiredOperatorAcknowledgements: ScheduledJobManualRunPreflightAcknowledgement[]; blockers: string[]; warnings: string[]; recommendedNextAction: string; preflightHash: string; archivedAt?: string; }
export type ScheduledJobManualRunAcknowledgementStatus = "acknowledged" | "rejected" | "stale" | "blocked" | "archived";
export interface ScheduledJobManualRunAcknowledgement { acknowledgementId: string; preflightId: string; manualRunContractId: string; jobId: string; jobVersion: number; createdAt: string; updatedAt: string; status: ScheduledJobManualRunAcknowledgementStatus; acknowledgedItems: string[]; missingAcknowledgements: string[]; operatorIntentSummary: "redacted" | "not_provided"; preflightHash: string; contractHash: string; jobHash: string; readinessHash?: string; blockers: string[]; warnings: string[]; acknowledgementHash: string; executable: false; actionsExecuted: false; confirmationTokensCreated: false; archivedAt?: string; }
export type ScheduledJobManualRunRequestStatus = "requested" | "blocked" | "rejected" | "archived";
export type ScheduledJobManualRunRequestReviewStatus = "pending" | "approved" | "rejected" | "blocked" | "applied" | "revoked" | "archived";
export type ScheduledJobManualRunRequestReviewDecision = "approve" | "reject" | "revoke" | "archive";
export type ScheduledJobManualRunApprovalStatus = "review_required" | "approval_pending" | "approval_approved" | "approval_rejected" | "approval_blocked" | "approval_revoked" | "approval_archived";
export interface ScheduledJobManualRunApprovalDependencySnapshot { requestHash: string; acknowledgementHash: string; preflightHash: string; contractHash: string; jobHash: string; jobVersion: number; activationHash?: string | undefined; readinessHash?: string | undefined; grantSnapshotHash?: string | undefined; deliveryHash: string; policyHash: string; futureControlsHash: string; reviewHash: string; capturedAt: string; }
export interface ScheduledJobManualRunApprovalSummary { approvalStatus: ScheduledJobManualRunApprovalStatus; approvalMode: "review_only"; executionAuthorized: false; executable: false; runSessionCreated: false; replaySessionCreated: false; actionsExecuted: false; confirmationTokensCreated: false; reviewId?: string; revoked: boolean; approvedAt?: string; expiresAt?: string; approvalDependencySnapshot?: ScheduledJobManualRunApprovalDependencySnapshot; approvalPolicyHash?: string; revokedAt?: string; approvalArchivedAt?: string; }
export interface ScheduledJobManualRunRequest extends ScheduledJobManualRunApprovalSummary { manualRunRequestId: string; acknowledgementId: string; preflightId: string; manualRunContractId: string; jobId: string; jobVersion: number; createdAt: string; updatedAt: string; status: ScheduledJobManualRunRequestStatus; requestMode: "audit_only"; manualRunRequestSupported: false | "request_only"; requiredFutureControls: ScheduledJobManualRunFutureControls; blockers: string[]; warnings: string[]; requestHash: string; archivedAt?: string; }
export interface ScheduledJobManualRunRequestReview { reviewId: string; manualRunRequestId: string; acknowledgementId: string; preflightId: string; manualRunContractId: string; jobId: string; jobVersion: number; createdAt: string; updatedAt: string; status: ScheduledJobManualRunRequestReviewStatus; decision: ScheduledJobManualRunRequestReviewDecision; requestHash: string; acknowledgementHash: string; preflightHash: string; contractHash: string; jobHash: string; readinessHash?: string; activationHash?: string; grantSnapshotHash?: string; blockers: string[]; warnings: string[]; futureExecutionControls: ScheduledJobManualRunFutureControls; safeReviewerSummary?: "redacted"; reviewHash: string; archivedAt?: string; }
export type ScheduledJobManualRunApprovalValidityStatus = "valid" | "expiring_soon" | "expired" | "stale" | "revoked" | "archived" | "blocked";
export interface ScheduledJobManualRunApprovalStaleDependency { name: string; expectedFingerprint?: string; currentFingerprint?: string; reasonCode: string; }
export interface ScheduledJobManualRunApprovalRecoveryAction { code: string; summary: string; requiresNewApproval: true; }
export interface ScheduledJobManualRunApprovalValidity { manualRunRequestId: string; reviewId?: string; approvalStatus: ScheduledJobManualRunApprovalStatus; validityStatus: ScheduledJobManualRunApprovalValidityStatus; evaluatedAt: string; approvedAt?: string; expiresAt?: string; remainingSeconds?: number; freshnessValid: boolean; hashesValid: boolean; grantsValid: boolean; readinessValid: boolean; activationValid: boolean; contractValid: boolean; preflightValid: boolean; acknowledgementValid: boolean; jobValid: boolean; stale: boolean; revoked: boolean; blockers: string[]; warnings: string[]; staleDependencies: ScheduledJobManualRunApprovalStaleDependency[]; recoveryActions: ScheduledJobManualRunApprovalRecoveryAction[]; recommendedNextAction: string; executionAuthorized: false; executable: false; actionsExecuted: false; confirmationTokensCreated: false; }
export interface ScheduledJobManualRunApprovalAuditExplanation { manualRunRequestId: string; validity: ScheduledJobManualRunApprovalValidity; lifecycle: Array<{ id: string; kind: string; status: string; timestamp?: string | undefined }>; dependencySummary: Array<{ name: string; matches: boolean; reasonCode?: string | undefined }>; recoveryActions: ScheduledJobManualRunApprovalRecoveryAction[]; redacted: true; }

export interface AgentHostConfig {
  agentHostDir: string;
  configPath: string;
  logFile: string;
  profile: PolicyProfileName;
  /** Undefined only for older in-memory callers; loader always supplies `auto` by default. */
  forgeRuntimeSandboxMode?: ForgeRuntimeSandboxMode;
  overlayRendererMode?: import("./overlay.js").OverlayRendererMode;
  browserBridge?: BrowserBridgeConfig;
  policy: PolicyProfile;
}

export interface BrowserBridgeConfig {
  enabled: boolean;
  port: number;
  pairingTokenFile: string;
}

export type BrowserFamily = "firefox" | "chromium";
export type BrowserBridgeStatus = "disabled" | "pairing_required" | "connected" | "unavailable";

export interface BrowserDetectResult {
  supported: boolean;
  enabled: boolean;
  paired: boolean;
  connected: boolean;
  status: BrowserBridgeStatus;
  backend: "webextension_loopback";
  browser?: { family: BrowserFamily; version?: string };
  reason: string;
}

export interface BrowserTabSummary {
  tabId: string;
  windowId: string;
  active: boolean;
  url: string;
  origin: string;
  title?: string;
  appSensitivity: AppSensitivity;
  sitePermission: "granted" | "missing" | "not_required";
  urlRedacted: boolean;
}

export interface BrowserPageContext {
  tab: BrowserTabSummary;
  language?: string;
  headings: string[];
  landmarks: string[];
  links: Array<{ text: string; url: string }>;
  controls: Array<{ role: string; name: string; disabled: boolean }>;
  truncated: boolean;
  redactionCounts: Record<string, number>;
}

export interface BrowserTextResult {
  tab: BrowserTabSummary;
  text: string;
  characterCount: number;
  truncated: boolean;
  redactionCounts: Record<string, number>;
}

export type BrowserElementActionKind = "safe_navigation" | "safe_toggle" | "safe_disclosure" | "safe_search" | "text_input" | "message_input" | "form_submit" | "communication_send" | "upload" | "destructive" | "financial" | "authentication" | "captcha" | "password_input" | "unknown";
export interface BrowserElementSummary {
  elementId: string;
  tabId: string;
  role: string;
  nameSummary: string;
  bounds?: { x: number; y: number; width: number; height: number };
  visible: boolean;
  enabled: boolean;
  confidence: number;
  ambiguous: boolean;
  actionKind: BrowserElementActionKind;
  expiresAt: string;
}
export interface BrowserFormStateResult {
  tab: BrowserTabSummary;
  fields: Array<{ elementId?: string; label: string; type: string; required: boolean; disabled: boolean; valueStatus: "empty" | "filled" | "redacted" }>;
  submitButtonPresent: boolean;
  truncated: boolean;
}
export interface BrowserCheckpointResult {
  passed: boolean;
  actionPerformed: boolean;
  checks: Array<{ kind: string; passed: boolean; redactedSummary: string }>;
  durationMs: number;
}

/** OS isolation preference for the fixed Forge JSON runner. */
export type ForgeRuntimeSandboxMode = "auto" | "none" | "bubblewrap" | "firejail" | "unshare";

export interface ToolContext {
  sessionId: string;
  config: AgentHostConfig;
  policy: PolicyProfile;
  registry: CapabilityRegistrySnapshot;
}

export interface AdapterActionRequest {
  adapterId: string;
  capabilityId: string;
  appId?: string;
  input: unknown;
}

export interface AppAdapter {
  id: string;
  displayName: string;
  appIds: string[];
  supportedPlatforms: string[];
  matchesApp?(input: { appId?: string; appName?: string }): boolean;
  getCapabilities(): AppCapability[];
  execute(action: AdapterActionRequest, context: ToolContext): Promise<ToolResult>;
}

export interface AdapterSummary {
  id: string;
  displayName: string;
  appIds: string[];
  supportedPlatforms: string[];
  capabilityCount: number;
}

export interface AdapterRegistrationResult {
  registered: boolean;
  skipped: boolean;
  adapterId: string;
  reason: string;
}

export interface AdapterCapabilityFilter {
  adapterId?: string;
  appId?: string;
}

export interface AdapterDetectionInput {
  appName: string;
  appId?: string;
}

export interface AdapterDetectionResult {
  appName: string;
  appId?: string;
  adapterAvailable: boolean;
  adapters: AdapterSummary[];
  capabilities: AppCapability[];
  recommendedStrategy: AutomationStrategy;
  reason: string;
}

export interface AdapterListResult {
  adapters: AdapterSummary[];
}

export interface AdapterCapabilitiesResult {
  adapterId?: string;
  appId?: string;
  capabilities: AppCapability[];
}

export interface AdapterRegistrySnapshot {
  get(adapterId: string): AppAdapter | undefined;
  listAdapters(): AdapterSummary[];
  listCapabilities(filter?: AdapterCapabilityFilter): AppCapability[];
  detectForApp(input: AdapterDetectionInput): AdapterDetectionResult;
}

export const GUIDE_WORKFLOW_KINDS = [
  "unsupported_app",
  "unknown_app",
  "sensitive_app",
  "unsafe_action",
  "manual_review",
  "general"
] as const;
export type GuideWorkflowKind = (typeof GUIDE_WORKFLOW_KINDS)[number];

export interface GuideToolSuggestion {
  tool: string;
  reason: string;
  input?: unknown;
}

export interface GuideStep {
  id: string;
  title: string;
  instruction: string;
  appName?: string;
  riskLevel: RiskLevel;
  expectedResult?: string;
  warning?: string;
  userActionRequired: boolean;
  canAutomateLater: boolean;
  relatedToolSuggestion?: GuideToolSuggestion;
}

export interface GuideCreateStepsInput {
  workflowGoal: string;
  appName?: string;
  appId?: string;
  workflowKind?: GuideWorkflowKind;
  taskType?: AppStrategyTaskType;
  reason?: string;
  availableStrategies?: AutomationStrategy[];
  knownAppSensitivity?: AppSensitivity;
  knownRiskLevel?: RiskLevel;
}

export interface GuideResult {
  strategy: "guide_only";
  workflowGoal: string;
  workflowKind: GuideWorkflowKind;
  appName?: string;
  appSensitivity: AppSensitivity;
  riskLevel: RiskLevel;
  summary: string;
  warnings: string[];
  steps: GuideStep[];
  canAutomateLater: boolean;
  relatedToolSuggestions: GuideToolSuggestion[];
}

export interface GuideSuggestion {
  strategy: "guide_only";
  reason: string;
  warning?: string;
  suggestedTool: "guide.create_steps";
  input: GuideCreateStepsInput;
}

export interface GuideExplainStrategyInput {
  appName?: string;
  taskType?: AppStrategyTaskType;
  availableStrategies?: AutomationStrategy[];
  recommendedStrategy?: AutomationStrategy;
  reason?: string;
  knownAppSensitivity?: AppSensitivity;
}

export interface GuideStrategyExplanationResult {
  recommendedStrategy: AutomationStrategy;
  appName?: string;
  appSensitivity: AppSensitivity;
  summary: string;
  reasons: string[];
  warnings: string[];
  guideSuggestion: GuideSuggestion;
}

export interface SafetyInput {
  tool: string;
  actionType: ActionType;
  strategy?: AutomationStrategy;
  generatedToolId?: string;
  generatedTool?: boolean;
  appId?: string;
  appName?: string;
  url?: string;
  filePath?: string;
  shellCommand?: string;
  dataSensitivity?: DataSensitivity;
  externalEffect?: boolean;
  destructive?: boolean;
  communicative?: boolean;
}

export interface GrantDecision {
  matchedGrantIds: string[];
  allowedByGrantIds: string[];
  deniedByGrantIds: string[];
  guideOnlyByGrantIds: string[];
  requiresDryRun: boolean;
  requiresConfirmationToken: boolean;
  requiresApproval: boolean;
  requiresExactTarget: boolean;
}

export interface SafetyDecision {
  riskLevel: RiskLevel;
  appSensitivity: AppSensitivity;
  approval: ApprovalInfo;
  allowed: boolean;
  blocked: boolean;
  guideOnly: boolean;
  reasons: string[];
  matchedRules: string[];
  grantDecision: GrantDecision;
}

export type PathAccessMode = "read" | "write" | "delete";

export interface PathSafetyResult {
  inputPath: string;
  normalizedPath: string;
  access: PathAccessMode;
  isProtectedPath: boolean;
  protectionKind: "none" | "root" | "home" | "credential" | "browser_profile" | "system";
  isAllowedWriteRoot: boolean;
  allowedWriteRoots: string[];
  riskLevel: RiskLevel;
  reasons: string[];
  matchedRules: string[];
}

export interface SafetyEvaluationContext {
  homeDir?: string;
  cwd?: string;
  agentHostDir?: string;
  grants?: CapabilityGrant[];
}

export type DependencyKind = "command" | "desktop_app" | "any";

export interface DependencyCheckResult {
  found: boolean;
  kind: DependencyKind;
  name: string;
  commandPath?: string;
  desktopEntryPath?: string;
  displayName?: string;
  reason: string;
}

export interface InstalledAppSummary {
  appId: string;
  displayName: string;
  command?: string;
  executablePath?: string;
  desktopEntryPath?: string;
}

export interface AppDetectionResult {
  found: boolean;
  appId: string;
  displayName?: string;
  executablePath?: string;
  desktopEntryPath?: string;
  adapterAvailable: boolean;
  adapterIds?: string[];
  adapterCapabilities?: AppCapability[];
  availableStrategies: AutomationStrategy[];
  recommendedStrategy: AutomationStrategy;
  appSensitivity: AppSensitivity;
  reason: string;
  guideSuggestion?: GuideSuggestion;
}

export type AppStrategyTaskType = "open" | "inspect" | "automate" | "unknown";

export interface AppStrategyResult extends AppDetectionResult {
  taskType: AppStrategyTaskType;
}

export interface AppOpenResult {
  opened: boolean;
  appId: string;
  displayName?: string;
  pid?: number;
  strategy: AutomationStrategy;
  command?: string;
  reason: string;
}

export interface ShellRunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

export interface FileWriteResult {
  path: string;
  bytesWritten: number;
  created: true;
}

export interface FileReadResult {
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  bytesRead: number;
  truncated: boolean;
}

export interface FileExistsResult {
  path: string;
  exists: boolean;
  type?: "file" | "directory" | "other";
}

export interface FileListEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "other";
}

export interface FileListResult {
  path: string;
  entries: FileListEntry[];
  truncated: boolean;
}

export interface FileEnsureDirResult {
  path: string;
  exists: boolean;
  created: boolean;
}

export type DesktopMouseButton = "left" | "middle" | "right";

export interface DesktopWindowContext {
  windowId?: string;
  appName?: string;
  title?: string;
  pid?: number;
  appSensitivity?: AppSensitivity;
}

export interface DesktopGetActiveWindowResult {
  supported: boolean;
  backend: string;
  activeWindow?: DesktopWindowContext;
  reason: string;
}

export interface DesktopScreenshotResult {
  supported: boolean;
  backend: string;
  path?: string;
  bytesWritten?: number;
  activeWindow?: DesktopWindowContext;
  screenshotMetadata?: { screenshotId: string; capturedAt: string; captureKind: "full_screen" | "active_window"; imageWidth: number; imageHeight: number; geometryAvailable: boolean };
  reason: string;
}

export interface DesktopHotkeyResult {
  supported: boolean;
  backend: string;
  sent: boolean;
  keys: string[];
  activeWindow: DesktopWindowContext;
  reason: string;
}

export interface DesktopTypeTextResult {
  supported: boolean;
  backend: string;
  typed: boolean;
  characterCount: number;
  activeWindow: DesktopWindowContext;
  reason: string;
}

export interface DesktopClickResult {
  supported: boolean;
  backend: string;
  clicked: boolean;
  x: number;
  y: number;
  button: DesktopMouseButton;
  activeWindow: DesktopWindowContext;
  reason: string;
}

export type DesktopPointerAction = "move_mouse" | "scroll" | "double_click" | "right_click" | "drag";
export interface DesktopPointerResult {
  supported: boolean;
  backend: string;
  performed: boolean;
  action: DesktopPointerAction;
  activeWindow: DesktopWindowContext;
  reason: string;
}

export type SandboxBackendId =
  | "bubblewrap"
  | "firejail"
  | "unshare"
  | "flatpak-spawn"
  | "nsjail"
  | "systemd-run";

export type SandboxFeatureStatus = {
  status: "available" | "unavailable" | "unknown";
  reason: string;
};

export interface SandboxBackendSupport {
  id: SandboxBackendId;
  commandName: string;
  commandPath: string;
  detected: true;
  usability: "candidate" | "limited" | "informational";
  reason: string;
  limitations: string[];
}

export interface SandboxBackendUnavailable {
  id: SandboxBackendId;
  detected: false;
  reason: string;
}

export interface SandboxSupportProbeResult {
  platform: string;
  supported: boolean;
  availableBackends: SandboxBackendSupport[];
  unavailableBackends: SandboxBackendUnavailable[];
  recommendedBackend: SandboxBackendId | null;
  kernelFeatures: {
    userNamespaces: SandboxFeatureStatus;
    seccomp: SandboxFeatureStatus;
    appArmor: SandboxFeatureStatus;
    flatpakContainer: SandboxFeatureStatus;
  };
  limitations: string[];
  requiresInstall: boolean;
  requiresSudo: false;
  safeForAgentHostUse: boolean;
  notes: string[];
}

export interface DesktopCapabilitySupport {
  supported: boolean;
  backend: string;
  reason: string;
}

export type DesktopSessionType = "x11" | "wayland" | "unknown";

export interface DesktopCapabilitiesResult {
  platform: string;
  sessionType: DesktopSessionType;
  displayAvailable: boolean;
  backend: string;
  activeWindow: DesktopCapabilitySupport;
  screenshot: DesktopCapabilitySupport;
  windowList: DesktopCapabilitySupport;
  windowFocus: DesktopCapabilitySupport;
  accessibility: DesktopCapabilitySupport;
  guiInput: DesktopCapabilitySupport;
}

export interface DesktopWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopWindowSummary {
  windowId: string;
  appName?: string;
  title?: string;
  pid?: number;
  appSensitivity?: AppSensitivity;
  bounds?: DesktopWindowBounds;
}

export interface WindowListResult {
  supported: boolean;
  backend: string;
  windows: DesktopWindowSummary[];
  truncated: boolean;
  reason: string;
}

export interface WindowFocusResult {
  supported: boolean;
  backend: string;
  focused: boolean;
  window: DesktopWindowContext;
  reason: string;
}

export interface AccessibilityTreeNode {
  id: string;
  role: string;
  name?: string;
  text?: string;
  description?: string;
  bounds?: DesktopWindowBounds;
  sensitive?: boolean;
  hidden?: boolean;
  children?: AccessibilityTreeNode[];
}

export interface AccessibilityElementCandidate {
  id: string;
  role: string;
  name?: string;
  text?: string;
  bounds?: DesktopWindowBounds;
  confidence: number;
  reason: string;
}

export interface AccessibilityElementTarget {
  appName?: string;
  windowId?: string;
  pid?: number;
  elementId?: string;
  query?: string;
  role?: string;
}

export interface AccessibilityValueMetadata {
  supportsText: boolean;
  supportsValue: boolean;
  editable: boolean;
  readOnly: boolean;
  textLength?: number;
  minimum?: number;
  maximum?: number;
  step?: number;
}

export interface AccessibilityElementDetails {
  elementId: string;
  role: string;
  name?: string;
  description?: string;
  states: string[];
  availableActions: string[];
  bounds?: DesktopWindowBounds;
  valueMetadata?: AccessibilityValueMetadata;
  appName?: string;
  windowId?: string;
  windowTitle?: string;
  pid?: number;
  appSensitivity?: AppSensitivity;
  dataSensitivity: DataSensitivity;
  hidden?: boolean;
}

export interface AccessibilityTreeResult {
  supported: boolean;
  backend: string;
  root?: AccessibilityTreeNode;
  nodeCount: number;
  truncated: boolean;
  redacted: boolean;
  reason: string;
}

export interface AccessibilityFindElementResult {
  supported: boolean;
  backend: string;
  candidates: AccessibilityElementCandidate[];
  reason: string;
}

export interface AccessibilityInspectElementResult {
  supported: boolean;
  backend: string;
  matched: boolean;
  ambiguous: boolean;
  redacted: boolean;
  reason: string;
  element?: AccessibilityElementDetails;
}

export interface AccessibilityInvokeActionResult {
  supported: boolean;
  backend: string;
  matched: boolean;
  ambiguous: boolean;
  performed: boolean;
  redacted: boolean;
  actionName?: string;
  reason: string;
  target?: AccessibilityElementDetails;
}

export interface AccessibilitySetValueResult {
  supported: boolean;
  backend: string;
  matched: boolean;
  ambiguous: boolean;
  changed: boolean;
  redacted: boolean;
  redactedValue: boolean;
  reason: string;
  target?: AccessibilityElementDetails;
}

export interface AccessibilityFocusElementResult {
  supported: boolean;
  backend: string;
  matched: boolean;
  ambiguous: boolean;
  focused: boolean;
  redacted: boolean;
  reason: string;
  target?: AccessibilityElementDetails;
}

export type PreviewTargetKind =
  | "accessibility_element"
  | "desktop_window"
  | "shell_command"
  | "file_path"
  | "app"
  | "browser";

export interface ActionPreviewTarget {
  kind: PreviewTargetKind;
  summary: string;
  appName?: string;
  windowId?: string;
  pid?: number;
  title?: string;
  elementId?: string;
  role?: string;
  name?: string;
  availableActions?: string[];
  path?: string;
  command?: string;
}

export interface ActionPreviewAlternative {
  strategy: AutomationStrategy;
  tool?: string;
  reason: string;
}

export interface ActionPreviewResult {
  preview: true;
  wouldExecute: boolean;
  wouldRequireApproval: boolean;
  wouldBeBlocked: boolean;
  riskLevel: RiskLevel;
  appSensitivity?: AppSensitivity;
  dataSensitivity?: DataSensitivity;
  targetSummary: string;
  target?: ActionPreviewTarget;
  ambiguous: boolean;
  reasons: string[];
  matchedRules: string[];
  saferAlternative?: ActionPreviewAlternative;
  supported?: boolean;
  backend?: string;
  confirmationAvailable?: boolean;
  confirmationRequired?: boolean;
  confirmationToken?: string;
  tokenId?: string;
  expiresAt?: string;
  inputFingerprint?: string;
  targetFingerprint?: string;
  confirmationExplanation?: string;
}

export interface SystemInfo {
  platform: string;
  arch: string;
  nodeVersion: string;
  agentHostDir: string;
  profile: PolicyProfileName;
  strategies: AutomationStrategy[];
  tools: string[];
}

export interface CapabilityList {
  strategies: AutomationStrategy[];
  tools: ToolCapability[];
  appCapabilities: AppCapability[];
}

export interface PolicyProfileSummary {
  name: PolicyProfileName;
  description: string;
  enabled: boolean;
  defaults: PermissionDefaults;
  requireDryRunForStateChanging: boolean;
  requireConfirmationForStateChanging: boolean;
  requireExactTargetForStateChanging: boolean;
}

export interface GrantSummary {
  id: string;
  scope: GrantScope;
  effect: GrantEffect;
  description?: string;
  createdAt?: string;
  expiresAt?: string;
  active: boolean;
  match: CapabilityGrantMatch;
  requirements?: CapabilityGrantRequirements;
}

export interface PolicyGetProfileResult {
  activeProfile: PolicyProfileSummary;
}

export interface PolicyListProfilesResult {
  profiles: PolicyProfileSummary[];
}

export interface PolicyListGrantsResult {
  profile: PolicyProfileName;
  grants: GrantSummary[];
}

export interface PolicyExplainDecisionResult {
  profile: PolicyProfileName;
  input: SafetyInput;
  decision: SafetyDecision;
}

export interface ToolForgeRequirements {
  requiresDryRun?: boolean | undefined;
  requiresConfirmationToken?: boolean | undefined;
  requiresApproval?: boolean | undefined;
}

export interface ToolForgeToolDeclaration {
  name: string;
  description: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  riskLevel: RiskLevel;
  actionType: ActionType;
  strategy?: AutomationStrategy | undefined;
}

export interface ToolForgePermissionRequest {
  id: string;
  description?: string | undefined;
  generatedToolId?: string | undefined;
  tools?: string[] | undefined;
  strategies?: AutomationStrategy[] | undefined;
  actionTypes?: ActionType[] | undefined;
  appNames?: string[] | undefined;
  appSensitivities?: AppSensitivity[] | undefined;
  fileRoots?: string[] | undefined;
  commandAllowlist?: string[] | undefined;
  networkDomains?: string[] | undefined;
  oauthScopes?: string[] | undefined;
  dataSensitivity?: DataSensitivity | undefined;
  canReadPrivateData?: boolean | undefined;
  canWriteFiles?: boolean | undefined;
  canRunShell?: boolean | undefined;
  canUseGui?: boolean | undefined;
  canSendMessages?: boolean | undefined;
  canDeleteData?: boolean | undefined;
  canUploadFiles?: boolean | undefined;
  requiresDryRun?: boolean | undefined;
  requiresConfirmationToken?: boolean | undefined;
  requiresApproval?: boolean | undefined;
}

export const TOOL_FORGE_RUNTIME_CAPABILITIES = [
  "pure_compute", "read_runtime_input", "write_runtime_output", "use_manifest_metadata", "use_registration_metadata",
  "read_sandbox_file", "write_sandbox_file", "list_sandbox_files",
  "read_user_file", "write_user_file", "network_fetch", "shell_command", "gui_action", "private_data_read", "communication_send"
] as const;
export type ToolForgeRuntimeCapability = (typeof TOOL_FORGE_RUNTIME_CAPABILITIES)[number];

export const TOOL_FORGE_RUNTIME_OPERATIONS = [
  "const", "input", "object", "array", "concat", "length", "get", "equals", "if", "join", "sum", "map", "filter", "var", "manifest", "registration"
] as const;
export type ToolForgeRuntimeOperation = (typeof TOOL_FORGE_RUNTIME_OPERATIONS)[number];

export interface ToolForgeRuntimePermissionRequest {
  id: string;
  toolNames: string[];
  capabilities: ToolForgeRuntimeCapability[];
  allowedOperations: ToolForgeRuntimeOperation[];
  maxInputBytes?: number;
  maxOutputBytes?: number;
  maxRuntimeMs?: number;
  sandboxRoots?: Array<"run" | "temp">;
  outputRoots?: Array<"run">;
  requiresDryRun?: boolean;
  requiresConfirmationToken?: boolean;
  requiresApproval?: boolean;
}

export interface ToolForgeManifest {
  schemaVersion: "agenthost.forge.v1";
  id: string;
  displayName: string;
  version: string;
  description: string;
  kind: ToolForgeManifestKind;
  source: ToolForgeManifestSource;
  tools: ToolForgeToolDeclaration[];
  requestedPermissions: ToolForgePermissionRequest[];
  runtimePermissions?: ToolForgeRuntimePermissionRequest[];
  riskDeclaration: RiskLevel;
  dataSensitivityDeclaration: DataSensitivity;
  requirements: ToolForgeRequirements;
}

export interface ToolForgeValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface ToolForgeValidationResult {
  valid: boolean;
  manifest?: ToolForgeManifest;
  errors: ToolForgeValidationIssue[];
  warnings: ToolForgeValidationIssue[];
  dangerousPermissions: string[];
  blockedPermissions: string[];
}

export interface ToolForgePermissionReview {
  permissionId: string;
  summary: string;
  riskLevel: RiskLevel;
  dangerous: boolean;
  blocked: boolean;
  matchedGrantIds: string[];
  missingGrant: boolean;
  reasons: string[];
  proposedGrant?: CapabilityGrant;
}

export interface ToolForgeReviewResult {
  valid: boolean;
  manifestId?: string;
  displayName?: string;
  kind?: ToolForgeManifestKind;
  riskLevel: RiskLevel;
  dataSensitivity: DataSensitivity;
  requestedCapabilities: ToolForgePermissionReview[];
  dangerousPermissions: string[];
  missingGrants: string[];
  matchedGrantIds: string[];
  sessionApprovalPossible: boolean;
  persistentApprovalAllowed: boolean;
  blockedReasons: string[];
  warnings: string[];
  saferAlternatives: string[];
}

export interface ToolForgeGrantProposal {
  grant: CapabilityGrant;
  permissionId: string;
  reasons: string[];
}

export interface ToolForgeGrantProposalResult {
  manifestId: string;
  proposals: ToolForgeGrantProposal[];
  warnings: string[];
}

export const TOOL_FORGE_REVIEW_DECISION_STATUSES = [
  "pending",
  "approved_for_session",
  "approved_persistent",
  "denied",
  "expired"
] as const;
export type ToolForgeReviewDecisionStatus = (typeof TOOL_FORGE_REVIEW_DECISION_STATUSES)[number];

export const TOOL_FORGE_ARTIFACT_STATUSES = [
  "draft",
  "validated",
  "scaffolded",
  "validation_pending",
  "reviewed",
  "grant_pending",
  "approved_inert",
  "rejected",
  "archived"
] as const;
export type ToolForgeArtifactStatus = (typeof TOOL_FORGE_ARTIFACT_STATUSES)[number];

export const TOOL_FORGE_VALIDATION_STATUSES = ["passed", "failed", "warnings"] as const;
export type ToolForgeValidationStatus = (typeof TOOL_FORGE_VALIDATION_STATUSES)[number];

export const TOOL_FORGE_HARNESS_MODES = ["static-plus", "contract"] as const;
export type ToolForgeHarnessMode = (typeof TOOL_FORGE_HARNESS_MODES)[number];

export const TOOL_FORGE_HARNESS_STATUSES = ["passed", "failed", "skipped", "blocked"] as const;
export type ToolForgeHarnessStatus = (typeof TOOL_FORGE_HARNESS_STATUSES)[number];

export const TOOL_FORGE_REGISTRATION_STATUSES = [
  "pending",
  "registered_inert",
  "rejected",
  "revoked",
  "expired"
] as const;
export type ToolForgeRegistrationStatus = (typeof TOOL_FORGE_REGISTRATION_STATUSES)[number];

export const TOOL_FORGE_RUNTIME_MODES = ["stub", "subprocess"] as const;
export type ToolForgeRuntimeMode = (typeof TOOL_FORGE_RUNTIME_MODES)[number];

export const TOOL_FORGE_RUNTIME_STATUSES = ["passed", "failed", "blocked", "timeout", "completed", "timed_out"] as const;
export type ToolForgeRuntimeStatus = (typeof TOOL_FORGE_RUNTIME_STATUSES)[number];

export interface ToolForgeArtifactRecord {
  artifactId: string;
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  kind: ToolForgeManifestKind;
  source: ToolForgeManifestSource;
  storagePath: string;
  projectPath?: string;
  status: ToolForgeArtifactStatus;
  executable: false;
  registered: false;
  createdAt: string;
  updatedAt: string;
}

export interface ToolForgeReviewRecord {
  reviewId: string;
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  timestamp: string;
  profile: PolicyProfileName;
  riskLevel: RiskLevel;
  dataSensitivity: DataSensitivity;
  dangerousPermissions: string[];
  blockedPermissions: string[];
  missingGrants: string[];
  proposedGrants: CapabilityGrant[];
  decisionStatus: ToolForgeReviewDecisionStatus;
  explanation: string;
  saferAlternatives: string[];
  review: ToolForgeReviewResult;
}

export interface ToolForgeManifestSummary {
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  kind: ToolForgeManifestKind;
  source: ToolForgeManifestSource;
  status: ToolForgeArtifactStatus;
  executable: false;
  registered: false;
  createdAt: string;
  updatedAt: string;
}

export interface ToolForgeReviewSummary {
  reviewId: string;
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  timestamp: string;
  profile: PolicyProfileName;
  riskLevel: RiskLevel;
  decisionStatus: ToolForgeReviewDecisionStatus;
}

export interface ToolForgeProjectFilePlanEntry {
  path: string;
  kind: "file" | "directory";
  description: string;
  bytes?: number;
}

export interface ToolForgeScaffoldProjectResult {
  artifact: ToolForgeArtifactRecord;
  manifestHash: string;
  projectPath: string;
  reviewId?: string;
  files: ToolForgeProjectFilePlanEntry[];
  overwritten: boolean;
}

export interface ToolForgeValidationCheck {
  id: string;
  level: "info" | "warning" | "error";
  message: string;
  path?: string;
}

export interface ToolForgeValidationRecord {
  validationId: string;
  artifactId: string;
  manifestId: string;
  manifestHash: string;
  projectPath: string;
  status: ToolForgeValidationStatus;
  checks: ToolForgeValidationCheck[];
  createdAt: string;
  summary: string;
  safeToConsiderRegistration: boolean;
}

export interface ToolForgeValidateProjectResult {
  artifact?: ToolForgeArtifactRecord;
  validation: ToolForgeValidationRecord;
}

export interface ToolForgeArtifactSummary {
  artifactId: string;
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  kind: ToolForgeManifestKind;
  source: ToolForgeManifestSource;
  storagePath: string;
  projectPath?: string;
  status: ToolForgeArtifactStatus;
  executable: false;
  registered: false;
  createdAt: string;
  updatedAt: string;
}

export interface ToolForgeGetArtifactResult {
  artifact: ToolForgeArtifactRecord;
}

export interface ToolForgeListArtifactsResult {
  artifacts: ToolForgeArtifactSummary[];
}

export interface ToolForgeValidationSummary {
  validationId: string;
  artifactId: string;
  manifestId: string;
  manifestHash: string;
  projectPath: string;
  status: ToolForgeValidationStatus;
  createdAt: string;
  summary: string;
  safeToConsiderRegistration: boolean;
}

export interface ToolForgeGetValidationResult {
  validation: ToolForgeValidationRecord;
}

export interface ToolForgeListValidationsResult {
  validations: ToolForgeValidationSummary[];
}

export interface ToolForgeHarnessRunRecord {
  harnessRunId: string;
  artifactId: string;
  manifestId: string;
  manifestHash: string;
  projectPath: string;
  mode: ToolForgeHarnessMode;
  status: ToolForgeHarnessStatus;
  checks: ToolForgeValidationCheck[];
  stdoutSummary: string;
  stderrSummary: string;
  durationMs: number;
  safeToConsiderRegistration: boolean;
  createdAt: string;
}

export interface ToolForgeRunValidationHarnessResult {
  artifact: ToolForgeArtifactRecord;
  validation: ToolForgeValidationRecord;
  harnessRun: ToolForgeHarnessRunRecord;
}

export interface ToolForgeHarnessRunSummary {
  harnessRunId: string;
  artifactId: string;
  manifestId: string;
  manifestHash: string;
  projectPath: string;
  mode: ToolForgeHarnessMode;
  status: ToolForgeHarnessStatus;
  durationMs: number;
  safeToConsiderRegistration: boolean;
  createdAt: string;
}

export interface ToolForgeGetHarnessRunResult {
  harnessRun: ToolForgeHarnessRunRecord;
}

export interface ToolForgeListHarnessRunsResult {
  harnessRuns: ToolForgeHarnessRunSummary[];
}

export interface ToolForgeRegistrationEligibilityResult {
  eligible: boolean;
  active: boolean;
  artifactId: string;
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  registeredTools: ToolForgeToolDeclaration[];
  requiredGrantIds: string[];
  activeGrantIds: string[];
  missingRequirements: string[];
  reasons: string[];
  reviewId?: string;
  validationIds: string[];
  harnessRunIds: string[];
}

export interface ToolForgeRegistrationRecord {
  registrationId: string;
  artifactId: string;
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  registeredAt: string;
  status: ToolForgeRegistrationStatus;
  registeredTools: ToolForgeToolDeclaration[];
  permissionsSnapshot: ToolForgePermissionRequest[];
  grantsSnapshot: GrantSummary[];
  reviewId?: string;
  validationIds: string[];
  harnessRunIds: string[];
  executable: false;
  live: false;
  explanation: string;
  expiresAt?: string;
}

export interface ToolForgeRegistrationSummary {
  registrationId: string;
  artifactId: string;
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  registeredAt: string;
  status: ToolForgeRegistrationStatus;
  executable: false;
  live: false;
  expiresAt?: string;
}

export interface ToolForgeRegisterArtifactResult {
  eligibility: ToolForgeRegistrationEligibilityResult;
  registration: ToolForgeRegistrationRecord;
}

export interface ToolForgeGetRegistrationResult {
  registration: ToolForgeRegistrationRecord;
}

export interface ToolForgeListRegistrationsResult {
  registrations: ToolForgeRegistrationSummary[];
}

export interface ToolForgeRevokeRegistrationResult {
  registration: ToolForgeRegistrationRecord;
}

export interface ToolForgeRuntimeSandboxPolicy {
  mode: ToolForgeRuntimeMode;
  childProcess: boolean;
  networkAllowed: false;
  filesystemRoots: string[];
  outputRoot?: string;
  shellAllowed: false;
  guiAllowed: false;
  envAllowlist: string[];
  envBlocked: string[];
  timeoutMs: number;
  stdoutBytesMax: number;
  stderrBytesMax: number;
}

export interface ToolForgeRuntimeEligibilityResult {
  eligible: boolean;
  active: boolean;
  registrationId: string;
  artifactId: string;
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  registrationStatus: ToolForgeRegistrationStatus;
  toolName: string;
  tool?: ToolForgeToolDeclaration;
  reviewId?: string;
  validationIds: string[];
  harnessRunIds: string[];
  requiredGrantIds: string[];
  activeGrantIds: string[];
  requestedPermissionIds: string[];
  blockedPermissionIds: string[];
  requestedRuntimeCapabilities: ToolForgeRuntimeCapability[];
  grantedRuntimeCapabilities: ToolForgeRuntimeCapability[];
  deniedRuntimeCapabilities: ToolForgeRuntimeCapability[];
  unsupportedRuntimeCapabilities: ToolForgeRuntimeCapability[];
  runtimeGrantIds: string[];
  requestedOperations: ToolForgeRuntimeOperation[];
  allowedOperations: ToolForgeRuntimeOperation[];
  blockedOperations: ToolForgeRuntimeOperation[];
  enforcedLimits: { maxInputBytes: number; maxOutputBytes: number; maxRuntimeMs: number };
  runtimeRequirements: { requiresDryRun: boolean; requiresConfirmationToken: boolean; requiresApproval: boolean };
  missingRequirements: string[];
  reasons: string[];
  sandbox: ToolForgeRuntimeSandboxPolicy;
}

export interface ToolForgeSandboxStubOutput {
  mode: ToolForgeRuntimeMode;
  generatedCodeExecuted: false;
  metadataOnly: true;
  tool: {
    name: string;
    description: string;
    riskLevel: RiskLevel;
    actionType: ActionType;
    strategy?: AutomationStrategy;
  };
  registration: {
    registrationId: string;
    status: ToolForgeRegistrationStatus;
    manifestHash: string;
  };
  manifest: {
    manifestId: string;
    manifestVersion: string;
    displayName: string;
    description: string;
  };
  sandbox: ToolForgeRuntimeSandboxPolicy;
}

export interface ToolForgeRuntimeRunRecord {
  runtimeRunId: string;
  registrationId: string;
  artifactId: string;
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  toolName: string;
  mode: ToolForgeRuntimeMode;
  status: ToolForgeRuntimeStatus;
  executedGeneratedCode: false;
  metadataOnly: boolean;
  runnerMode: "metadata_stub" | "subprocess";
  /** Backend selected around the fixed subprocess; never executes generated source code. */
  sandboxBackend?: "none" | "bubblewrap" | "firejail" | "unshare";
  sandboxLimitations?: string[];
  projectPath: string;
  outputRoot: string;
  inputFingerprint: string;
  summary: string;
  sandbox: ToolForgeRuntimeSandboxPolicy;
  durationMs: number;
  commandSummary?: string;
  cwd?: string;
  envKeys?: string[];
  timeoutMs?: number;
  outputSizeBytes?: number;
  resultSummary?: string;
  errorSummary?: string;
  runtimeCapabilitiesUsed?: ToolForgeRuntimeCapability[];
  enforcedLimits?: { maxInputBytes: number; maxOutputBytes: number; maxRuntimeMs: number };
  executableStillFalse: true;
  liveStillFalse: true;
  createdAt: string;
}

export interface ToolForgeRuntimeRunSummary {
  runtimeRunId: string;
  registrationId: string;
  artifactId: string;
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  toolName: string;
  mode: ToolForgeRuntimeMode;
  status: ToolForgeRuntimeStatus;
  executedGeneratedCode: false;
  metadataOnly: boolean;
  runnerMode: "metadata_stub" | "subprocess";
  createdAt: string;
}

export interface ToolForgeCheckRuntimeEligibilityResult {
  eligibility: ToolForgeRuntimeEligibilityResult;
}

export interface ToolForgeRunSandboxedToolResult {
  eligibility: ToolForgeRuntimeEligibilityResult;
  runtimeRun: ToolForgeRuntimeRunRecord;
  output: ToolForgeSandboxStubOutput | { mode: "subprocess"; generatedCodeExecuted: false; metadataOnly: false; result: unknown; sandbox: ToolForgeRuntimeSandboxPolicy };
}

/** Metadata for a generated tool that remains inert and non-callable as an MCP tool. */
export interface ToolForgeDispatchableTool {
  registrationId: string;
  artifactId: string;
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  toolName: string;
  description: string;
  inputSchema: unknown;
  riskLevel: RiskLevel;
  runtimeCapabilities: ToolForgeRuntimeCapability[];
  registrationStatus: ToolForgeRegistrationStatus;
  active: boolean;
  inactiveReasons: string[];
  notCallableAsMcpTool: true;
}

export interface ToolForgeListDispatchableToolsResult {
  tools: ToolForgeDispatchableTool[];
}

export interface ToolForgeGetDispatchableToolResult {
  tool: ToolForgeDispatchableTool;
}

export interface ToolForgeDispatchGeneratedToolResult extends ToolForgeRunSandboxedToolResult {
  dispatch: {
    registrationId: string;
    artifactId: string;
    manifestId: string;
    toolName: string;
    underlyingTool: "forge.run_sandboxed_tool";
    notCallableAsMcpTool: true;
  };
}

export interface ToolForgeGetRuntimeRunResult {
  runtimeRun: ToolForgeRuntimeRunRecord;
}

export interface ToolForgeListRuntimeRunsResult {
  runtimeRuns: ToolForgeRuntimeRunSummary[];
}

export interface ToolForgeSaveManifestResult {
  manifest: ToolForgeManifest;
  manifestHash: string;
  storagePath: string;
  artifact: ToolForgeArtifactRecord;
}

export interface ToolForgeGetManifestResult {
  manifest: ToolForgeManifest;
  manifestHash: string;
  storagePath: string;
  artifact: ToolForgeArtifactRecord;
}

export interface ToolForgeListManifestsResult {
  manifests: ToolForgeManifestSummary[];
}

export interface ToolForgeCreateReviewResult {
  review: ToolForgeReviewRecord;
}

export interface ToolForgeGetReviewResult {
  review: ToolForgeReviewRecord;
}

export interface ToolForgeListReviewsResult {
  reviews: ToolForgeReviewSummary[];
}

export interface ToolForgeArchiveManifestResult {
  artifact: ToolForgeArtifactRecord;
}

export interface ToolForgeApplySessionGrantsResult {
  reviewId: string;
  manifestId: string;
  manifestHash: string;
  appliedGrantIds: string[];
  grants: GrantSummary[];
}

export interface AuditLogEntry {
  timestamp: string;
  sessionId: string;
  profile: PolicyProfileName;
  tool: string;
  riskLevel: RiskLevel;
  strategy?: AutomationStrategy;
  preview?: boolean;
  confirmationStatus?: ConfirmationStatus;
  confirmationTokenId?: string;
  confirmationReason?: string;
  receiptId?: string;
  matchedGrantIds?: string[];
  deniedGrantIds?: string[];
  guideOnlyGrantIds?: string[];
  grantDecision?: GrantDecision;
  dryRunRequired?: boolean;
  confirmationRequiredByGrant?: boolean;
  approvalRequiredByGrant?: boolean;
  grantDenied?: boolean;
  inputSummary: string;
  approvalStatus: ApprovalStatus;
  ok: boolean;
  durationMs: number;
  outputSummary: string;
  errorCode?: string;
}

export interface AuditLogger {
  log(entry: AuditLogEntry): Promise<void>;
}
