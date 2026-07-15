import type { OverlayAnimation, OverlayControlSurfaceAction, OverlayPrimitive, OverlaySensitivity, OverlayTargetBinding, OverlayWidget, OverlayRendererStatus } from "./overlay.js";
import type { OverlayAssistanceSessionExplanation, OverlayAssistanceStepPreview } from "./overlay-assistance-templates.js";

export type OverlayAssistanceSessionStatus = "draft" | "ready" | "active" | "waiting_for_operator" | "paused" | "completed" | "cancelled" | "blocked" | "expired";
export type OverlayAssistanceStepType = "pointer" | "highlight" | "tooltip" | "widget" | "instruction" | "warning" | "progress" | "checkpoint_result" | "wait_for_event" | "clear" | "finish";
export type OverlayAssistanceEventName = "accepted" | "rejected" | "dismissed" | "cancelled" | "next" | "back" | "acknowledgement_checked" | "emergency_stop_requested";

export interface OverlayAssistanceCheckpointSummary { checkpointId?: string; kind: string; status: "pass" | "fail" | "blocked" | "unknown"; summary: string; requiredGrantIds?: string[]; }
export interface OverlayAssistanceTransition { fromStepId: string; event: OverlayAssistanceEventName; toStepId?: string; automatic: false; }
export interface OverlayAssistanceStep { stepId: string; index: number; type: OverlayAssistanceStepType; primitive?: OverlayPrimitive; widget?: OverlayWidget; target?: OverlayTargetBinding; transitions?: OverlayAssistanceTransition[]; requiresEvent?: boolean; expectedEvent?: OverlayAssistanceEventName; checkpoint?: OverlayAssistanceCheckpointSummary; progressGroup?: string; warningCodes?: string[]; durationMs?: number; animation?: OverlayAnimation; }
export interface OverlayAssistanceEvent { eventId: string; sessionId: string; stepId: string; overlayId?: string; event: OverlayAssistanceEventName; createdAt: string; ownerSessionId: string; }
export interface OverlayAssistanceSession { sessionId: string; ownerSessionId: string; name: string; status: OverlayAssistanceSessionStatus; createdAt: string; updatedAt: string; expiresAt: string; currentStepIndex: number; currentOverlayId?: string; steps: OverlayAssistanceStep[]; transitions: OverlayAssistanceTransition[]; lastEvent?: OverlayAssistanceEvent; checkpointSummaries: OverlayAssistanceCheckpointSummary[]; progress: { completed: number; total: number; percent: number }; blockers: string[]; warnings: string[]; ephemeralMaterialAvailable: boolean; }

export type OverlayControlSurfaceStatus = "visible" | "hidden" | "stale" | "closed";
export interface OverlayControlSurfaceRendererHealth { rendererStatus: OverlayRendererStatus; effectiveBackend: string; sessionType: "x11" | "wayland" | "unknown"; childState?: string; handshake?: string; activeOverlayCount?: number; fallbackReason?: string; }
export interface OverlayControlSurfaceEventSummary { eventId: string; action: OverlayControlSurfaceAction; createdAt: string; outcome: "accepted" | "rejected" | "replayed"; reason?: string; }
export interface OverlayControlSurface { controlSurfaceId: string; assistanceSessionId: string; status: OverlayControlSurfaceStatus; createdAt: string; updatedAt: string; expiresAt: string; assistanceStatus: OverlayAssistanceSessionStatus; currentStepIndex: number; progress: { completed: number; total: number; percent: number }; rendererHealth: OverlayControlSurfaceRendererHealth; blockers: string[]; warnings: string[]; recommendedActions: OverlayControlSurfaceAction[]; recentEvents: OverlayControlSurfaceEventSummary[]; bindingState: "bound" | "unbound" | "stale"; stepPreview?: OverlayAssistanceStepPreview; sessionExplanation?: OverlayAssistanceSessionExplanation; }
export interface OverlayControlSurfaceEvent { eventId: string; controlSurfaceId: string; assistanceSessionId: string; overlayId: string; action: OverlayControlSurfaceAction; createdAt: string; ownerSessionId: string; }

export const OVERLAY_ASSISTANCE_MAX_STEPS = 50;
export const OVERLAY_ASSISTANCE_MAX_ACTIVE_OVERLAYS = 10;
export const OVERLAY_ASSISTANCE_MAX_TTL_MS = 30 * 60 * 1000;
export const OVERLAY_ASSISTANCE_EVENT_TTL_MS = 60 * 1000;

const events = new Set<OverlayAssistanceEventName>(["accepted", "rejected", "dismissed", "cancelled", "next", "back", "acknowledgement_checked", "emergency_stop_requested"]);
const controlSurfaceActions = new Set<OverlayControlSurfaceAction>(["continue", "pause", "resume", "cancel", "retry_visual_render", "inspect_diagnostics", "emergency_hide", "close_control_surface"]);
const stepTypes = new Set<OverlayAssistanceStepType>(["pointer", "highlight", "tooltip", "widget", "instruction", "warning", "progress", "checkpoint_result", "wait_for_event", "clear", "finish"]);

