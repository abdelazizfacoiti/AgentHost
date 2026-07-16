import type { AppSensitivity, PolicyProfileName, RiskLevel, ToolExecutionClass } from "./types.js";

export const CAPABILITY_STRATEGY_SCHEMA_VERSION = 1 as const;
export const CAPABILITY_STRATEGY_STATUSES = ["proposed", "reviewed", "active", "degraded", "disabled", "archived"] as const;
export type CapabilityStrategyStatus = (typeof CAPABILITY_STRATEGY_STATUSES)[number];
export const CAPABILITY_STRATEGY_SOURCES = ["built_in", "reviewed_local"] as const;
export type CapabilityStrategySource = (typeof CAPABILITY_STRATEGY_SOURCES)[number];
export const CAPABILITY_STRATEGY_GOALS = [
  "browser_navigation", "webpage_inspection", "form_preparation", "form_submission_boundary",
  "screenshot_target_recovery", "visual_assistance", "browser_bridge_recovery", "meeting_observation",
  "meeting_recap", "local_tts", "speech_output"
] as const;
export type CapabilityStrategyGoal = (typeof CAPABILITY_STRATEGY_GOALS)[number];
export const CAPABILITY_STRATEGY_FAMILIES = ["browser", "accessibility", "vision", "desktop", "overlay", "guide", "adapter", "speech_unavailable"] as const;
export type CapabilityStrategyFamily = (typeof CAPABILITY_STRATEGY_FAMILIES)[number];
export const CAPABILITY_STRATEGY_OPERATIONS = [
  "inspect_bridge", "reuse_tab", "open_tab", "navigate", "wait_ready", "verify_url", "inspect_page",
  "find_element", "prepare_field", "submission_boundary", "recover_target", "show_visual_guidance",
  "inspect_meeting_state", "prepare_recap", "synthesize_local_audio", "prepare_speech_output", "guide_operator"
] as const;
export type CapabilityStrategyOperation = (typeof CAPABILITY_STRATEGY_OPERATIONS)[number];
export const CAPABILITY_STRATEGY_BINDINGS = ["none", "normalized_url", "current_session_goal", "declared_parameter", "fresh_target_reference"] as const;
export type CapabilityStrategyBinding = (typeof CAPABILITY_STRATEGY_BINDINGS)[number];
export const CAPABILITY_STRATEGY_RESULTS = ["bridge_status", "browser_tab", "page_context", "field_metadata", "checkpoint_passed", "visual_session", "meeting_metadata", "audio_artifact", "operator_guidance"] as const;
export type CapabilityStrategyResult = (typeof CAPABILITY_STRATEGY_RESULTS)[number];
export const CAPABILITY_STRATEGY_CHECKPOINTS = ["bridge_paired", "browser_url_verified", "page_ready", "safe_structure_observed", "field_prepared_without_submit", "target_revalidated", "visual_session_state", "meeting_source_authorized", "audio_ready", "manual_operator_check"] as const;
export type CapabilityStrategyCheckpoint = (typeof CAPABILITY_STRATEGY_CHECKPOINTS)[number];
export const CAPABILITY_STRATEGY_FAILURES = [
  "bridge_unavailable", "extension_disconnected", "extension_version_mismatch", "invalid_url", "navigation_timeout",
  "page_readiness_timeout", "target_not_found", "stale_target", "browser_closed", "authentication_required",
  "protected_browser_ui", "capability_unavailable", "grant_missing", "policy_blocked", "verification_failed", "receipt_invalid"
] as const;
export type CapabilityStrategyFailure = (typeof CAPABILITY_STRATEGY_FAILURES)[number];

export interface CapabilityStrategyStep {
  stepId: string;
  operation: CapabilityStrategyOperation;
  capabilityFamily: CapabilityStrategyFamily;
  trustedTool?: string;
  prerequisite?: string;
  inputBinding: CapabilityStrategyBinding;
  expectedResult: CapabilityStrategyResult;
  verification?: CapabilityStrategyCheckpoint;
  timeoutMs: number;
  retryLimit: 0 | 1;
  fallbackCode?: CapabilityStrategyFailure;
  expectedExecutionClass: ToolExecutionClass;
  expectedRiskLevel: RiskLevel;
  requiresDryRun: boolean;
  requiresConfirmation: boolean;
}

