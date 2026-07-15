import { chmod, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  OVERLAY_ASSISTANCE_EVENT_TTL_MS,
  isOverlayControlSurfaceAction,
  validateOverlayControlSurfaceEvent,
  type OverlayAssistanceSessionStatus,
  type OverlayControlSurface,
  type OverlayControlSurfaceAction,
  type OverlayControlSurfaceEvent,
  type OverlayControlSurfaceEventSummary,
  type OverlayControlSurfaceRendererHealth
} from "@agenthost/core";
import type { OverlayManager } from "@agenthost/app-overlay";
import type { OverlayAssistanceStore } from "./overlay-assistance-store.js";

const MAX_EVENTS = 20;
const MAX_LEDGER_ENTRIES = 200;
const MAX_SURFACE_TTL_MS = 300_000;
const now = () => new Date().toISOString();
const safeId = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 200);

interface SurfaceRecord extends OverlayControlSurface {
  ownerSessionId: string;
  overlayId?: string;
  rendererEpoch?: number;
}

interface LedgerEntry {
  eventId: string;
  ownerSessionId: string;
  controlSurfaceId: string;
  assistanceSessionId: string;
  overlayId: string;
  action: OverlayControlSurfaceAction;
  createdAt: string;
  expiresAt: string;
  outcome: "accepted" | "rejected";
  reason?: string;
}

function validSessionStatus(status: OverlayAssistanceSessionStatus): boolean {
  return ["ready", "active", "waiting_for_operator", "paused"].includes(status);
}

function healthSummary(value: Awaited<ReturnType<OverlayManager["diagnostics"]>>): OverlayControlSurfaceRendererHealth {
  return {
    rendererStatus: value.rendererStatus,
    effectiveBackend: value.effectiveBackend,
    sessionType: value.sessionType,
    childState: value.childState,
    handshake: value.handshake,
    activeOverlayCount: value.activeOverlayCount,
    ...(value.fallbackReason === undefined ? {} : { fallbackReason: value.fallbackReason })
  };
}

export class OverlayControlSurfaceStore {
  readonly #dir: string;
  readonly #ledgerDir: string;
  readonly #manager: OverlayManager;
  readonly #assistance: OverlayAssistanceStore;
  readonly #ownerSessionId: string;
  readonly #surfaces = new Map<string, SurfaceRecord>();
  readonly #ledger = new Map<string, LedgerEntry>();

  constructor(agentHostDir: string, manager: OverlayManager, assistance: OverlayAssistanceStore, ownerSessionId: string) {
    this.#dir = path.join(agentHostDir, "overlays", "control-surfaces");
    this.#ledgerDir = path.join(agentHostDir, "overlays", "control-surface-event-ledger");
    this.#manager = manager;
    this.#assistance = assistance;
    this.#ownerSessionId = ownerSessionId;
  }

