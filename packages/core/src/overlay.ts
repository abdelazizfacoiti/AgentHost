import { redactSensitiveText } from "./safety/redaction.js";

export type OverlayPrimitiveType = "pointer" | "arrow" | "highlight" | "spotlight" | "tooltip" | "instruction_card" | "approval_card" | "warning" | "progress" | "checkpoint_result" | "status_toast" | "comparison" | "cancel_control" | "emergency_stop_control";
export type OverlayRendererStatus = "available" | "degraded" | "headless" | "unavailable";
export type OverlayRendererMode = "headless" | "auto" | "gtk3-x11" | "gtk3-native" | "webkit-gtk-react" | "disabled";
export type OverlayActivityMode = "always" | "on_change" | "off";
export type OverlaySensitivity = "public" | "private" | "secret";
export type OverlayTheme = "system" | "light" | "dark";
export type OverlayDensity = "compact" | "normal";
export type OverlayPlacement = "top_left" | "top_center" | "top_right" | "bottom_left" | "bottom_center" | "bottom_right";
export type OverlayDisplayPolicy = "primary" | "all";
export interface OverlayPublicConfig {
  rendererMode: OverlayRendererMode;
  /** Automatic activity feedback: every computer action, state-changing only, or none. */
  mode: OverlayActivityMode;
  theme: OverlayTheme;
  density: OverlayDensity;
  reducedMotion: boolean;
  /** Progress cards stay until explicitly dismissed (default true). */
  persistent: boolean;
  /** Terminal auto-hide delay in ms; 0 means never. Ignored for persistent cards. */
  autoHideMs: number;
  preferredPosition: OverlayPlacement;
  maxWidth: number;
  multiMonitor: "primary" | "all";
}
export type OverlayAnimationKind = "fade" | "slide" | "scale" | "pulse" | "glow" | "pointer_move" | "progress";
export type OverlayControlSurfaceAction = "continue" | "pause" | "resume" | "cancel" | "retry_visual_render" | "inspect_diagnostics" | "emergency_hide" | "close_control_surface";
export type OverlayEventName = "accepted" | "rejected" | "dismissed" | "cancelled" | "next" | "back" | "acknowledgement_checked" | "emergency_stop_requested" | "acknowledge" | "show_details" | "hide" | "open_control_room" | "review_prepared_action" | OverlayControlSurfaceAction;

export interface OverlayBounds { x: number; y: number; width: number; height: number; }
export interface OverlayPoint { x: number; y: number; }

export type OverlayTargetBinding =
  | { kind: "browser_element"; elementId: string; tabId: string; expiresAt: string }
  | { kind: "accessibility_element"; elementId: string; windowId: string; expiresAt: string }
  | { kind: "vision_target"; candidateId: string; screenshotId: string; expiresAt: string }
  | { kind: "window_region"; windowId: string; bounds: OverlayBounds; displayId?: string; expiresAt: string }
  | { kind: "screenshot_region"; screenshotId: string; bounds: OverlayBounds; displayId?: string; expiresAt: string }
  | { kind: "screen_point"; point: OverlayPoint; displayId?: string; trusted: true; expiresAt: string };

export interface OverlayTargetSummary { kind: OverlayTargetBinding["kind"]; targetId: string; displayId?: string | undefined; windowId?: string | undefined; bounds?: OverlayBounds | undefined; point?: OverlayPoint | undefined; sensitivity: OverlaySensitivity; validatedAt: string; expiresAt: string; }
export interface OverlayAnimation { kind: OverlayAnimationKind; durationMs: number; easing?: "linear" | "ease_in" | "ease_out" | "ease_in_out" | undefined; repeatCount?: number | undefined; reducedMotion?: "instant" | "fade" | "none" | undefined; }
export interface OverlayStyleTokens { theme?: OverlayTheme | undefined; density?: OverlayDensity | undefined; spacing?: "tight" | "normal" | "relaxed" | undefined; typography?: "caption" | "body" | "label" | "title" | "mono" | undefined; radius?: "none" | "small" | "medium" | "large" | undefined; elevation?: "none" | "low" | "medium" | "high" | undefined; semantic?: "neutral" | "info" | "success" | "warning" | "danger" | undefined; accentToken?: "blue" | "green" | "amber" | "red" | "violet" | undefined; }
export interface OverlayInteractionPolicy { interactive: boolean; focus: "never" | "when_required"; dismissible: boolean; allowedEvents: OverlayEventName[]; }