export interface CapabilityStrategyDefinition {
  strategyId: string;
  schemaVersion: 1;
  name: string;
  description: string;
  goalCategory: CapabilityStrategyGoal;
  goalVariants: string[];
  supportedOperatingSystems: string[];
  supportedApplications: string[];
  supportedAdapters: string[];
  compatibleProfiles: PolicyProfileName[];
  compatibleAgentHostRange: string;
  compatibleBrowserExtensionRange?: string;
  compatibleAdapterRanges: Record<string, string>;
  requiredCapabilities: string[];
  prerequisiteChecks: string[];
  preferredSteps: CapabilityStrategyStep[];
  fallbackStrategyIds: string[];
  verificationCheckpoints: CapabilityStrategyCheckpoint[];
  expectedSafety: { executionClasses: ToolExecutionClass[]; maxRiskLevel: RiskLevel; requiresDryRun: boolean; requiresConfirmation: boolean; exactTarget: boolean };
  expectedConfirmationBoundary: "none" | "before_state_change" | "separate_submission" | "never_automatic";
  knownFailureCodes: CapabilityStrategyFailure[];
  successCount: number;
  failureCount: number;
  consecutiveFailureCount: number;
  confidence: number;
  source: CapabilityStrategySource;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  lastVerifiedAt?: string;
  invalidationConditions: string[];
  status: CapabilityStrategyStatus;
  reviewId?: string;
  lastFailureCode?: CapabilityStrategyFailure;
}

export interface CapabilityStrategyReview {
  reviewId: string;
  strategyId: string;
  decision: "approve" | "reject";
  status: "approved" | "rejected";
  createdAt: string;
  updatedAt: string;
  reviewerSummary: "redacted";
  safetyFindings: string[];
  compatibilityFindings: string[];
  requiredOutcomeCount: 0 | 2;
}

export interface CapabilityStrategyHealth {
  strategyId?: string;
  compatible: boolean;
  availableCapabilities: string[];
  missingCapabilities: string[];
  checks: Array<{ check: string; status: "passed" | "failed" | "unknown"; reason: string }>;
  browserBridge?: { enabled: boolean; paired: boolean; connected: boolean; compatible: boolean; reason: string };
  blockers: string[];
  warnings: string[];
  evaluatedAt: string;
}

export interface CapabilityStrategySelection {
  selectionId: string;
  strategyId?: string;
  goalCategory: CapabilityStrategyGoal;
  selectedAt: string;
  expiresAt: string;
  mode: "normal" | "validation";
  score?: number;
  preferredStrategyId?: string;
  fallbackStrategyIds: string[];
  operationSummaries: Array<{ stepId: string; operation: CapabilityStrategyOperation; capabilityFamily: CapabilityStrategyFamily; verification?: CapabilityStrategyCheckpoint; requiresDryRun: boolean; requiresConfirmation: boolean }>;
  requiredCapabilities: string[];
  requiredGrantSummary: string[];
  expectedConfirmationBoundary: CapabilityStrategyDefinition["expectedConfirmationBoundary"];
  health: CapabilityStrategyHealth;
  explanation: string[];
  blockers: string[];
  warnings: string[];
  executable: false;
  actionsExecuted: false;
  confirmationTokensCreated: false;
}

export interface CapabilityStrategyOutcome {
  outcomeId: string;
  strategyId: string;
  selectionId: string;
  status: "verified_success" | "verified_failure" | "partial";
  toolFamily: CapabilityStrategyFamily;
  verification: CapabilityStrategyCheckpoint;
  failureCode?: CapabilityStrategyFailure;
  createdAt: string;
  redacted: true;
}