  async ensureStructure(): Promise<void> {
    await mkdir(this.#dir, { recursive: true, mode: 0o700 });
    await mkdir(this.#ledgerDir, { recursive: true, mode: 0o700 });
  }

  async show(assistanceSessionId: string): Promise<Record<string, unknown>> {
    const assistance = await this.#assistance.get(assistanceSessionId);
    this.#assertValidAssistance(assistance);
    let surface = await this.#getOrLoad(assistanceSessionId);
    if (surface !== undefined && surface.status !== "closed" && surface.overlayId !== undefined && this.#manager.isOverlayLive(surface.overlayId)) {
      await this.#refresh(surface, assistance);
      return this.#safeSummary(surface);
    }
    if (surface === undefined || surface.status === "closed") {
      const timestamp = now();
      surface = {
        controlSurfaceId: `surface_${randomUUID()}`,
        assistanceSessionId,
        ownerSessionId: this.#ownerSessionId,
        status: "hidden",
        createdAt: timestamp,
        updatedAt: timestamp,
        expiresAt: String(assistance.expiresAt),
        assistanceStatus: assistance.status as OverlayAssistanceSessionStatus,
        currentStepIndex: Number(assistance.currentStepIndex ?? 0),
        progress: this.#progress(assistance),
        rendererHealth: await this.#health(),
        blockers: this.#codes(assistance.blockers),
        warnings: this.#codes(assistance.warnings),
        recommendedActions: this.#recommended(assistance.status as OverlayAssistanceSessionStatus),
        recentEvents: [],
        bindingState: "unbound"
      };
      this.#surfaces.set(assistanceSessionId, surface);
    } else {
      surface.status = "stale";
      surface.bindingState = "stale";
      delete surface.overlayId;
      delete surface.rendererEpoch;
    }
    const activeSurface = surface;
    await this.#render(activeSurface, assistance);
    return this.#safeSummary(activeSurface);
  }

  async get(assistanceSessionId: string): Promise<Record<string, unknown>> {
    const surface = await this.#getOrLoad(assistanceSessionId);
    if (surface === undefined || surface.ownerSessionId !== this.#ownerSessionId) throw new Error("control_surface_not_found");
    const assistance = await this.#assistance.get(assistanceSessionId);
    this.#assertValidAssistance(assistance, true);
    await this.#refresh(surface, assistance);
    return this.#safeSummary(surface);
  }

  async update(assistanceSessionId: string, controlSurfaceId: string): Promise<Record<string, unknown>> {
    const surface = await this.#require(assistanceSessionId, controlSurfaceId);
    const assistance = await this.#assistance.get(assistanceSessionId);
    this.#assertValidAssistance(assistance, true);
    if (surface.status !== "visible" || surface.overlayId === undefined || !this.#manager.isOverlayLive(surface.overlayId)) {
      surface.status = "stale";
      surface.bindingState = "stale";
      delete surface.overlayId;
      delete surface.rendererEpoch;
      await this.#persist(surface);
      throw new Error("control_surface_binding_stale");
    }
    await this.#render(surface, assistance, surface.overlayId);
    return this.#safeSummary(surface);
  }

  async hide(assistanceSessionId: string, controlSurfaceId: string): Promise<Record<string, unknown>> {
    const surface = await this.#require(assistanceSessionId, controlSurfaceId);
    if (surface.overlayId !== undefined) await this.#manager.dismiss(surface.overlayId);
    delete surface.overlayId;
    delete surface.rendererEpoch;
    surface.status = "hidden";
    surface.bindingState = "unbound";
    surface.updatedAt = now();
    await this.#persist(surface);
    return this.#safeSummary(surface);
  }

  async applyEvent(input: { assistanceSessionId: string; controlSurfaceId: string; overlayId: string; eventId: string; action: OverlayControlSurfaceAction; createdAt: string }): Promise<Record<string, unknown>> {
    const surface = await this.#require(input.assistanceSessionId, input.controlSurfaceId);
    if (surface.status !== "visible" || surface.overlayId !== input.overlayId || !this.#manager.isOverlayLive(input.overlayId) || surface.rendererEpoch !== this.#manager.rendererEpoch()) throw new Error("control_surface_binding_stale");
    if (!isOverlayControlSurfaceAction(input.action)) throw new Error("control_surface_action_not_allowed");
    const event: OverlayControlSurfaceEvent = { ...input, ownerSessionId: this.#ownerSessionId };
    const errors = validateOverlayControlSurfaceEvent(event);
    if (errors.length > 0) throw new Error(errors[0]);
    await this.#loadLedger();
    this.#cleanupLedger();
    const existing = this.#ledger.get(input.eventId);
    if (existing !== undefined) throw new Error(existing.outcome === "accepted" ? "control_surface_event_reused" : existing.reason ?? "control_surface_event_rejected");
    const ledger: LedgerEntry = { ...event, expiresAt: new Date(Date.now() + OVERLAY_ASSISTANCE_EVENT_TTL_MS).toISOString(), outcome: "rejected" };
    this.#ledger.set(input.eventId, ledger);
    let reason: string | undefined;
    try {
      if (input.action === "continue") await this.#assistance.advance(input.assistanceSessionId);
      else if (input.action === "pause") await this.#assistance.pause(input.assistanceSessionId);
      else if (input.action === "resume") await this.#assistance.start(input.assistanceSessionId);
      else if (input.action === "cancel") await this.#assistance.cancel(input.assistanceSessionId);
      else if (input.action === "retry_visual_render") { const assistance = await this.#assistance.get(input.assistanceSessionId); await this.#render(surface, assistance, input.overlayId); }
      else if (input.action === "inspect_diagnostics") await this.#manager.diagnostics();
      else if (input.action === "emergency_hide") { await this.#manager.emergencyHide(); surface.status = "stale"; surface.bindingState = "stale"; delete surface.overlayId; delete surface.rendererEpoch; }
      else if (input.action === "close_control_surface") { await this.#manager.dismiss(input.overlayId); surface.status = "closed"; surface.bindingState = "unbound"; delete surface.overlayId; delete surface.rendererEpoch; }
      ledger.outcome = "accepted";
    } catch (error) {
      reason = error instanceof Error ? error.message : "control_surface_event_failed";
      ledger.reason = reason;
      throw error;
    } finally {
      const summary: OverlayControlSurfaceEventSummary = { eventId: input.eventId, action: input.action, createdAt: input.createdAt, outcome: ledger.outcome === "accepted" ? "accepted" : "rejected", ...(reason === undefined ? {} : { reason }) };
      surface.recentEvents = [...surface.recentEvents, summary].slice(-MAX_EVENTS);
      surface.updatedAt = now();
      if (ledger.outcome === "accepted" && surface.status !== "stale" && surface.status !== "closed") {
        const assistance = await this.#assistance.get(input.assistanceSessionId).catch(() => undefined);
        if (assistance !== undefined) await this.#refresh(surface, assistance);
      }
      await this.#persistLedger(ledger);
      await this.#persist(surface);
    }
    return { ...this.#safeSummary(surface), event: { eventId: input.eventId, action: input.action, outcome: "accepted" } };
  }

  async close(): Promise<void> {
    for (const surface of this.#surfaces.values()) {
      if (surface.overlayId !== undefined) await this.#manager.dismiss(surface.overlayId).catch(() => undefined);
      delete surface.overlayId;
      delete surface.rendererEpoch;
      if (surface.status === "visible") surface.status = "stale";
      surface.bindingState = "stale";
      await this.#persist(surface);
    }
  }

  async #render(surface: SurfaceRecord, assistance: Record<string, unknown>, overlayId?: string): Promise<void> {
    const result = await this.#manager.showWidget(this.#widget(surface, assistance, overlayId));
    if (!result.ok || result.overlay === undefined) {
      surface.status = "stale";
      surface.bindingState = "stale";
      surface.blockers = [...new Set([...surface.blockers, result.errors[0] ?? "control_surface_render_failed"])];
      await this.#persist(surface);
      throw new Error(surface.blockers.at(-1));
    }
    surface.overlayId = result.overlay.overlayId;
    surface.rendererEpoch = this.#manager.rendererEpoch();
    surface.status = "visible";
    surface.bindingState = "bound";
    surface.rendererHealth = await this.#health();
    surface.updatedAt = now();
    await this.#persist(surface);
  }

  #widget(surface: SurfaceRecord, assistance: Record<string, unknown>, overlayId?: string) {
    const status = String(assistance.status ?? surface.assistanceStatus);
    const progress = this.#progress(assistance);
    const actions = this.#recommended(status as OverlayAssistanceSessionStatus);
    return {
      ...(overlayId === undefined ? {} : { widgetId: overlayId }),
      title: "AgentHost visual assistance",
      sensitivity: "public" as const,
      ttlMs: Math.min(MAX_SURFACE_TTL_MS, Math.max(1_000, Date.parse(String(assistance.expiresAt)) - Date.now())),
      interaction: { interactive: true, focus: "never" as const, dismissible: true, allowedEvents: actions },
      components: [
        { type: "heading" as const, text: "Visual assistance control" },
        { type: "status_badge" as const, status: status === "blocked" ? "danger" as const : status === "paused" ? "warning" as const : "info" as const, text: status },
        { type: "progress" as const, value: progress.percent / 100, label: `${progress.completed}/${progress.total}` },
        { type: "key_value" as const, key: "Current step", value: String(assistance.currentStepIndex ?? 0) },
        ...actions.map((action) => ({ type: "button" as const, label: action.replaceAll("_", " "), event: action }))
      ]
    };
  }

  async #refresh(surface: SurfaceRecord, assistance: Record<string, unknown>): Promise<void> {
    surface.assistanceStatus = assistance.status as OverlayAssistanceSessionStatus;
    surface.currentStepIndex = Number(assistance.currentStepIndex ?? 0);
    surface.progress = this.#progress(assistance);
    surface.expiresAt = String(assistance.expiresAt ?? surface.expiresAt);
    surface.blockers = this.#codes(assistance.blockers);
    surface.warnings = this.#codes(assistance.warnings);
    surface.recommendedActions = this.#recommended(surface.assistanceStatus);
    surface.rendererHealth = await this.#health();
    if (surface.overlayId !== undefined && (!this.#manager.isOverlayLive(surface.overlayId) || surface.rendererEpoch !== this.#manager.rendererEpoch())) {
      delete surface.overlayId;
      delete surface.rendererEpoch;
      surface.bindingState = "stale";
      surface.status = "stale";
    }
    surface.updatedAt = now();
    await this.#persist(surface);
  }

  async #require(assistanceSessionId: string, controlSurfaceId: string): Promise<SurfaceRecord> {
    const surface = await this.#getOrLoad(assistanceSessionId);
    if (surface === undefined || surface.ownerSessionId !== this.#ownerSessionId || surface.controlSurfaceId !== controlSurfaceId) throw new Error("control_surface_not_found");
    return surface;
  }

  async #getOrLoad(assistanceSessionId: string): Promise<SurfaceRecord | undefined> {
    const current = this.#surfaces.get(assistanceSessionId);
    if (current !== undefined) return current;
    const file = this.#file(assistanceSessionId);
    try {
      const stored = JSON.parse(await readFile(file, "utf8")) as SurfaceRecord;
      if (stored.ownerSessionId !== this.#ownerSessionId) return undefined;
      stored.bindingState = "stale";
      delete stored.overlayId;
      delete stored.rendererEpoch;
      this.#surfaces.set(assistanceSessionId, stored);
      return stored;
    } catch { return undefined; }
  }

  #assertValidAssistance(value: Record<string, unknown>, allowTerminal = false): void {
    const status = value.status as OverlayAssistanceSessionStatus;
    if (!allowTerminal && (!validSessionStatus(status) || value.ephemeralMaterialAvailable === false)) throw new Error(`assistance_session_${status ?? "invalid"}`);
    if (allowTerminal && value.ephemeralMaterialAvailable === false) throw new Error("assistance_session_ephemeral_input_unavailable");
  }

  async #health(): Promise<OverlayControlSurfaceRendererHealth> { return healthSummary(await this.#manager.diagnostics()); }
  #progress(value: Record<string, unknown>): { completed: number; total: number; percent: number } { const progress = value.progress; if (progress !== null && typeof progress === "object") { const p = progress as Record<string, unknown>; return { completed: Number(p.completed ?? 0), total: Number(p.total ?? 0), percent: Number(p.percent ?? 0) }; } return { completed: 0, total: 0, percent: 0 }; }
  #codes(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 20) : []; }
  #recommended(status: OverlayAssistanceSessionStatus): OverlayControlSurfaceAction[] { if (status === "paused") return ["resume", "cancel", "inspect_diagnostics", "emergency_hide", "close_control_surface"]; if (status === "active" || status === "waiting_for_operator") return ["continue", "pause", "cancel", "retry_visual_render", "inspect_diagnostics", "emergency_hide", "close_control_surface"]; return ["resume", "inspect_diagnostics", "emergency_hide", "close_control_surface"]; }
  #safeSummary(surface: SurfaceRecord): Record<string, unknown> { return { controlSurfaceId: surface.controlSurfaceId, assistanceSessionId: surface.assistanceSessionId, status: surface.status, createdAt: surface.createdAt, updatedAt: surface.updatedAt, expiresAt: surface.expiresAt, assistanceStatus: surface.assistanceStatus, currentStepIndex: surface.currentStepIndex, progress: surface.progress, rendererHealth: surface.rendererHealth, blockers: surface.blockers, warnings: surface.warnings, recommendedActions: surface.recommendedActions, recentEvents: surface.recentEvents.slice(-MAX_EVENTS), bindingState: surface.bindingState, ...(surface.overlayId !== undefined && surface.bindingState === "bound" ? { overlayId: surface.overlayId } : {}) }; }
  #cleanupLedger(): void { const nowMs = Date.now(); for (const [eventId, entry] of this.#ledger) if (Date.parse(entry.expiresAt) <= nowMs) this.#ledger.delete(eventId); while (this.#ledger.size > MAX_LEDGER_ENTRIES) this.#ledger.delete(this.#ledger.keys().next().value as string); }
  async #loadLedger(): Promise<void> { if (this.#ledger.size > 0) return; const entries = await readdir(this.#ledgerDir, { withFileTypes: true }).catch(() => []); for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json"))) { try { const value = JSON.parse(await readFile(path.join(this.#ledgerDir, entry.name), "utf8")) as LedgerEntry; if (value.ownerSessionId === this.#ownerSessionId) this.#ledger.set(value.eventId, value); } catch { /* ignore malformed replay records */ } } this.#cleanupLedger(); }
  async #persistLedger(value: LedgerEntry): Promise<void> { await mkdir(this.#ledgerDir, { recursive: true, mode: 0o700 }); const file = path.join(this.#ledgerDir, `${safeId(value.eventId)}.json`); const temp = `${file}.${randomUUID()}.tmp`; await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); await chmod(temp, 0o600); await rename(temp, file); }
  async #persist(surface: SurfaceRecord): Promise<void> { await mkdir(this.#dir, { recursive: true, mode: 0o700 }); const persisted = { ...surface }; delete persisted.overlayId; delete persisted.rendererEpoch; const file = this.#file(surface.assistanceSessionId); const temp = `${file}.${randomUUID()}.tmp`; await writeFile(temp, `${JSON.stringify(persisted, null, 2)}\n`, { mode: 0o600 }); await chmod(temp, 0o600); await rename(temp, file); }
  #file(assistanceSessionId: string): string { return path.join(this.#dir, `${safeId(assistanceSessionId)}.json`); }
}