export interface OverlayPrimitive { overlayId?: string | undefined; type: OverlayPrimitiveType; target?: OverlayTargetBinding | undefined; label?: string | undefined; text?: string | undefined; value?: number | undefined; progress?: number | undefined; style?: OverlayStyleTokens | undefined; animation?: OverlayAnimation | undefined; interaction?: OverlayInteractionPolicy | undefined; accessibilityLabel?: string | undefined; sensitivity: OverlaySensitivity; ttlMs?: number | undefined; }

export type OverlayWidgetComponent =
  | { type: "heading" | "text" | "divider"; text: string }
  | { type: "icon"; token: "info" | "success" | "warning" | "danger" | "pointer" | "check" | "close" }
  | { type: "status_badge"; status: "neutral" | "info" | "success" | "warning" | "danger"; text: string }
  | { type: "progress"; value: number; label?: string }
  | { type: "spinner"; label?: string }
  | { type: "checklist"; items: Array<{ label: string; checked: boolean; state?: "pending" | "active" | "done" | "failed" }> }
  | { type: "key_value"; key: string; value: string }
  | { type: "button"; label: string; event: OverlayEventName }
  | { type: "choice"; label: string; event: "accepted" | "rejected" | "cancelled" }
  | { type: "comparison"; before: string; after: string }
  | { type: "warning"; text: string }
  | { type: "image_reference"; evidenceId: string; alt: string };

export interface OverlayWidget { widgetId?: string; title: string; components: OverlayWidgetComponent[]; target?: OverlayTargetBinding; placement?: OverlayPlacement; displayPolicy?: OverlayDisplayPolicy; style?: OverlayStyleTokens; animation?: OverlayAnimation; interaction?: OverlayInteractionPolicy; accessibilityLabel?: string; sensitivity: OverlaySensitivity; ttlMs?: number; persistent?: boolean; }
export interface OverlayWidgetEvent { eventId: string; overlayId: string; event: OverlayEventName; createdAt: string; ownerSessionId: string; }

export interface OverlayCapabilityReport { supported: boolean; available?: boolean; visible?: boolean; renderer: string; rendererStatus: OverlayRendererStatus; sessionType: "x11" | "wayland" | "unknown"; displayAvailable: boolean; clickThrough: boolean; interactiveWidgets: boolean; multipleDisplays: boolean; globalOverlayAvailable: boolean; clickThroughAvailable: boolean; multiDisplayAvailable: boolean; animationAvailable: boolean; interactiveWidgetsAvailable: boolean; /** True only when compositor-backed transparent windows are available. */ compositorAvailable?: boolean | undefined; /** True only when renderer can create transparent windows without covering the desktop. */ transparentWindowsAvailable?: boolean | undefined; /** Safe child rendering path selected after handshake. */ drawingBackend?: "cairo" | "gtk3-widgets" | undefined; cairoCallbacks?: boolean | undefined; fallbackRenderer?: "headless" | undefined; reason: string; limitations: string[]; }
export interface OverlayStateSummary { overlayId: string; ownerSessionId: string; type: OverlayPrimitiveType | "widget"; target?: OverlayTargetSummary; sensitivity: OverlaySensitivity; interactive: boolean; visible: boolean; createdAt: string; updatedAt: string; expiresAt: string; persistent?: boolean; lastEvent?: OverlayWidgetEvent; }
export interface OverlayStateSnapshot { renderer: OverlayCapabilityReport; overlays: OverlayStateSummary[]; pendingEvents: OverlayWidgetEvent[]; emergencyHidden: boolean; }

export interface OverlayValidationResult { ok: boolean; redactedText?: string; redactionCounts: Record<string, number>; errors: string[]; }
const forbiddenMarkup = /<[^>]+>|javascript:|data:text\/html|https?:\/\//i;
const MAX_ANIMATION_MS = 5_000;

export function redactOverlayText(value: string, sensitivity: OverlaySensitivity): OverlayValidationResult {
  const redacted = redactSensitiveText(value).trim().replace(/\s+/g, " ");
  const redactionCounts: Record<string, number> = {};
  if (redacted !== value) redactionCounts.redacted = 1;
  if (sensitivity === "secret") return { ok: false, redactionCounts, errors: ["overlay_secret_content_blocked"] };
  if (forbiddenMarkup.test(redacted)) return { ok: false, redactionCounts, errors: ["overlay_unsafe_content_blocked"] };
  if (redacted.length > 1000) return { ok: false, redactionCounts, errors: ["overlay_text_too_large"] };
  return { ok: true, redactedText: redacted, redactionCounts, errors: [] };
}

