import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OverlayCapabilityReport, OverlayRendererMode, OverlayStateSnapshot, OverlayWidgetEvent } from "@agenthost/core";
import { HeadlessOverlayRenderer } from "./headless-renderer.js";
import { probeGtk3, probeLinuxOverlay, type OverlayEnvironment } from "./linux-probe.js";
import { OVERLAY_IPC_MAX_BYTES, OVERLAY_IPC_MAX_IN_FLIGHT, OVERLAY_IPC_VERSION, serializeRendererMessage, validateRendererHandshake, validateRendererOperationData, validateRendererReply, type OverlayRendererCommand, type OverlayRendererReply, type OverlayRendererRequest } from "./linux-renderer-protocol.js";
import type { OverlayOperationResult, OverlayRenderRecord, OverlayRenderer, OverlayRendererDiagnostics, OverlayRendererRestartResult } from "./renderer.js";

export type LinuxOverlaySpawn = (command: string, args: string[], options: { stdio: ["pipe", "pipe", "pipe"]; env: NodeJS.ProcessEnv }) => ChildProcessWithoutNullStreams;
export interface LinuxOverlayRendererOptions { environment?: OverlayEnvironment; mode?: OverlayRendererMode; sessionId?: string; pythonCommand?: string; scriptPath?: string; commandTimeoutMs?: number; startupTimeoutMs?: number; renderAckTimeoutMs?: number; maxRestarts?: number; probe?: () => Promise<OverlayCapabilityReport> | OverlayCapabilityReport; spawnProcess?: LinuxOverlaySpawn; pidFilePath?: string | null; }

const fallbackReport = (report: OverlayCapabilityReport, reason: string): OverlayCapabilityReport => ({ ...report, supported: false, available: true, visible: false, rendererStatus: "degraded", fallbackRenderer: "headless", reason, limitations: [...new Set([...report.limitations, "Headless renderer fallback is active."])] });
const failure = (reason: string): OverlayOperationResult => ({ ok: false, reason, acknowledged: false });
function isOverlayWidgetEvent(value: unknown): value is OverlayWidgetEvent {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.eventId === "string" && record.eventId.length > 0 && record.eventId.length <= 100 && typeof record.overlayId === "string" && record.overlayId.length > 0 && record.overlayId.length <= 200 && typeof record.event === "string" && record.event.length > 0 && record.event.length <= 100 && typeof record.createdAt === "string" && typeof record.ownerSessionId === "string" && record.ownerSessionId.length > 0;
}

export class LinuxOverlayRenderer implements OverlayRenderer {
  readonly #fallback = new HeadlessOverlayRenderer();
  readonly #environment: OverlayEnvironment;
  readonly #mode: OverlayRendererMode;
  readonly #sessionId: string;
  readonly #pythonCommand: string;
  readonly #scriptPath: string;
  readonly #commandTimeoutMs: number;
  readonly #startupTimeoutMs: number;
  readonly #renderAckTimeoutMs: number;
  readonly #maxRestarts: number;
  readonly #probeOverride: (() => Promise<OverlayCapabilityReport> | OverlayCapabilityReport) | undefined;
  readonly #spawnProcess: LinuxOverlaySpawn;
  readonly #pidFilePath: string | null;
  readonly #token = randomBytes(32).toString("hex");
  readonly #pending = new Map<string, { command: OverlayRendererCommand; resolve: (reply: OverlayRendererReply) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  #child: ChildProcessWithoutNullStreams | undefined;
  #buffer = "";
  #report: OverlayCapabilityReport = probeLinuxOverlay({});
  #probePromise: Promise<OverlayCapabilityReport> | undefined;
  #starting: Promise<boolean> | undefined;
  #closed = false;
  #restarts = 0;
  #startAttempts = 0;
  #childState: "stopped" | "starting" | "running" | "failed" | "closed" = "stopped";
  #handshake: "not_attempted" | "pending" | "passed" | "failed" = "not_attempted";
  #runtimeState: "stopped" | "starting" | "handshaking" | "ready" | "rendering" | "degraded" | "closed" = "stopped";
  #rendererEpoch = 0;
  #lastCommand: string | undefined;
  #lastRequestId: string | undefined;
  #lastAckAt: string | undefined;
  #lastExitCode: number | null | undefined;
  #lastExitSignal: NodeJS.Signals | null | undefined;
  #lastStderrSummary: string | undefined;
  #gtk3Available: boolean | undefined;
  #lastFailure: string | undefined;
  #lastRenderMs: number | undefined;

