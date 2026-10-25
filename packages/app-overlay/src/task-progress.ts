import type { OverlayPlacement, OverlayWidget, OverlayWidgetComponent, OverlayWidgetEvent } from "@agenthost/core";
import type { OverlayManager } from "./manager.js";

export type TaskProgressStatus = "running" | "pause_requested" | "paused" | "stopping" | "waiting_approval" | "done" | "error" | "stopped";
export type TaskProgressAction = "pause" | "resume" | "stop" | "dismiss";
export type TaskProgressStepState = "pending" | "active" | "done" | "failed";

export interface TaskProgressStep { id: string; label: string; state?: TaskProgressStepState; }
export interface TaskProgressSnapshot { taskId: string; title: string; status: TaskProgressStatus; stepIndex: number; stepCount: number; steps: TaskProgressStep[]; elapsedMs: number; detail?: string; waitingCommand?: string; runningTaskCount: number; }

export interface TaskProgressOverlayOptions {
  manager: OverlayManager;
  taskId: string;
  title: string;
  steps?: TaskProgressStep[];
  placement?: OverlayPlacement;
  /** Persist after terminal states until the operator dismisses (default true).
   * Passing a positive autoHideMs restores terminal auto-hide behavior. */
  persistent?: boolean;
  autoHideMs?: number;
  heartbeatMs?: number;
  runningTaskCount?: number;
  now?: () => number;
  onAction?: (action: TaskProgressAction) => void;
}

const TERMINAL: ReadonlySet<TaskProgressStatus> = new Set(["done", "error", "stopped"]);
const BADGE: Record<TaskProgressStatus, { status: "neutral" | "info" | "success" | "warning" | "danger"; text: string }> = {
  running: { status: "info", text: "Running" },
  pause_requested: { status: "warning", text: "Pausing after this step" },
  paused: { status: "warning", text: "Paused" },
  stopping: { status: "danger", text: "Stopping…" },
  waiting_approval: { status: "warning", text: "Waiting for approval" },
  done: { status: "success", text: "Done" },
  error: { status: "danger", text: "Failed" },
  stopped: { status: "neutral", text: "Stopped" }
};