export interface CapabilityStrategySummary {
  counts: { proposed: number; reviewed: number; active: number; degraded: number; disabled: number; archived: number };
  lastSelection?: { strategyId?: string; goalCategory: CapabilityStrategyGoal; selectedAt: string; status: "selected" | "blocked"; redacted: true };
  active: Array<{ strategyId: string; goalCategory: CapabilityStrategyGoal; status: CapabilityStrategyStatus; confidence: number; successCount: number; failureCount: number; lastVerifiedAt?: string; source: CapabilityStrategySource; redacted: true }>;
  degraded: Array<{ strategyId: string; goalCategory: CapabilityStrategyGoal; lastFailureCode?: CapabilityStrategyFailure; redacted: true }>;
  redacted: true;
}

const MAX_STEPS = 12;
const MAX_FALLBACKS = 3;
const SAFE_TEXT = /^[^\u0000-\u001f\u007f]+$/;
const PROHIBITED_TEXT = /password|passwd|api[ _-]?key|access[ _-]?token|pairing\s*(token|secret)|confirmation\s*(token|secret)|cookie|private key|bearer|javascript:|data:|file:|curl\s+[^ ]+\||wget\s+[^ ]+\||message body|meeting transcript|screenshot bytes|ocr text|page text|\/home\/|\/tmp\//i;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{1,100}$/;
const TRUSTED_TOOL_NAMES = new Set(["browser.detect", "browser.get_active_tab", "browser.open_url", "browser.wait_for_state", "browser.current_url", "browser.get_page_context", "browser.find_element", "browser.fill_text", "browser.get_form_state", "browser.diagnose_bridge", "vision.find_target", "overlay.assistance_step_show", "guide.explain_strategy", "guide.create_steps"]);
const STRATEGY_KEYS = new Set(["strategyId", "schemaVersion", "name", "description", "goalCategory", "goalVariants", "supportedOperatingSystems", "supportedApplications", "supportedAdapters", "compatibleProfiles", "compatibleAgentHostRange", "compatibleBrowserExtensionRange", "compatibleAdapterRanges", "requiredCapabilities", "prerequisiteChecks", "preferredSteps", "fallbackStrategyIds", "verificationCheckpoints", "expectedSafety", "expectedConfirmationBoundary", "knownFailureCodes", "successCount", "failureCount", "consecutiveFailureCount", "confidence", "source", "createdAt", "updatedAt", "lastUsedAt", "lastVerifiedAt", "invalidationConditions", "status", "reviewId", "lastFailureCode"]);
const STEP_KEYS = new Set(["stepId", "operation", "capabilityFamily", "trustedTool", "prerequisite", "inputBinding", "expectedResult", "verification", "timeoutMs", "retryLimit", "fallbackCode", "expectedExecutionClass", "expectedRiskLevel", "requiresDryRun", "requiresConfirmation"]);
const SAFETY_KEYS = new Set(["executionClasses", "maxRiskLevel", "requiresDryRun", "requiresConfirmation", "exactTarget"]);

function validText(value: string, max: number, allowProhibited = false): boolean {
  return value.length > 0 && value.length <= max && SAFE_TEXT.test(value) && (allowProhibited || !PROHIBITED_TEXT.test(value));
}

