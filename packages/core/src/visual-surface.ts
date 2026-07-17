import { redactSensitiveText } from "./safety/redaction.js";
import { validateOverlayAnimation, validateOverlayStyleTokens, validateOverlayTargetBinding, type OverlayAnimation, type OverlayInteractionPolicy, type OverlayPlacement, type OverlaySensitivity, type OverlayStyleTokens, type OverlayTargetBinding, type OverlayWidgetComponent } from "./overlay.js";

export const VISUAL_SURFACE_SCHEMA_VERSION = 1 as const;
export const VISUAL_SURFACE_TYPES = [
  "activity_pill", "progress_card", "step_progress", "task_checklist", "instruction_card", "warning_banner",
  "blocked_card", "approval_notice", "recovery_card", "target_highlight", "arrow", "pointer", "spotlight",
  "tooltip", "checkpoint_result", "result_summary", "comparison_card", "browser_connection", "speech_player",
  "renderer_health", "control_bar", "notification_toast"
] as const;
export type VisualSurfaceType = typeof VISUAL_SURFACE_TYPES[number];
export type VisualSurfaceState = "draft" | "visible" | "updating" | "waiting" | "blocked" | "completed" | "failed" | "hidden";
export type VisualSurfacePriority = "low" | "normal" | "high" | "critical";
export type VisualSurfaceSource = "runtime_activity" | "assistance" | "control_surface" | "template_preview" | "renderer_diagnostics" | "route_status";
export type VisualSurfaceEventIntent = "continue" | "pause" | "resume" | "cancel" | "acknowledge" | "show_details" | "hide" | "retry_visual_render" | "inspect_diagnostics" | "open_control_room" | "review_prepared_action";