function elapsedLabel(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export class TaskProgressOverlay {
  readonly #options: TaskProgressOverlayOptions;
  readonly #steps: TaskProgressStep[];
  readonly #now: () => number;
  readonly #startedAt: number;
  #title: string;
  #status: TaskProgressStatus = "running";
  #detail: string | undefined;
  #waitingCommand: string | undefined;
  #runningTaskCount: number;
  #heartbeat: ReturnType<typeof setInterval> | undefined;
  #keepalive: ReturnType<typeof setInterval> | undefined;
  #autoHide: ReturnType<typeof setTimeout> | undefined;
  #terminalElapsedMs: number | undefined;
  #persistence: boolean;
  #renderQueue: Promise<void> = Promise.resolve();
  #disposed = false;
  #started = false;

  constructor(options: TaskProgressOverlayOptions) {
    this.#options = options;
    this.#title = options.title;
    this.#steps = (options.steps ?? []).map((step) => ({ ...step }));
    this.#runningTaskCount = Math.max(1, options.runningTaskCount ?? 1);
    this.#now = options.now ?? (() => Date.now());
    this.#startedAt = this.#now();
    this.#persistence = (options.autoHideMs === undefined || options.autoHideMs <= 0) && options.persistent !== false;
    this.#normalizeSteps();
  }

  snapshot(): TaskProgressSnapshot {
    return { taskId: this.#options.taskId, title: this.#title, status: this.#status, stepIndex: this.#activeIndex(), stepCount: this.#steps.length, steps: this.#steps.map((step) => ({ ...step })), elapsedMs: this.#terminalElapsedMs ?? Math.max(0, this.#now() - this.#startedAt), ...(this.#detail === undefined ? {} : { detail: this.#detail }), ...(this.#waitingCommand === undefined ? {} : { waitingCommand: this.#waitingCommand }), runningTaskCount: this.#runningTaskCount };
  }

  async start(): Promise<boolean> {
    if (this.#disposed) return false;
    const result = await this.#options.manager.showWidget(this.#widget());
    if (!result.ok) return false;
    this.#started = true;
    this.#startHeartbeat();
    return true;
  }

  async setSteps(steps: TaskProgressStep[]): Promise<void> {
    this.#steps.splice(0, this.#steps.length, ...steps.map((step) => ({ ...step })));
    this.#normalizeSteps();
    await this.#render();
  }

  async setRunningTaskCount(count: number): Promise<void> {
    const next = Math.max(1, Math.floor(count));
    if (next === this.#runningTaskCount) return;
    this.#runningTaskCount = next;
    await this.#render();
  }

  async setStep(stepIdOrIndex: string | number, state: TaskProgressStepState = "active"): Promise<void> {
    const index = typeof stepIdOrIndex === "number" ? stepIdOrIndex : this.#steps.findIndex((step) => step.id === stepIdOrIndex);
    if (index < 0 || index >= this.#steps.length) return;
    const step = this.#steps[index];
    if (step === undefined) return;
    if (state === "active") {
      for (let cursor = 0; cursor < index; cursor += 1) {
        const prior = this.#steps[cursor];
        if (prior !== undefined && prior.state !== "failed") prior.state = "done";
      }
    }
    step.state = state;
    await this.#render();
  }

  async setDetail(detail: string | undefined): Promise<void> {
    this.#detail = detail;
    await this.#render();
  }

  async setStatus(status: TaskProgressStatus): Promise<void> {
    this.#status = status;
    if (TERMINAL.has(status)) await this.#afterTerminal();
    else {
      this.#stopKeepalive();
      if (this.#autoHide !== undefined) clearTimeout(this.#autoHide);
      this.#autoHide = undefined;
      this.#startHeartbeat();
      await this.#render();
    }
  }

  async pause(): Promise<void> { await this.setStatus("paused"); }
  async resume(): Promise<void> { await this.setStatus("running"); }
  async requestStop(): Promise<void> { await this.setStatus("stopping"); }

  async waitingForApproval(command: string): Promise<void> {
    this.#waitingCommand = command;
    this.#status = "waiting_approval";
    await this.#render();
  }

  async complete(detail?: string): Promise<void> {
    if (detail !== undefined) this.#detail = detail;
    this.#status = "done";
    this.#waitingCommand = undefined;
    for (const step of this.#steps) step.state = step.state === "failed" ? "failed" : "done";
    await this.#afterTerminal();
  }

  async fail(detail?: string): Promise<void> {
    if (detail !== undefined) this.#detail = detail;
    this.#status = "error";
    this.#waitingCommand = undefined;
    const active = this.#steps.find((step) => step.state === "active");
    if (active !== undefined) active.state = "failed";
    await this.#afterTerminal();
  }

  async stopped(detail?: string): Promise<void> {
    if (detail !== undefined) this.#detail = detail;
    this.#status = "stopped";
    this.#waitingCommand = undefined;
    await this.#afterTerminal();
  }

  async pollEvents(): Promise<TaskProgressAction[]> {
    if (this.#disposed || !this.#started) return [];
    const events = await this.#options.manager.pollEvents(this.#options.taskId);
    const actions: TaskProgressAction[] = [];
    for (const event of events) {
      if (event.overlayId !== this.#options.taskId) continue;
      const action = await this.#applyEvent(event);
      if (action !== undefined) actions.push(action);
    }
    for (const action of actions) this.#options.onAction?.(action);
    return actions;
  }

  async flush(): Promise<void> { await this.#renderQueue; }

  async dismiss(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#stopHeartbeat();
    this.#stopKeepalive();
    if (this.#autoHide !== undefined) clearTimeout(this.#autoHide);
    this.#autoHide = undefined;
    await this.#renderQueue.catch(() => undefined);
    await this.#options.manager.dismiss(this.#options.taskId);
  }

  async #applyEvent(event: OverlayWidgetEvent): Promise<TaskProgressAction | undefined> {
    if (event.event === "pause") {
      if (this.#status !== "running") return undefined;
      this.#status = "pause_requested";
      await this.#render();
      return "pause";
    }
    if (event.event === "resume") {
      if (this.#status !== "paused" && this.#status !== "pause_requested") return undefined;
      this.#status = "running";
      await this.#render();
      return "resume";
    }
    if (event.event === "emergency_stop_requested" || event.event === "cancel" || event.event === "cancelled") {
      if (TERMINAL.has(this.#status) || this.#status === "stopping") return undefined;
      this.#status = "stopping";
      this.#waitingCommand = undefined;
      await this.#render();
      return "stop";
    }
    if (event.event === "dismissed" || event.event === "hide") {
      await this.dismiss();
      return "dismiss";
    }
    return undefined;
  }

  #normalizeSteps(): void {
    if (this.#steps.length === 0) return;
    const firstOpen = this.#steps.findIndex((step) => step.state !== "done" && step.state !== "failed");
    for (const [index, step] of this.#steps.entries()) {
      if (step.state === undefined) step.state = index === firstOpen ? "active" : "pending";
    }
    const first = firstOpen >= 0 ? this.#steps[firstOpen] : undefined;
    if (!this.#steps.some((step) => step.state === "active") && first !== undefined) first.state = "active";
  }

  #activeIndex(): number {
    const index = this.#steps.findIndex((step) => step.state === "active");
    if (index >= 0) return index;
    const lastDone = this.#steps.reduce((last, step, current) => (step.state === "done" ? current : last), -1);
    return lastDone >= 0 ? lastDone : 0;
  }

  #progress(): number {
    if (this.#steps.length === 0) return this.#status === "done" ? 1 : 0;
    const completed = this.#steps.filter((step) => step.state === "done").length;
    if (this.#status === "done") return 1;
    return Math.max(0, Math.min(1, completed / this.#steps.length));
  }

  #widget(): OverlayWidget {
    const badge = BADGE[this.#status];
    const components: OverlayWidgetComponent[] = [{ type: "status_badge", status: badge.status, text: badge.text }];
    if (this.#steps.length > 0) {
      const stepNumber = this.#status === "done" ? this.#steps.length : Math.min(this.#steps.length, this.#activeIndex() + 1);
      components.push({ type: "progress", value: this.#progress(), label: `Step ${stepNumber} / ${this.#steps.length}` });
      components.push({ type: "checklist", items: this.#steps.map((step) => ({ label: step.label, checked: step.state === "done", state: step.state ?? "pending" })) });
    }
    if (this.#detail !== undefined && this.#detail.length > 0) components.push({ type: "text", text: this.#detail });
    if (this.#waitingCommand !== undefined) components.push({ type: "warning", text: `Approval needed. Run: agenthost task approve ${this.#waitingCommand}` });
    components.push({ type: "key_value", key: "Elapsed", value: elapsedLabel(this.snapshot().elapsedMs) });
    if (this.#runningTaskCount > 1) components.push({ type: "key_value", key: "Tasks", value: `${this.#runningTaskCount} running` });
    for (const [label, event] of this.#buttons()) components.push({ type: "button", label, event });
    return {
      widgetId: this.#options.taskId,
      title: this.#title,
      components,
      placement: this.#options.placement ?? "top_right",
      sensitivity: "public",
      ttlMs: 300_000,
      ...(this.#persistence ? { persistent: true } : {}),
      interaction: { interactive: true, focus: "never", dismissible: true, allowedEvents: ["pause", "resume", "emergency_stop_requested", "dismissed"] }
    };
  }

  #buttons(): Array<[string, "pause" | "resume" | "emergency_stop_requested" | "dismissed"]> {
    if (this.#status === "running") return [["Pause", "pause"], ["Stop", "emergency_stop_requested"]];
    if (this.#status === "pause_requested") return [["Resume", "resume"], ["Stop", "emergency_stop_requested"]];
    if (this.#status === "paused") return [["Resume", "resume"], ["Stop", "emergency_stop_requested"]];
    if (this.#status === "waiting_approval") return [["Stop", "emergency_stop_requested"]];
    if (this.#status === "stopping") return [];
    return [["Dismiss", "dismissed"]];
  }

  #render(): Promise<void> {
    this.#renderQueue = this.#renderQueue.catch(() => undefined).then(async () => {
      if (this.#disposed || !this.#started) return;
      const result = await this.#options.manager.updateWidget(this.#widget());
      if (result.ok) return;
      if (result.reason === "overlay_not_found") await this.#options.manager.showWidget(this.#widget());
    });
    return this.#renderQueue;
  }

  #startHeartbeat(): void {
    this.#stopHeartbeat();
    const interval = setInterval(() => {
      if (this.#disposed || TERMINAL.has(this.#status)) return;
      void this.#render();
    }, Math.max(250, this.#options.heartbeatMs ?? 1_000));
    const unref = interval as unknown as { unref?: () => void };
    if (typeof unref.unref === "function") unref.unref();
    this.#heartbeat = interval;
  }

  #stopHeartbeat(): void {
    if (this.#heartbeat === undefined) return;
    clearInterval(this.#heartbeat);
    this.#heartbeat = undefined;
  }

  async #afterTerminal(): Promise<void> {
    if (this.#terminalElapsedMs === undefined) this.#terminalElapsedMs = Math.max(0, this.#now() - this.#startedAt);
    this.#stopHeartbeat();
    await this.#render();
    if (this.#persistence) this.#startKeepalive();
    else this.#scheduleAutoHide();
  }

  #startKeepalive(): void {
    if (!this.#persistence || this.#disposed) return;
    this.#stopKeepalive();
    // Slow keepalive: if the renderer restarted (or a hide raced the last
    // paint), re-create the card instead of leaving the operator blind.
    const interval = setInterval(() => {
      if (this.#disposed) return;
      void this.#render();
    }, 30_000);
    const unref = interval as unknown as { unref?: () => void };
    if (typeof unref.unref === "function") unref.unref();
    this.#keepalive = interval;
  }

  #stopKeepalive(): void {
    if (this.#keepalive === undefined) return;
    clearInterval(this.#keepalive);
    this.#keepalive = undefined;
  }

  #scheduleAutoHide(): void {
    if (this.#autoHide !== undefined) clearTimeout(this.#autoHide);
    const timer = setTimeout(() => void this.dismiss(), Math.max(1_000, this.#options.autoHideMs ?? 15_000));
    const unref = timer as unknown as { unref?: () => void };
    if (typeof unref.unref === "function") unref.unref();
    this.#autoHide = timer;
  }
}