export function validateOverlayAnimation(animation?: OverlayAnimation, reducedMotion = false): string[] {
  if (animation === undefined) return [];
  if (typeof animation !== "object" || animation === null) return ["overlay_animation_invalid"];
  const errors: string[] = [];
  if (!Number.isInteger(animation.durationMs) || animation.durationMs < 0 || animation.durationMs > MAX_ANIMATION_MS) errors.push("overlay_animation_duration_invalid");
  if (animation.repeatCount !== undefined && (!Number.isInteger(animation.repeatCount) || animation.repeatCount < 0 || animation.repeatCount > 3)) errors.push("overlay_animation_repeat_invalid");
  if (animation.kind === "pulse" && animation.repeatCount === undefined) errors.push("overlay_animation_infinite_blocked");
  if (reducedMotion && animation.reducedMotion === undefined) errors.push("overlay_reduced_motion_policy_missing");
  return errors;
}

export function validateOverlayTargetBinding(binding: OverlayTargetBinding, now = Date.now()): string[] {
  const errors: string[] = [];
  if (!binding || typeof binding !== "object") return ["overlay_target_invalid"];
  if (!["browser_element", "accessibility_element", "vision_target", "window_region", "screenshot_region", "screen_point"].includes(binding.kind)) return ["overlay_target_invalid"];
  const expires = Date.parse(binding.expiresAt);
  if (!Number.isFinite(expires) || expires <= now) errors.push("overlay_target_expired");
  if (binding.kind === "screen_point" && binding.trusted !== true) errors.push("overlay_coordinate_not_trusted");
  if ((binding.kind === "window_region" || binding.kind === "screenshot_region") && (binding.bounds === undefined || binding.bounds === null || binding.bounds.width <= 0 || binding.bounds.height <= 0)) errors.push("overlay_target_bounds_invalid");
  if (binding.kind === "screen_point" && (binding.point === undefined || binding.point === null || !Number.isFinite(binding.point.x) || !Number.isFinite(binding.point.y))) errors.push("overlay_point_invalid");
  return errors;
}

export function validateOverlayStyleTokens(style?: OverlayStyleTokens): string[] {
  if (style === undefined) return [];
  if (typeof style !== "object" || style === null) return ["overlay_style_invalid"];
  const errors: string[] = [];
  const allowedKeys = new Set(["theme", "density", "spacing", "typography", "radius", "elevation", "semantic", "accentToken"]);
  if (Object.keys(style as object).some((key) => !allowedKeys.has(key))) errors.push("overlay_style_token_blocked");
  if (style.theme !== undefined && !["system", "light", "dark"].includes(style.theme)) errors.push("overlay_style_theme_invalid");
  if (style.density !== undefined && !["compact", "normal"].includes(style.density)) errors.push("overlay_style_density_invalid");
  if (style.spacing !== undefined && !["tight", "normal", "relaxed"].includes(style.spacing)) errors.push("overlay_style_spacing_invalid");
  if (style.typography !== undefined && !["caption", "body", "label", "title", "mono"].includes(style.typography)) errors.push("overlay_style_typography_invalid");
  if (style.radius !== undefined && !["none", "small", "medium", "large"].includes(style.radius)) errors.push("overlay_style_radius_invalid");
  if (style.elevation !== undefined && !["none", "low", "medium", "high"].includes(style.elevation)) errors.push("overlay_style_elevation_invalid");
  if (style.semantic !== undefined && !["neutral", "info", "success", "warning", "danger"].includes(style.semantic)) errors.push("overlay_style_semantic_invalid");
  if (style.accentToken !== undefined && !["blue", "green", "amber", "red", "violet"].includes(style.accentToken)) errors.push("overlay_style_accent_invalid");
  return [...new Set(errors)];
}

export function validateOverlayInteractionPolicy(policy?: OverlayInteractionPolicy): string[] {
  if (policy === undefined) return [];
  if (typeof policy !== "object" || policy === null) return ["overlay_interaction_invalid"];
  const errors: string[] = [];
  const events: OverlayEventName[] = ["accepted", "rejected", "dismissed", "cancelled", "next", "back", "acknowledgement_checked", "emergency_stop_requested", "acknowledge", "show_details", "hide", "open_control_room", "review_prepared_action", "continue", "pause", "resume", "cancel", "retry_visual_render", "inspect_diagnostics", "emergency_hide", "close_control_surface"];
  if (typeof policy.interactive !== "boolean" || typeof policy.dismissible !== "boolean" || !["never", "when_required"].includes(policy.focus)) errors.push("overlay_interaction_invalid");
  if (!Array.isArray(policy.allowedEvents) || policy.allowedEvents.length > 8 || policy.allowedEvents.some((event) => !events.includes(event))) errors.push("overlay_event_invalid");
  return [...new Set(errors)];
}

