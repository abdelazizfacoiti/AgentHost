import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { OverlayCapabilityReport, OverlayStateSnapshot, OverlayWidgetEvent } from "@agenthost/core";
import { HeadlessOverlayRenderer } from "./headless-renderer.js";
import { probeGtk3, probeLinuxOverlay, type OverlayEnvironment } from "./linux-probe.js";
import { OVERLAY_IPC_MAX_BYTES, OVERLAY_IPC_MAX_IN_FLIGHT, OVERLAY_IPC_VERSION, serializeRendererMessage, validateRendererHandshake, validateRendererReply, type OverlayRendererCommand, type OverlayRendererReply, type OverlayRendererRequest } from "./linux-renderer-protocol.js";
import type { OverlayOperationResult, OverlayRenderRecord, OverlayRenderer } from "./renderer.js";

export interface LinuxOverlayRendererOptions { environment?: OverlayEnvironment; sessionId?: string; pythonCommand?: string; scriptPath?: string; commandTimeoutMs?: number; startupTimeoutMs?: number; maxRestarts?: number; probe?: () => Promise<OverlayCapabilityReport> | OverlayCapabilityReport; }

const fallbackReport = (report: OverlayCapabilityReport, reason: string): OverlayCapabilityReport => ({ ...report, supported: false, rendererStatus: "degraded", fallbackRenderer: "headless", reason, limitations: [...report.limitations, "Headless renderer fallback is active."] });

export class LinuxOverlayRenderer implements OverlayRenderer {
  readonly #fallback = new HeadlessOverlayRenderer();
  readonly #environment: OverlayEnvironment;
  readonly #sessionId: string;
  readonly #pythonCommand: string;
  readonly #scriptPath: string;
  readonly #commandTimeoutMs: number;
  readonly #startupTimeoutMs: number;
  readonly #maxRestarts: number;
  readonly #probeOverride: (() => Promise<OverlayCapabilityReport> | OverlayCapabilityReport) | undefined;
  readonly #token = randomBytes(32).toString("hex");
  readonly #pending = new Map<string, { resolve: (reply: OverlayRendererReply) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  #child: ChildProcessWithoutNullStreams | undefined;
  #buffer = "";
  #report: OverlayCapabilityReport = probeLinuxOverlay({});
  #probePromise: Promise<OverlayCapabilityReport> | undefined;
  #starting: Promise<boolean> | undefined;
  #closed = false;
  #restarts = 0;

  constructor(options: LinuxOverlayRendererOptions = {}) {
    this.#environment = options.environment ?? process.env;
    this.#sessionId = options.sessionId ?? `overlay-session-${randomUUID()}`;
    this.#pythonCommand = options.pythonCommand ?? "python3";
    this.#scriptPath = options.scriptPath ?? fileURLToPath(new URL("../runtime/gtk3-renderer.py", import.meta.url));
    this.#commandTimeoutMs = Math.min(5_000, Math.max(250, options.commandTimeoutMs ?? 2_000));
    this.#startupTimeoutMs = Math.min(10_000, Math.max(500, options.startupTimeoutMs ?? 3_000));
    this.#maxRestarts = Math.min(1, Math.max(0, options.maxRestarts ?? 1));
    this.#probeOverride = options.probe;
  }