export function validateOverlayAssistanceEvent(event: OverlayAssistanceEvent, now = Date.now()): string[] {
  const errors: string[] = [];
  if (!event || typeof event !== "object") return ["assistance_event_invalid"];
  if (!event.sessionId || !event.stepId || !event.eventId || !event.ownerSessionId) errors.push("assistance_event_identity_invalid");
  if (!events.has(event.event)) errors.push("assistance_event_not_allowed");
  const created = Date.parse(event.createdAt);
  if (!Number.isFinite(created) || created > now + 5_000 || now - created > OVERLAY_ASSISTANCE_EVENT_TTL_MS) errors.push("assistance_event_stale");
  return [...new Set(errors)];
}

export function validateOverlayControlSurfaceEvent(event: OverlayControlSurfaceEvent, now = Date.now()): string[] {
  const errors: string[] = [];
  if (!event || typeof event !== "object") return ["control_surface_event_invalid"];
  if (!event.eventId || !event.controlSurfaceId || !event.assistanceSessionId || !event.overlayId || !event.ownerSessionId) errors.push("control_surface_event_identity_invalid");
  if (!controlSurfaceActions.has(event.action)) errors.push("control_surface_action_not_allowed");
  const created = Date.parse(event.createdAt);
  if (!Number.isFinite(created) || created > now + 5_000 || now - created > OVERLAY_ASSISTANCE_EVENT_TTL_MS) errors.push("control_surface_event_stale");
  return [...new Set(errors)];
}

export function isOverlayControlSurfaceAction(value: string): value is OverlayControlSurfaceAction { return controlSurfaceActions.has(value as OverlayControlSurfaceAction); }

export function validateOverlayAssistanceSteps(steps: OverlayAssistanceStep[], now = Date.now()): string[] {
  const errors: string[] = [];
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > OVERLAY_ASSISTANCE_MAX_STEPS) return ["assistance_step_count_invalid"];
  const ids = new Set<string>();
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    if (!step || step.index !== index || !step.stepId || ids.has(step.stepId) || !stepTypes.has(step.type)) errors.push("assistance_step_invalid");
    ids.add(step.stepId);
    if (step.durationMs !== undefined && (!Number.isInteger(step.durationMs) || step.durationMs < 0 || step.durationMs > OVERLAY_ASSISTANCE_MAX_TTL_MS)) errors.push("assistance_step_duration_invalid");
    if (step.type === "widget" && step.widget === undefined) errors.push("assistance_widget_missing");
    if (step.type !== "clear" && step.type !== "wait_for_event" && step.type !== "finish" && step.primitive === undefined && step.widget === undefined) errors.push("assistance_visual_reference_missing");
    for (const transition of step.transitions ?? []) {
      if (transition.fromStepId !== step.stepId || transition.automatic !== false || (transition.toStepId !== undefined && !ids.has(transition.toStepId) && transition.toStepId !== steps[index + 1]?.stepId)) errors.push("assistance_transition_invalid");
      if (!events.has(transition.event)) errors.push("assistance_transition_event_invalid");
    }
    if (step.animation?.durationMs !== undefined && step.animation.durationMs > OVERLAY_ASSISTANCE_MAX_TTL_MS) errors.push("assistance_animation_invalid");
    if (step.target !== undefined && Date.parse(step.target.expiresAt) <= now) errors.push("assistance_target_expired");
  }
  const edges = steps.flatMap((step) => (step.transitions ?? []).filter((transition) => transition.toStepId !== undefined).map((transition) => [transition.fromStepId, transition.toStepId!] as const));
  const adjacency = new Map<string, string[]>();
  for (const [from, to] of edges) adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (id: string): void => { if (visiting.has(id)) { errors.push("assistance_transition_cycle"); return; } if (visited.has(id)) return; visiting.add(id); for (const next of adjacency.get(id) ?? []) visit(next); visiting.delete(id); visited.add(id); };
  for (const step of steps) visit(step.stepId);
  return [...new Set(errors)];
}

export function redactOverlayAssistanceSession(session: OverlayAssistanceSession): Record<string, unknown> {
  return { sessionId: session.sessionId, ownerSessionId: session.ownerSessionId, name: "[redacted]", status: session.status, createdAt: session.createdAt, updatedAt: session.updatedAt, expiresAt: session.expiresAt, currentStepIndex: session.currentStepIndex, ...(session.currentOverlayId === undefined ? {} : { currentOverlayId: session.currentOverlayId }), stepTypes: session.steps.map((step) => step.type), stepCount: session.steps.length, progress: session.progress, checkpointCount: session.checkpointSummaries.length, lastEvent: session.lastEvent === undefined ? undefined : { eventId: session.lastEvent.eventId, stepId: session.lastEvent.stepId, overlayId: session.lastEvent.overlayId, event: session.lastEvent.event, createdAt: session.lastEvent.createdAt }, blockers: session.blockers, warnings: session.warnings, ephemeralMaterialAvailable: session.ephemeralMaterialAvailable };
}

export type { OverlaySensitivity };
