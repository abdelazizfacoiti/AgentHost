import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { redactOverlayText, validateOverlayAnimation, validateOverlayInteractionPolicy, validateOverlayStyleTokens, validateOverlayTargetBinding, validateOverlayWidget, type OverlayCapabilityReport, type OverlayPrimitive, type OverlaySensitivity, type OverlayStateSnapshot, type OverlayStateSummary, type OverlayTargetBinding, type OverlayTargetSummary, type OverlayWidget, type OverlayWidgetEvent } from "@agenthost/core";
import type { OverlayOperationResult, OverlayRenderRecord, OverlayRenderer, OverlayRendererDiagnostics, OverlayRendererRestartResult } from "./renderer.js";

export interface OverlayTargetResolution { ok: boolean; summary?: OverlayTargetSummary; reason?: string; }
export type OverlayTargetResolver = (binding: OverlayTargetBinding, sessionId: string) => Promise<OverlayTargetResolution> | OverlayTargetResolution;
export interface OverlayOwner { sessionId: string; }
export interface OverlaySuppressionRecord { overlayId: string; type: string; payload: unknown; record?: OverlayStateSummary; }
export interface OverlayManagerOptions { /** Set to null to disable the cross-process hide marker (tests). */ hideMarkerPath?: string | null; }

const PERSISTENT_EXPIRY_MS = 100 * 365 * 24 * 60 * 60 * 1000;

function expiry(ttlMs = 30_000): string { return new Date(Date.now() + Math.min(300_000, Math.max(1_000, ttlMs))).toISOString(); }
function overlayExpiry(ttlMs: number | undefined, target: OverlayTargetSummary | undefined, persistent = false): string { if (persistent) return new Date(Date.now() + PERSISTENT_EXPIRY_MS).toISOString(); const own = Date.parse(expiry(ttlMs)); const targetExpiry = target === undefined ? own : Date.parse(target.expiresAt); return new Date(Math.min(own, targetExpiry)).toISOString(); }
function sensitivity(value: OverlaySensitivity): OverlaySensitivity { return value === "secret" ? "secret" : value === "private" ? "private" : "public"; }
function safePrimitive(input: OverlayPrimitive, target: OverlayTargetSummary | undefined): Record<string, unknown> { const value: Record<string, unknown> = { type: input.type, sensitivity: sensitivity(input.sensitivity), ...(target === undefined ? {} : { target }), ...(input.style === undefined ? {} : { style: input.style }), ...(input.animation === undefined ? {} : { animation: input.animation }), ...(input.interaction === undefined ? {} : { interaction: input.interaction }) }; if (input.label !== undefined) value.label = redactOverlayText(input.label, input.sensitivity).redactedText ?? "[redacted]"; if (input.text !== undefined) value.text = redactOverlayText(input.text, input.sensitivity).redactedText ?? "[redacted]"; if (input.value !== undefined) value.value = input.value; if (input.progress !== undefined) value.progress = input.progress; return value; }
function safeWidget(input: OverlayWidget, target: OverlayTargetSummary | undefined): Record<string, unknown> { const components = input.components.map((component) => { if (component.type === "heading" || component.type === "text" || component.type === "divider" || component.type === "warning") return { ...component, text: redactOverlayText(component.text, input.sensitivity).redactedText ?? "[redacted]" }; if (component.type === "status_badge") return { ...component, text: redactOverlayText(component.text, input.sensitivity).redactedText ?? "[redacted]" }; if (component.type === "button" || component.type === "choice") return { ...component, label: redactOverlayText(component.label, input.sensitivity).redactedText ?? "[redacted]" }; if (component.type === "key_value") return { ...component, key: redactOverlayText(component.key, input.sensitivity).redactedText ?? "[redacted]", value: redactOverlayText(component.value, input.sensitivity).redactedText ?? "[redacted]" }; if (component.type === "comparison") return { ...component, before: redactOverlayText(component.before, input.sensitivity).redactedText ?? "[redacted]", after: redactOverlayText(component.after, input.sensitivity).redactedText ?? "[redacted]" }; if (component.type === "checklist") return { ...component, items: component.items.map((item) => ({ label: redactOverlayText(item.label, input.sensitivity).redactedText ?? "[redacted]", checked: item.checked, ...(item.state === undefined ? {} : { state: item.state }) })) }; if (component.type === "spinner") return { ...component, ...(component.label === undefined ? {} : { label: redactOverlayText(component.label, input.sensitivity).redactedText ?? "[redacted]" }) }; if (component.type === "progress") return { ...component, ...(component.label === undefined ? {} : { label: redactOverlayText(component.label, input.sensitivity).redactedText ?? "[redacted]" }) }; if (component.type === "image_reference") return { type: component.type, evidenceId: component.evidenceId, alt: redactOverlayText(component.alt, input.sensitivity).redactedText ?? "[redacted]" }; return component; }); return { title: redactOverlayText(input.title, input.sensitivity).redactedText ?? "[redacted]", components, sensitivity: sensitivity(input.sensitivity), ...(target === undefined ? {} : { target }), ...(input.placement === undefined ? {} : { placement: input.placement }), ...(input.displayPolicy === undefined ? {} : { displayPolicy: input.displayPolicy }), ...(input.style === undefined ? {} : { style: input.style }), ...(input.animation === undefined ? {} : { animation: input.animation }), ...(input.interaction === undefined ? {} : { interaction: input.interaction }) }; }

