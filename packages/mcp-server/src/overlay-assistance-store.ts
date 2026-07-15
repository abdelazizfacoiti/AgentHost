import { chmod, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { redactOverlayText, validateOverlayAnimation, validateOverlayAssistanceEvent, validateOverlayAssistanceSteps, validateOverlayInteractionPolicy, validateOverlayTargetBinding, validateOverlayWidget, type OverlayAssistanceEvent, type OverlayAssistanceRecoveryState, type OverlayAssistanceSession, type OverlayAssistanceStep, type OverlayAssistanceSessionStatus, type OverlayTargetBinding, type OverlayWidget, type OverlayPrimitive, type OverlayAssistanceStepPreview, type OverlayAssistanceSessionExplanation } from "@agenthost/core";
import type { OverlayManager, OverlayTargetResolver } from "@agenthost/app-overlay";

const now = () => new Date().toISOString();
const id = () => `assist_${randomUUID()}`;
const MAX_TARGET_REFRESHES = 2;
const safeText = (value: string, sensitivity: "public" | "private" | "secret" = "public") => redactOverlayText(value, sensitivity).redactedText ?? "[redacted]";
const allowedPrimitiveTypes = new Set([
  "pointer", "arrow", "highlight", "spotlight", "tooltip", "instruction_card",
  "approval_card", "warning", "progress", "checkpoint_result", "status_toast",
  "comparison", "cancel_control", "emergency_stop_control",
]);

function sanitizePrimitive(value: OverlayPrimitive): OverlayPrimitive {
  const sensitivity = value.sensitivity;
  return { ...value, ...(value.label === undefined ? {} : { label: safeText(value.label, sensitivity) }), ...(value.text === undefined ? {} : { text: safeText(value.text, sensitivity) }) };
}
function sanitizeWidget(value: OverlayWidget): OverlayWidget {
  const sensitivity = value.sensitivity;
  const components = value.components.map((component) => {
    if (component.type === "heading" || component.type === "text" || component.type === "divider" || component.type === "warning") return { ...component, text: safeText(component.text, sensitivity) };
    if (component.type === "status_badge") return { ...component, text: safeText(component.text, sensitivity) };
    if (component.type === "button" || component.type === "choice") return { ...component, label: safeText(component.label, sensitivity) };
    if (component.type === "key_value") return { ...component, key: safeText(component.key, sensitivity), value: safeText(component.value, sensitivity) };
    if (component.type === "comparison") return { ...component, before: safeText(component.before, sensitivity), after: safeText(component.after, sensitivity) };
    if (component.type === "checklist") return { ...component, items: component.items.map((item) => ({ ...item, label: safeText(item.label, sensitivity) })) };
    if (component.type === "progress" && component.label !== undefined) return { ...component, label: safeText(component.label, sensitivity) };
    if (component.type === "image_reference") return { ...component, alt: safeText(component.alt, sensitivity) };
    return component;
  });
  return { ...value, title: safeText(value.title, sensitivity), components };
}
function sanitizeStep(step: OverlayAssistanceStep): OverlayAssistanceStep { return { ...step, ...(step.primitive === undefined ? {} : { primitive: sanitizePrimitive(step.primitive) }), ...(step.widget === undefined ? {} : { widget: sanitizeWidget(step.widget) }) }; }
function summary(session: OverlayAssistanceSession): Record<string, unknown> { return { sessionId: session.sessionId, ownerSessionId: session.ownerSessionId, name: "[redacted]", status: session.status, createdAt: session.createdAt, updatedAt: session.updatedAt, expiresAt: session.expiresAt, currentStepIndex: session.currentStepIndex, ...(session.currentOverlayId === undefined ? {} : { currentOverlayId: session.currentOverlayId }), stepTypes: session.steps.map((step) => step.type), stepCount: session.steps.length, progress: session.progress, checkpointCount: session.checkpointSummaries.length, lastEvent: session.lastEvent === undefined ? undefined : { eventId: session.lastEvent.eventId, stepId: session.lastEvent.stepId, overlayId: session.lastEvent.overlayId, event: session.lastEvent.event, createdAt: session.lastEvent.createdAt }, blockers: session.blockers, warnings: session.warnings, targetRefreshCount: session.targetRefreshCount ?? 0, ephemeralMaterialAvailable: session.ephemeralMaterialAvailable }; }
const TARGET_BLOCKERS = new Set([
    "assistance_target_missing", "assistance_target_stale", "overlay_target_expired", "overlay_target_resolver_unavailable",
    "browser_element_stale_or_mismatched", "browser_tab_unavailable", "accessibility_element_stale_or_mismatched",
    "vision_target_stale_or_unsafe", "vision_geometry_unverified", "screenshot_evidence_stale", "screenshot_geometry_unverified",
    "screenshot_region_out_of_bounds", "active_window_mismatch", "window_geometry_unavailable", "window_region_out_of_bounds",
    "screen_point_out_of_bounds"
  ]);
function targetBlocker(value: string): boolean { return TARGET_BLOCKERS.has(value); }
function targetBlockersOnly(session: OverlayAssistanceSession): boolean { return session.blockers.length > 0 && session.blockers.every(targetBlocker); }

export class OverlayAssistanceStore {
  readonly #dir: string;
  readonly #manager: OverlayManager;
  readonly #ownerSessionId: string;
  readonly #sessions = new Map<string, OverlayAssistanceSession>();
  readonly #overlayIds = new Map<string, string>();
  constructor(agentHostDir: string, manager: OverlayManager, ownerSessionId: string) { this.#dir = path.join(agentHostDir, "overlays", "assistance-sessions"); this.#manager = manager; this.#ownerSessionId = ownerSessionId; }
  async ensureStructure(): Promise<void> { await mkdir(this.#dir, { recursive: true, mode: 0o700 }); }
  async create(input: { name: string; steps: OverlayAssistanceStep[]; ttlMs?: number; allowPrivate: boolean }): Promise<Record<string, unknown>> {
    const errors = validateOverlayAssistanceSteps(input.steps);
    for (const step of input.steps) {
      if (step.primitive !== undefined && !allowedPrimitiveTypes.has(step.primitive.type)) errors.push("assistance_primitive_type_invalid");
      if (step.primitive?.target !== undefined) errors.push(...validateOverlayTargetBinding(step.primitive.target));
      if (step.target !== undefined) errors.push(...validateOverlayTargetBinding(step.target));
      if (step.widget !== undefined) errors.push(...validateOverlayWidget(step.widget));
      if (step.primitive?.animation !== undefined) errors.push(...validateOverlayAnimation(step.primitive.animation));
      if (step.widget?.animation !== undefined) errors.push(...validateOverlayAnimation(step.widget.animation));
      if (step.primitive?.interaction !== undefined) errors.push(...validateOverlayInteractionPolicy(step.primitive.interaction));
      if (step.widget?.interaction !== undefined) errors.push(...validateOverlayInteractionPolicy(step.widget.interaction));
      const sensitivity = step.widget?.sensitivity ?? step.primitive?.sensitivity ?? "public";
      if (sensitivity === "secret") errors.push("assistance_secret_content_blocked");
      if (sensitivity === "private" && !input.allowPrivate) errors.push("assistance_private_grant_required");
    }
    const uniqueErrors = [...new Set(errors)];
    const timestamp = now(); const ttl = Math.min(30 * 60 * 1000, Math.max(1_000, input.ttlMs ?? 30 * 60 * 1000));
    const session: OverlayAssistanceSession = { sessionId: id(), ownerSessionId: this.#ownerSessionId, name: safeText(input.name), status: uniqueErrors.length > 0 ? "blocked" : "ready", createdAt: timestamp, updatedAt: timestamp, expiresAt: new Date(Date.now() + ttl).toISOString(), currentStepIndex: 0, steps: input.steps.map(sanitizeStep), transitions: input.steps.flatMap((step) => step.transitions ?? []), checkpointSummaries: input.steps.flatMap((step) => step.checkpoint === undefined ? [] : [step.checkpoint]), progress: { completed: 0, total: input.steps.length, percent: 0 }, blockers: uniqueErrors, warnings: [], ephemeralMaterialAvailable: true };
    this.#sessions.set(session.sessionId, session); await this.#persist(session); return summary(session);
  }
  async get(sessionId: string): Promise<Record<string, unknown>> { const session = this.#sessions.get(sessionId); if (session !== undefined) { if (session.ownerSessionId !== this.#ownerSessionId) throw new Error("assistance_session_not_found"); this.#expire(session); return summary(session); } try { const stored = JSON.parse(await readFile(this.#file(sessionId), "utf8")) as Record<string, unknown>; if (stored.ownerSessionId !== this.#ownerSessionId) throw new Error("assistance_session_not_found"); const { currentOverlayId: _ephemeralOverlayId, ...persisted } = stored; return { ...persisted, status: stored.status === "completed" || stored.status === "cancelled" || stored.status === "expired" ? stored.status : "blocked", ephemeralMaterialAvailable: false, blockers: [...(Array.isArray(stored.blockers) ? stored.blockers : []), "ephemeral_input_unavailable"] }; } catch (error) { if (error instanceof Error && error.message === "assistance_session_not_found") throw error; throw new Error("assistance_session_not_found"); } }
  async preview(sessionId: string): Promise<OverlayAssistanceStepPreview> {
    const session = this.#sessions.get(sessionId);
    if (session === undefined) {
      try { const persisted = await this.get(sessionId); if (persisted.ephemeralMaterialAvailable === false) throw new Error("assistance_session_ephemeral_input_unavailable"); } catch (error) { throw error instanceof Error && error.message === "assistance_session_ephemeral_input_unavailable" ? error : new Error("assistance_session_not_found"); }
    }
    if (session === undefined || session.ownerSessionId !== this.#ownerSessionId) throw new Error("assistance_session_not_found");
    this.#expire(session);
    const step = session.steps[session.currentStepIndex];
    const terminal = ["completed", "cancelled", "expired"].includes(session.status) || (session.status === "blocked" && !targetBlockersOnly(session)) || step === undefined;
    const target = step?.target ?? step?.primitive?.target ?? step?.widget?.target;
    const targetRequired = step !== undefined && ["pointer", "highlight", "tooltip"].includes(step.type) && target === undefined;
    const targetExpiresAt = target === undefined ? NaN : Date.parse(target.expiresAt);
    const targetFreshness = step === undefined || ["clear", "wait_for_event", "finish"].includes(step.type) ? "not_required" : target === undefined ? (targetRequired ? "missing" : "not_required") : !Number.isFinite(targetExpiresAt) ? "unknown" : targetExpiresAt > Date.now() ? "fresh" : "stale";
    const blockers = [...session.blockers];
    if (!session.ephemeralMaterialAvailable) blockers.push("ephemeral_input_unavailable");
    if (targetFreshness === "missing" || targetFreshness === "stale") blockers.push(`assistance_target_${targetFreshness}`);
    const sensitivity = step?.primitive?.sensitivity ?? step?.widget?.sensitivity ?? "public";
    const safeLabel = step === undefined ? undefined : sensitivity === "private" ? "[redacted-private]" : safeText(step.primitive?.label ?? step.primitive?.text ?? step.widget?.title ?? step.type, sensitivity);
    const canRender = !terminal && blockers.length === 0 && (targetFreshness === "fresh" || targetFreshness === "not_required");
    let recoveryState: OverlayAssistanceRecoveryState = "none";
    if (terminal) recoveryState = "terminal";
    else if (targetFreshness === "missing") recoveryState = (session.targetRefreshCount ?? 0) >= MAX_TARGET_REFRESHES ? "retry_exhausted" : "target_missing";
    else if (targetFreshness === "stale") recoveryState = (session.targetRefreshCount ?? 0) >= MAX_TARGET_REFRESHES ? "retry_exhausted" : "target_stale";
    else if (session.blockers.some((item) => item.includes("renderer"))) recoveryState = "renderer_unavailable";
    const recovery = { state: recoveryState, retryCount: session.targetRefreshCount ?? 0, maxRetries: MAX_TARGET_REFRESHES, retryAllowed: !terminal && recoveryState !== "retry_exhausted", recommendedAction: recoveryState === "target_missing" || recoveryState === "target_stale" ? "refresh_visual_target" : recoveryState === "renderer_unavailable" ? "inspect_diagnostics" : recoveryState === "retry_exhausted" ? "stop_and_review" : terminal ? "no_action_terminal" : "continue_visual_assistance" };
    return {
      sessionId,
      status: session.status,
      currentStepIndex: session.currentStepIndex,
      ...(step === undefined ? {} : { stepId: step.stepId, stepType: step.type, ...(safeLabel === undefined ? {} : { safeLabel }), ...(step.progressGroup === undefined ? {} : { progressGroup: step.progressGroup }) }),
      warningCodes: (step?.warningCodes ?? []).slice(0, 10),
      progress: session.progress,
      canRender,
      targetRequired,
      targetFreshness,
      ...(step?.expectedEvent === undefined ? {} : { expectedEvent: step.expectedEvent }),
      blockers: [...new Set(blockers)].slice(0, 20),
      warnings: session.warnings.slice(0, 20),
      recovery,
      recommendedAction: recoveryState !== "none" ? recovery.recommendedAction : blockers.length > 0 ? "review_blockers" : session.status === "ready" ? "start_assistance_session" : session.status === "active" ? "show_current_step" : session.status === "waiting_for_operator" ? "apply_expected_visual_event" : session.status === "paused" ? "resume_assistance_session" : "review_blockers",
      terminal
    };
  }
  async explain(sessionId: string, renderer: { rendererStatus?: string; effectiveBackend?: string; sessionType?: string; fallbackReason?: string } = {}): Promise<OverlayAssistanceSessionExplanation> {
    const session = this.#sessions.get(sessionId);
    if (session === undefined) {
      try { const persisted = await this.get(sessionId); if (persisted.ephemeralMaterialAvailable === false) throw new Error("assistance_session_ephemeral_input_unavailable"); } catch (error) { throw error instanceof Error && error.message === "assistance_session_ephemeral_input_unavailable" ? error : new Error("assistance_session_not_found"); }
    }
    if (session === undefined || session.ownerSessionId !== this.#ownerSessionId) throw new Error("assistance_session_not_found");
    const preview = await this.preview(sessionId);
    const step = session.steps[session.currentStepIndex];
    const terminalExplanation = session.status === "completed" ? "assistance_session_completed" : session.status === "cancelled" ? "assistance_session_cancelled" : session.status === "expired" ? "assistance_session_expired" : session.status === "blocked" ? "assistance_session_blocked" : undefined;
    return {
      sessionId,
      status: session.status,
      currentStepIndex: session.currentStepIndex,
      remainingSteps: Math.max(0, session.steps.length - session.currentStepIndex),
      progress: session.progress,
      ...(step === undefined ? {} : { currentStep: { stepId: step.stepId, type: step.type, ...(preview.safeLabel === undefined ? {} : { label: preview.safeLabel }) } }),
      ...(session.status === "waiting_for_operator" ? { waitingReason: step?.expectedEvent === undefined ? "operator_event_required" : `expected_event_${step.expectedEvent}` } : {}),
      ...(session.lastEvent === undefined ? {} : { lastEvent: { event: session.lastEvent.event, stepId: session.lastEvent.stepId, createdAt: session.lastEvent.createdAt } }),
      renderer: { status: renderer.rendererStatus ?? "unknown", backend: renderer.effectiveBackend ?? "unknown", sessionType: renderer.sessionType ?? "unknown", healthy: renderer.rendererStatus === "available" || renderer.rendererStatus === "degraded", ...(renderer.fallbackReason === undefined ? {} : { reason: renderer.fallbackReason }) },
      targetFreshness: preview.targetFreshness,
      blockers: preview.blockers,
      warnings: preview.warnings,
      recovery: preview.recovery,
      requiredGrantIds: session.checkpointSummaries.flatMap((checkpoint) => checkpoint.requiredGrantIds ?? []).slice(0, 20),
      recommendedAction: preview.recommendedAction,
      ...(terminalExplanation === undefined ? {} : { terminalExplanation })
    };
  }
  async list(): Promise<Record<string, unknown>[]> { const entries = await readdir(this.#dir, { withFileTypes: true }).catch(() => []); const values = new Map<string, Record<string, unknown>>(); for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json"))) { try { const value = JSON.parse(await readFile(path.join(this.#dir, entry.name), "utf8")) as Record<string, unknown>; if (value.ownerSessionId === this.#ownerSessionId && typeof value.sessionId === "string") { delete value.currentOverlayId; values.set(value.sessionId, value); } } catch { /* ignore invalid records */ } } for (const session of this.#sessions.values()) { if (session.ownerSessionId !== this.#ownerSessionId) continue; this.#expire(session); values.set(session.sessionId, summary(session)); } return [...values.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))); }
  async start(sessionId: string): Promise<Record<string, unknown>> { const session = this.#active(sessionId); if (session.status !== "ready" && session.status !== "paused") throw new Error("assistance_session_not_startable"); session.status = "active"; session.updatedAt = now(); await this.#persist(session); return summary(session); }
  async showCurrent(sessionId: string, resolver: OverlayTargetResolver): Promise<Record<string, unknown>> { const session = this.#active(sessionId); if (session.status !== "active") throw new Error("assistance_session_not_active"); const step = session.steps[session.currentStepIndex]; if (step === undefined) throw new Error("assistance_current_step_missing"); const preview = await this.preview(sessionId); const targetMissing = preview.targetFreshness === "missing" && step.requiresTarget === true; if (!preview.canRender && (targetMissing || preview.targetFreshness === "stale")) { session.blockers = [...new Set([...session.blockers, `assistance_target_${preview.targetFreshness}`])]; session.updatedAt = now(); await this.#persist(session); throw new Error(`assistance_target_${preview.targetFreshness}`); } await this.#clearSessionOverlay(session.sessionId); const result = step.primitive !== undefined ? await this.#manager.showPrimitive({ ...step.primitive, ...(step.target === undefined ? {} : { target: step.target }) }, resolver) : step.widget !== undefined ? await this.#manager.showWidget({ ...step.widget, ...(step.target === undefined ? {} : { target: step.target }) }, resolver) : step.type === "clear" ? { ok: true, reason: "assistance_overlay_cleared" } : { ok: true, reason: "assistance_step_visual_state" };
    const resultError = "errors" in result ? result.errors[0] : result.ok ? undefined : result.reason;
    if (!result.ok) { session.blockers = [...new Set([...session.blockers, resultError ?? "assistance_step_show_failed"])]; session.warnings = [...new Set([...session.warnings, "assistance_visual_retry_required"])]; session.updatedAt = now(); await this.#persist(session); throw new Error(session.blockers.at(-1)); }
    if ("overlay" in result && result.overlay?.overlayId !== undefined) { this.#overlayIds.set(session.sessionId, result.overlay.overlayId); session.currentOverlayId = result.overlay.overlayId; } else { delete session.currentOverlayId; } if (step.requiresEvent || step.type === "wait_for_event") session.status = "waiting_for_operator"; session.updatedAt = now(); await this.#persist(session); return summary(session); }
  async applyEvent(input: OverlayAssistanceEvent): Promise<Record<string, unknown>> { const session = this.#active(input.sessionId); if (session.status !== "waiting_for_operator") throw new Error("assistance_session_not_waiting"); const step = session.steps[session.currentStepIndex]; const expectedOverlayId = this.#overlayIds.get(session.sessionId); if (step === undefined || step.stepId !== input.stepId || input.ownerSessionId !== session.ownerSessionId || (expectedOverlayId === undefined ? input.overlayId !== undefined : input.overlayId !== expectedOverlayId)) throw new Error("assistance_event_mismatch"); if (session.lastEvent?.eventId === input.eventId) throw new Error("assistance_event_reused"); const errors = validateOverlayAssistanceEvent(input); if (errors.length > 0) throw new Error(errors[0]); if (step.expectedEvent !== undefined && step.expectedEvent !== input.event) throw new Error("assistance_event_unexpected"); session.lastEvent = input; session.updatedAt = now(); await this.#persist(session); return summary(session); }
  async refreshTarget(sessionId: string, stepId: string, target: OverlayTargetBinding, resolver: OverlayTargetResolver): Promise<Record<string, unknown>> {
    const session = this.#sessions.get(sessionId);
    if (session === undefined || session.ownerSessionId !== this.#ownerSessionId) throw new Error("assistance_session_not_found");
    this.#expire(session);
    if (["completed", "cancelled", "expired"].includes(session.status)) throw new Error(`assistance_session_${session.status}`);
    if (session.status === "blocked" && !targetBlockersOnly(session)) throw new Error("assistance_session_blocked");
    const step = session.steps[session.currentStepIndex];
    if (step === undefined || step.stepId !== stepId) throw new Error("assistance_current_step_mismatch");
    if ((session.targetRefreshCount ?? 0) >= MAX_TARGET_REFRESHES) throw new Error("assistance_target_refresh_limit");
    const errors = validateOverlayTargetBinding(target);
    if (errors.length > 0) throw new Error(errors[0]);
    const existing = step.target ?? step.primitive?.target ?? step.widget?.target;
    if (existing !== undefined && existing.kind !== target.kind) throw new Error("assistance_target_kind_mismatch");
    const resolved = await resolver(target, sessionId);
    if (!resolved.ok || resolved.summary === undefined) throw new Error(resolved.reason ?? "assistance_target_unavailable");
    const nextStep: OverlayAssistanceStep = { ...step, target, ...(step.primitive === undefined ? {} : { primitive: { ...step.primitive, target } }), ...(step.widget === undefined ? {} : { widget: { ...step.widget, target } }) };
    session.steps[session.currentStepIndex] = nextStep;
    session.targetRefreshCount = (session.targetRefreshCount ?? 0) + 1;
    session.blockers = session.blockers.filter((blocker) => !targetBlocker(blocker));
    if (session.status === "blocked") session.status = "active";
    session.updatedAt = now();
    await this.#persist(session);
    return { ...summary(session), target: { kind: resolved.summary.kind, sensitivity: resolved.summary.sensitivity, expiresAt: resolved.summary.expiresAt }, recovery: { state: "retry_available", retryCount: session.targetRefreshCount, maxRetries: MAX_TARGET_REFRESHES, retryAllowed: session.targetRefreshCount < MAX_TARGET_REFRESHES, recommendedAction: "show_current_step" } };
  }
  async advance(sessionId: string): Promise<Record<string, unknown>> { const session = this.#active(sessionId); if (session.status !== "active" && session.status !== "waiting_for_operator") throw new Error("assistance_session_not_advancable"); const step = session.steps[session.currentStepIndex]; if (step === undefined) throw new Error("assistance_current_step_missing"); if ((step.requiresEvent || step.type === "wait_for_event") && (session.lastEvent === undefined || session.lastEvent.stepId !== step.stepId)) throw new Error("assistance_event_required"); await this.#clearSessionOverlay(session.sessionId); session.currentStepIndex += 1; session.targetRefreshCount = 0; session.progress = { completed: Math.min(session.currentStepIndex, session.steps.length), total: session.steps.length, percent: Math.round((Math.min(session.currentStepIndex, session.steps.length) / session.steps.length) * 100) }; session.status = session.currentStepIndex >= session.steps.length ? "completed" : "active"; session.updatedAt = now(); await this.#persist(session); return summary(session); }
  async pause(sessionId: string): Promise<Record<string, unknown>> { const session = this.#active(sessionId); if (session.status !== "active" && session.status !== "waiting_for_operator") throw new Error("assistance_session_not_pauseable"); await this.#clearSessionOverlay(session.sessionId); session.status = "paused"; session.updatedAt = now(); await this.#persist(session); return summary(session); }
  async cancel(sessionId: string): Promise<Record<string, unknown>> { const session = this.#active(sessionId); if (["completed", "cancelled", "expired"].includes(session.status)) return summary(session); await this.#clearSessionOverlay(session.sessionId); session.status = "cancelled"; session.updatedAt = now(); await this.#persist(session); return summary(session); }
  async complete(sessionId: string): Promise<Record<string, unknown>> { const existing = this.#sessions.get(sessionId); if (existing?.ownerSessionId !== this.#ownerSessionId) throw new Error("assistance_session_not_found"); if (existing.status === "completed") return summary(existing); const session = this.#active(sessionId); if (session.currentStepIndex < session.steps.length) throw new Error("assistance_steps_remaining"); session.status = "completed"; session.updatedAt = now(); await this.#persist(session); return summary(session); }
  async close(): Promise<void> { for (const session of this.#sessions.values()) { if (session.ownerSessionId !== this.#ownerSessionId || ["completed", "cancelled", "expired", "blocked"].includes(session.status)) continue; await this.#clearSessionOverlay(session.sessionId); session.status = "cancelled"; session.warnings = [...new Set([...session.warnings, "assistance_owner_session_closed"])]; session.updatedAt = now(); await this.#persist(session); } }
  #active(sessionId: string): OverlayAssistanceSession { const session = this.#sessions.get(sessionId); if (session === undefined || session.ownerSessionId !== this.#ownerSessionId) throw new Error("assistance_session_not_found"); this.#expire(session); if (["cancelled", "completed", "expired", "blocked"].includes(session.status)) throw new Error("assistance_session_" + session.status); return session; }
  #expire(session: OverlayAssistanceSession): void { if (!(["completed", "cancelled", "blocked", "expired"] as OverlayAssistanceSessionStatus[]).includes(session.status) && Date.parse(session.expiresAt) <= Date.now()) { session.status = "expired"; session.warnings = [...new Set([...session.warnings, "assistance_session_expired"])]; void this.#clearSessionOverlay(session.sessionId); void this.#persist(session); } }
  async #clearSessionOverlay(sessionId: string): Promise<void> { const overlayId = this.#overlayIds.get(sessionId); if (overlayId === undefined) return; this.#overlayIds.delete(sessionId); await this.#manager.dismiss(overlayId); const session = this.#sessions.get(sessionId); if (session !== undefined) delete session.currentOverlayId; }
  async #persist(session: OverlayAssistanceSession): Promise<void> { await mkdir(this.#dir, { recursive: true, mode: 0o700 }); const file = this.#file(session.sessionId); const temp = `${file}.${randomUUID()}.tmp`; const persisted = summary(session); delete persisted.currentOverlayId; await writeFile(temp, `${JSON.stringify(persisted, null, 2)}\n`, { mode: 0o600 }); await chmod(temp, 0o600); await rename(temp, file); }
  #file(sessionId: string): string { return path.join(this.#dir, `${sessionId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`); }
}
