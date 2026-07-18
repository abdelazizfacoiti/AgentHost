import type { CapabilityRouteFamily, CapabilityRouteVerificationStrength } from "./capability-routing.js";
import type { RiskLevel, ToolExecutionClass } from "./types.js";
import type { VisualSurfaceType } from "./visual-surface.js";

export const GOAL_PLANNING_SCHEMA_VERSION = 1 as const;

export const AGENT_GOAL_CATEGORIES = [
  "browser_navigation",
  "webpage_inspection",
  "browser_setup",
  "form_preparation",
  "file_operation",
  "application_operation",
  "desktop_guidance",
  "content_inspection",
  "local_speech",
  "meeting_assistance",
  "workflow_assistance",
  "generated_capability_inspection",
  "system_inspection",
  "unknown"
] as const;
export type AgentGoalCategory = (typeof AGENT_GOAL_CATEGORIES)[number];

export const AGENT_GOAL_STATUSES = [
  "proposed",
  "clarified",
  "ready",
  "active",
  "waiting_for_user",
  "waiting_for_approval",
  "blocked",
  "completed",
  "failed",
  "cancelled",
  "expired"
] as const;
export type AgentGoalStatus = (typeof AGENT_GOAL_STATUSES)[number];

export const GOAL_EFFECTS = [
  "observe",
  "inspect_private_data",
  "local_metadata_write",
  "local_file_create",
  "local_file_modify",
  "application_state_change",
  "browser_navigation",
  "form_draft",
  "communication_send",
  "external_submit",
  "upload",
  "delete",
  "payment",
  "local_audio",
  "visual_assistance"
] as const;
export type GoalEffect = (typeof GOAL_EFFECTS)[number];

export const GOAL_CONSTRAINTS = [
  "local_only",
  "operator_present",
  "read_only",
  "no_external_send",
  "no_submit",
  "no_upload",
  "no_delete",
  "no_payment",
  "no_credentials",
  "no_private_data",
  "no_background",
  "no_retry"
] as const;
export type GoalConstraint = (typeof GOAL_CONSTRAINTS)[number];

export const GOAL_CONFIRMATION_REQUIREMENTS = [
  "none",
  "before_state_change",
  "before_private_read",
  "before_external_effect",
  "before_target_change",
  "every_state_change"
] as const;
export type GoalConfirmationRequirement = (typeof GOAL_CONFIRMATION_REQUIREMENTS)[number];

export const GOAL_PRIVACY_CLASSES = ["public", "private", "secret"] as const;
export type GoalPrivacyClass = (typeof GOAL_PRIVACY_CLASSES)[number];
export const GOAL_PRIORITIES = ["low", "normal", "high"] as const;
export type GoalPriority = (typeof GOAL_PRIORITIES)[number];
export const GOAL_APP_FAMILIES = [
  "browser",
  "communication",
  "office",
  "development",
  "media",
  "system",
  "unknown"
] as const;
export type GoalAppFamily = (typeof GOAL_APP_FAMILIES)[number];

export const GOAL_SUCCESS_CRITERION_KINDS = [
  "state_observed",
  "url_verified",
  "content_available",
  "draft_prepared",
  "file_exists",
  "application_state_verified",
  "checkpoint_passed",
  "operator_acknowledged"
] as const;
export type GoalSuccessCriterionKind = (typeof GOAL_SUCCESS_CRITERION_KINDS)[number];

export interface GoalSuccessCriterion {
  criterionId: string;
  kind: GoalSuccessCriterionKind;
  summary: string;
  required: boolean;
}

export interface GoalExecutionBudget {
  maxSteps: number;
  maxDurationMs: number;
  maxExternalEffects: number;
  maxUserInterruptions: number;
}

export interface GoalFallbackPolicy {
  allowed: boolean;
  maxFallbacksPerStep: number;
  maxReplans: number;
  allowGuideMode: boolean;
}

export interface GoalVerificationRequirement {
  mode: "all_required" | "any_required";
  minimumStrength: CapabilityRouteVerificationStrength;
  independentObservationRequired: boolean;
}

export interface AgentGoal {
  schemaVersion: typeof GOAL_PLANNING_SCHEMA_VERSION;
  goalId: string;
  ownerSessionId: string;
  category: AgentGoalCategory;
  summary: string;
  desiredOutcome: string;
  successCriteria: GoalSuccessCriterion[];
  constraints: GoalConstraint[];
  allowedEffects: GoalEffect[];
  prohibitedEffects: GoalEffect[];
  requiredConfirmations: GoalConfirmationRequirement[];
  privacy: GoalPrivacyClass;
  appFamily?: GoalAppFamily;
  priority: GoalPriority;
  deadline?: string;
  executionBudget: GoalExecutionBudget;
  fallbackPolicy: GoalFallbackPolicy;
  verification: GoalVerificationRequirement;
  status: AgentGoalStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  redacted: true;
}

export const PLAN_STATES = [
  "draft",
  "selected",
  "active",
  "waiting",
  "replanning",
  "blocked",
  "completed",
  "failed",
  "cancelled",
  "superseded"
] as const;
export type ExecutionPlanState = (typeof PLAN_STATES)[number];

export const PLAN_OPERATION_CATEGORIES = [
  "inspect_state",
  "check_prerequisite",
  "navigate",
  "prepare_draft",
  "create_local_file",
  "modify_local_file",
  "change_application_state",
  "synthesize_local_audio",
  "show_visual_guidance",
  "wait_for_operator",
  "verify_state"
] as const;
export type PlanOperationCategory = (typeof PLAN_OPERATION_CATEGORIES)[number];

export const PLAN_CAPABILITY_FAMILIES = [
  "browser",
  "native_adapter",
  "accessibility",
  "vision",
  "desktop",
  "file",
  "shell",
  "speech",
  "overlay",
  "guide"
] as const;
export type PlanCapabilityFamily = (typeof PLAN_CAPABILITY_FAMILIES)[number];

export const PLAN_GROUNDING_REQUIREMENTS = [
  "none",
  "live_browser_state",
  "live_application_state",
  "fresh_accessibility_state",
  "fresh_screenshot",
  "fresh_vision_target",
  "operator_observation"
] as const;
export type PlanGroundingRequirement = (typeof PLAN_GROUNDING_REQUIREMENTS)[number];

