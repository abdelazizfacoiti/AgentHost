import { createHash } from "node:crypto";

export const RUNTIME_ACTIVITY_STATES = [
  "preparing", "inspecting", "acting", "waiting_for_approval", "waiting_for_user",
  "recovering", "paused", "blocked", "stopping", "completed", "failed", "cancelled"
] as const;
export type RuntimeActivityState = typeof RUNTIME_ACTIVITY_STATES[number];

export const RUNTIME_ACTIVITY_SOURCES = [
  "direct_tool", "browser", "desktop", "accessibility", "screenshot", "vision", "checkpoint",
  "workflow", "assistance", "forge", "scheduler", "strategy", "speech", "confirmation", "policy", "recovery"
] as const;
export type RuntimeActivitySource = typeof RUNTIME_ACTIVITY_SOURCES[number];

export const RUNTIME_ACTIVITY_LABEL_KEYS = [
  "agenthost_working", "opening_browser", "inspecting_page", "waiting_for_page", "checking_permissions",
  "waiting_for_approval", "waiting_for_user", "preparing_screenshot", "analyzing_screenshot", "recovering_target",
  "synthesizing_speech", "playing_speech", "preparing_transmission", "transmitting_speech", "running_workflow",
  "visual_assistance", "validating_generated_tool", "checking_scheduler", "checking_strategy", "blocked_by_policy",
  "paused", "stopping", "completed", "failed", "cancelled", "renderer_unavailable", "background_work"
] as const;
export type RuntimeActivityLabelKey = typeof RUNTIME_ACTIVITY_LABEL_KEYS[number];

export const RUNTIME_ACTIVITY_CONTROL_KEYS = ["pause", "stop", "details", "emergency_hide", "close"] as const;
export type RuntimeActivityControlKey = typeof RUNTIME_ACTIVITY_CONTROL_KEYS[number];

export type RuntimeActivityProgress =
  | { kind: "exact"; completed: number; total: number; percent: number }
  | { kind: "indeterminate" }
  | { kind: "waiting" };

export interface RuntimeActivityTerminalVerification {
  verified: boolean;
  source: "tool_result" | "workflow_trace" | "assistance_session" | "forge_runtime" | "speech" | "scheduler" | "manual";
  verifiedAt?: string;
  summary?: string;
}

export interface RuntimeActivityRendererBinding {
  overlayId: string;
  rendererEpoch: number;
  boundAt: string;
  visible: boolean;
  acknowledged: boolean;
}

export type RuntimeActivityScreenshotSuppression = "none" | "requested" | "suppressed" | "capturing" | "restoring" | "restored" | "failed";

export interface RuntimeActivityRecord {
  schemaVersion: 1;
  activityId: string;
  ownerSessionId: string;
  taskId: string;
  parentActivityId?: string;
  source: RuntimeActivitySource;
  labelKey: RuntimeActivityLabelKey;
  actionKey: RuntimeActivityLabelKey;
  state: RuntimeActivityState;
  startedAt: string;
  updatedAt: string;
  elapsedMs: number;
  progress?: RuntimeActivityProgress;
  blockerCode?: string;
  warningCode?: string;
  terminalVerification?: RuntimeActivityTerminalVerification;
  rendererBinding?: RuntimeActivityRendererBinding;
  screenshotSuppression: RuntimeActivityScreenshotSuppression;
  concurrencyPriority: number;
  dedupKey: string;
  controlCapabilities: RuntimeActivityControlKey[];
  redacted: true;
}

export interface RuntimeActivityEvent {
  eventId: string;
  activityId: string;
  ownerSessionId: string;
  createdAt: string;
  kind: "started" | "updated" | "transitioned" | "completed" | "failed" | "blocked" | "cancelled" | "control" | "renderer" | "screenshot";
  state: RuntimeActivityState;
  labelKey: RuntimeActivityLabelKey;
  actionKey: RuntimeActivityLabelKey;
  blockerCode?: string;
  warningCode?: string;
  redacted: true;
}

export interface RuntimeActivityProjection {
  activities: RuntimeActivityRecord[];
  active?: RuntimeActivityRecord;
  activeCount: number;
  rendererVisible: boolean;
  rendererStatus: "available" | "degraded" | "headless" | "unavailable";
  screenshotSuppression: RuntimeActivityScreenshotSuppression;
  redacted: true;
}

export interface RuntimeActivityOverlayConfig {
  enabled: boolean;
  position: "top_left" | "top_center" | "top_right" | "bottom_left" | "bottom_center" | "bottom_right";
  reducedMotion: boolean;
  terminalAutoHideMs: number;
  maxLabelChars: number;
  showElapsed: boolean;
  showProgress: boolean;
  interactiveControls: boolean;
  screenshotSuppression: boolean;
  multiTaskSummary: boolean;
}

