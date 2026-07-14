import { chmod, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { redactOverlayText, validateOverlayAnimation, validateOverlayAssistanceEvent, validateOverlayAssistanceSteps, validateOverlayInteractionPolicy, validateOverlayTargetBinding, validateOverlayWidget, type OverlayAssistanceEvent, type OverlayAssistanceSession, type OverlayAssistanceStep, type OverlayAssistanceSessionStatus, type OverlayTargetBinding, type OverlayWidget, type OverlayPrimitive } from "@agenthost/core";
import type { OverlayManager, OverlayTargetResolver } from "@agenthost/app-overlay";

const now = () => new Date().toISOString();
const id = () => `assist_${randomUUID()}`;
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
function summary(session: OverlayAssistanceSession): Record<string, unknown> { return { sessionId: session.sessionId, ownerSessionId: session.ownerSessionId, name: "[redacted]", status: session.status, createdAt: session.createdAt, updatedAt: session.updatedAt, expiresAt: session.expiresAt, currentStepIndex: session.currentStepIndex, ...(session.currentOverlayId === undefined ? {} : { currentOverlayId: session.currentOverlayId }), stepTypes: session.steps.map((step) => step.type), stepCount: session.steps.length, progress: session.progress, checkpointCount: session.checkpointSummaries.length, lastEvent: session.lastEvent === undefined ? undefined : { eventId: session.lastEvent.eventId, stepId: session.lastEvent.stepId, overlayId: session.lastEvent.overlayId, event: session.lastEvent.event, createdAt: session.lastEvent.createdAt }, blockers: session.blockers, warnings: session.warnings, ephemeralMaterialAvailable: session.ephemeralMaterialAvailable }; }

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
  async get(sessionId: string): Promise<Record<string, unknown>> { const session = this.#sessions.get(sessionId); if (session !== undefined) { if (session.ownerSessionId !== this.#ownerSessionId) throw new Error("assistance_session_not_found"); this.#expire(session); return summary(session); } try { const stored = JSON.parse(await readFile(this.#file(sessionId), "utf8")) as Record<string, unknown>; if (stored.ownerSessionId !== this.#ownerSessionId) throw new Error("assistance_session_not_found"); return { ...stored, status: stored.status === "completed" || stored.status === "cancelled" || stored.status === "expired" ? stored.status : "blocked", ephemeralMaterialAvailable: false, blockers: [...(Array.isArray(stored.blockers) ? stored.blockers : []), "ephemeral_input_unavailable"] }; } catch (error) { if (error instanceof Error && error.message === "assistance_session_not_found") throw error; throw new Error("assistance_session_not_found"); } }
  async list(): Promise<Record<string, unknown>[]> { const entries = await readdir(this.#dir, { withFileTypes: true }).catch(() => []); const values = new Map<string, Record<string, unknown>>(); for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json"))) { try { const value = JSON.parse(await readFile(path.join(this.#dir, entry.name), "utf8")) as Record<string, unknown>; if (value.ownerSessionId === this.#ownerSessionId && typeof value.sessionId === "string") values.set(value.sessionId, value); } catch { /* ignore invalid records */ } } for (const session of this.#sessions.values()) { if (session.ownerSessionId !== this.#ownerSessionId) continue; this.#expire(session); values.set(session.sessionId, summary(session)); } return [...values.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))); }
  async start(sessionId: string): Promise<Record<string, unknown>> { const session = this.#active(sessionId); if (session.status !== "ready" && session.status !== "paused") throw new Error("assistance_session_not_startable"); session.status = "active"; session.updatedAt = now(); await this.#persist(session); return summary(session); }
  async showCurrent(sessionId: string, resolver: OverlayTargetResolver): Promise<Record<string, unknown>> { const session = this.#active(sessionId); if (session.status !== "active") throw new Error("assistance_session_not_active"); const step = session.steps[session.currentStepIndex]; if (step === undefined) throw new Error("assistance_current_step_missing"); await this.#clearSessionOverlay(session.sessionId); const result = step.primitive !== undefined ? await this.#manager.showPrimitive({ ...step.primitive, ...(step.target === undefined ? {} : { target: step.target }) }, resolver) : step.widget !== undefined ? await this.#manager.showWidget({ ...step.widget, ...(step.target === undefined ? {} : { target: step.target }) }, resolver) : step.type === "clear" ? { ok: true, reason: "assistance_overlay_cleared" } : { ok: true, reason: "assistance_step_visual_state" };
    const resultError = "errors" in result ? result.errors[0] : result.ok ? undefined : result.reason;
    if (!result.ok) { session.status = "blocked"; session.blockers = [...new Set([...session.blockers, resultError ?? "assistance_step_show_failed"])]; session.updatedAt = now(); await this.#persist(session); throw new Error(session.blockers.at(-1)); }
    if ("overlay" in result && result.overlay?.overlayId !== undefined) { this.#overlayIds.set(session.sessionId, result.overlay.overlayId); session.currentOverlayId = result.overlay.overlayId; } else { delete session.currentOverlayId; } if (step.requiresEvent || step.type === "wait_for_event") session.status = "waiting_for_operator"; session.updatedAt = now(); await this.#persist(session); return summary(session); }
  async applyEvent(input: OverlayAssistanceEvent): Promise<Record<string, unknown>> { const session = this.#active(input.sessionId); if (session.status !== "waiting_for_operator") throw new Error("assistance_session_not_waiting"); const step = session.steps[session.currentStepIndex]; const expectedOverlayId = this.#overlayIds.get(session.sessionId); if (step === undefined || step.stepId !== input.stepId || input.ownerSessionId !== session.ownerSessionId || (expectedOverlayId === undefined ? input.overlayId !== undefined : input.overlayId !== expectedOverlayId)) throw new Error("assistance_event_mismatch"); if (session.lastEvent?.eventId === input.eventId) throw new Error("assistance_event_reused"); const errors = validateOverlayAssistanceEvent(input); if (errors.length > 0) throw new Error(errors[0]); if (step.expectedEvent !== undefined && step.expectedEvent !== input.event) throw new Error("assistance_event_unexpected"); session.lastEvent = input; session.updatedAt = now(); await this.#persist(session); return summary(session); }
  async advance(sessionId: string): Promise<Record<string, unknown>> { const session = this.#active(sessionId); if (session.status !== "active" && session.status !== "waiting_for_operator") throw new Error("assistance_session_not_advancable"); const step = session.steps[session.currentStepIndex]; if (step === undefined) throw new Error("assistance_current_step_missing"); if ((step.requiresEvent || step.type === "wait_for_event") && (session.lastEvent === undefined || session.lastEvent.stepId !== step.stepId)) throw new Error("assistance_event_required"); await this.#clearSessionOverlay(session.sessionId); session.currentStepIndex += 1; session.progress = { completed: Math.min(session.currentStepIndex, session.steps.length), total: session.steps.length, percent: Math.round((Math.min(session.currentStepIndex, session.steps.length) / session.steps.length) * 100) }; session.status = session.currentStepIndex >= session.steps.length ? "completed" : "active"; session.updatedAt = now(); await this.#persist(session); return summary(session); }
  async pause(sessionId: string): Promise<Record<string, unknown>> { const session = this.#active(sessionId); if (session.status !== "active" && session.status !== "waiting_for_operator") throw new Error("assistance_session_not_pauseable"); await this.#clearSessionOverlay(session.sessionId); session.status = "paused"; session.updatedAt = now(); await this.#persist(session); return summary(session); }
  async cancel(sessionId: string): Promise<Record<string, unknown>> { const session = this.#active(sessionId); if (["completed", "cancelled", "expired"].includes(session.status)) return summary(session); await this.#clearSessionOverlay(session.sessionId); session.status = "cancelled"; session.updatedAt = now(); await this.#persist(session); return summary(session); }
  async complete(sessionId: string): Promise<Record<string, unknown>> { const existing = this.#sessions.get(sessionId); if (existing?.ownerSessionId !== this.#ownerSessionId) throw new Error("assistance_session_not_found"); if (existing.status === "completed") return summary(existing); const session = this.#active(sessionId); if (session.currentStepIndex < session.steps.length) throw new Error("assistance_steps_remaining"); session.status = "completed"; session.updatedAt = now(); await this.#persist(session); return summary(session); }
  async close(): Promise<void> { for (const session of this.#sessions.values()) { if (session.ownerSessionId !== this.#ownerSessionId || ["completed", "cancelled", "expired", "blocked"].includes(session.status)) continue; await this.#clearSessionOverlay(session.sessionId); session.status = "cancelled"; session.warnings = [...new Set([...session.warnings, "assistance_owner_session_closed"])]; session.updatedAt = now(); await this.#persist(session); } }
  #active(sessionId: string): OverlayAssistanceSession { const session = this.#sessions.get(sessionId); if (session === undefined || session.ownerSessionId !== this.#ownerSessionId) throw new Error("assistance_session_not_found"); this.#expire(session); if (["cancelled", "completed", "expired", "blocked"].includes(session.status)) throw new Error("assistance_session_" + session.status); return session; }
  #expire(session: OverlayAssistanceSession): void { if (!(["completed", "cancelled", "blocked", "expired"] as OverlayAssistanceSessionStatus[]).includes(session.status) && Date.parse(session.expiresAt) <= Date.now()) { session.status = "expired"; session.warnings = [...new Set([...session.warnings, "assistance_session_expired"])]; void this.#clearSessionOverlay(session.sessionId); void this.#persist(session); } }
  async #clearSessionOverlay(sessionId: string): Promise<void> { const overlayId = this.#overlayIds.get(sessionId); if (overlayId === undefined) return; this.#overlayIds.delete(sessionId); await this.#manager.dismiss(overlayId); const session = this.#sessions.get(sessionId); if (session !== undefined) delete session.currentOverlayId; }
  async #persist(session: OverlayAssistanceSession): Promise<void> { await mkdir(this.#dir, { recursive: true, mode: 0o700 }); const file = this.#file(session.sessionId); const temp = `${file}.${randomUUID()}.tmp`; await writeFile(temp, `${JSON.stringify(summary(session), null, 2)}\n`, { mode: 0o600 }); await chmod(temp, 0o600); await rename(temp, file); }
  #file(sessionId: string): string { return path.join(this.#dir, `${sessionId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`); }
}