export const PLAN_COMPLETION_CONDITIONS = [
  "observation_matches",
  "checkpoint_passes",
  "state_change_verified",
  "artifact_exists",
  "operator_acknowledges"
] as const;
export type PlanCompletionCondition = (typeof PLAN_COMPLETION_CONDITIONS)[number];

export const PLAN_FAILURE_CODES = [
  "capability_unavailable",
  "prerequisite_failed",
  "policy_blocked",
  "grant_missing",
  "confirmation_declined",
  "target_stale",
  "execution_failed",
  "verification_failed",
  "timeout",
  "operator_cancelled",
  "protected_context",
  "budget_exhausted"
] as const;
export type PlanFailureCode = (typeof PLAN_FAILURE_CODES)[number];

export const REPLAN_REASONS = [
  "prerequisite_failed",
  "route_unavailable",
  "target_stale",
  "execution_failed",
  "verification_failed",
  "application_state_changed",
  "user_constraints_changed",
  "confirmation_declined",
  "effect_changed",
  "recipient_changed",
  "risk_changed",
  "budget_exceeded",
  "safer_route_available"
] as const;
export type ReplanReason = (typeof REPLAN_REASONS)[number];

export interface PlanStep {
  stepId: string;
  order: number;
  operation: PlanOperationCategory;
  requiredCapability: PlanCapabilityFamily;
  allowedRoutes: CapabilityRouteFamily[];
  expectedEffect: GoalEffect;
  expectedExecutionClass: ToolExecutionClass;
  riskLevel: RiskLevel;
  grounding: PlanGroundingRequirement;
  confirmation: GoalConfirmationRequirement;
  timeoutMs: number;
  retryLimit: 0 | 1;
  fallbackBudget: number;
  dependencyStepIds: string[];
  verificationCheckpointIds: string[];
  completionCondition: PlanCompletionCondition;
  safeFailureCodes: PlanFailureCode[];
}

export const VERIFICATION_CHECKPOINT_KINDS = [
  "browser_state",
  "application_state",
  "accessibility_state",
  "file_state",
  "vision_state",
  "operator_acknowledgement"
] as const;
export type VerificationCheckpointKind = (typeof VERIFICATION_CHECKPOINT_KINDS)[number];
export const VERIFICATION_CHECKPOINT_STATUSES = [
  "pending",
  "passed",
  "failed",
  "blocked",
  "timeout"
] as const;
export type VerificationCheckpointStatus = (typeof VERIFICATION_CHECKPOINT_STATUSES)[number];

export interface VerificationCheckpoint {
  checkpointId: string;
  kind: VerificationCheckpointKind;
  summary: string;
  sensitivity: GoalPrivacyClass;
  required: boolean;
  minimumStrength: CapabilityRouteVerificationStrength;
  completionCondition: PlanCompletionCondition;
  timeoutMs: number;
  status: VerificationCheckpointStatus;
}

export interface ExecutionPlan {
  schemaVersion: typeof GOAL_PLANNING_SCHEMA_VERSION;
  planId: string;
  goalId: string;
  revision: number;
  assumptions: string[];
  prerequisites: Array<{
    capability: PlanCapabilityFamily;
    requiredHealth: "healthy" | "degraded_allowed";
  }>;
  steps: PlanStep[];
  permittedRouteFamilies: CapabilityRouteFamily[];
  checkpoints: VerificationCheckpoint[];
  expectedEffects: GoalEffect[];
  confirmationBoundaries: GoalConfirmationRequirement[];
  expectedLatencyMs: number;
  expectedCostClass: "low" | "medium" | "high";
  uncertainty: "low" | "medium" | "high";
  fallbackBudget: number;
  replanBudget: number;
  currentStepIndex: number;
  state: ExecutionPlanState;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  executable: false;
  redacted: true;
}

export interface ActionRoute {
  routeId: string;
  planId: string;
  stepId: string;
  family: CapabilityRouteFamily;
  health: "healthy" | "degraded" | "unavailable";
  verificationStrength: CapabilityRouteVerificationStrength;
  latencyClass: "fast" | "moderate" | "slow";
  riskLevel: RiskLevel;
  expectedEffect: GoalEffect;
  requiresConfirmation: boolean;
  reasonCode:
    | "deterministic_fast_path"
    | "verified_strategy"
    | "healthy_verified_route"
    | "bounded_safe_route"
    | "guide_required"
    | "no_safe_route";
  selectedAt: string;
  expiresAt: string;
  executable: false;
}

export const GOAL_OUTCOME_STATUSES = [
  "completed",
  "failed",
  "blocked",
  "cancelled",
  "expired"
] as const;
export type GoalOutcomeStatus = (typeof GOAL_OUTCOME_STATUSES)[number];

export interface GoalOutcome {
  goalId: string;
  planId?: string;
  status: GoalOutcomeStatus;
  verified: boolean;
  criteria: Array<{ criterionId: string; satisfied: boolean }>;
  checkpointIds: string[];
  summary: string;
  completedAt: string;
  redacted: true;
}

export type GoalDecisionLevel = 0 | 1 | 2 | 3;
export interface GoalDecisionInput {
  knownOperationCount: number;
  healthyRouteCount: number;
  decompositionRequired: boolean;
  directVerificationAvailable: boolean;
  activeVerifiedStrategy: boolean;
  materiallyAmbiguous: boolean;
  sensitiveExternalEffect: boolean;
  guideModeRequired: boolean;
}

export interface CandidatePlanEvaluation {
  plan: ExecutionPlan;
  policyCompatible: boolean;
  safety: "safe" | "conditional" | "blocked";
  maximumRisk: RiskLevel;
  goalCoverage: number;
  successCriteriaCoverage: number;
  verificationStrength: CapabilityRouteVerificationStrength;
  capabilityHealth: "healthy" | "degraded" | "unavailable";
  verifiedReliability: number;
  expectedRecoveryMs: number;
  confirmationCount: number;
  externalEffectCount: number;
  userInterruptionCount: number;
  contextTokens: number;
  dependencyCount: number;
}

