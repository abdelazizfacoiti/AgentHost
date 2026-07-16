import { appendFile, chmod, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  canTransitionRuntimeActivity,
  runtimeActivityDedupKey,
  runtimeActivityPriority,
  safeRuntimeActivityRecord,
  validateRuntimeActivityTransition,
  type RuntimeActivityEvent,
  type RuntimeActivityLabelKey,
  type RuntimeActivityProgress,
  type RuntimeActivityRecord,
  type RuntimeActivityScreenshotSuppression,
  type RuntimeActivitySource,
  type RuntimeActivityState,
  type RuntimeActivityTerminalVerification,
  type RuntimeActivityControlKey
} from "@agenthost/core";

const MAX_RECORDS = 2_000;
const MAX_EVENTS = 10_000;
const now = () => new Date().toISOString();
const bounded = (value: string, max = 160) => value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
const activityId = () => `activity_${randomUUID()}`;

export interface RuntimeActivityStoreOptions { ownerSessionId: string; }
export interface RuntimeActivityBeginInput {
  taskId: string;
  parentActivityId?: string;
  source: RuntimeActivitySource;
  labelKey: RuntimeActivityLabelKey;
  actionKey?: RuntimeActivityLabelKey;
  state?: RuntimeActivityState;
  operation?: string;
  progress?: RuntimeActivityProgress;
  controlCapabilities?: RuntimeActivityControlKey[];
}
export interface RuntimeActivityPatch {
  labelKey?: RuntimeActivityLabelKey;
  actionKey?: RuntimeActivityLabelKey;
  state?: RuntimeActivityState;
  progress?: RuntimeActivityProgress;
  blockerCode?: string;
  warningCode?: string;
  terminalVerification?: RuntimeActivityTerminalVerification;
  screenshotSuppression?: RuntimeActivityScreenshotSuppression;
  rendererBinding?: RuntimeActivityRecord["rendererBinding"];
  controlCapabilities?: RuntimeActivityControlKey[];
  clearWarning?: boolean;
  clearBlocker?: boolean;
}

export class RuntimeActivityStore {
  readonly #dir: string;
  readonly #recordsFile: string;
  readonly #eventsFile: string;
  readonly #ownerSessionId: string;
  readonly #records = new Map<string, RuntimeActivityRecord>();
  readonly #byDedup = new Map<string, string>();
  readonly #events: RuntimeActivityEvent[] = [];
  #write: Promise<void> = Promise.resolve();

  constructor(agentHostDir: string, options: RuntimeActivityStoreOptions) {
    this.#dir = path.join(agentHostDir, "runtime-activity");
    this.#recordsFile = path.join(this.#dir, "records.jsonl");
    this.#eventsFile = path.join(this.#dir, "events.jsonl");
    this.#ownerSessionId = bounded(options.ownerSessionId, 200);
  }