export function validateCapabilityStrategy(strategy: CapabilityStrategyDefinition): void {
  if (strategy === null || typeof strategy !== "object") throw new Error("strategy_shape_invalid");
  for (const key of Object.keys(strategy as unknown as Record<string, unknown>)) if (!STRATEGY_KEYS.has(key)) throw new Error("strategy_unknown_field");
  if (strategy.schemaVersion !== CAPABILITY_STRATEGY_SCHEMA_VERSION) throw new Error("strategy_schema_unsupported");
  if (!CAPABILITY_STRATEGY_GOALS.includes(strategy.goalCategory) || !CAPABILITY_STRATEGY_STATUSES.includes(strategy.status) || !CAPABILITY_STRATEGY_SOURCES.includes(strategy.source)) throw new Error("strategy_enum_invalid");
  if (!SAFE_ID.test(strategy.strategyId) || !validText(strategy.name, 120) || !validText(strategy.description, 500)) throw new Error("strategy_text_invalid");
  if (!Array.isArray(strategy.preferredSteps) || !Array.isArray(strategy.fallbackStrategyIds) || !Array.isArray(strategy.verificationCheckpoints)) throw new Error("strategy_shape_invalid");
  if (strategy.expectedSafety === null || typeof strategy.expectedSafety !== "object") throw new Error("strategy_safety_invalid");
  for (const key of Object.keys(strategy.expectedSafety as unknown as Record<string, unknown>)) if (!SAFETY_KEYS.has(key)) throw new Error("strategy_safety_unknown_field");
  if (strategy.preferredSteps.length < 1 || strategy.preferredSteps.length > MAX_STEPS) throw new Error("strategy_steps_out_of_bounds");
  if (strategy.fallbackStrategyIds.length > MAX_FALLBACKS || new Set(strategy.fallbackStrategyIds).size !== strategy.fallbackStrategyIds.length) throw new Error("strategy_fallbacks_out_of_bounds");
  if (strategy.requiredCapabilities.length > 50 || strategy.prerequisiteChecks.length > 20 || strategy.knownFailureCodes.length > 30) throw new Error("strategy_metadata_out_of_bounds");
  if (!Number.isInteger(strategy.successCount) || strategy.successCount < 0 || !Number.isInteger(strategy.failureCount) || strategy.failureCount < 0 || !Number.isInteger(strategy.consecutiveFailureCount) || strategy.consecutiveFailureCount < 0) throw new Error("strategy_counters_invalid");
  if (!Number.isFinite(strategy.confidence) || strategy.confidence < 0 || strategy.confidence > 1) throw new Error("strategy_confidence_invalid");
  for (const step of strategy.preferredSteps) {
    if (step === null || typeof step !== "object") throw new Error("strategy_step_invalid");
    for (const key of Object.keys(step as unknown as Record<string, unknown>)) if (!STEP_KEYS.has(key)) throw new Error("strategy_step_unknown_field");
    if (!SAFE_ID.test(step.stepId) || !Number.isInteger(step.timeoutMs) || step.timeoutMs < 100 || step.timeoutMs > 120_000) throw new Error("strategy_step_invalid");
    if (step.trustedTool !== undefined && (!TRUSTED_TOOL_NAMES.has(step.trustedTool) || strategy.source === "reviewed_local")) throw new Error("strategy_tool_not_allowlisted");
    if (step.retryLimit < 0 || step.retryLimit > 1) throw new Error("strategy_retry_invalid");
    if (step.expectedExecutionClass === "state_changing" && !step.requiresDryRun) throw new Error("strategy_state_change_without_dry_run");
  }
  const serialized = JSON.stringify({ name: strategy.name, description: strategy.description, goalCategory: strategy.goalCategory, goalVariants: strategy.goalVariants, supportedApplications: strategy.supportedApplications, supportedAdapters: strategy.supportedAdapters, invalidationConditions: strategy.invalidationConditions });
  if (PROHIBITED_TEXT.test(serialized)) throw new Error("strategy_prohibited_content");
}

export function strategyConfidence(successCount: number, failureCount: number): number {
  return (successCount + 1) / (successCount + failureCount + 2);
}

export function shouldDegradeStrategy(strategy: CapabilityStrategyDefinition): boolean {
  return strategy.consecutiveFailureCount >= 2 || (strategy.successCount + strategy.failureCount >= 2 && strategy.confidence < 0.5);
}

export function strategyScore(input: { strategy: CapabilityStrategyDefinition; goalCategory: CapabilityStrategyGoal; appId?: string; adapterId?: string; verifiedCheckpoint: boolean; recent: boolean }): number {
  const strategy = input.strategy;
  let score = 0;
  if (strategy.goalCategory === input.goalCategory) score += 100;
  if (input.appId !== undefined && strategy.supportedApplications.includes(input.appId)) score += 30;
  if (input.adapterId !== undefined && strategy.supportedAdapters.includes(input.adapterId)) score += 15;
  score += Math.round(strategy.confidence * 24);
  if (input.recent) score += 12;
  if (input.verifiedCheckpoint) score += 10;
  score += Math.max(0, 6 - strategy.preferredSteps.length);
  score -= strategy.consecutiveFailureCount * 12;
  return score;
}

export function isStrategyActive(strategy: CapabilityStrategyDefinition): boolean {
  return strategy.status === "active" && !shouldDegradeStrategy(strategy);
}
