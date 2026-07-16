import { appendFile, chmod, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ControlRoomDashboardProjection, ControlRoomHealthProjection, ControlRoomScreenshotProjection, ControlRoomTaskProjection, ControlRoomTimelineEvent, RiskLevel } from "@agenthost/core";
import type { ControlRoomReportProvider, ControlRoomScreenshotQuery, ControlRoomTaskQuery } from "@agenthost/app-control-room";

interface ActivityRecord {
  eventId: string;
  sessionId: string;
  timestamp: string;
  tool: string;
  strategy?: string;
  riskLevel: RiskLevel;
  preview: boolean;
  ok: boolean;
  errorCode?: string;
  durationMs: number;
  confirmation: boolean;
  receiptId?: string;
}
interface ScreenshotRecord extends ControlRoomScreenshotProjection {}

export interface ControlRoomStoreOptions {
  /** Trusted MCP session owner; never accepted from Control Room input. */
  ownerSessionId?: string;
}

function now(): string { return new Date().toISOString(); }
function bounded(value: string, max = 240): string { return value.replace(/[\u0000-\u001f]/g, " ").slice(0, max); }
function opaque(value: unknown, max = 200): string | undefined { return typeof value === "string" && value.length > 0 ? bounded(value, max) : undefined; }
function limit(value: number): number { return Number.isFinite(value) ? Math.min(100, Math.max(1, Math.floor(value))) : 50; }
function mapStatus(value: string): ControlRoomTaskProjection["status"] {
  if (value === "active" || value === "ready" || value === "paused" || value === "waiting_for_operator") return "active";
  if (value === "failed" || value === "timeout") return "failed";
  if (value === "cancelled" || value === "canceled") return "cancelled";
  if (value === "blocked" || value === "rejected") return "blocked";
  if (value === "completed" || value === "stopped" || value === "passed" || value === "archived") return "completed";
  if (value === "recent") return "recent";
  if (value === "draft" || value === "review_required" || value.startsWith("approval_")) return "active";
  return "blocked";
}
function sourceId(source: string, id: string): string { return source + ":" + id; }
function eventId(source: string, id: string, index: number): string { return source + ":" + id + ":" + index; }
function sanitizeScreenshot(input: ScreenshotRecord): ScreenshotRecord | undefined {
  const screenshotId = opaque(input.screenshotId);
  const capturedAtValue = typeof input.capturedAt === "string" ? Date.parse(input.capturedAt) : NaN;
  if (screenshotId === undefined || !Number.isFinite(capturedAtValue)) return undefined;
  const capturedAt = new Date(capturedAtValue).toISOString();
  const taskId = opaque(input.taskId);
  const sessionId = opaque(input.sessionId);
  const sensitivity = input.sensitivity === "secret" || input.sensitivity === "private" ? input.sensitivity : "public";
  const width = Number.isFinite(input.imageWidth) ? Math.max(0, Math.min(100_000, Math.floor(input.imageWidth))) : 0;
  const height = Number.isFinite(input.imageHeight) ? Math.max(0, Math.min(100_000, Math.floor(input.imageHeight))) : 0;
  return { screenshotId, ...(taskId === undefined ? {} : { taskId }), ...(sessionId === undefined ? {} : { sessionId }), capturedAt, captureKind: input.captureKind === "active_window" ? "active_window" : "full_screen", imageWidth: width, imageHeight: height, sensitivity, thumbnailAvailable: false, retention: input.retention === "expired" ? "expired" : "available", redacted: true };
}

export interface ControlRoomSources {
  workflowTrace?: { listTraces(status?: string): Promise<any[]> };
  assistance?: { list(): Promise<Record<string, unknown>[]> };
  forge?: { listRuntimeRuns(): Promise<any[]> };
  scheduler?: { listJobs(): Promise<any[]> };
  overlay?: { diagnostics(): Promise<any> };
  browserBridge?: { status(): Record<string, unknown> };
  strategies?: { summary(): Promise<Record<string, unknown>> };
}