const transitions: Record<RuntimeActivityState, RuntimeActivityState[]> = {
  preparing: ["inspecting", "acting", "waiting_for_approval", "waiting_for_user", "blocked", "failed", "cancelled", "stopping"],
  inspecting: ["acting", "waiting_for_approval", "waiting_for_user", "recovering", "blocked", "failed", "cancelled", "stopping", "completed"],
  acting: ["waiting_for_approval", "waiting_for_user", "recovering", "paused", "blocked", "stopping", "completed", "failed", "cancelled"],
  waiting_for_approval: ["acting", "blocked", "cancelled", "stopping"],
  waiting_for_user: ["acting", "paused", "blocked", "cancelled", "stopping"],
  recovering: ["acting", "paused", "blocked", "failed", "cancelled", "stopping"],
  paused: ["acting", "waiting_for_user", "cancelled", "stopping"],
  blocked: ["recovering", "cancelled", "stopping"],
  stopping: ["cancelled", "failed"],
  completed: [], failed: [], cancelled: []
};

const priority: Record<RuntimeActivityState, number> = {
  waiting_for_approval: 100, blocked: 95, waiting_for_user: 90, acting: 80, recovering: 70,
  inspecting: 60, preparing: 50, paused: 40, stopping: 30, failed: 25, cancelled: 20, completed: 10
};

const labels: Record<RuntimeActivityLabelKey, string> = {
  agenthost_working: "AgentHost working", opening_browser: "Opening browser", inspecting_page: "Inspecting page",
  waiting_for_page: "Waiting for page", checking_permissions: "Checking permissions", waiting_for_approval: "Waiting for approval",
  waiting_for_user: "Waiting for user", preparing_screenshot: "Preparing screenshot", analyzing_screenshot: "Analyzing screenshot",
  recovering_target: "Recovering target", synthesizing_speech: "Synthesizing speech", playing_speech: "Playing speech",
  preparing_transmission: "Preparing transmission", transmitting_speech: "Transmitting speech", running_workflow: "Running workflow",
  visual_assistance: "Visual assistance", validating_generated_tool: "Validating generated tool", checking_scheduler: "Checking scheduler",
  checking_strategy: "Checking strategy", blocked_by_policy: "Blocked by policy", paused: "Paused", stopping: "Stopping",
  completed: "Completed", failed: "Failed", cancelled: "Cancelled", renderer_unavailable: "Renderer unavailable", background_work: "Working"
};

export function runtimeActivityLabel(key: RuntimeActivityLabelKey, max = 80): string { return labels[key].slice(0, Math.max(1, Math.min(200, max))); }
export function runtimeActivityPriority(state: RuntimeActivityState): number { return priority[state]; }
export function runtimeActivityDedupKey(input: { ownerSessionId: string; taskId: string; source: RuntimeActivitySource; operation: string }): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32);
}
export function canTransitionRuntimeActivity(from: RuntimeActivityState, to: RuntimeActivityState): boolean { return from === to || transitions[from].includes(to); }
export function validateRuntimeActivityTransition(from: RuntimeActivityState, to: RuntimeActivityState, verification?: RuntimeActivityTerminalVerification): string[] {
  const errors: string[] = [];
  if (!canTransitionRuntimeActivity(from, to)) errors.push("runtime_activity_transition_invalid");
  if (to === "completed" && verification?.verified !== true) errors.push("runtime_activity_terminal_verification_required");
  return errors;
}
export function safeRuntimeActivityRecord(record: RuntimeActivityRecord): Record<string, unknown> {
  return {
    schemaVersion: 1, activityId: record.activityId, ownerSessionId: record.ownerSessionId, taskId: record.taskId,
    ...(record.parentActivityId === undefined ? {} : { parentActivityId: record.parentActivityId }),
    source: record.source, labelKey: record.labelKey,
    actionKey: record.actionKey, state: record.state, startedAt: record.startedAt, updatedAt: record.updatedAt,
    elapsedMs: record.elapsedMs, ...(record.progress === undefined ? {} : { progress: record.progress }),
    ...(record.blockerCode === undefined ? {} : { blockerCode: record.blockerCode }),
    ...(record.warningCode === undefined ? {} : { warningCode: record.warningCode }),
    ...(record.terminalVerification === undefined ? {} : { terminalVerification: { verified: record.terminalVerification.verified, source: record.terminalVerification.source } }),
    ...(record.rendererBinding === undefined ? {} : { rendererBinding: { overlayId: record.rendererBinding.overlayId, rendererEpoch: record.rendererBinding.rendererEpoch, boundAt: record.rendererBinding.boundAt, visible: record.rendererBinding.visible, acknowledged: record.rendererBinding.acknowledged } }),
    screenshotSuppression: record.screenshotSuppression, concurrencyPriority: record.concurrencyPriority,
    dedupKey: record.dedupKey,
    controlCapabilities: record.controlCapabilities, redacted: true
  };
}