  async capabilities(): Promise<OverlayCapabilityReport> {
    if (this.#probePromise === undefined) this.#probePromise = this.#probe();
    await this.#probePromise;
    return this.#report;
  }

  async show(record: OverlayRenderRecord): Promise<OverlayOperationResult> { return await this.#operation("show", record, () => this.#fallback.show(record)); }
  async update(record: OverlayRenderRecord): Promise<OverlayOperationResult> { return await this.#operation("update", record, () => this.#fallback.update(record)); }
  async dismiss(overlayId: string): Promise<OverlayOperationResult> { return await this.#operation("dismiss", { overlayId }, () => this.#fallback.dismiss(overlayId)); }
  async clear(): Promise<OverlayOperationResult> { return await this.#operation("clear", {}, () => this.#fallback.clear()); }
  async emergencyHide(): Promise<OverlayOperationResult> { const result = await this.#operation("emergency_hide", {}, () => this.#fallback.emergencyHide()); await this.#fallback.emergencyHide(); return result; }
  async state(): Promise<OverlayStateSnapshot> { if (await this.#ensureStarted()) { const reply = await this.#request("state", {}).catch(() => undefined); if (reply?.ok && reply.data !== undefined) return reply.data as OverlayStateSnapshot; } const fallback = await this.#fallback.state(); return { ...fallback, renderer: this.#report }; }
  async events(): Promise<OverlayWidgetEvent[]> {
    if (await this.#ensureStarted()) {
      const reply = await this.#request("state", {}).catch(() => undefined);
      const data = reply?.ok === true && reply.data !== undefined ? reply.data as Partial<OverlayStateSnapshot> : undefined;
      if (Array.isArray(data?.pendingEvents)) return data.pendingEvents;
    }
    return await this.#fallback.events();
  }

  async close(): Promise<void> {
    this.#closed = true;
    if (this.#child !== undefined) {
      await this.#request("close", {}).catch(() => undefined);
      this.#child.kill("SIGTERM");
      this.#child = undefined;
    }
    this.#rejectPending(new Error("overlay_renderer_closed"));
    await this.#fallback.clear();
  }

  async #probe(): Promise<OverlayCapabilityReport> {
    if (this.#probeOverride !== undefined) { this.#report = await this.#probeOverride(); return this.#report; }
    const session = (this.#environment.XDG_SESSION_TYPE ?? (this.#environment.DISPLAY ? "x11" : this.#environment.WAYLAND_DISPLAY ? "wayland" : "unknown")).toLowerCase();
    if (session !== "x11" || this.#environment.DISPLAY === undefined) { const report = probeLinuxOverlay(this.#environment, { gtk3Available: false }); this.#report = fallbackReport(report, report.reason); return this.#report; }
    const gtkAvailable = await probeGtk3(this.#environment);
    const report = probeLinuxOverlay(this.#environment, { gtk3Available: gtkAvailable });
    this.#report = report.supported ? report : fallbackReport(report, report.reason);
    return this.#report;
  }

  async #operation(command: Exclude<OverlayRendererCommand, "hello" | "capabilities" | "state" | "close">, payload: unknown, fallback: () => Promise<OverlayOperationResult> | OverlayOperationResult): Promise<OverlayOperationResult> {
    if (!(await this.#ensureStarted())) return await fallback();
    const reply = await this.#request(command, payload).catch(() => undefined);
    if (reply?.ok === true) return { ok: true, reason: typeof reply.data === "object" && reply.data !== null && typeof (reply.data as { reason?: unknown }).reason === "string" ? (reply.data as { reason: string }).reason : "gtk3_overlay_complete" };
    return await fallback();
  }

  async #ensureStarted(): Promise<boolean> {
    if (this.#closed) return false;
    if (this.#child !== undefined) return true;
    if (this.#starting !== undefined) return await this.#starting;
    this.#starting = this.#start();
    try { return await this.#starting; } finally { this.#starting = undefined; }
  }

  async #start(): Promise<boolean> {
    const report = await this.capabilities();
    if (!report.supported || this.#restarts > this.#maxRestarts) return false;
    const child = spawn(this.#pythonCommand, [this.#scriptPath, "--protocol"], { stdio: ["pipe", "pipe", "pipe"], env: this.#safeEnvironment() });
    this.#child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.#read(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { if (chunk.length > 8_192) child.stderr.pause(); });
    child.once("error", () => this.#childFailed("overlay_renderer_process_error"));
    child.once("exit", () => { if (!this.#closed) this.#childFailed("overlay_renderer_process_crashed"); });
    const hello = await this.#request("hello", { sessionId: this.#sessionId }, this.#startupTimeoutMs).catch(() => undefined);
    if (hello?.ok !== true || !validateRendererHandshake(hello.data)) { this.#childFailed("overlay_renderer_handshake_failed"); return false; }
    return true;
  }

  #safeEnvironment(): NodeJS.ProcessEnv { return { PATH: this.#environment.PATH ?? process.env.PATH ?? "/usr/bin:/bin", PYTHONUNBUFFERED: "1", ...(this.#environment.DISPLAY === undefined ? {} : { DISPLAY: this.#environment.DISPLAY }), ...(this.#environment.XAUTHORITY === undefined ? {} : { XAUTHORITY: this.#environment.XAUTHORITY }), ...(this.#environment.XDG_SESSION_TYPE === undefined ? {} : { XDG_SESSION_TYPE: this.#environment.XDG_SESSION_TYPE }) }; }

  #request(command: OverlayRendererCommand, payload: unknown, timeoutMs = this.#commandTimeoutMs): Promise<OverlayRendererReply | undefined> {
    if (this.#child === undefined || this.#child.stdin.destroyed || this.#pending.size >= OVERLAY_IPC_MAX_IN_FLIGHT) return Promise.resolve(undefined);
    const id = `overlay_ipc_${randomUUID()}`;
    const request: OverlayRendererRequest = { version: OVERLAY_IPC_VERSION, id, token: this.#token, command, ...(payload === undefined ? {} : { payload }) };
    const encoded = serializeRendererMessage(request);
    if (encoded === undefined) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#pending.delete(id); reject(new Error("overlay_renderer_timeout")); }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#child?.stdin.write(`${encoded}\n`, (error) => { if (error !== undefined) { clearTimeout(timer); this.#pending.delete(id); reject(error); } });
    });
  }

  #read(chunk: string): void {
    this.#buffer += chunk;
    if (Buffer.byteLength(this.#buffer, "utf8") > OVERLAY_IPC_MAX_BYTES * 2) { this.#childFailed("overlay_renderer_output_oversized"); return; }
    let newline = this.#buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.#buffer.slice(0, newline).trim(); this.#buffer = this.#buffer.slice(newline + 1); newline = this.#buffer.indexOf("\n");
      if (line.length === 0 || Buffer.byteLength(line, "utf8") > OVERLAY_IPC_MAX_BYTES) { this.#childFailed("overlay_renderer_message_invalid"); return; }
      try { const reply: unknown = JSON.parse(line); if (!validateRendererReply(reply)) { this.#childFailed("overlay_renderer_reply_invalid"); return; } const pending = this.#pending.get(reply.id); if (pending === undefined) continue; clearTimeout(pending.timer); this.#pending.delete(reply.id); pending.resolve(reply); } catch { this.#childFailed("overlay_renderer_reply_invalid"); return; }
    }
  }

  #childFailed(reason: string): void { const child = this.#child; this.#child = undefined; if (child !== undefined && !child.killed) child.kill("SIGKILL"); this.#rejectPending(new Error(reason)); this.#report = fallbackReport(this.#report, reason); if (!this.#closed) this.#restarts += 1; }
  #rejectPending(error: Error): void { for (const [id, pending] of this.#pending) { clearTimeout(pending.timer); pending.reject(error); this.#pending.delete(id); } }
}