export class ControlRoomStore {
  readonly #root: string;
  readonly #activityFile: string;
  readonly #screenshotFile: string;
  readonly #activity: ActivityRecord[] = [];
  readonly #screenshots = new Map<string, ScreenshotRecord>();
  readonly #eventIndex = new Map<string, ControlRoomTimelineEvent[]>();
  readonly #sources: ControlRoomSources;
  readonly #ownerSessionId: string | undefined;
  #screenshotWrite: Promise<void> = Promise.resolve();
  constructor(agentHostDir: string, sources: ControlRoomSources = {}, options: ControlRoomStoreOptions = {}) {
    this.#root = path.join(agentHostDir, "control-room");
    this.#activityFile = path.join(this.#root, "activity.jsonl");
    this.#screenshotFile = path.join(this.#root, "screenshots.jsonl");
    this.#sources = sources;
    this.#ownerSessionId = options.ownerSessionId;
  }
  async ensureStructure(): Promise<void> {
    await mkdir(this.#root, { recursive: true, mode: 0o700 });
    try {
      const raw = await readFile(this.#activityFile, "utf8");
      for (const line of raw.split("\n").slice(-10_000)) {
        try { const value = JSON.parse(line) as ActivityRecord; if (typeof value.eventId === "string" && typeof value.sessionId === "string") this.#activity.push(value); } catch { /* skip corrupt line */ }
      }
    } catch { /* first run */ }
    try {
      const raw = await readFile(this.#screenshotFile, "utf8");
      for (const line of raw.split("\n").slice(-5_000)) {
        try { const value = sanitizeScreenshot(JSON.parse(line) as ScreenshotRecord); if (value !== undefined) this.#screenshots.set(value.screenshotId, value); } catch { /* skip corrupt line */ }
      }
    } catch { /* first run */ }
  }
  async recordToolActivity(input: Omit<ActivityRecord, "eventId">): Promise<void> {
    const safeReceiptId = input.receiptId === undefined ? undefined : opaque(input.receiptId);
    const record: ActivityRecord = { eventId: "activity_" + randomUUID(), sessionId: bounded(input.sessionId), timestamp: bounded(input.timestamp, 40), tool: bounded(input.tool), ...(input.strategy === undefined ? {} : { strategy: bounded(input.strategy) }), riskLevel: input.riskLevel, preview: input.preview === true, ok: input.ok === true, ...(input.errorCode === undefined ? {} : { errorCode: bounded(input.errorCode) }), durationMs: Number.isFinite(input.durationMs) ? Math.max(0, Math.min(86_400_000, Math.floor(input.durationMs))) : 0, confirmation: input.confirmation === true, ...(safeReceiptId === undefined ? {} : { receiptId: safeReceiptId }) };
    this.#activity.push(record);
    while (this.#activity.length > 10_000) this.#activity.shift();
    await appendFile(this.#activityFile, JSON.stringify(record) + "\n", "utf8");
    await chmod(this.#activityFile, 0o600);
  }
  async recordScreenshot(input: ScreenshotRecord): Promise<void> {
    const safe = sanitizeScreenshot(input);
    if (safe === undefined || !this.#owns(safe.sessionId)) return;
    this.#screenshots.set(safe.screenshotId, safe);
    this.#screenshotWrite = this.#screenshotWrite.then(async () => { await appendFile(this.#screenshotFile, JSON.stringify(safe) + "\n", "utf8"); await chmod(this.#screenshotFile, 0o600); }).catch(() => undefined);
    await this.#screenshotWrite;
  }

  provider(): ControlRoomReportProvider {
    return {
      dashboard: (input) => this.dashboard(input),
      tasks: (input) => this.tasks(input),
      task: (id) => this.task(id),
      timeline: (id, input) => this.timeline(id, input),
      screenshots: (input) => this.screenshots(input),
      screenshot: (id) => this.screenshot(id),
      health: () => this.health()
    };
  }

  async dashboard(input: { from?: string; to?: string }): Promise<ControlRoomDashboardProjection> {
    const to = input.to ?? now();
    const from = input.from ?? new Date(Date.now() - 86_400_000).toISOString();
    const tasks = await this.#buildTasks(from, to);
    const events = tasks.flatMap((task) => this.#eventsForTask(task.taskId)).filter((event) => event.timestamp >= from && event.timestamp <= to).sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.eventId.localeCompare(a.eventId));
    const counts = { active: 0, recent: 0, completed: 0, failed: 0, cancelled: 0, blocked: 0, toolExecutions: 0, screenshotCaptures: 0, confirmationRequests: 0 };
    for (const task of tasks) counts[task.status] += 1;
    counts.toolExecutions = events.filter((event) => event.tool !== undefined).length;
    counts.screenshotCaptures = this.#screenshotsInRange(from, to).length;
    counts.confirmationRequests = this.#activity.filter((item) => item.confirmation && item.timestamp >= from && item.timestamp <= to).length;
    const durations = tasks.map((task) => task.durationMs).filter((value): value is number => value !== undefined);
    const health = await this.health();
    return { generatedAt: now(), range: { from, to }, counts, ...(durations.length === 0 ? {} : { averageDurationMs: Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) }), recentActivity: events.slice(0, 50), health };
  }

  async tasks(input: ControlRoomTaskQuery): Promise<{ tasks: ControlRoomTaskProjection[]; nextCursor?: string; truncated: boolean }> {
    const all = await this.#buildTasks(input.from, input.to);
    const filtered = input.status === undefined ? all : all.filter((task) => task.status === input.status);
    const start = Math.max(0, Number(input.cursor ?? "0") || 0);
    const tasks = filtered.slice(start, start + limit(input.limit));
    return { tasks, ...(start + tasks.length < filtered.length ? { nextCursor: String(start + tasks.length) } : {}), truncated: start + tasks.length < filtered.length };
  }

  async task(taskId: string): Promise<ControlRoomTaskProjection> {
    const value = (await this.#buildTasks()).find((task) => task.taskId === taskId);
    if (value === undefined) throw new Error("control_room_task_not_found");
    return value;
  }
  async timeline(taskId: string, input: ControlRoomTaskQuery): Promise<{ events: ControlRoomTimelineEvent[]; nextCursor?: string; truncated: boolean }> {
    await this.task(taskId);
    let all = this.#eventsForTask(taskId).sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.eventId.localeCompare(b.eventId));
    if (input.from !== undefined) all = all.filter((event) => event.timestamp >= input.from!);
    if (input.to !== undefined) all = all.filter((event) => event.timestamp <= input.to!);
    const start = Math.max(0, Number(input.cursor ?? "0") || 0);
    const events = all.slice(start, start + limit(input.limit));
    return { events, ...(start + events.length < all.length ? { nextCursor: String(start + events.length) } : {}), truncated: start + events.length < all.length };
  }
  async screenshots(input: ControlRoomScreenshotQuery): Promise<{ screenshots: ControlRoomScreenshotProjection[]; nextCursor?: string; truncated: boolean }> {
    let all = [...this.#screenshots.values()].filter((value) => this.#owns(value.sessionId) && (input.taskId === undefined || value.taskId === input.taskId)).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || b.screenshotId.localeCompare(a.screenshotId));
    if (input.from !== undefined) all = all.filter((value) => value.capturedAt >= input.from!);
    if (input.to !== undefined) all = all.filter((value) => value.capturedAt <= input.to!);
    const start = Math.max(0, Number(input.cursor ?? "0") || 0);
    const screenshots = all.slice(start, start + limit(input.limit));
    return { screenshots, ...(start + screenshots.length < all.length ? { nextCursor: String(start + screenshots.length) } : {}), truncated: start + screenshots.length < all.length };
  }
  async screenshot(screenshotId: string): Promise<ControlRoomScreenshotProjection> {
    const value = this.#screenshots.get(screenshotId);
    if (value === undefined || !this.#owns(value.sessionId)) throw new Error("control_room_screenshot_not_found");
    return value;
  }
  async health(): Promise<ControlRoomHealthProjection> {
    let renderer: Record<string, unknown> | undefined;
    try { renderer = this.#sources.overlay === undefined ? undefined : await this.#sources.overlay.diagnostics(); } catch { renderer = { rendererStatus: "unavailable" }; }
    let browser: Record<string, unknown> | undefined;
    try { browser = this.#sources.browserBridge?.status(); } catch { browser = { state: "unavailable" }; }
    let strategies: Record<string, unknown> | undefined;
    try { strategies = this.#sources.strategies === undefined ? undefined : await this.#sources.strategies.summary(); } catch { strategies = { redacted: true, status: "unavailable" }; }
    return { service: "available", ...(renderer === undefined ? {} : { renderer }), ...(browser === undefined ? {} : { browser }), ...(strategies === undefined ? {} : { strategies }), stores: { activity: "available", workflows: this.#sources.workflowTrace === undefined ? "unavailable" : "available", forge: this.#sources.forge === undefined ? "unavailable" : "available", scheduler: this.#sources.scheduler === undefined ? "unavailable" : "available" }, limitations: ["Read-only reporting.", "No raw page text, screenshots, secrets, or filesystem paths are exposed.", "Scheduler and generated runtime records remain non-executable.", "Strategy projections contain structural metadata only."] };
  }

  async #buildTasks(from?: string, to?: string): Promise<ControlRoomTaskProjection[]> {
    const tasks: ControlRoomTaskProjection[] = [];
    this.#eventIndex.clear();
    const claimedSessions = new Set<string>();
    const traces = this.#sources.workflowTrace === undefined ? [] : await this.#sources.workflowTrace.listTraces();
    for (const trace of traces) {
      if (this.#ownerSessionId !== undefined && trace.sessionId !== this.#ownerSessionId) continue;
      const id = sourceId("workflow", String(trace.traceId));
      const steps = Array.isArray(trace.steps) ? trace.steps : [];
      const createdAt = String(trace.createdAt);
      const updatedAt = String(trace.updatedAt);
      if ((from !== undefined && updatedAt < from) || (to !== undefined && createdAt > to)) continue;
      if (trace.sessionId !== undefined) claimedSessions.add(String(trace.sessionId));
      tasks.push({ taskId: id, source: "workflow_trace", sourceRecordId: String(trace.traceId), ...(trace.sessionId === undefined ? {} : { sessionId: String(trace.sessionId) }), status: mapStatus(String(trace.status)), createdAt, updatedAt, category: "workflow", riskLevel: steps.some((step: any) => step.riskLevel === "high") ? "high" : "low", toolCount: steps.length, screenshotCount: this.#screenshotsForSession(trace.sessionId).length, confirmationCount: steps.filter((step: any) => step.safetyDecision?.requiresConfirmationToken === true).length, durationMs: Date.parse(updatedAt) - Date.parse(createdAt), executable: false, actionsExecuted: steps.some((step: any) => step.preview !== true && step.ok === true), redacted: true });
      this.#eventIndex.set(id, steps.map((step: any, index: number) => ({ eventId: eventId("workflow", String(trace.traceId), index), taskId: id, source: "workflow_trace", sourceRecordId: String(trace.traceId), timestamp: String(step.timestamp ?? updatedAt), kind: step.preview === true ? "policy_decision" : step.ok === true ? "tool_completed" : "failed", tool: String(step.tool), strategy: step.strategy, riskLevel: step.riskLevel, ...(step.preview === true ? { preview: true } : {}), ok: step.ok, ...(step.errorSummary === undefined ? {} : { errorCode: String(step.errorSummary) }), summary: step.ok === true ? "Workflow step recorded; content omitted." : "Workflow step failed; content omitted." })));
    }
    const assistance = this.#sources.assistance === undefined ? [] : await this.#sources.assistance.list();
    for (const session of assistance) {
      if (this.#ownerSessionId !== undefined && session.ownerSessionId !== this.#ownerSessionId) continue;
      const id = sourceId("assistance", String(session.sessionId));
      const createdAt = String(session.createdAt);
      const updatedAt = String(session.updatedAt);
      if ((from !== undefined && updatedAt < from) || (to !== undefined && createdAt > to)) continue;
      if (session.ownerSessionId !== undefined) claimedSessions.add(String(session.ownerSessionId));
      tasks.push({ taskId: id, source: "assistance_session", sourceRecordId: String(session.sessionId), ...(session.ownerSessionId === undefined ? {} : { sessionId: String(session.ownerSessionId) }), status: mapStatus(String(session.status)), createdAt, updatedAt, category: "visual_assistance", riskLevel: "low", toolCount: Number(session.stepCount ?? 0), screenshotCount: this.#screenshotsForSession(String(session.ownerSessionId ?? "" )).length, confirmationCount: 0, durationMs: Date.parse(updatedAt) - Date.parse(createdAt), executable: false, actionsExecuted: false, redacted: true });
      const lastEvent = session.lastEvent as Record<string, unknown> | undefined;
      this.#eventIndex.set(id, lastEvent === undefined ? [] : [{ eventId: eventId("assistance", String(session.sessionId), 0), taskId: id, source: "assistance_session", sourceRecordId: String(session.sessionId), timestamp: String(lastEvent.createdAt ?? updatedAt), kind: "metadata", summary: "Visual assistance event recorded; target-app action omitted." }]);
    }
    const runs = this.#sources.forge === undefined ? [] : await this.#sources.forge.listRuntimeRuns();
    for (const run of runs) {
      if (this.#ownerSessionId !== undefined && run.sessionId !== this.#ownerSessionId) continue;
      const id = sourceId("forge", String(run.runtimeRunId ?? run.runId));
      const createdAt = String(run.createdAt);
      const updatedAt = String(run.completedAt ?? run.createdAt);
      if ((from !== undefined && updatedAt < from) || (to !== undefined && createdAt > to)) continue;
      if (run.sessionId !== undefined) claimedSessions.add(String(run.sessionId));
      tasks.push({ taskId: id, source: "forge_runtime", sourceRecordId: String(run.runtimeRunId ?? run.runId), status: mapStatus(String(run.status)), createdAt, updatedAt, category: "forge_runtime", riskLevel: "low", toolCount: 1, screenshotCount: 0, confirmationCount: 0, durationMs: Date.parse(updatedAt) - Date.parse(createdAt), executable: run.executableStillFalse !== false ? false : false, actionsExecuted: false, redacted: true });
      this.#eventIndex.set(id, [{ eventId: eventId("forge", String(run.runtimeRunId ?? run.runId), 0), taskId: id, source: "forge_runtime", sourceRecordId: String(run.runtimeRunId ?? run.runId), timestamp: updatedAt, kind: mapStatus(String(run.status)) === "failed" ? "failed" : "metadata", summary: "Forge runtime record projected; execution flags remain false." }]);
    }
    const jobs = this.#sources.scheduler === undefined ? [] : await this.#sources.scheduler.listJobs();
    for (const job of jobs) {
      const id = sourceId("scheduler", String(job.jobId));
      const createdAt = String(job.createdAt);
      const updatedAt = String(job.updatedAt ?? job.createdAt);
      if ((from !== undefined && updatedAt < from) || (to !== undefined && createdAt > to)) continue;
      const status = mapStatus(String(job.status));
      tasks.push({ taskId: id, source: "scheduler_metadata", sourceRecordId: String(job.jobId), status, createdAt, updatedAt, category: "scheduler_metadata", riskLevel: "low", toolCount: 0, screenshotCount: 0, confirmationCount: 0, durationMs: Date.parse(updatedAt) - Date.parse(createdAt), executable: false, actionsExecuted: false, redacted: true });
      this.#eventIndex.set(id, [{ eventId: eventId("scheduler", String(job.jobId), 0), taskId: id, source: "scheduler_metadata", sourceRecordId: String(job.jobId), timestamp: updatedAt, kind: status === "failed" ? "failed" : "metadata", summary: "Scheduler metadata projected; execution remains unsupported." }]);
    }
    const bySession = new Map<string, ActivityRecord[]>();
    for (const activity of this.#activity) if (this.#owns(activity.sessionId) && !claimedSessions.has(activity.sessionId)) bySession.set(activity.sessionId, [...(bySession.get(activity.sessionId) ?? []), activity]);
    for (const [sessionId, activity] of bySession) {
      if (activity.length === 0) continue;
      const first = activity[0]!;
      const last = activity[activity.length - 1]!;
      if ((from !== undefined && last.timestamp < from) || (to !== undefined && first.timestamp > to)) continue;
      const failed = activity.some((item) => !item.ok);
      tasks.push({ taskId: sourceId("direct", sessionId), source: "direct_activity", sourceRecordId: sessionId, sessionId, status: failed ? "failed" : "recent", createdAt: first.timestamp, updatedAt: last.timestamp, category: "direct_activity", riskLevel: activity.some((item) => item.riskLevel === "high") ? "high" : "low", toolCount: activity.length, screenshotCount: this.#screenshotsForSession(sessionId).length, confirmationCount: activity.filter((item) => item.confirmation).length, durationMs: Date.parse(last.timestamp) - Date.parse(first.timestamp), executable: false, actionsExecuted: activity.some((item) => !item.preview && item.ok), redacted: true });
    }
    return tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.taskId.localeCompare(a.taskId));
  }

  #eventsForTask(taskId: string): ControlRoomTimelineEvent[] {
    const [source, id] = taskId.split(":", 2);
    if (source === "direct") return this.#activity.filter((item) => item.sessionId === id && this.#owns(item.sessionId)).map((item) => ({ eventId: item.eventId, taskId, source: "direct_activity" as const, sourceRecordId: id ?? "unknown", timestamp: item.timestamp, kind: item.ok ? "tool_completed" as const : "failed" as const, tool: item.tool, ...(item.strategy === undefined ? {} : { strategy: item.strategy as any }), riskLevel: item.riskLevel, ...(item.preview ? { preview: true as const } : {}), ok: item.ok, ...(item.errorCode === undefined ? {} : { errorCode: item.errorCode }), summary: item.ok ? "Tool result recorded; content omitted." : "Tool failed; content omitted.", ...(item.receiptId === undefined ? {} : { opaqueIds: [item.receiptId] }) }));
    return this.#eventIndex.get(taskId) ?? [];
  }
  #owns(sessionId: string | undefined): boolean { return this.#ownerSessionId === undefined || sessionId === this.#ownerSessionId; }
  #screenshotsForSession(sessionId: string): ScreenshotRecord[] { return [...this.#screenshots.values()].filter((item) => this.#owns(item.sessionId) && item.sessionId === sessionId); }
  #screenshotsInRange(from: string, to: string): ScreenshotRecord[] { return [...this.#screenshots.values()].filter((item) => this.#owns(item.sessionId) && item.capturedAt >= from && item.capturedAt <= to); }
}