export interface PlanSelection {
  selected?: ExecutionPlan;
  rankedPlanIds: string[];
  rejectedPlanIds: string[];
  reasonCode: "candidate_selected" | "no_safe_candidate";
}

export interface ReplanDecision {
  allowed: boolean;
  goalId: string;
  priorPlanId: string;
  reason: ReplanReason;
  nextRevision?: number;
  remainingReplanBudget: number;
  invalidateTargetBindings: boolean;
  requiresFreshConfirmation: boolean;
  code: "replan_allowed" | "replan_budget_exhausted" | "plan_terminal";
}

export interface GoalVisualDecisionInput {
  goalCategory: AgentGoalCategory;
  goalStatus: AgentGoalStatus;
  planState?: ExecutionPlanState;
  stepCount: number;
  currentStepIndex: number;
  expectedRemainingMs: number;
  waitingForApproval: boolean;
  blocked: boolean;
  recovering: boolean;
  guideMode: boolean;
  choiceCount: number;
}

export interface GoalVisualDecision {
  surfaceType: VisualSurfaceType;
  reasonCode:
    | "approval_required"
    | "blocked"
    | "recovering"
    | "manual_instruction"
    | "setup_checklist"
    | "plan_choices"
    | "multistep_progress"
    | "verified_result"
    | "compact_activity";
  compact: boolean;
}