export function validateOverlayWidget(widget: OverlayWidget, reducedMotion = false): string[] {
  const errors: string[] = [];
  if (widget === null || typeof widget !== "object") return ["overlay_widget_invalid"];
  if (!["public", "private", "secret"].includes(widget.sensitivity)) errors.push("overlay_widget_sensitivity_invalid");
  if (widget.sensitivity === "secret") errors.push("overlay_secret_widget_blocked");
  if (widget.persistent !== undefined) {
    if (typeof widget.persistent !== "boolean") errors.push("overlay_widget_persistent_invalid");
    // Persistent cards outlive the task and may be captured in screenshots, so
    // only public summary content is allowed to stay on screen indefinitely.
    else if (widget.persistent === true && widget.sensitivity !== "public") errors.push("overlay_persistent_requires_public");
  }
  if (typeof widget.title !== "string" || !widget.title || widget.title.length > 200) errors.push("overlay_widget_title_invalid");
  if (typeof widget.title === "string") errors.push(...redactOverlayText(widget.title, widget.sensitivity).errors);
  if (!Array.isArray(widget.components) || widget.components.length > 30) errors.push("overlay_widget_components_invalid");
  if (widget.placement !== undefined && !["top_left", "top_center", "top_right", "bottom_left", "bottom_center", "bottom_right"].includes(widget.placement)) errors.push("overlay_widget_placement_invalid");
  if (widget.displayPolicy !== undefined && !["primary", "all"].includes(widget.displayPolicy)) errors.push("overlay_widget_display_policy_invalid");
  const allowedComponents = new Set(["heading", "text", "divider", "icon", "status_badge", "progress", "spinner", "checklist", "key_value", "button", "choice", "comparison", "warning", "image_reference"]);
  for (const component of widget.components ?? []) {
    if (component === null || typeof component !== "object") { errors.push("overlay_component_unsupported"); continue; }
    if (!allowedComponents.has(component.type)) {
      errors.push("overlay_component_unsupported");
      continue;
    }
    if (component.type === "heading" || component.type === "text" || component.type === "divider" || component.type === "warning") {
      const result = redactOverlayText(component.text, widget.sensitivity); errors.push(...result.errors);
    }
    if (component.type === "status_badge" || component.type === "button" || component.type === "choice") {
      const label = "label" in component ? component.label : component.text; const result = redactOverlayText(label, widget.sensitivity); errors.push(...result.errors);
    }
    if (component.type === "spinner" && component.label !== undefined) errors.push(...redactOverlayText(component.label, widget.sensitivity).errors);
    if (component.type === "spinner" && component.label !== undefined && component.label.length > 200) errors.push("overlay_spinner_label_too_large");
    if (component.type === "checklist") {
      for (const item of component.items) {
        if (item.state !== undefined && !["pending", "active", "done", "failed"].includes(item.state)) errors.push("overlay_checklist_state_invalid");
      }
    }
    if (component.type === "icon" && !["info", "success", "warning", "danger", "pointer", "check", "close"].includes(component.token)) errors.push("overlay_icon_token_invalid");
    if (component.type === "status_badge" && !["neutral", "info", "success", "warning", "danger"].includes(component.status)) errors.push("overlay_status_invalid");
    if ((component.type === "button" || component.type === "choice") && typeof component.event !== "string") errors.push("overlay_event_invalid");
    if (component.type === "key_value" || component.type === "comparison") {
      const values = component.type === "key_value" ? [component.key, component.value] : [component.before, component.after];
      for (const value of values) errors.push(...redactOverlayText(value, widget.sensitivity).errors);
    }
    if (component.type === "progress" && (component.value < 0 || component.value > 1)) errors.push("overlay_progress_invalid");
    if (component.type === "image_reference") {
      if (!/^[A-Za-z0-9._-]{1,200}$/.test(component.evidenceId)) errors.push("overlay_image_reference_invalid");
      errors.push(...redactOverlayText(component.alt, widget.sensitivity).errors);
    }
  }
  errors.push(...validateOverlayAnimation(widget.animation, reducedMotion));
  errors.push(...validateOverlayStyleTokens(widget.style));
  errors.push(...validateOverlayInteractionPolicy(widget.interaction));
  return [...new Set(errors)];
}

export const OVERLAY_MAX_ANIMATION_MS = MAX_ANIMATION_MS;