export interface VisualSurfaceProgress { completed: number; total: number; percent: number; }
export interface VisualSurfaceContent { title: string; components: OverlayWidgetComponent[]; summary?: string; progress?: VisualSurfaceProgress; }
export interface VisualSurfaceProtocolEnvelope {
  schemaVersion: typeof VISUAL_SURFACE_SCHEMA_VERSION;
  surfaceId: string;
  ownerSessionId: string;
  source: VisualSurfaceSource;
  taskId?: string;
  assistanceSessionId?: string;
  rendererEpoch?: number;
  type: VisualSurfaceType;
  content: VisualSurfaceContent;
  state: VisualSurfaceState;
  target?: OverlayTargetBinding;
  placement: OverlayPlacement;
  priority: VisualSurfacePriority;
  interactionMode: "click_through" | "bounded_interactive";
  approvedIntents: VisualSurfaceEventIntent[];
  ttlMs: number;
  sensitivity: OverlaySensitivity;
  screenshotBehavior: "hide" | "allow";
  style?: OverlayStyleTokens;
  animation?: OverlayAnimation;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface VisualSurfaceValidation { ok: boolean; errors: string[]; redactionCounts: Record<string, number>; }

const SAFE_ID = /^[A-Za-z0-9._:-]{1,200}$/;
const SAFE_INTENTS = new Set<VisualSurfaceEventIntent>(["continue", "pause", "resume", "cancel", "acknowledge", "show_details", "hide", "retry_visual_render", "inspect_diagnostics", "open_control_room", "review_prepared_action"]);
const ALLOWED_KEYS = new Set(["schemaVersion", "surfaceId", "ownerSessionId", "source", "taskId", "assistanceSessionId", "rendererEpoch", "type", "content", "state", "target", "placement", "priority", "interactionMode", "approvedIntents", "ttlMs", "sensitivity", "screenshotBehavior", "style", "animation", "createdAt", "updatedAt", "expiresAt"]);

function safeText(value: unknown, max = 500): { text?: string; count: number } {
  if (typeof value !== "string") return { count: 0 };
  const redacted = redactSensitiveText(value).replace(/\s+/g, " ").trim().slice(0, max);
  return { text: redacted, count: redacted === value ? 0 : 1 };
}

function redactField(value: unknown, max = 500): unknown {
  if (typeof value !== "string") return value;
  return redactSensitiveText(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/(?<![A-Za-z0-9])(?:\+?\d[\d ()-]{6,}\d)(?![A-Za-z0-9])/g, "[redacted-phone]")
    .replace(/\s+/g, " ").trim().slice(0, max);
}

/** Returns a bounded projection safe for renderer state and Control Room summaries. */
export function redactVisualSurface(surface: VisualSurfaceProtocolEnvelope): VisualSurfaceProtocolEnvelope {
  const components = (Array.isArray(surface.content?.components) ? surface.content.components : []).map((component) => {
    const next: Record<string, unknown> = { ...(component as unknown as Record<string, unknown>) };
    for (const key of ["text", "label", "key", "value", "before", "after", "alt"]) if (key in next) next[key] = redactField(next[key]);
    if (Array.isArray(next.items)) next.items = next.items.slice(0, 30).map((item) => item && typeof item === "object" ? { ...(item as Record<string, unknown>), label: redactField((item as Record<string, unknown>).label) } : item);
    return next as unknown as typeof component;
  });
  return {
    ...surface,
    content: {
      ...surface.content,
      title: typeof surface.content.title === "string" ? String(redactField(surface.content.title, 200)) : surface.content.title,
      components,
      ...(surface.content.summary === undefined ? {} : { summary: String(redactField(surface.content.summary)) })
    }
  };
}

export function validateVisualSurface(surface: VisualSurfaceProtocolEnvelope, now = Date.now()): VisualSurfaceValidation {
  const errors: string[] = [];
  const redactionCounts: Record<string, number> = {};
  if (surface === null || typeof surface !== "object") return { ok: false, errors: ["visual_surface_invalid"], redactionCounts };
  for (const key of Object.keys(surface as unknown as Record<string, unknown>)) if (!ALLOWED_KEYS.has(key)) errors.push("visual_surface_unknown_field");
  if (surface.schemaVersion !== VISUAL_SURFACE_SCHEMA_VERSION) errors.push("visual_surface_schema_unsupported");
  if (!SAFE_ID.test(surface.surfaceId) || !SAFE_ID.test(surface.ownerSessionId)) errors.push("visual_surface_id_invalid");
  if (!VISUAL_SURFACE_TYPES.includes(surface.type)) errors.push("visual_surface_type_unsupported");
  if (!["runtime_activity", "assistance", "control_surface", "template_preview", "renderer_diagnostics", "route_status"].includes(surface.source)) errors.push("visual_surface_source_invalid");
  if (!["draft", "visible", "updating", "waiting", "blocked", "completed", "failed", "hidden"].includes(surface.state)) errors.push("visual_surface_state_invalid");
  if (!["low", "normal", "high", "critical"].includes(surface.priority)) errors.push("visual_surface_priority_invalid");
  if (!["click_through", "bounded_interactive"].includes(surface.interactionMode)) errors.push("visual_surface_interaction_invalid");
  if (!["hide", "allow"].includes(surface.screenshotBehavior)) errors.push("visual_surface_screenshot_policy_invalid");
  if (!["public", "private", "secret"].includes(surface.sensitivity) || surface.sensitivity === "secret") errors.push("visual_surface_secret_blocked");
  if (!Array.isArray(surface.approvedIntents) || surface.approvedIntents.length > 12 || surface.approvedIntents.some((intent) => !SAFE_INTENTS.has(intent))) errors.push("visual_surface_intent_invalid");
  if (!Number.isInteger(surface.ttlMs) || surface.ttlMs < 1_000 || surface.ttlMs > 300_000) errors.push("visual_surface_ttl_invalid");
  if (surface.rendererEpoch !== undefined && (!Number.isInteger(surface.rendererEpoch) || surface.rendererEpoch < 1)) errors.push("visual_surface_epoch_invalid");
  if (!surface.content || typeof surface.content !== "object" || typeof surface.content.title !== "string" || !Array.isArray(surface.content.components) || surface.content.components.length > 30) errors.push("visual_surface_content_invalid");
  if (surface.content && typeof surface.content === "object") {
    const contentKeys = Object.keys(surface.content as object);
    if (contentKeys.some((key) => !["title", "components", "summary", "progress"].includes(key))) errors.push("visual_surface_content_field_blocked");
    if (surface.content.summary !== undefined) { const summary = safeText(surface.content.summary, 500); if (summary.text === undefined) errors.push("visual_surface_summary_invalid"); else if (summary.count) redactionCounts.summary = 1; }
    if (surface.content.progress !== undefined) { const progress = surface.content.progress; if (!Number.isInteger(progress.completed) || !Number.isInteger(progress.total) || progress.total < 1 || progress.completed < 0 || progress.completed > progress.total || !Number.isFinite(progress.percent) || progress.percent < 0 || progress.percent > 100) errors.push("visual_surface_progress_invalid"); }
  }
  if (!['top_left', 'top_center', 'top_right', 'bottom_left', 'bottom_center', 'bottom_right'].includes(surface.placement)) errors.push("visual_surface_placement_invalid");
  if (surface.target !== undefined) errors.push(...validateOverlayTargetBinding(surface.target));
  errors.push(...validateOverlayStyleTokens(surface.style));
  errors.push(...validateOverlayAnimation(surface.animation));
  if (surface.content?.title !== undefined) { if (/<[^>]+>|javascript:|data:text\/html|https?:\/\//i.test(surface.content.title)) errors.push("visual_surface_unsafe_content_blocked"); const result = safeText(surface.content.title, 200); if (result.text === undefined || result.text.length === 0) errors.push("visual_surface_title_invalid"); if (result.text !== undefined && /<[^>]+>|javascript:|data:text\/html|https?:\/\//i.test(result.text)) errors.push("visual_surface_unsafe_content_blocked"); if (result.count) redactionCounts.title = result.count; }
  for (const component of surface.content?.components ?? []) {
    if (!component || typeof component !== "object" || !["heading", "text", "divider", "icon", "status_badge", "progress", "checklist", "key_value", "button", "choice", "comparison", "warning", "image_reference"].includes(component.type)) errors.push("visual_surface_component_unsupported");
    const value = component as Record<string, unknown>;
    for (const key of Object.keys(value)) if (!["type", "text", "token", "status", "value", "label", "items", "key", "before", "after", "event", "evidenceId", "alt", "checked"].includes(key)) errors.push("visual_surface_component_field_blocked");
    for (const key of ["text", "label", "key", "before", "after", "alt"]) if (typeof value[key] === "string") { if (/<[^>]+>|javascript:|data:text\/html|https?:\/\//i.test(value[key] as string)) errors.push("visual_surface_unsafe_content_blocked"); const result = safeText(value[key], 500); if (result.text !== undefined && /<[^>]+>|javascript:|data:text\/html|https?:\/\//i.test(result.text)) errors.push("visual_surface_unsafe_content_blocked"); if (result.count) redactionCounts[key] = (redactionCounts[key] ?? 0) + result.count; }
    if (["button", "choice"].includes(String(value.type)) && typeof value.event !== "string") errors.push("visual_surface_event_invalid");
    if (value.type === "button" && typeof value.event === "string" && !SAFE_INTENTS.has(value.event as VisualSurfaceEventIntent)) errors.push("visual_surface_event_blocked");
  }
  if (surface.sensitivity === "private" && surface.screenshotBehavior !== "hide") errors.push("visual_surface_private_screenshot_policy_required");
  const expiry = Date.parse(surface.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now) errors.push("visual_surface_expired");
  return { ok: errors.length === 0, errors: [...new Set(errors)], redactionCounts };
}

export function visualSurfacePriorityValue(priority: VisualSurfacePriority): number { return priority === "critical" ? 400 : priority === "high" ? 300 : priority === "normal" ? 200 : 100; }