const SAFE_ID = /^[A-Za-z][A-Za-z0-9_-]{1,119}$/;
const RAW_PRIVATE_OR_EXECUTABLE =
  /(?:https?:\/\/|file:\/\/|\/(?:home|tmp|etc|var|root)\/|[A-Z]:\\|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?<![A-Za-z0-9])(?:\+?\d[\d ()-]{6,}\d)(?![A-Za-z0-9])|(?:bearer|password|passwd|api[ _-]?key|access[ _-]?token|cookie|private key)\b|\b(?:browser|desktop|accessibility|file|shell|forge|workflow|scheduler|overlay|speech|vision)\.[a-z_]+\b|\{\{|\}\}|\$\(|`|&&|\|\||(?:^|\s)(?:sudo|curl|wget|rm\s+-rf|bash|sh)\b)/i;
const STATE_CHANGING_EFFECTS = new Set<GoalEffect>([
  "local_file_create",
  "local_file_modify",
  "application_state_change",
  "browser_navigation",
  "form_draft",
  "communication_send",
  "external_submit",
  "upload",
  "delete",
  "payment",
  "local_audio"
]);
const KNOWN_KEYS = {
  goal: new Set([
    "schemaVersion", "goalId", "ownerSessionId", "category", "summary", "desiredOutcome",
    "successCriteria", "constraints", "allowedEffects", "prohibitedEffects",
    "requiredConfirmations", "privacy", "appFamily", "priority", "deadline",
    "executionBudget", "fallbackPolicy", "verification", "status", "createdAt",
    "updatedAt", "expiresAt", "redacted"
  ]),
  criterion: new Set(["criterionId", "kind", "summary", "required"]),
  executionBudget: new Set(["maxSteps", "maxDurationMs", "maxExternalEffects", "maxUserInterruptions"]),
  fallbackPolicy: new Set(["allowed", "maxFallbacksPerStep", "maxReplans", "allowGuideMode"]),
  verificationRequirement: new Set(["mode", "minimumStrength", "independentObservationRequired"]),
  plan: new Set([
    "schemaVersion", "planId", "goalId", "revision", "assumptions", "prerequisites",
    "steps", "permittedRouteFamilies", "checkpoints", "expectedEffects",
    "confirmationBoundaries", "expectedLatencyMs", "expectedCostClass", "uncertainty",
    "fallbackBudget", "replanBudget", "currentStepIndex", "state", "createdAt",
    "updatedAt", "expiresAt", "executable", "redacted"
  ]),
  prerequisite: new Set(["capability", "requiredHealth"]),
  step: new Set([
    "stepId", "order", "operation", "requiredCapability", "allowedRoutes", "expectedEffect",
    "expectedExecutionClass", "riskLevel", "grounding", "confirmation", "timeoutMs",
    "retryLimit", "fallbackBudget", "dependencyStepIds", "verificationCheckpointIds",
    "completionCondition", "safeFailureCodes"
  ]),
  checkpoint: new Set([
    "checkpointId", "kind", "summary", "sensitivity", "required", "minimumStrength",
    "completionCondition", "timeoutMs", "status"
  ]),
  route: new Set([
    "routeId", "planId", "stepId", "family", "health", "verificationStrength",
    "latencyClass", "riskLevel", "expectedEffect", "requiresConfirmation", "reasonCode",
    "selectedAt", "expiresAt", "executable"
  ]),
  outcome: new Set([
    "goalId", "planId", "status", "verified", "criteria", "checkpointIds", "summary",
    "completedAt", "redacted"
  ]),
  outcomeCriterion: new Set(["criterionId", "satisfied"]),
  candidate: new Set([
    "plan", "policyCompatible", "safety", "maximumRisk", "goalCoverage",
    "successCriteriaCoverage", "verificationStrength", "capabilityHealth",
    "verifiedReliability", "expectedRecoveryMs", "confirmationCount",
    "externalEffectCount", "userInterruptionCount", "contextTokens", "dependencyCount"
  ])
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unknownKeys(value: unknown, keys: ReadonlySet<string>, code: string): string[] {
  if (!isRecord(value)) return [code.replace("_unknown_field", "_invalid")];
  return Object.keys(value).some((key) => !keys.has(key)) ? [code] : [];
}

function validId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function safeText(value: unknown, max: number): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= max
    && !/[\u0000-\u001f\u007f]/.test(value)
    && !RAW_PRIVATE_OR_EXECUTABLE.test(value);
}

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function uniqueEnum<T extends string>(value: unknown, allowed: readonly T[], max: number): value is T[] {
  return Array.isArray(value)
    && value.length <= max
    && new Set(value).size === value.length
    && value.every((item) => typeof item === "string" && allowed.includes(item as T));
}

function integerBetween(value: unknown, minimum: number, maximum: number): boolean {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function timeOrder(createdAt: string, updatedAt: string, expiresAt: string): boolean {
  return Date.parse(createdAt) <= Date.parse(updatedAt) && Date.parse(updatedAt) < Date.parse(expiresAt);
}

export function validateAgentGoal(goal: AgentGoal): string[] {
  const errors = unknownKeys(goal, KNOWN_KEYS.goal, "goal_unknown_field");
  if (!isRecord(goal)) return errors;
  if (goal.schemaVersion !== GOAL_PLANNING_SCHEMA_VERSION) errors.push("goal_schema_unsupported");
  if (!validId(goal.goalId) || !validId(goal.ownerSessionId)) errors.push("goal_id_invalid");
  if (!AGENT_GOAL_CATEGORIES.includes(goal.category)) errors.push("goal_category_invalid");
  if (!safeText(goal.summary, 240) || !safeText(goal.desiredOutcome, 500)) errors.push("goal_text_unsafe");
  if (!Array.isArray(goal.successCriteria) || goal.successCriteria.length < 1 || goal.successCriteria.length > 12) {
    errors.push("goal_success_criteria_out_of_bounds");
  } else {
    const ids = new Set<string>();
    for (const criterion of goal.successCriteria) {
      errors.push(...unknownKeys(criterion, KNOWN_KEYS.criterion, "goal_criterion_unknown_field"));
      if (!validId(criterion?.criterionId) || ids.has(criterion.criterionId)) errors.push("goal_criterion_id_invalid");
      else ids.add(criterion.criterionId);
      if (!GOAL_SUCCESS_CRITERION_KINDS.includes(criterion?.kind) || !safeText(criterion?.summary, 240) || typeof criterion?.required !== "boolean") errors.push("goal_criterion_invalid");
    }
  }
  if (!uniqueEnum(goal.constraints, GOAL_CONSTRAINTS, 12)) errors.push("goal_constraints_invalid");
  const allowedEffectsValid = uniqueEnum(goal.allowedEffects, GOAL_EFFECTS, 10);
  const prohibitedEffectsValid = uniqueEnum(goal.prohibitedEffects, GOAL_EFFECTS, 15);
  if (!allowedEffectsValid || !prohibitedEffectsValid) errors.push("goal_effects_invalid");
  if (allowedEffectsValid && prohibitedEffectsValid
    && goal.allowedEffects.some((effect) => goal.prohibitedEffects.includes(effect))) errors.push("goal_effect_conflict");
  if (allowedEffectsValid && Array.isArray(goal.constraints)) {
    const forbiddenByConstraint: Partial<Record<GoalConstraint, GoalEffect[]>> = {
      read_only: GOAL_EFFECTS.filter((effect) => effect !== "observe" && effect !== "visual_assistance"),
      no_external_send: ["communication_send"],
      no_submit: ["external_submit"],
      no_upload: ["upload"],
      no_delete: ["delete"],
      no_payment: ["payment"],
      no_private_data: ["inspect_private_data"]
    };
    if (goal.constraints.some((constraint) =>
      (forbiddenByConstraint[constraint] ?? []).some((effect) => goal.allowedEffects.includes(effect)))) {
      errors.push("goal_constraint_effect_conflict");
    }
  }
  if (!uniqueEnum(goal.requiredConfirmations, GOAL_CONFIRMATION_REQUIREMENTS, 6)) errors.push("goal_confirmations_invalid");
  if (Array.isArray(goal.requiredConfirmations)
    && goal.requiredConfirmations.includes("none")
    && goal.requiredConfirmations.length > 1) errors.push("goal_confirmations_conflict");
  if (allowedEffectsValid && Array.isArray(goal.requiredConfirmations)) {
    if (goal.allowedEffects.includes("inspect_private_data")
      && !goal.requiredConfirmations.includes("before_private_read")) {
      errors.push("goal_private_read_confirmation_required");
    }
    if (goal.allowedEffects.some((effect) => STATE_CHANGING_EFFECTS.has(effect))
      && !goal.requiredConfirmations.some((requirement) =>
        ["before_state_change", "before_external_effect", "before_target_change", "every_state_change"].includes(requirement))) {
      errors.push("goal_state_change_confirmation_required");
    }
  }
  if (!GOAL_PRIVACY_CLASSES.includes(goal.privacy) || !GOAL_PRIORITIES.includes(goal.priority)) errors.push("goal_classification_invalid");
  if (goal.appFamily !== undefined && !GOAL_APP_FAMILIES.includes(goal.appFamily)) errors.push("goal_app_family_invalid");
  if (goal.deadline !== undefined && !validIso(goal.deadline)) errors.push("goal_deadline_invalid");
  errors.push(...unknownKeys(goal.executionBudget, KNOWN_KEYS.executionBudget, "goal_budget_unknown_field"));
  if (!integerBetween(goal.executionBudget?.maxSteps, 1, 12)
    || !integerBetween(goal.executionBudget?.maxDurationMs, 1_000, 3_600_000)
    || !integerBetween(goal.executionBudget?.maxExternalEffects, 0, 12)
    || !integerBetween(goal.executionBudget?.maxUserInterruptions, 0, 12)) errors.push("goal_budget_invalid");
  errors.push(...unknownKeys(goal.fallbackPolicy, KNOWN_KEYS.fallbackPolicy, "goal_fallback_unknown_field"));
  if (typeof goal.fallbackPolicy?.allowed !== "boolean"
    || !integerBetween(goal.fallbackPolicy?.maxFallbacksPerStep, 0, 2)
    || !integerBetween(goal.fallbackPolicy?.maxReplans, 0, 3)
    || typeof goal.fallbackPolicy?.allowGuideMode !== "boolean") errors.push("goal_fallback_invalid");
  errors.push(...unknownKeys(goal.verification, KNOWN_KEYS.verificationRequirement, "goal_verification_unknown_field"));
  if (!["all_required", "any_required"].includes(goal.verification?.mode)
    || !["strong", "medium", "weak"].includes(goal.verification?.minimumStrength)
    || typeof goal.verification?.independentObservationRequired !== "boolean") errors.push("goal_verification_invalid");
  if (!AGENT_GOAL_STATUSES.includes(goal.status)) errors.push("goal_status_invalid");
  if (!validIso(goal.createdAt) || !validIso(goal.updatedAt) || !validIso(goal.expiresAt)
    || !timeOrder(goal.createdAt, goal.updatedAt, goal.expiresAt)) errors.push("goal_timestamps_invalid");
  if (goal.redacted !== true) errors.push("goal_redaction_required");
  return [...new Set(errors)];
}

export function validatePlanStep(step: PlanStep): string[] {
  const errors = unknownKeys(step, KNOWN_KEYS.step, "plan_step_unknown_field");
  if (!isRecord(step)) return errors;
  if (!validId(step.stepId) || !integerBetween(step.order, 0, 11)) errors.push("plan_step_identity_invalid");
  if (!PLAN_OPERATION_CATEGORIES.includes(step.operation)
    || !PLAN_CAPABILITY_FAMILIES.includes(step.requiredCapability)
    || !GOAL_EFFECTS.includes(step.expectedEffect)
    || !["read_only", "diagnostic", "metadata_only", "inert", "visual_only", "state_changing"].includes(step.expectedExecutionClass)
    || !["observe", "low", "medium", "high", "blocked"].includes(step.riskLevel)
    || !PLAN_GROUNDING_REQUIREMENTS.includes(step.grounding)
    || !GOAL_CONFIRMATION_REQUIREMENTS.includes(step.confirmation)
    || !PLAN_COMPLETION_CONDITIONS.includes(step.completionCondition)) errors.push("plan_step_enum_invalid");
  if (!uniqueEnum(step.allowedRoutes, [
    "browser_bridge", "structured_browser", "native_adapter", "accessibility",
    "local_ocr", "screenshot_vision", "desktop_input", "guide_only"
  ], 8) || step.allowedRoutes.length < 1) errors.push("plan_step_routes_invalid");
  if (!integerBetween(step.timeoutMs, 100, 120_000)
    || !integerBetween(step.retryLimit, 0, 1)
    || !integerBetween(step.fallbackBudget, 0, 2)) errors.push("plan_step_budget_invalid");
  if (!Array.isArray(step.dependencyStepIds) || step.dependencyStepIds.length > 11
    || new Set(step.dependencyStepIds).size !== step.dependencyStepIds.length
    || !step.dependencyStepIds.every(validId)
    || !Array.isArray(step.verificationCheckpointIds) || step.verificationCheckpointIds.length > 8
    || new Set(step.verificationCheckpointIds).size !== step.verificationCheckpointIds.length
    || !step.verificationCheckpointIds.every(validId)
    || !uniqueEnum(step.safeFailureCodes, PLAN_FAILURE_CODES, 12)) errors.push("plan_step_references_invalid");
  if (step.expectedExecutionClass === "state_changing" && step.confirmation === "none") errors.push("plan_step_confirmation_required");
  const effectMatchesClass =
    step.expectedExecutionClass === "state_changing" && STATE_CHANGING_EFFECTS.has(step.expectedEffect)
    || step.expectedExecutionClass === "metadata_only" && step.expectedEffect === "local_metadata_write"
    || step.expectedExecutionClass === "visual_only" && step.expectedEffect === "visual_assistance"
    || step.expectedExecutionClass === "read_only" && ["observe", "inspect_private_data"].includes(step.expectedEffect)
    || ["diagnostic", "inert"].includes(step.expectedExecutionClass) && step.expectedEffect === "observe";
  if (!effectMatchesClass) errors.push("plan_step_effect_class_conflict");
  if (step.riskLevel === "blocked") errors.push("plan_step_blocked_risk");
  return [...new Set(errors)];
}

export function validateVerificationCheckpoint(checkpoint: VerificationCheckpoint): string[] {
  const errors = unknownKeys(checkpoint, KNOWN_KEYS.checkpoint, "verification_checkpoint_unknown_field");
  if (!isRecord(checkpoint)) return errors;
  if (!validId(checkpoint.checkpointId) || !VERIFICATION_CHECKPOINT_KINDS.includes(checkpoint.kind)
    || !safeText(checkpoint.summary, 240) || !GOAL_PRIVACY_CLASSES.includes(checkpoint.sensitivity)
    || typeof checkpoint.required !== "boolean"
    || !["strong", "medium", "weak"].includes(checkpoint.minimumStrength)
    || !PLAN_COMPLETION_CONDITIONS.includes(checkpoint.completionCondition)
    || !integerBetween(checkpoint.timeoutMs, 100, 120_000)
    || !VERIFICATION_CHECKPOINT_STATUSES.includes(checkpoint.status)) errors.push("verification_checkpoint_invalid");
  if (checkpoint.sensitivity === "secret") errors.push("verification_checkpoint_secret_blocked");
  return [...new Set(errors)];
}

export function validateExecutionPlan(plan: ExecutionPlan, goal?: AgentGoal): string[] {
  const errors = unknownKeys(plan, KNOWN_KEYS.plan, "plan_unknown_field");
  if (!isRecord(plan)) return errors;
  if (plan.schemaVersion !== GOAL_PLANNING_SCHEMA_VERSION) errors.push("plan_schema_unsupported");
  if (!validId(plan.planId) || !validId(plan.goalId)) errors.push("plan_id_invalid");
  if (goal !== undefined && plan.goalId !== goal.goalId) errors.push("plan_goal_mismatch");
  if (!integerBetween(plan.revision, 1, 100)) errors.push("plan_revision_invalid");
  if (!Array.isArray(plan.assumptions) || plan.assumptions.length > 12 || !plan.assumptions.every((item) => safeText(item, 240))) errors.push("plan_assumptions_unsafe");
  if (!Array.isArray(plan.prerequisites) || plan.prerequisites.length > 20) errors.push("plan_prerequisites_out_of_bounds");
  else for (const prerequisite of plan.prerequisites) {
    errors.push(...unknownKeys(prerequisite, KNOWN_KEYS.prerequisite, "plan_prerequisite_unknown_field"));
    if (!PLAN_CAPABILITY_FAMILIES.includes(prerequisite?.capability)
      || !["healthy", "degraded_allowed"].includes(prerequisite?.requiredHealth)) errors.push("plan_prerequisite_invalid");
  }
  if (!Array.isArray(plan.steps) || plan.steps.length < 1 || plan.steps.length > 12) {
    errors.push("plan_steps_out_of_bounds");
  } else {
    const ids = new Set<string>();
    const checkpointIds = new Set(
      (Array.isArray(plan.checkpoints) ? plan.checkpoints : [])
        .filter(isRecord)
        .map((checkpoint) => checkpoint.checkpointId)
        .filter(validId)
    );
    plan.steps.forEach((step, index) => {
      errors.push(...validatePlanStep(step));
      if (!isRecord(step)) {
        errors.push("plan_step_invalid");
        return;
      }
      if (ids.has(step.stepId) || step.order !== index) errors.push("plan_step_order_invalid");
      ids.add(step.stepId);
      if (Array.isArray(step.dependencyStepIds)
        && step.dependencyStepIds.some((id) => !ids.has(id) || id === step.stepId)) errors.push("plan_step_dependency_invalid");
      if (Array.isArray(step.verificationCheckpointIds)
        && step.verificationCheckpointIds.some((id) => !checkpointIds.has(id))) errors.push("plan_step_checkpoint_missing");
      if (Array.isArray(plan.expectedEffects) && !plan.expectedEffects.includes(step.expectedEffect)) errors.push("plan_step_effect_missing");
      if (Array.isArray(plan.permittedRouteFamilies)
        && Array.isArray(step.allowedRoutes)
        && step.allowedRoutes.some((route) => !plan.permittedRouteFamilies.includes(route))) errors.push("plan_step_route_not_permitted");
    });
  }
  if (!uniqueEnum(plan.permittedRouteFamilies, [
    "browser_bridge", "structured_browser", "native_adapter", "accessibility",
    "local_ocr", "screenshot_vision", "desktop_input", "guide_only"
  ], 8) || plan.permittedRouteFamilies.length < 1) errors.push("plan_routes_invalid");
  if (!Array.isArray(plan.checkpoints) || plan.checkpoints.length > 24) errors.push("plan_checkpoints_out_of_bounds");
  else {
    const ids = new Set<string>();
    for (const checkpoint of plan.checkpoints) {
      errors.push(...validateVerificationCheckpoint(checkpoint));
      if (!isRecord(checkpoint)) {
        errors.push("plan_checkpoint_invalid");
        continue;
      }
      if (ids.has(checkpoint.checkpointId)) errors.push("plan_checkpoint_duplicate");
      ids.add(checkpoint.checkpointId);
    }
  }
  if (!uniqueEnum(plan.expectedEffects, GOAL_EFFECTS, 12)
    || !uniqueEnum(plan.confirmationBoundaries, GOAL_CONFIRMATION_REQUIREMENTS, 6)) errors.push("plan_effects_invalid");
  if (goal !== undefined) {
    if (Array.isArray(plan.expectedEffects)
      && plan.expectedEffects.some((effect) => goal.prohibitedEffects.includes(effect) || !goal.allowedEffects.includes(effect))) errors.push("plan_goal_effect_violation");
    if (Array.isArray(plan.steps) && plan.steps.length > goal.executionBudget.maxSteps
      || plan.fallbackBudget > goal.fallbackPolicy.maxFallbacksPerStep
      || plan.replanBudget > goal.fallbackPolicy.maxReplans) errors.push("plan_goal_budget_violation");
  }
  if (!integerBetween(plan.expectedLatencyMs, 0, 3_600_000)
    || !["low", "medium", "high"].includes(plan.expectedCostClass)
    || !["low", "medium", "high"].includes(plan.uncertainty)
    || !integerBetween(plan.fallbackBudget, 0, 2)
    || !integerBetween(plan.replanBudget, 0, 3)
    || !integerBetween(plan.currentStepIndex, 0, Math.max(0, (Array.isArray(plan.steps) ? plan.steps.length : 0) - 1))) errors.push("plan_budget_invalid");
  if (!PLAN_STATES.includes(plan.state)) errors.push("plan_state_invalid");
  if (!validIso(plan.createdAt) || !validIso(plan.updatedAt) || !validIso(plan.expiresAt)
    || !timeOrder(plan.createdAt, plan.updatedAt, plan.expiresAt)) errors.push("plan_timestamps_invalid");
  if (plan.executable !== false || plan.redacted !== true) errors.push("plan_non_executable_required");
  return [...new Set(errors)];
}

export function validateActionRoute(route: ActionRoute, plan?: ExecutionPlan): string[] {
  const errors = unknownKeys(route, KNOWN_KEYS.route, "action_route_unknown_field");
  if (!isRecord(route)) return errors;
  if (!validId(route.routeId) || !validId(route.planId) || !validId(route.stepId)) errors.push("action_route_id_invalid");
  if (!["browser_bridge", "structured_browser", "native_adapter", "accessibility", "local_ocr", "screenshot_vision", "desktop_input", "guide_only"].includes(route.family)
    || !["healthy", "degraded", "unavailable"].includes(route.health)
    || !["strong", "medium", "weak"].includes(route.verificationStrength)
    || !["fast", "moderate", "slow"].includes(route.latencyClass)
    || !["observe", "low", "medium", "high", "blocked"].includes(route.riskLevel)
    || !GOAL_EFFECTS.includes(route.expectedEffect)
    || typeof route.requiresConfirmation !== "boolean"
    || !["deterministic_fast_path", "verified_strategy", "healthy_verified_route", "bounded_safe_route", "guide_required", "no_safe_route"].includes(route.reasonCode)) errors.push("action_route_invalid");
  if (!validIso(route.selectedAt) || !validIso(route.expiresAt)
    || Date.parse(route.selectedAt) >= Date.parse(route.expiresAt)) errors.push("action_route_timestamps_invalid");
  if (route.executable !== false) errors.push("action_route_non_executable_required");
  if (route.health === "unavailable" && route.reasonCode !== "no_safe_route" && route.reasonCode !== "guide_required") errors.push("action_route_unavailable_selected");
  if (route.riskLevel === "blocked" && route.reasonCode !== "no_safe_route") errors.push("action_route_blocked_selected");
  if (plan !== undefined) {
    const step = plan.steps[plan.currentStepIndex];
    if (route.planId !== plan.planId || step === undefined || route.stepId !== step.stepId
      || !step.allowedRoutes.includes(route.family)) errors.push("action_route_plan_mismatch");
    if (step !== undefined && route.requiresConfirmation !== (step.confirmation !== "none")) {
      errors.push("action_route_confirmation_mismatch");
    }
  }
  return [...new Set(errors)];
}

export function validateGoalOutcome(outcome: GoalOutcome, goal?: AgentGoal, plan?: ExecutionPlan): string[] {
  const errors = unknownKeys(outcome, KNOWN_KEYS.outcome, "goal_outcome_unknown_field");
  if (!isRecord(outcome)) return errors;
  if (!validId(outcome.goalId) || outcome.planId !== undefined && !validId(outcome.planId)
    || !GOAL_OUTCOME_STATUSES.includes(outcome.status)
    || typeof outcome.verified !== "boolean"
    || !safeText(outcome.summary, 240)
    || !validIso(outcome.completedAt)
    || outcome.redacted !== true) errors.push("goal_outcome_invalid");
  if (!Array.isArray(outcome.criteria) || outcome.criteria.length < 1 || outcome.criteria.length > 12) errors.push("goal_outcome_criteria_invalid");
  else {
    const ids = new Set<string>();
    for (const criterion of outcome.criteria) {
      errors.push(...unknownKeys(criterion, KNOWN_KEYS.outcomeCriterion, "goal_outcome_criterion_unknown_field"));
      if (!validId(criterion?.criterionId) || ids.has(criterion.criterionId) || typeof criterion?.satisfied !== "boolean") errors.push("goal_outcome_criterion_invalid");
      ids.add(criterion?.criterionId);
    }
  }
  if (!Array.isArray(outcome.checkpointIds) || outcome.checkpointIds.length > 24
    || new Set(outcome.checkpointIds).size !== outcome.checkpointIds.length
    || !outcome.checkpointIds.every(validId)) errors.push("goal_outcome_checkpoints_invalid");
  const validOutcomeCriteria = Array.isArray(outcome.criteria)
    ? outcome.criteria.filter((criterion): criterion is { criterionId: string; satisfied: boolean } =>
      isRecord(criterion) && validId(criterion.criterionId) && typeof criterion.satisfied === "boolean")
    : [];
  if (goal !== undefined && Array.isArray(outcome.criteria)) {
    if (outcome.goalId !== goal.goalId) errors.push("goal_outcome_goal_mismatch");
    const criteria = new Map(validOutcomeCriteria.map((criterion) => [criterion.criterionId, criterion.satisfied]));
    if (goal.successCriteria.some((criterion) => criterion.required && criteria.get(criterion.criterionId) !== true)) errors.push("goal_outcome_required_criterion_missing");
  } else if (goal !== undefined && outcome.goalId !== goal.goalId) {
    errors.push("goal_outcome_goal_mismatch");
  }
  if (plan !== undefined && outcome.planId !== plan.planId) errors.push("goal_outcome_plan_mismatch");
  if (plan !== undefined && Array.isArray(outcome.checkpointIds) && outcome.checkpointIds.some((id) =>
    !plan.checkpoints.some((checkpoint) => checkpoint.checkpointId === id))) errors.push("goal_outcome_checkpoint_unknown");
  if (outcome.status === "completed" && Array.isArray(outcome.criteria)
    && validOutcomeCriteria.some((criterion) => !criterion.satisfied)) errors.push("goal_outcome_criterion_unsatisfied");
  if (outcome.status === "completed" && !outcome.verified) errors.push("goal_outcome_completion_unverified");
  if (outcome.status === "completed" && plan !== undefined && plan.state !== "completed") errors.push("goal_outcome_plan_not_completed");
  return [...new Set(errors)];
}

export function determineGoalDecisionLevel(input: GoalDecisionInput): GoalDecisionLevel {
  if (input.materiallyAmbiguous || input.sensitiveExternalEffect || input.guideModeRequired || input.healthyRouteCount === 0) return 3;
  if (input.knownOperationCount === 1 && !input.decompositionRequired && input.directVerificationAvailable) return 0;
  if (input.activeVerifiedStrategy && input.knownOperationCount > 0) return 1;
  return 2;
}

function safetyRank(value: CandidatePlanEvaluation["safety"]): number {
  return value === "safe" ? 0 : value === "conditional" ? 1 : 2;
}
function riskRank(value: RiskLevel): number {
  return ({ observe: 0, low: 1, medium: 2, high: 3, blocked: 4 } as const)[value];
}
function verificationRank(value: CapabilityRouteVerificationStrength): number {
  return ({ strong: 0, medium: 1, weak: 2 } as const)[value];
}
function healthRank(value: CandidatePlanEvaluation["capabilityHealth"]): number {
  return value === "healthy" ? 0 : value === "degraded" ? 1 : 2;
}
function candidateValid(candidate: CandidatePlanEvaluation): boolean {
  return candidate.policyCompatible
    && candidate.safety !== "blocked"
    && candidate.maximumRisk !== "blocked"
    && candidate.capabilityHealth !== "unavailable"
    && validateCandidatePlanEvaluation(candidate).length === 0
    && validateExecutionPlan(candidate.plan).length === 0;
}

export function validateCandidatePlanEvaluation(candidate: CandidatePlanEvaluation): string[] {
  const errors = unknownKeys(candidate, KNOWN_KEYS.candidate, "candidate_plan_unknown_field");
  if (!isRecord(candidate)) return errors;
  if (typeof candidate.policyCompatible !== "boolean"
    || !["safe", "conditional", "blocked"].includes(candidate.safety)
    || !["observe", "low", "medium", "high", "blocked"].includes(candidate.maximumRisk)
    || !["strong", "medium", "weak"].includes(candidate.verificationStrength)
    || !["healthy", "degraded", "unavailable"].includes(candidate.capabilityHealth)) errors.push("candidate_plan_classification_invalid");
  for (const value of [candidate.goalCoverage, candidate.successCriteriaCoverage]) {
    if (!Number.isFinite(value) || value < 0 || value > 100) errors.push("candidate_plan_coverage_invalid");
  }
  if (!Number.isFinite(candidate.verifiedReliability)
    || candidate.verifiedReliability < 0 || candidate.verifiedReliability > 1) errors.push("candidate_plan_reliability_invalid");
  if (!integerBetween(candidate.expectedRecoveryMs, 0, 3_600_000)
    || !integerBetween(candidate.confirmationCount, 0, 12)
    || !integerBetween(candidate.externalEffectCount, 0, 12)
    || !integerBetween(candidate.userInterruptionCount, 0, 12)
    || !integerBetween(candidate.contextTokens, 0, 100_000)
    || !integerBetween(candidate.dependencyCount, 0, 50)) errors.push("candidate_plan_cost_invalid");
  if (candidate.plan === undefined || validateExecutionPlan(candidate.plan).length > 0) errors.push("candidate_plan_invalid");
  return [...new Set(errors)];
}

/**
 * Lexicographic comparison intentionally keeps policy, safety, risk, coverage,
 * and verification ahead of latency and context cost.
 */
export function compareCandidatePlans(a: CandidatePlanEvaluation, b: CandidatePlanEvaluation): number {
  const eligibility = Number(!candidateValid(a)) - Number(!candidateValid(b));
  if (eligibility !== 0) return eligibility;
  const safety = safetyRank(a.safety) - safetyRank(b.safety);
  if (safety !== 0) return safety;
  const risk = riskRank(a.maximumRisk) - riskRank(b.maximumRisk);
  if (risk !== 0) return risk;
  const aCoverage = Math.min(a.goalCoverage, a.successCriteriaCoverage);
  const bCoverage = Math.min(b.goalCoverage, b.successCriteriaCoverage);
  if (aCoverage !== bCoverage) return bCoverage - aCoverage;
  const verification = verificationRank(a.verificationStrength) - verificationRank(b.verificationStrength);
  if (verification !== 0) return verification;
  const health = healthRank(a.capabilityHealth) - healthRank(b.capabilityHealth);
  if (health !== 0) return health;
  if (a.verifiedReliability !== b.verifiedReliability) return b.verifiedReliability - a.verifiedReliability;
  const aCost = a.plan.expectedLatencyMs + a.expectedRecoveryMs + a.confirmationCount * 250
    + a.externalEffectCount * 250 + a.userInterruptionCount * 250
    + Math.ceil(a.contextTokens / 100) + a.dependencyCount * 10;
  const bCost = b.plan.expectedLatencyMs + b.expectedRecoveryMs + b.confirmationCount * 250
    + b.externalEffectCount * 250 + b.userInterruptionCount * 250
    + Math.ceil(b.contextTokens / 100) + b.dependencyCount * 10;
  return aCost - bCost || a.plan.planId.localeCompare(b.plan.planId);
}

export function selectCandidatePlan(candidates: CandidatePlanEvaluation[]): PlanSelection {
  if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 4) {
    return { rankedPlanIds: [], rejectedPlanIds: [], reasonCode: "no_safe_candidate" };
  }
  const ranked = [...candidates].sort(compareCandidatePlans);
  const selected = ranked.find(candidateValid);
  return {
    ...(selected === undefined ? {} : { selected: selected.plan }),
    rankedPlanIds: ranked.map((candidate) => candidate.plan.planId),
    rejectedPlanIds: ranked.filter((candidate) => !candidateValid(candidate)).map((candidate) => candidate.plan.planId),
    reasonCode: selected === undefined ? "no_safe_candidate" : "candidate_selected"
  };
}

export function planReplanDecision(plan: ExecutionPlan, reason: ReplanReason): ReplanDecision {
  if (["completed", "failed", "cancelled", "superseded"].includes(plan.state)) {
    return {
      allowed: false,
      goalId: plan.goalId,
      priorPlanId: plan.planId,
      reason,
      remainingReplanBudget: plan.replanBudget,
      invalidateTargetBindings: true,
      requiresFreshConfirmation: true,
      code: "plan_terminal"
    };
  }
  if (plan.replanBudget < 1 || plan.revision >= 100) {
    return {
      allowed: false,
      goalId: plan.goalId,
      priorPlanId: plan.planId,
      reason,
      remainingReplanBudget: 0,
      invalidateTargetBindings: true,
      requiresFreshConfirmation: true,
      code: "replan_budget_exhausted"
    };
  }
  return {
    allowed: true,
    goalId: plan.goalId,
    priorPlanId: plan.planId,
    reason,
    nextRevision: plan.revision + 1,
    remainingReplanBudget: plan.replanBudget - 1,
    invalidateTargetBindings: true,
    requiresFreshConfirmation: [
      "target_stale",
      "user_constraints_changed",
      "confirmation_declined",
      "effect_changed",
      "recipient_changed",
      "risk_changed",
      "safer_route_available"
    ].includes(reason),
    code: "replan_allowed"
  };
}

export function selectGoalVisualSurface(input: GoalVisualDecisionInput): GoalVisualDecision {
  if (input.waitingForApproval || input.goalStatus === "waiting_for_approval") {
    return { surfaceType: "approval_notice", reasonCode: "approval_required", compact: false };
  }
  if (input.blocked || input.goalStatus === "blocked" || input.planState === "blocked") {
    return { surfaceType: "blocked_card", reasonCode: "blocked", compact: false };
  }
  if (input.recovering || input.planState === "replanning") {
    return { surfaceType: "recovery_card", reasonCode: "recovering", compact: false };
  }
  if (input.guideMode || input.goalStatus === "waiting_for_user") {
    return { surfaceType: "instruction_card", reasonCode: "manual_instruction", compact: false };
  }
  if (input.goalStatus === "completed" || input.planState === "completed") {
    return { surfaceType: "result_summary", reasonCode: "verified_result", compact: false };
  }
  if (input.goalCategory === "browser_setup") {
    return { surfaceType: "task_checklist", reasonCode: "setup_checklist", compact: false };
  }
  if (input.choiceCount > 1) {
    return { surfaceType: "comparison_card", reasonCode: "plan_choices", compact: false };
  }
  if (input.stepCount > 1 || input.expectedRemainingMs >= 3_000) {
    return { surfaceType: "progress_card", reasonCode: "multistep_progress", compact: false };
  }
  return { surfaceType: "activity_pill", reasonCode: "compact_activity", compact: true };
}