  async ensureStructure(): Promise<void> {
    await mkdir(this.#dir, { recursive: true, mode: 0o700 });
    await this.#loadRecords();
    await this.#loadEvents();
    for (const record of this.#records.values()) {
      const hadBinding = record.rendererBinding !== undefined;
      // Renderer-bound IDs are process/epoch scoped and never survive restart.
      delete record.rendererBinding;
      if (!this.#isTerminal(record.state)) {
        record.state = "failed";
        record.warningCode = "runtime_activity_process_restarted";
        record.updatedAt = now();
        record.elapsedMs = Math.max(0, Date.parse(record.updatedAt) - Date.parse(record.startedAt));
        record.terminalVerification = { verified: false, source: "manual" };
      }
      if (hadBinding || record.state === "failed" && record.warningCode === "runtime_activity_process_restarted") this.#append(record, record.state === "failed" ? "failed" : "renderer");
    }
  }

  ownerSessionId(): string { return this.#ownerSessionId; }

  begin(input: RuntimeActivityBeginInput): RuntimeActivityRecord {
    const operation = bounded(input.operation ?? `${input.source}:${input.labelKey}`, 200);
    const dedupKey = runtimeActivityDedupKey({ ownerSessionId: this.#ownerSessionId, taskId: bounded(input.taskId, 200), source: input.source, operation });
    const existingId = this.#byDedup.get(dedupKey);
    const existing = existingId === undefined ? undefined : this.#records.get(existingId);
    if (existing !== undefined && !this.#isTerminal(existing.state)) return existing;
    const timestamp = now();
    const record: RuntimeActivityRecord = {
      schemaVersion: 1,
      activityId: activityId(),
      ownerSessionId: this.#ownerSessionId,
      taskId: bounded(input.taskId, 200),
      ...(input.parentActivityId === undefined ? {} : { parentActivityId: bounded(input.parentActivityId, 200) }),
      source: input.source,
      labelKey: input.labelKey,
      actionKey: input.actionKey ?? input.labelKey,
      state: input.state ?? "preparing",
      startedAt: timestamp,
      updatedAt: timestamp,
      elapsedMs: 0,
      ...(input.progress === undefined ? {} : { progress: input.progress }),
      screenshotSuppression: "none",
      concurrencyPriority: runtimeActivityPriority(input.state ?? "preparing"),
      dedupKey,
      controlCapabilities: [...new Set(input.controlCapabilities ?? [])].slice(0, 5),
      redacted: true
    };
    this.#records.set(record.activityId, record);
    this.#byDedup.set(dedupKey, record.activityId);
    this.#append(record, "started");
    return record;
  }

  get(id: string): RuntimeActivityRecord | undefined {
    const value = this.#records.get(id);
    return value === undefined || value.ownerSessionId !== this.#ownerSessionId ? undefined : this.#clone(value);
  }

  update(id: string, patch: RuntimeActivityPatch): RuntimeActivityRecord {
    const record = this.#require(id);
    if (patch.state !== undefined && patch.state !== record.state) {
      const errors = validateRuntimeActivityTransition(record.state, patch.state, patch.terminalVerification);
      if (errors.length > 0) throw new Error(errors[0]);
      record.state = patch.state;
    }
    if (patch.labelKey !== undefined) record.labelKey = patch.labelKey;
    if (patch.actionKey !== undefined) record.actionKey = patch.actionKey;
    if (patch.progress !== undefined) record.progress = patch.progress;
    if (patch.blockerCode !== undefined) record.blockerCode = bounded(patch.blockerCode, 120);
    if (patch.warningCode !== undefined) record.warningCode = bounded(patch.warningCode, 120);
    if (patch.clearWarning === true) delete record.warningCode;
    if (patch.clearBlocker === true) delete record.blockerCode;
    if (patch.terminalVerification !== undefined) record.terminalVerification = { verified: patch.terminalVerification.verified, source: patch.terminalVerification.source, ...(patch.terminalVerification.verifiedAt === undefined ? {} : { verifiedAt: patch.terminalVerification.verifiedAt }) };
    if (patch.screenshotSuppression !== undefined) record.screenshotSuppression = patch.screenshotSuppression;
    if (patch.rendererBinding !== undefined) record.rendererBinding = patch.rendererBinding;
    if (patch.controlCapabilities !== undefined) record.controlCapabilities = [...new Set(patch.controlCapabilities)].slice(0, 5);
    record.updatedAt = now();
    record.elapsedMs = Math.max(0, Date.parse(record.updatedAt) - Date.parse(record.startedAt));
    record.concurrencyPriority = runtimeActivityPriority(record.state);
    this.#append(record, patch.state === undefined ? "updated" : "transitioned");
    return this.#clone(record);
  }

  finish(id: string, state: "completed" | "failed" | "blocked" | "cancelled", verification?: RuntimeActivityTerminalVerification): RuntimeActivityRecord {
    const record = this.#require(id);
    const terminal = verification ?? { verified: false, source: "manual" as const };
    if (state === "completed" && terminal.verified !== true) throw new Error("runtime_activity_terminal_verification_required");
    return this.update(id, { state, terminalVerification: terminal });
  }

  list(options: { includeTerminal?: boolean; limit?: number } = {}): RuntimeActivityRecord[] {
    const limit = Math.min(200, Math.max(1, Math.floor(options.limit ?? 50)));
    return [...this.#records.values()]
      .filter((record) => record.ownerSessionId === this.#ownerSessionId && (options.includeTerminal === true || !this.#isTerminal(record.state)))
      .sort((a, b) => b.concurrencyPriority - a.concurrencyPriority || b.updatedAt.localeCompare(a.updatedAt) || a.activityId.localeCompare(b.activityId))
      .slice(0, limit)
      .map((record) => this.#clone(record));
  }

  events(limit = 100): RuntimeActivityEvent[] { return this.#events.slice(-Math.min(200, Math.max(1, limit))).map((event) => ({ ...event })); }

  recentTerminal(limit = 50): RuntimeActivityRecord[] { return this.list({ includeTerminal: true, limit: Math.min(200, limit) }).filter((record) => this.#isTerminal(record.state)); }

  clearRendererBindings(): void { for (const record of this.#records.values()) delete record.rendererBinding; }

  #require(id: string): RuntimeActivityRecord { const record = this.#records.get(id); if (record === undefined || record.ownerSessionId !== this.#ownerSessionId) throw new Error("runtime_activity_not_found"); return record; }
  #isTerminal(state: RuntimeActivityState): boolean { return state === "completed" || state === "failed" || state === "cancelled"; }
  #clone(value: RuntimeActivityRecord): RuntimeActivityRecord { return JSON.parse(JSON.stringify(value)) as RuntimeActivityRecord; }
  #append(record: RuntimeActivityRecord, kind: RuntimeActivityEvent["kind"]): void {
    const event: RuntimeActivityEvent = { eventId: `activity_event_${randomUUID()}`, activityId: record.activityId, ownerSessionId: this.#ownerSessionId, createdAt: record.updatedAt, kind, state: record.state, labelKey: record.labelKey, actionKey: record.actionKey, ...(record.blockerCode === undefined ? {} : { blockerCode: record.blockerCode }), ...(record.warningCode === undefined ? {} : { warningCode: record.warningCode }), redacted: true };
    this.#events.push(event);
    while (this.#events.length > MAX_EVENTS) this.#events.shift();
    while (this.#records.size > MAX_RECORDS) { const oldest = [...this.#records.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0]; if (oldest === undefined) break; this.#records.delete(oldest.activityId); this.#byDedup.delete(oldest.dedupKey); }
    this.#write = this.#write.then(async () => { await appendFile(this.#recordsFile, JSON.stringify(safeRuntimeActivityRecord(record)) + "\n", "utf8"); await appendFile(this.#eventsFile, JSON.stringify(event) + "\n", "utf8"); await chmod(this.#recordsFile, 0o600); await chmod(this.#eventsFile, 0o600); }).catch(() => undefined);
  }
  async #loadRecords(): Promise<void> { try { const lines = (await readFile(this.#recordsFile, "utf8")).split("\n").slice(-MAX_RECORDS); for (const line of lines) { try { const value = JSON.parse(line) as RuntimeActivityRecord; if (value.schemaVersion === 1 && value.ownerSessionId === this.#ownerSessionId && typeof value.activityId === "string" && typeof value.taskId === "string" && typeof value.source === "string" && typeof value.state === "string") { const dedup = typeof value.dedupKey === "string" ? value.dedupKey : `legacy:${value.activityId}`; const normalized = { ...value, dedupKey: dedup, screenshotSuppression: value.screenshotSuppression ?? "none", concurrencyPriority: Number.isFinite(value.concurrencyPriority) ? value.concurrencyPriority : runtimeActivityPriority(value.state), controlCapabilities: Array.isArray(value.controlCapabilities) ? value.controlCapabilities : [], redacted: true as const }; this.#records.set(value.activityId, normalized); this.#byDedup.set(dedup, value.activityId); } } catch { /* skip malformed activity snapshot */ } } } catch { /* first run */ } }
  async #loadEvents(): Promise<void> { try { const lines = (await readFile(this.#eventsFile, "utf8")).split("\n").slice(-MAX_EVENTS); for (const line of lines) { try { const value = JSON.parse(line) as RuntimeActivityEvent; if (value.ownerSessionId === this.#ownerSessionId) this.#events.push(value); } catch { /* skip malformed activity event */ } } } catch { /* first run */ } }
}