export class OverlayManager {
  readonly #renderer: OverlayRenderer;
  readonly #owner: OverlayOwner;
  readonly #records = new Map<string, OverlayStateSummary>();
  readonly #payloads = new Map<string, unknown>();
  readonly #targets = new Map<string, { binding: OverlayTargetBinding; resolver?: OverlayTargetResolver | undefined }>();
  readonly #hideMarkerPath: string | null;
  readonly #localEvents: OverlayWidgetEvent[] = [];
  readonly #pendingEvents: OverlayWidgetEvent[] = [];
  #emergencyHidden = false;
  #rendererEpoch = 0;
  #sweeper: ReturnType<typeof setInterval> | undefined;
  constructor(renderer: OverlayRenderer, owner: OverlayOwner, options: OverlayManagerOptions = {}) {
    this.#renderer = renderer;
    this.#owner = owner;
    this.#hideMarkerPath = options.hideMarkerPath === undefined ? path.join(process.env.AGENTHOST_HOME ?? path.join(os.homedir(), ".agenthost"), "run", "overlay.hide") : options.hideMarkerPath;
    // TTLs must hide windows even when nobody polls state(). Without this
    // sweeper, an expired overlay stayed mapped on screen indefinitely while
    // the runtime sat idle. Unref'd so test/CLi processes exit cleanly.
    const sweeper = setInterval(() => {
      try {
        this.#checkHideMarker();
        this.#expire();
      } catch {
        /* Expiry never breaks rendering. */
      }
    }, 5_000);
    const maybeUnref = sweeper as unknown as { unref?: () => void };
    if (typeof maybeUnref.unref === "function") maybeUnref.unref();
    this.#sweeper = sweeper;
  }
  capabilities(): Promise<OverlayCapabilityReport> | OverlayCapabilityReport { return this.#renderer.capabilities(); }
  async diagnostics(): Promise<OverlayRendererDiagnostics> { const diagnostics = await this.#renderer.diagnostics?.(); if (diagnostics !== undefined) return { ...diagnostics, activeOverlayCount: this.#records.size }; const capabilities = await this.#renderer.capabilities(); return { requestedMode: "headless", effectiveBackend: "headless", rendererStatus: "headless", sessionType: "unknown", displayPresent: false, waylandDisplayPresent: false, pythonExecutable: "not_used", gtk3Available: false, rendererScriptPresent: false, childState: "stopped", handshake: "not_attempted", capabilities, activeOverlayCount: this.#records.size, restartCount: 0, restartAllowed: false, recommendedAction: "Use headless renderer." }; }
  async state(): Promise<OverlayStateSnapshot> { this.#expire(); await this.#revalidateTargets(); const renderer = await this.#renderer.state(); return { ...renderer, overlays: [...this.#records.values()].filter((item) => item.visible), emergencyHidden: this.#emergencyHidden }; }
  async showPrimitive(input: OverlayPrimitive, resolver?: OverlayTargetResolver, reducedMotion = false): Promise<{ ok: boolean; overlay?: OverlayStateSummary; errors: string[] }> {
    const errors = [...validateOverlayAnimation(input.animation, reducedMotion), ...validateOverlayStyleTokens(input.style), ...validateOverlayInteractionPolicy(input.interaction)];
    if (input.sensitivity === "secret") errors.push("overlay_secret_content_blocked");
    if (input.text !== undefined) errors.push(...redactOverlayText(input.text, input.sensitivity).errors);
    if (input.label !== undefined) errors.push(...redactOverlayText(input.label, input.sensitivity).errors);
    let target: OverlayTargetSummary | undefined;
    if (input.target !== undefined) {
      errors.push(...validateOverlayTargetBinding(input.target));
      if (resolver !== undefined && errors.length === 0) {
        const resolved = await resolver(input.target, this.#owner.sessionId);
        if (!resolved.ok || resolved.summary === undefined) errors.push(resolved.reason ?? "overlay_target_unavailable"); else target = resolved.summary;
      } else if (resolver === undefined && errors.length === 0 && input.target.kind === "screen_point") {
        target = { kind: input.target.kind, targetId: `point_${input.target.point.x}_${input.target.point.y}`, point: input.target.point, ...(input.target.displayId === undefined ? {} : { displayId: input.target.displayId }), sensitivity: "public", validatedAt: new Date().toISOString(), expiresAt: input.target.expiresAt };
      } else if (resolver === undefined) errors.push("overlay_target_resolver_unavailable");
    }
    if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };
    const overlayId = input.overlayId ?? `overlay_${randomUUID()}`; const createdAt = new Date().toISOString(); const record: OverlayStateSummary = { overlayId, ownerSessionId: this.#owner.sessionId, type: input.type, ...(target === undefined ? {} : { target }), sensitivity: sensitivity(input.sensitivity), interactive: input.interaction?.interactive === true, visible: true, createdAt, updatedAt: createdAt, expiresAt: overlayExpiry(input.ttlMs, target) };
    const payload = safePrimitive(input, target);
    const result = await this.#renderer.show({ overlayId, type: input.type, payload });
    if (!result.ok || result.acknowledged !== true) return { ok: false, errors: [result.reason || "overlay_render_not_acknowledged"] };
    if (result.rendererEpoch !== undefined) this.#rendererEpoch = Math.max(this.#rendererEpoch, result.rendererEpoch);
    this.#records.set(overlayId, record); this.#payloads.set(overlayId, payload); this.#emergencyHidden = false;
    if (input.target !== undefined) this.#targets.set(overlayId, { binding: input.target, ...(resolver === undefined ? {} : { resolver }) });
    return { ok: true, overlay: record, errors: [] };
  }
  async showWidget(input: OverlayWidget, resolver?: OverlayTargetResolver, reducedMotion = false): Promise<{ ok: boolean; overlay?: OverlayStateSummary; errors: string[] }> {
    const errors = validateOverlayWidget(input, reducedMotion); let target: OverlayTargetSummary | undefined;
    if (input.target !== undefined) {
      errors.push(...validateOverlayTargetBinding(input.target));
      if (resolver !== undefined && errors.length === 0) {
        const resolved = await resolver(input.target, this.#owner.sessionId);
        if (!resolved.ok || resolved.summary === undefined) errors.push(resolved.reason ?? "overlay_target_unavailable"); else target = resolved.summary;
      } else if (resolver === undefined && errors.length === 0 && input.target.kind === "screen_point") {
        target = { kind: input.target.kind, targetId: `point_${input.target.point.x}_${input.target.point.y}`, point: input.target.point, ...(input.target.displayId === undefined ? {} : { displayId: input.target.displayId }), sensitivity: "public", validatedAt: new Date().toISOString(), expiresAt: input.target.expiresAt };
      } else if (resolver === undefined) errors.push("overlay_target_resolver_unavailable");
    }
    if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };
    const overlayId = input.widgetId ?? `overlay_${randomUUID()}`; const createdAt = new Date().toISOString(); const persistent = input.persistent === true; const record: OverlayStateSummary = { overlayId, ownerSessionId: this.#owner.sessionId, type: "widget", ...(target === undefined ? {} : { target }), sensitivity: sensitivity(input.sensitivity), interactive: input.interaction?.interactive === true, visible: true, createdAt, updatedAt: createdAt, expiresAt: overlayExpiry(input.ttlMs, target, persistent), ...(persistent ? { persistent: true } : {}) };
    const payload = safeWidget(input, target);
    const result = await this.#renderer.show({ overlayId, type: "widget", payload });
    if (!result.ok || result.acknowledged !== true) return { ok: false, errors: [result.reason || "overlay_render_not_acknowledged"] };
    if (result.rendererEpoch !== undefined) this.#rendererEpoch = Math.max(this.#rendererEpoch, result.rendererEpoch);
    this.#records.set(overlayId, record); this.#payloads.set(overlayId, payload); this.#emergencyHidden = false;
    if (input.target !== undefined) this.#targets.set(overlayId, { binding: input.target, ...(resolver === undefined ? {} : { resolver }) }); return { ok: true, overlay: record, errors: [] };
  }
  async updateWidget(input: OverlayWidget, reducedMotion = false): Promise<OverlayOperationResult> {
    const overlayId = input.widgetId;
    if (overlayId === undefined) return { ok: false, reason: "overlay_widget_id_required" };
    const current = this.#records.get(overlayId);
    if (current === undefined || current.ownerSessionId !== this.#owner.sessionId) return { ok: false, reason: "overlay_not_found" };
    const errors = validateOverlayWidget(input, reducedMotion);
    if (errors.length > 0) return { ok: false, reason: [...new Set(errors)].join(",") };
    const payload = safeWidget(input, current.target);
    const result = await this.#renderer.update({ overlayId, type: "widget", payload });
    if (!result.ok || result.acknowledged !== true) return { ok: false, reason: result.reason || "overlay_render_not_acknowledged" };
    if (result.rendererEpoch !== undefined) this.#rendererEpoch = Math.max(this.#rendererEpoch, result.rendererEpoch);
    const updatedAt = new Date().toISOString();
    const persistent = input.persistent ?? current.persistent === true;
    this.#records.set(overlayId, { ...current, sensitivity: sensitivity(input.sensitivity), interactive: input.interaction?.interactive === true, visible: true, updatedAt, expiresAt: overlayExpiry(input.ttlMs, current.target, persistent), ...(persistent ? { persistent: true } : {}) });
    this.#payloads.set(overlayId, payload);
    return { ok: true, reason: result.reason ?? "overlay_widget_updated", acknowledged: true, ...(result.rendererEpoch === undefined ? {} : { rendererEpoch: result.rendererEpoch }) };
  }
  async pollEvents(overlayId?: string): Promise<OverlayWidgetEvent[]> {
    this.#checkHideMarker();
    const renderer = this.#renderer as OverlayRenderer & { drainEvents?: () => Promise<OverlayWidgetEvent[]> | OverlayWidgetEvent[] };
    const events = await (renderer.drainEvents?.() ?? renderer.events());
    const local = this.#localEvents.splice(0, this.#localEvents.length);
    const fresh = [...local, ...events].filter((event) => event.ownerSessionId === this.#owner.sessionId);
    if (overlayId === undefined) {
      const all = [...this.#pendingEvents.splice(0, this.#pendingEvents.length), ...fresh];
      return all.slice(-200);
    }
    const selected: OverlayWidgetEvent[] = [];
    for (const event of [...this.#pendingEvents.splice(0, this.#pendingEvents.length), ...fresh]) {
      if (event.overlayId === overlayId) selected.push(event);
      else this.#pendingEvents.push(event);
    }
    if (this.#pendingEvents.length > 200) this.#pendingEvents.splice(0, this.#pendingEvents.length - 200);
    return selected;
  }
  async update(overlayId: string, patch: Record<string, unknown>): Promise<OverlayOperationResult> { const current = this.#records.get(overlayId); if (current === undefined || current.ownerSessionId !== this.#owner.sessionId) return { ok: false, reason: "overlay_not_found" }; if (Object.keys(patch).some((key) => !["label", "text", "style", "animation", "visible"].includes(key))) return { ok: false, reason: "overlay_update_field_blocked" }; if (typeof patch.label === "string" && redactOverlayText(patch.label, current.sensitivity).errors.length > 0) return { ok: false, reason: "overlay_unsafe_content_blocked" }; if (typeof patch.text === "string" && redactOverlayText(patch.text, current.sensitivity).errors.length > 0) return { ok: false, reason: "overlay_unsafe_content_blocked" }; if (patch.style !== undefined && validateOverlayStyleTokens(patch.style as never).length > 0) return { ok: false, reason: "overlay_style_token_blocked" }; if (patch.animation !== undefined && validateOverlayAnimation(patch.animation as never).length > 0) return { ok: false, reason: "overlay_animation_invalid" }; const next = { ...current, updatedAt: new Date().toISOString(), ...(typeof patch.visible === "boolean" ? { visible: patch.visible } : {}) }; const safePatch: Record<string, unknown> = {}; if (typeof patch.label === "string") safePatch.label = redactOverlayText(patch.label, current.sensitivity).redactedText ?? "[redacted]"; if (typeof patch.text === "string") safePatch.text = redactOverlayText(patch.text, current.sensitivity).redactedText ?? "[redacted]"; if (patch.style !== undefined) safePatch.style = patch.style; if (patch.animation !== undefined) safePatch.animation = patch.animation; if (typeof patch.visible === "boolean") safePatch.visible = patch.visible; const payload = { ...(this.#payloads.get(overlayId) as Record<string, unknown>), ...safePatch }; const result = await this.#renderer.update({ overlayId, type: next.type, payload }); if (!result.ok || result.acknowledged !== true) return { ...result, reason: result.reason || "overlay_render_not_acknowledged" }; if (result.rendererEpoch !== undefined) this.#rendererEpoch = result.rendererEpoch; this.#records.set(overlayId, next); this.#payloads.set(overlayId, payload); return result; }
  async dismiss(overlayId: string): Promise<OverlayOperationResult> { const current = this.#records.get(overlayId); if (current !== undefined && current.ownerSessionId !== this.#owner.sessionId) return { ok: false, reason: "overlay_owner_mismatch" }; this.#records.delete(overlayId); this.#payloads.delete(overlayId); this.#targets.delete(overlayId); return this.#renderer.dismiss(overlayId); }
  async clear(): Promise<OverlayOperationResult> { this.#records.clear(); this.#payloads.clear(); this.#targets.clear(); this.#rendererEpoch += 1; return this.#renderer.clear(); }
  async emergencyHide(): Promise<OverlayOperationResult> { this.#records.clear(); this.#payloads.clear(); this.#targets.clear(); this.#rendererEpoch += 1; this.#emergencyHidden = true; return this.#renderer.emergencyHide(); }
  async close(): Promise<void> { if (this.#sweeper !== undefined) clearInterval(this.#sweeper); this.#sweeper = undefined; this.#records.clear(); this.#payloads.clear(); this.#targets.clear(); this.#rendererEpoch += 1; await this.#renderer.close?.(); }
  async restartRenderer(): Promise<OverlayRendererRestartResult> { this.#records.clear(); this.#payloads.clear(); this.#targets.clear(); this.#rendererEpoch += 1; const result = await this.#renderer.restart?.(); if (result === undefined) return { ok: false, reason: "overlay_renderer_restart_unsupported" }; return result; }
  rendererEpoch(): number { return this.#rendererEpoch; }
  ownerId(): string { return this.#owner.sessionId; }
  suppressionSnapshot(): OverlaySuppressionRecord[] { return [...this.#payloads.entries()].map(([overlayId, payload]) => { const record = this.#records.get(overlayId); return { overlayId, type: record?.type ?? "widget", payload, ...(record === undefined ? {} : { record }) }; }); }
  async restoreSuppressionSnapshot(snapshot: OverlaySuppressionRecord[]): Promise<void> { for (const item of snapshot) { if (item.record !== undefined && (item.record.ownerSessionId !== this.#owner.sessionId || Date.parse(item.record.expiresAt) <= Date.now())) continue; const result = await this.#renderer.show(item); if (result.ok && result.acknowledged === true) { const current = this.#records.get(item.overlayId); if (current !== undefined) this.#records.set(item.overlayId, { ...current, visible: true, updatedAt: new Date().toISOString() }); else if (item.record !== undefined) this.#records.set(item.overlayId, { ...item.record, visible: true, updatedAt: new Date().toISOString() }); this.#payloads.set(item.overlayId, item.payload); } } }
  isOverlayLive(overlayId: string): boolean { const current = this.#records.get(overlayId); return current?.ownerSessionId === this.#owner.sessionId && current.visible === true && Date.parse(current.expiresAt) > Date.now(); }
  pushEvent(event: OverlayWidgetEvent): void { if (event.ownerSessionId !== this.#owner.sessionId) return; const renderer = this.#renderer as OverlayRenderer & { pushEvent?: (event: OverlayWidgetEvent) => void }; renderer.pushEvent?.(event); }
  #expire() { const now = Date.now(); for (const [id, record] of this.#records) if (record.persistent !== true && Date.parse(record.expiresAt) <= now) { this.#records.delete(id); this.#payloads.delete(id); this.#targets.delete(id); void this.#renderer.dismiss(id); } }
  #checkHideMarker(): void {
    if (this.#hideMarkerPath === null || !existsSync(this.#hideMarkerPath)) return;
    try { rmSync(this.#hideMarkerPath, { force: true }); } catch { return; }
    for (const overlayId of this.#records.keys()) this.#localEvents.push({ eventId: `event_local_${randomUUID()}`, overlayId, event: "hide", createdAt: new Date().toISOString(), ownerSessionId: this.#owner.sessionId });
    if (this.#localEvents.length > 100) this.#localEvents.splice(0, this.#localEvents.length - 100);
    void this.emergencyHide();
  }
  async #revalidateTargets(): Promise<void> { for (const [id, target] of this.#targets) { if (target.resolver === undefined) continue; const resolved = await target.resolver(target.binding, this.#owner.sessionId); if (!resolved.ok || resolved.summary === undefined) { this.#records.delete(id); this.#payloads.delete(id); this.#targets.delete(id); await this.#renderer.dismiss(id); continue; } const current = this.#records.get(id); if (current !== undefined) this.#records.set(id, { ...current, target: resolved.summary, updatedAt: new Date().toISOString(), expiresAt: new Date(Math.min(Date.parse(current.expiresAt), Date.parse(resolved.summary.expiresAt))).toISOString() }); } }
}