  constructor(options: LinuxOverlayRendererOptions = {}) {
    this.#environment = options.environment ?? process.env;
    this.#mode = options.mode ?? "auto";
    this.#sessionId = options.sessionId ?? `overlay-session-${randomUUID()}`;
    this.#pythonCommand = options.pythonCommand ?? "python3";
    this.#scriptPath = options.scriptPath ?? fileURLToPath(new URL("../runtime/gtk3-renderer.py", import.meta.url));
    this.#commandTimeoutMs = Math.min(5_000, Math.max(250, options.commandTimeoutMs ?? 2_000));
    this.#startupTimeoutMs = Math.min(10_000, Math.max(500, options.startupTimeoutMs ?? 3_000));
    this.#renderAckTimeoutMs = Math.min(10_000, Math.max(250, options.renderAckTimeoutMs ?? this.#commandTimeoutMs));
    this.#maxRestarts = Math.min(1, Math.max(0, options.maxRestarts ?? 1));
    this.#probeOverride = options.probe;
    this.#spawnProcess = options.spawnProcess ?? ((command, args, spawnOptions) => spawn(command, args, spawnOptions));
    // PID registry lets `agenthost overlay hide/status` find live renderers.
    // Unit tests pass a minimal environment without PATH; skip the registry
    // there so tests never write into the operator's home directory.
    if (options.pidFilePath === null) this.#pidFilePath = null;
    else if (typeof options.pidFilePath === "string") this.#pidFilePath = options.pidFilePath;
    else if (this.#environment.PATH !== undefined) this.#pidFilePath = path.join(this.#environment.AGENTHOST_HOME ?? path.join(this.#environment.HOME ?? os.homedir(), ".agenthost"), "run", "overlay-renderer.pid");
    else this.#pidFilePath = null;
  }

  async capabilities(): Promise<OverlayCapabilityReport> {
    if (this.#probePromise === undefined) this.#probePromise = this.#probe();
    await this.#probePromise;
    return this.#report;
  }

  async diagnostics(): Promise<OverlayRendererDiagnostics> {
    const capabilities = await this.capabilities();
    return { requestedMode: this.#mode, effectiveBackend: capabilities.renderer, rendererStatus: capabilities.rendererStatus, sessionType: capabilities.sessionType, displayPresent: this.#environment.DISPLAY !== undefined, waylandDisplayPresent: this.#environment.WAYLAND_DISPLAY !== undefined, pythonExecutable: this.#pythonCommand, ...(this.#gtk3Available === undefined ? {} : { gtk3Available: this.#gtk3Available }), rendererScriptPresent: existsSync(this.#scriptPath), childState: this.#childState, handshake: this.#handshake, runtimeState: this.#runtimeState, rendererEpoch: this.#rendererEpoch, ...(this.#lastCommand === undefined ? {} : { lastCommand: this.#lastCommand }), ...(this.#lastRequestId === undefined ? {} : { lastRequestId: this.#lastRequestId }), ...(this.#lastAckAt === undefined ? {} : { lastAckAt: this.#lastAckAt }), ...(this.#lastRenderMs === undefined ? {} : { lastRenderMs: this.#lastRenderMs }), ...(this.#lastExitCode === undefined ? {} : { lastExitCode: this.#lastExitCode }), ...(this.#lastExitSignal === undefined ? {} : { lastExitSignal: this.#lastExitSignal }), ...(this.#lastStderrSummary === undefined ? {} : { lastStderrSummary: this.#lastStderrSummary }), capabilities, activeOverlayCount: 0, restartCount: this.#restarts, restartAllowed: this.#childState === "failed" || capabilities.fallbackRenderer === "headless", ...(capabilities.fallbackRenderer === "headless" ? { fallbackReason: capabilities.reason } : {}), ...(this.#lastFailure === undefined ? {} : { lastFailure: this.#lastFailure }), recommendedAction: capabilities.supported && this.#runtimeState === "ready" ? "Renderer healthy." : capabilities.supported ? "Renderer requires startup or inspection." : "Use headless mode or inspect setup instructions." };
  }

  async restart(): Promise<OverlayRendererRestartResult> {
    if (this.#closed) return { ok: false, reason: "overlay_renderer_closed", diagnostics: await this.diagnostics() };
    const old = this.#child;
    this.#child = undefined;
    this.#rejectPending(new Error("overlay_renderer_restarting"));
    if (old !== undefined && !old.killed) { old.kill("SIGTERM"); this.#removePidRegistry(old.pid); }
    this.#buffer = ""; this.#restarts = 0; this.#startAttempts = 0; this.#lastFailure = undefined; this.#lastExitCode = undefined; this.#lastExitSignal = undefined; this.#lastStderrSummary = undefined; this.#childState = "stopped"; this.#runtimeState = "stopped"; this.#handshake = "not_attempted"; this.#report = probeLinuxOverlay({}); this.#probePromise = undefined;
    const started = await this.#ensureStarted();
    return { ok: started, reason: started ? "overlay_renderer_restarted" : "overlay_renderer_restart_failed", diagnostics: await this.diagnostics() };
  }

  async show(record: OverlayRenderRecord): Promise<OverlayOperationResult> { return await this.#operation("show", record, () => this.#fallback.show(record)); }
  async update(record: OverlayRenderRecord): Promise<OverlayOperationResult> { return await this.#operation("update", record, () => this.#fallback.update(record)); }
  async dismiss(overlayId: string): Promise<OverlayOperationResult> { return await this.#operation("dismiss", { overlayId }, () => this.#fallback.dismiss(overlayId)); }
  async clear(): Promise<OverlayOperationResult> { return await this.#operation("clear", {}, () => this.#fallback.clear()); }
  async emergencyHide(): Promise<OverlayOperationResult> { const result = await this.#operation("emergency_hide", {}, () => this.#fallback.emergencyHide()); await this.#fallback.emergencyHide(); return result; }
  async state(): Promise<OverlayStateSnapshot> { if (await this.#ensureStarted()) { const reply = await this.#request("state", {}).catch(() => undefined); if (reply?.ok && reply.data !== undefined) return reply.data as OverlayStateSnapshot; } const fallback = await this.#fallback.state(); return { ...fallback, renderer: this.#report }; }
  async events(): Promise<OverlayWidgetEvent[]> { if (await this.#ensureStarted()) { const reply = await this.#request("state", {}).catch(() => undefined); const data = reply?.ok === true && reply.data !== undefined ? reply.data as Partial<OverlayStateSnapshot> : undefined; if (Array.isArray(data?.pendingEvents)) return data.pendingEvents; } return await this.#fallback.events(); }
  async drainEvents(): Promise<OverlayWidgetEvent[]> { if (await this.#ensureStarted()) { const reply = await this.#request("events", {}).catch(() => undefined); const data = reply?.ok === true && reply.data !== null && typeof reply.data === "object" ? (reply.data as { events?: unknown }).events : undefined; if (Array.isArray(data)) return data.filter(isOverlayWidgetEvent); } return await this.#fallback.drainEvents(); }

  async close(): Promise<void> {
    this.#closed = true;
    this.#runtimeState = "closed";
    this.#childState = "closed";
    const child = this.#child;
    this.#child = undefined;
    if (child !== undefined && !child.killed) { await this.#request("close", {}).catch(() => undefined); child.kill("SIGTERM"); this.#removePidRegistry(child.pid); }
    else this.#removePidRegistry();
    this.#rejectPending(new Error("overlay_renderer_closed"));
    await this.#fallback.clear();
  }

  async #probe(): Promise<OverlayCapabilityReport> {
    if (this.#probeOverride !== undefined) { this.#gtk3Available = true; this.#report = await this.#probeOverride(); return this.#report; }
    const session = (this.#environment.XDG_SESSION_TYPE ?? (this.#environment.DISPLAY ? "x11" : this.#environment.WAYLAND_DISPLAY ? "wayland" : "unknown")).toLowerCase();
    if (session !== "x11" || this.#environment.DISPLAY === undefined) { this.#gtk3Available = false; const report = probeLinuxOverlay(this.#environment, { gtk3Available: false }); this.#report = fallbackReport(report, report.reason); return this.#report; }
    const gtkAvailable = await probeGtk3(this.#environment); this.#gtk3Available = gtkAvailable;
    const report = probeLinuxOverlay(this.#environment, { gtk3Available: gtkAvailable });
    this.#report = report.supported ? report : fallbackReport(report, report.reason);
    return this.#report;
  }

  async #operation(command: Exclude<OverlayRendererCommand, "hello" | "capabilities" | "state" | "events" | "close">, payload: unknown, fallback: () => Promise<OverlayOperationResult> | OverlayOperationResult): Promise<OverlayOperationResult> {
    if (!(await this.#ensureStarted())) return this.#mode === "auto" ? await fallback() : failure(this.#lastFailure ?? "renderer_start_timeout");
    this.#runtimeState = "rendering";
    const startedAt = Date.now();
    let reply = await this.#sendOperation(command, payload);
    // One bounded retry for an unacknowledged render: a busy paint used to be
    // fatal (SIGKILL) even when the renderer recovered a moment later.
    if (reply instanceof Error && reply.message === "overlay_render_not_acknowledged") {
      reply = await this.#sendOperation(command, payload);
    }
    this.#lastRenderMs = Date.now() - startedAt;
    if (reply instanceof Error) {
      const reason = reply.message;
      // Transport-level failure: the child is wedged, dead, or unauthenticated.
      this.#fail(reason);
      return this.#mode === "auto" ? await fallback() : failure(reason);
    }
    if (reply.ok === true && validateRendererOperationData(reply.data, command)) {
      if (reply.data.rendererEpoch !== this.#rendererEpoch) { this.#fail("renderer_epoch_mismatch"); return failure("renderer_epoch_mismatch"); }
      if ((this.#mode === "gtk3-native" || this.#mode === "auto") && reply.data.requestId !== reply.id) { this.#fail("renderer_protocol_error"); return failure("renderer_protocol_error"); }
      this.#runtimeState = "ready"; this.#lastAckAt = new Date().toISOString();
      const visible = reply.data.visible ?? reply.data.visibleWindowCount > 0;
      const drawReady = reply.data.drawReadyCount ?? (this.#mode === "gtk3-native" || this.#mode === "auto" ? 0 : reply.data.visibleWindowCount);
      if ((command === "show" || command === "update") && (!visible || drawReady === 0)) {
        // The renderer answered and is healthy; the window simply did not map.
        // Treat as a soft failure so a transient visibility hiccup no longer
        // kills a working renderer process.
        this.#lastFailure = "renderer_visibility_timeout";
        return this.#mode === "auto" ? await fallback() : failure("renderer_visibility_timeout");
      }
      if ((command === "show" || command === "update") && (this.#mode === "gtk3-native" || this.#mode === "auto") && reply.data.liveSurfaceRegistered !== true) {
        this.#lastFailure = "overlay_live_registration_missing";
        return failure("overlay_live_registration_missing");
      }
      return { ok: true, reason: reply.data.reason ?? "gtk3_overlay_complete", acknowledged: true, rendererEpoch: reply.data.rendererEpoch, visibleWindowCount: reply.data.visibleWindowCount, interactiveWindowCount: reply.data.interactiveWindowCount, ...(reply.data.transparentWindowCount === undefined ? {} : { transparentWindowCount: reply.data.transparentWindowCount }), ...(reply.data.drawReadyCount === undefined ? {} : { drawReadyCount: reply.data.drawReadyCount }), ...(reply.data.liveSurfaceRegistered === undefined ? {} : { liveSurfaceRegistered: reply.data.liveSurfaceRegistered }), ...(reply.data.visible === undefined ? {} : { visible: reply.data.visible }) };
    }
    const reason = reply.ok === false && typeof reply.error === "string" ? reply.error : "overlay_render_not_acknowledged";
    // Logical renderer-side rejection (overlay_not_found, oversized record,
    // ...): the child is alive and answered. Never SIGKILL it for answering.
    this.#lastFailure = reason;
    this.#runtimeState = "ready";
    return this.#mode === "auto" ? await fallback() : failure(reason);
  }

  async #sendOperation(command: Exclude<OverlayRendererCommand, "hello" | "capabilities" | "state" | "events" | "close">, payload: unknown): Promise<OverlayRendererReply | Error> {
    try { return await this.#request(command, payload, this.#renderAckTimeoutMs); }
    catch (error: unknown) { return error instanceof Error ? error : new Error("renderer_protocol_error"); }
  }

  async #ensureStarted(): Promise<boolean> {
    if (this.#closed) return false;
    if (this.#starting !== undefined) return await this.#starting;
    if (this.#child !== undefined && this.#handshake === "passed") return true;
    if (this.#child !== undefined) this.#fail("renderer_protocol_error");
    this.#starting = this.#start();
    try { return await this.#starting; } finally { this.#starting = undefined; }
  }

  async #start(): Promise<boolean> {
    const report = await this.capabilities();
    if (!report.supported || this.#startAttempts > this.#maxRestarts) { if (this.#lastFailure === undefined) this.#lastFailure = report.supported ? "renderer_start_timeout" : "renderer_start_unavailable"; return false; }
    this.#startAttempts += 1;
    let child: ChildProcessWithoutNullStreams;
    try { child = this.#spawnProcess(this.#pythonCommand, [this.#scriptPath, "--protocol"], { stdio: ["pipe", "pipe", "pipe"], env: this.#safeEnvironment() }); } catch { this.#fail("renderer_process_exited"); return false; }
    this.#childState = "starting"; this.#runtimeState = "handshaking"; this.#handshake = "pending"; this.#child = child; this.#buffer = "";
    child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk: string) => this.#read(chunk));
    child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk: string) => this.#captureStderr(chunk));
    child.once("error", (error) => { const message = error instanceof Error ? error.message : "renderer_spawn_error"; this.#lastStderrSummary = message.replace(/[A-Za-z0-9+/=_-]{32,}/g, "[redacted]").replace(/\s+/g, " ").slice(0, 512); this.#childFailed(child, "renderer_process_exited"); });
    child.once("exit", (code, signal) => this.#childFailed(child, "renderer_process_exited", code, signal));
    const candidateEpoch = this.#rendererEpoch + 1;
    const hello = await this.#request("hello", { sessionId: this.#sessionId, rendererEpoch: candidateEpoch }, this.#startupTimeoutMs).catch((error: unknown) => { this.#fail(error instanceof Error ? error.message : "renderer_handshake_timeout"); return undefined; });
    if (hello?.ok !== true) { this.#fail(typeof hello?.error === "string" ? hello.error : this.#lastFailure ?? "renderer_protocol_error"); return false; }
    if (!validateRendererHandshake(hello.data)) { this.#fail("renderer_protocol_error"); return false; }
    if (hello.data.rendererEpoch !== candidateEpoch) { this.#fail("renderer_epoch_mismatch"); return false; }
    if (hello.data.capabilities.supported !== true) {
      const reason = typeof hello.data.capabilities.reason === "string" && ["overlay_compositor_unavailable", "overlay_transparency_unavailable"].includes(hello.data.capabilities.reason) ? hello.data.capabilities.reason : "overlay_transparency_unavailable";
      this.#report = { ...this.#report, ...hello.data.capabilities };
      this.#fail(reason);
      return false;
    }
    this.#rendererEpoch = candidateEpoch; this.#handshake = "passed"; this.#childState = "running"; this.#runtimeState = "ready"; this.#report = { ...this.#report, ...hello.data.capabilities, rendererStatus: "available", available: true, visible: true, supported: true, fallbackRenderer: undefined };
    this.#writePidRegistry();
    return true;
  }

  #writePidRegistry(): void {
    if (this.#pidFilePath === null) return;
    const pid = this.#child?.pid;
    if (pid === undefined) return;
    try {
      mkdirSync(path.dirname(this.#pidFilePath), { recursive: true });
      writeFileSync(this.#pidFilePath, `${JSON.stringify({ pid, sessionId: this.#sessionId, startedAt: new Date().toISOString() })}\n`, { mode: 0o600 });
    } catch {
      /* Registry is best effort; orphan cleanup still works via pgrep. */
    }
  }

  #removePidRegistry(pid?: number): void {
    if (this.#pidFilePath === null) return;
    try {
      if (pid !== undefined) {
        const parsed = JSON.parse(readFileSync(this.#pidFilePath, "utf8")) as { pid?: number };
        if (parsed.pid !== pid) return;
      }
      rmSync(this.#pidFilePath, { force: true });
    } catch {
      try { rmSync(this.#pidFilePath, { force: true }); } catch { /* Already gone. */ }
    }
  }

  #captureStderr(chunk: string): void { const safe = chunk.slice(-2_048).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[A-Za-z0-9+/=_-]{32,}/g, "[redacted]").replace(/\s+/g, " ").trim(); if (!safe) return; this.#lastStderrSummary = `${this.#lastStderrSummary ?? ""} ${safe}`.trim().slice(-512); }
  #safeEnvironment(): NodeJS.ProcessEnv { return { PATH: this.#environment.PATH ?? process.env.PATH ?? "/usr/bin:/bin", PYTHONUNBUFFERED: "1", ...(this.#environment.DISPLAY === undefined ? {} : { DISPLAY: this.#environment.DISPLAY }), ...(this.#environment.XAUTHORITY === undefined ? {} : { XAUTHORITY: this.#environment.XAUTHORITY }), ...(this.#environment.XDG_SESSION_TYPE === undefined ? {} : { XDG_SESSION_TYPE: this.#environment.XDG_SESSION_TYPE }) }; }

  #request(command: OverlayRendererCommand, payload: unknown, timeoutMs = this.#commandTimeoutMs): Promise<OverlayRendererReply> {
    if (this.#child === undefined || this.#child.stdin.destroyed) return Promise.reject(new Error("renderer_process_exited"));
    if (this.#pending.size >= OVERLAY_IPC_MAX_IN_FLIGHT) return Promise.reject(new Error("renderer_protocol_error"));
    const id = `overlay_ipc_${randomUUID()}`; const request: OverlayRendererRequest = { version: OVERLAY_IPC_VERSION, id, token: this.#token, command, ...(payload === undefined ? {} : { payload }) }; const encoded = serializeRendererMessage(request); if (encoded === undefined) return Promise.reject(new Error("renderer_protocol_error"));
    this.#lastCommand = command; this.#lastRequestId = id;
    return new Promise((resolve, reject) => { const timeoutReason = command === "hello" ? "renderer_handshake_timeout" : ["show", "update", "dismiss", "clear", "emergency_hide"].includes(command) ? "overlay_render_not_acknowledged" : "renderer_protocol_error"; const timer = setTimeout(() => { this.#pending.delete(id); reject(new Error(timeoutReason)); }, timeoutMs); this.#pending.set(id, { command, resolve, reject, timer }); this.#child?.stdin.write(`${encoded}\n`, (error) => { if (error !== undefined && error !== null) { this.#lastStderrSummary = error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 512) : "renderer_stdin_write_failed"; clearTimeout(timer); this.#pending.delete(id); reject(new Error("renderer_process_exited")); } }); });
  }

  #read(chunk: string): void {
    this.#buffer += chunk;
    if (Buffer.byteLength(this.#buffer, "utf8") > OVERLAY_IPC_MAX_BYTES * 2) { this.#fail("renderer_protocol_error"); return; }
    let newline = this.#buffer.indexOf("\n");
    while (newline >= 0) { const line = this.#buffer.slice(0, newline).trim(); this.#buffer = this.#buffer.slice(newline + 1); newline = this.#buffer.indexOf("\n"); if (line.length === 0 || Buffer.byteLength(line, "utf8") > OVERLAY_IPC_MAX_BYTES) { this.#fail("renderer_protocol_error"); return; } try { const reply: unknown = JSON.parse(line); if (!validateRendererReply(reply)) { this.#fail("renderer_protocol_error"); return; } const pending = this.#pending.get(reply.id); if (pending === undefined) { this.#fail("renderer_protocol_error"); return; } clearTimeout(pending.timer); this.#pending.delete(reply.id); pending.resolve(reply); } catch { this.#fail("renderer_protocol_error"); return; } }
  }

  #childFailed(child: ChildProcessWithoutNullStreams, reason: string, code?: number | null, signal?: NodeJS.Signals | null): void { if (this.#child !== child) return; this.#lastExitCode = code ?? null; this.#lastExitSignal = signal ?? null; this.#removePidRegistry(child.pid); this.#fail(reason, child); }
  #fail(reason: string, expectedChild?: ChildProcessWithoutNullStreams): void { if (expectedChild !== undefined && this.#child !== expectedChild) return; const child = this.#child; this.#child = undefined; if (child !== undefined) this.#removePidRegistry(child.pid); this.#rejectPending(new Error(reason)); if (child !== undefined && !child.killed) child.kill("SIGKILL"); this.#report = fallbackReport(this.#report, reason); this.#lastFailure = reason; this.#childState = this.#closed ? "closed" : "failed"; this.#runtimeState = this.#closed ? "closed" : "degraded"; this.#handshake = this.#handshake === "passed" ? this.#handshake : "failed"; if (!this.#closed) this.#restarts = Math.min(this.#maxRestarts + 1, this.#restarts + 1); }
  #rejectPending(error: Error): void { for (const [id, pending] of this.#pending) { clearTimeout(pending.timer); pending.reject(error); this.#pending.delete(id); } }
}
