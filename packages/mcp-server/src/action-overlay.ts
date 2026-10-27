import type { OverlayManager } from "@agenthost/app-overlay";
import type { OverlayPlacement, OverlayWidget, OverlayWidgetComponent, RiskLevel, ToolResult } from "@agenthost/core";

export type ToolActionPhase = "running" | "paused" | "waiting_approval" | "preview" | "done" | "halted" | "error";

export interface ToolActionInput {
  tool: string;
  summary: string;
  riskLevel: RiskLevel;
}

export interface ToolActionStatus {
  started: boolean;
  visible: boolean;
  hidden: boolean;
  error?: string;
}

export interface ToolActionHandle {
  finish(result: ToolResult): Promise<ToolActionStatus>;
}

export interface ToolActionOverlayOptions {
  widgetId?: string;
  placement?: OverlayPlacement;
  persistent?: boolean;
  autoHideMs?: number;
  heartbeatMs?: number;
  eventPollMs?: number;
  showTimeoutMs?: number;
  minDisplayMs?: number;
  now?: () => number;
  onPause?: () => Promise<void> | void;
  onResume?: () => Promise<void> | void;
  onStop?: () => Promise<void> | void;
  isPaused?: () => Promise<boolean> | boolean;
}

interface ActiveAction {
  id: string;
  tool: string;
  summary: string;
  riskLevel: RiskLevel;
  startedAt: number;
}

interface LastAction {
  tool: string;
  summary: string;
  riskLevel: RiskLevel;
  phase: Exclude<ToolActionPhase, "running">;
  errorCode?: string;
  elapsedMs: number;
}

const BADGES: Record<ToolActionPhase, { status: "neutral" | "info" | "success" | "warning" | "danger"; text: string }> = {
  running: { status: "info", text: "Running" },
  paused: { status: "warning", text: "Paused" },
  waiting_approval: { status: "warning", text: "Waiting for approval" },
  preview: { status: "info", text: "Preview ready" },
  done: { status: "success", text: "Done" },
  halted: { status: "warning", text: "Halted" },
  error: { status: "danger", text: "Failed" }
};

const HALT_CODES = new Set(["emergency_stop_requested", "human_takeover_active", "pause_requested", "safety_blocked"]);

function elapsedLabel(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function riskLabel(risk: RiskLevel): string {
  return risk.toUpperCase();
}

function safeToolName(tool: string): string {
  return tool.replace(/[\r\n\t]/g, " ").slice(0, 150);
}

function safeDetail(detail: string | undefined): string | undefined {
  if (detail === undefined) return undefined;
  const normalized = detail.replace(/\s+/g, " ").trim();
  return normalized.length === 0 ? undefined : normalized.slice(0, 300);
}

function settlePhase(result: ToolResult): Exclude<ToolActionPhase, "running"> {
  const code = result.error?.code;
  if (code === "confirmation_required") return "waiting_approval";
  if (code !== undefined && HALT_CODES.has(code)) return "halted";
  if (!result.ok) return "error";
  if (result.preview === true) return "preview";
  return "done";
}

/** One in-place status card for every state-changing AgentHost action.
 * The card is best-effort: renderer failures never change tool outcomes. */
export class ToolActionOverlay {
  readonly #manager: OverlayManager;
  readonly #widgetId: string;
  readonly #placement: OverlayPlacement;
  readonly #persistent: boolean;
  readonly #autoHideMs: number;
  readonly #heartbeatMs: number;
  readonly #eventPollMs: number;
  readonly #showTimeoutMs: number;
  readonly #approvalShowTimeoutMs: number;
  readonly #minDisplayMs: number;
  readonly #now: () => number;
  readonly #onPause: (() => Promise<void> | void) | undefined;
  readonly #onResume: (() => Promise<void> | void) | undefined;
  readonly #onStop: (() => Promise<void> | void) | undefined;
  readonly #isPaused: (() => Promise<boolean> | boolean) | undefined;
  readonly #active = new Map<string, ActiveAction>();
  #last: LastAction | undefined;
  #renderQueue: Promise<void> = Promise.resolve();
  #heartbeat: ReturnType<typeof setInterval> | undefined;
  #eventPoll: ReturnType<typeof setInterval> | undefined;
  #autoHide: ReturnType<typeof setTimeout> | undefined;
  #started = false;
  #visible = false;
  #visibleSince: number | undefined;
  #hiddenByOperator = false;
  #paused = false;
  #stopRequested = false;
  #controlError: string | undefined;
  #lastRenderError: string | undefined;
  #showTimedOut = false;
  #polling = false;
  #disposed = false;
  #sequence = 0;

  constructor(manager: OverlayManager, options: ToolActionOverlayOptions = {}) {
    this.#manager = manager;
    this.#widgetId = options.widgetId ?? "agenthost-action";
    this.#placement = options.placement ?? "top_right";
    this.#persistent = options.persistent ?? true;
    this.#autoHideMs = options.autoHideMs ?? 15_000;
    this.#heartbeatMs = Math.max(250, options.heartbeatMs ?? 1_000);
    this.#eventPollMs = Math.max(100, options.eventPollMs ?? 350);
    this.#showTimeoutMs = Math.max(1, options.showTimeoutMs ?? 150);
    this.#approvalShowTimeoutMs = Math.max(this.#showTimeoutMs, 1_500);
    this.#minDisplayMs = Math.max(0, options.minDisplayMs ?? 400);
    this.#now = options.now ?? (() => Date.now());
    this.#onPause = options.onPause;
    this.#onResume = options.onResume;
    this.#onStop = options.onStop;
    this.#isPaused = options.isPaused;
  }

  async begin(input: ToolActionInput): Promise<ToolActionHandle> {
    if (this.#disposed) return this.#noopHandle();
    this.#hiddenByOperator = false;
    this.#stopRequested = false;
    this.#controlError = undefined;
    this.#clearAutoHide();
    if (this.#isPaused) {
      try { this.#paused = await this.#isPaused(); } catch { /* Keep the last known pause state. */ }
    }
    const action: ActiveAction = {
      id: `action_${++this.#sequence}`,
      tool: safeToolName(input.tool),
      summary: safeDetail(input.summary) ?? "Working",
      riskLevel: input.riskLevel,
      startedAt: this.#now()
    };
    this.#active.set(action.id, action);
    this.#startHeartbeat();
    this.#startEventPoll();
    await this.#renderWithinBudget();

    let settled = false;
    return {
      finish: async (result: ToolResult): Promise<ToolActionStatus> => {
        if (settled) return this.#status();
        settled = true;
        this.#active.delete(action.id);
        if (this.#hiddenByOperator || this.#disposed) return this.#status();
        const phase = settlePhase(result);
        this.#last = {
          tool: action.tool,
          summary: action.summary,
          riskLevel: result.riskLevel,
          phase,
          ...(result.error?.code === undefined ? {} : { errorCode: result.error.code }),
          elapsedMs: Math.max(0, this.#now() - action.startedAt)
        };
        if (this.#active.size === 0) {
          this.#stopHeartbeat();
          const needsOperator = phase === "waiting_approval" || phase === "halted";
          if (!this.#paused && !this.#stopRequested && !needsOperator) this.#scheduleAutoHide();
        } else {
          this.#startHeartbeat();
        }
        const needsOperator = phase === "waiting_approval" || phase === "halted";
        if (!needsOperator && this.#visibleSince !== undefined) {
          const remaining = this.#minDisplayMs - (this.#now() - this.#visibleSince);
          if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, remaining));
        }
        await this.#renderWithinBudget(needsOperator ? this.#approvalShowTimeoutMs : this.#showTimeoutMs);
        return this.#status();
      }
    };
  }

  snapshot(): {
    active: number;
    phase: ToolActionPhase;
    tool?: string;
    title?: string;
    started: boolean;
    visible: boolean;
    hidden: boolean;
    paused: boolean;
    stopRequested: boolean;
    showTimedOut: boolean;
    lastRenderError?: string;
  } {
    const phase = this.#currentPhase();
    const current = this.#currentAction();
    const tool = current?.tool ?? this.#last?.tool;
    return {
      active: this.#active.size,
      phase,
      ...(tool === undefined ? {} : { tool }),
      ...(this.#started ? { title: this.#widget().title } : {}),
      started: this.#started,
      visible: this.#started && this.#visible && !this.#hiddenByOperator && !this.#showTimedOut,
      hidden: this.#hiddenByOperator,
      paused: this.#paused,
      stopRequested: this.#stopRequested,
      showTimedOut: this.#showTimedOut,
      ...(this.#lastRenderError === undefined ? {} : { lastRenderError: this.#lastRenderError })
    };
  }

  #status(): ToolActionStatus {
    const snapshot = this.snapshot();
    if (snapshot.hidden) return { started: snapshot.started, visible: false, hidden: true };
    const error = snapshot.lastRenderError
      ?? (snapshot.showTimedOut ? "overlay_show_timeout" : undefined)
      ?? (snapshot.started && !snapshot.visible ? "overlay_not_visible" : undefined);
    return {
      started: snapshot.started,
      visible: snapshot.visible,
      hidden: false,
      ...(error === undefined ? {} : { error })
    };
  }

  async refresh(): Promise<void> {
    await this.#render();
  }

  async dismiss(): Promise<void> {
    this.#stopHeartbeat();
    this.#stopEventPoll();
    this.#clearAutoHide();
    this.#active.clear();
    this.#last = undefined;
    this.#hiddenByOperator = false;
    this.#stopRequested = false;
    this.#controlError = undefined;
    this.#lastRenderError = undefined;
    this.#showTimedOut = false;
    this.#setVisibility(false);
    if (!this.#started) return;
    this.#started = false;
    try {
      await this.#manager.dismiss(this.#widgetId);
    } catch {
      /* Dismissal is best effort. */
    }
  }

  async close(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    await this.dismiss();
  }

  #noopHandle(): ToolActionHandle {
    return { finish: async (): Promise<ToolActionStatus> => ({ started: false, visible: false, hidden: false }) };
  }

  #currentAction(): ActiveAction | undefined {
    return [...this.#active.values()].sort((a, b) => a.startedAt - b.startedAt).at(-1);
  }

  #currentPhase(): ToolActionPhase {
    if (this.#stopRequested) return "halted";
    if (this.#paused) return "paused";
    if (this.#active.size > 0) return "running";
    return this.#last?.phase ?? "running";
  }

  #detailText(phase: ToolActionPhase, current: ActiveAction | undefined): string {
    const summary = current?.summary ?? this.#last?.summary ?? "Working";
    if (phase === "paused") return `${summary} Paused by the operator. Resume to allow the next state-changing action.`;
    if (phase === "waiting_approval") return `${summary} No action executed. Run "agenthost confirmations" to review and approve.`;
    if (phase === "preview") return `${summary} No action executed.`;
    if (phase === "halted" && this.#stopRequested) return `${summary} Stop requested. The current action may finish, but no new state-changing action will start.`;
    if (phase === "halted") return `${summary} Halted by the operator or safety policy.`;
    if (phase === "error") return `${summary} ${this.#last?.errorCode ?? "Action failed."}`;
    return summary;
  }

  #widget(): OverlayWidget {
    const phase = this.#currentPhase();
    const current = this.#currentAction();
    const badge = BADGES[phase];
    const tool = current?.tool ?? this.#last?.tool ?? "action";
    const risk = current?.riskLevel ?? this.#last?.riskLevel ?? "medium";
    const elapsed = current === undefined
      ? (this.#last?.elapsedMs ?? 0)
      : Math.max(...[...this.#active.values()].map((action) => Math.max(0, this.#now() - action.startedAt)));
    const components: OverlayWidgetComponent[] = [
      { type: "status_badge", status: badge.status, text: badge.text },
      { type: "text", text: this.#detailText(phase, current) }
    ];
    if (phase === "waiting_approval") components.push({ type: "warning", text: "Approval required. Run: agenthost confirmations" });
    if (phase === "paused") components.push({ type: "warning", text: "Paused. Resume here or run: agenthost agent resume --pause" });
    if (phase === "halted" && this.#stopRequested) components.push({ type: "warning", text: "Stop is active. Dismiss this card or run: agenthost agent resume --stop" });
    if (this.#controlError !== undefined) components.push({ type: "warning", text: this.#controlError });
    if (this.#active.size > 1) components.push({ type: "key_value", key: "Actions", value: `${this.#active.size} running` });
    components.push({ type: "key_value", key: "Risk", value: riskLabel(risk) });
    components.push({ type: "key_value", key: "Elapsed", value: elapsedLabel(elapsed) });
    for (const [label, event] of this.#buttons(phase)) components.push({ type: "button", label, event });
    const title = phase === "waiting_approval"
      ? "AgentHost · Approval required"
      : phase === "paused"
        ? "AgentHost · Paused"
        : phase === "halted"
          ? "AgentHost · Halted"
          : this.#active.size > 1
            ? `AgentHost · ${this.#active.size} actions running`
            : `AgentHost · ${tool}`;
    return {
      widgetId: this.#widgetId,
      title,
      components,
      placement: this.#placement,
      style: { semantic: phase === "error" ? "danger" : phase === "waiting_approval" || phase === "paused" || phase === "halted" ? "warning" : "info", elevation: phase === "waiting_approval" ? "high" : "medium" },
      interaction: { interactive: true, focus: "never", dismissible: true, allowedEvents: ["pause", "resume", "emergency_stop_requested", "dismissed"] },
      sensitivity: "public",
      ttlMs: 300_000,
      ...(this.#persistent ? { persistent: true } : {})
    };
  }

  #buttons(phase: ToolActionPhase): Array<[string, "pause" | "resume" | "emergency_stop_requested" | "dismissed"]> {
    if (this.#stopRequested) return [["Dismiss", "dismissed"]];
    if (phase === "paused") return [["Resume", "resume"], ["Stop", "emergency_stop_requested"], ...(this.#active.size === 0 ? [["Dismiss", "dismissed"] as [string, "dismissed"]] : [])];
    if (phase === "running") return [["Pause", "pause"], ["Stop", "emergency_stop_requested"]];
    if (phase === "waiting_approval") return [["Stop", "emergency_stop_requested"], ["Dismiss", "dismissed"]];
    return [["Pause", "pause"], ["Dismiss", "dismissed"]];
  }

  async #renderWithinBudget(timeoutMs = this.#showTimeoutMs): Promise<void> {
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolve();
      }, timeoutMs);
      const unref = timer as unknown as { unref?: () => void };
      if (typeof unref.unref === "function") unref.unref();
    });
    await Promise.race([this.#render(), budget]);
    if (timer !== undefined) clearTimeout(timer);
    if (timedOut) this.#showTimedOut = true;
  }

  async #rendererVisible(): Promise<boolean> {
    try {
      return (await this.#manager.capabilities()).visible === true;
    } catch {
      return false;
    }
  }

  #setVisibility(visible: boolean): void {
    if (visible && !this.#visible) this.#visibleSince = this.#now();
    if (!visible) this.#visibleSince = undefined;
    this.#visible = visible;
  }

  async #render(): Promise<void> {
    this.#renderQueue = this.#renderQueue.catch(() => undefined).then(async () => {
      if (this.#disposed || this.#hiddenByOperator) return;
      const widget = this.#widget();
      try {
        if (!this.#started) {
          const shown = await this.#manager.showWidget(widget);
          if (shown.ok) {
            this.#started = true;
            this.#setVisibility(await this.#rendererVisible());
            this.#lastRenderError = undefined;
            this.#showTimedOut = false;
          } else {
            this.#setVisibility(false);
            this.#lastRenderError = shown.errors[0] ?? "overlay_show_failed";
          }
          return;
        }
        const result = await this.#manager.updateWidget(widget);
        if (!result.ok && result.reason === "overlay_not_found") {
          const shown = await this.#manager.showWidget(widget);
          if (shown.ok) {
            this.#started = true;
            this.#setVisibility(await this.#rendererVisible());
            this.#lastRenderError = undefined;
            this.#showTimedOut = false;
          } else {
            this.#setVisibility(false);
            this.#lastRenderError = shown.errors[0] ?? "overlay_show_failed";
          }
          return;
        }
        if (result.ok) {
          this.#setVisibility(await this.#rendererVisible());
          this.#lastRenderError = undefined;
          this.#showTimedOut = false;
        } else {
          this.#setVisibility(false);
          this.#lastRenderError = result.reason || "overlay_update_failed";
        }
      } catch {
        this.#lastRenderError = "overlay_render_failed";
      }
    });
    await this.#renderQueue;
  }

  async #pollOperatorEvents(): Promise<void> {
    if (this.#disposed || this.#hiddenByOperator || this.#polling) return;
    this.#polling = true;
    try {
      if (this.#isPaused) {
        const paused = await this.#isPaused();
        if (paused !== this.#paused) {
          this.#paused = paused;
          await this.#render();
        }
      }
      const events = await this.#manager.pollEvents(this.#widgetId);
      for (const event of events) {
        if (event.overlayId !== this.#widgetId) continue;
        if (event.event === "hide" || event.event === "dismissed") {
          await this.#hideByOperator();
          return;
        }
        if (event.event === "pause") {
          if (this.#paused) continue;
          this.#paused = true;
          this.#controlError = undefined;
          try { await this.#onPause?.(); } catch {
            this.#paused = false;
            this.#controlError = "Pause request failed. State-changing actions may still run.";
          }
          await this.#render();
          return;
        }
        if (event.event === "resume") {
          if (!this.#paused) continue;
          this.#paused = false;
          this.#controlError = undefined;
          try { await this.#onResume?.(); } catch {
            this.#paused = true;
            this.#controlError = "Resume request failed. The pause may still be active.";
          }
          await this.#render();
          return;
        }
        if (event.event === "emergency_stop_requested" || event.event === "cancel" || event.event === "cancelled") {
          if (this.#stopRequested) continue;
          this.#stopRequested = true;
          this.#controlError = undefined;
          try { await this.#onStop?.(); } catch {
            this.#stopRequested = false;
            this.#controlError = "Stop request failed. State-changing actions may still run.";
          }
          await this.#render();
          return;
        }
      }
    } catch {
      /* Event polling is advisory; the card remains usable. */
    } finally {
      this.#polling = false;
    }
  }

  async #hideByOperator(): Promise<void> {
    this.#hiddenByOperator = true;
    this.#started = false;
    this.#setVisibility(false);
    this.#active.clear();
    this.#last = undefined;
    this.#stopHeartbeat();
    this.#stopEventPoll();
    this.#clearAutoHide();
    try {
      await this.#manager.dismiss(this.#widgetId);
    } catch {
      /* GTK already removed the card locally when close was clicked. */
    }
  }

  #startHeartbeat(): void {
    if (this.#heartbeat !== undefined || this.#disposed) return;
    const interval = setInterval(() => {
      if (this.#disposed || this.#active.size === 0) return;
      void this.#render();
    }, this.#heartbeatMs);
    const unref = interval as unknown as { unref?: () => void };
    if (typeof unref.unref === "function") unref.unref();
    this.#heartbeat = interval;
  }

  #stopHeartbeat(): void {
    if (this.#heartbeat === undefined) return;
    clearInterval(this.#heartbeat);
    this.#heartbeat = undefined;
  }

  #startEventPoll(): void {
    if (this.#eventPoll !== undefined || this.#disposed || this.#hiddenByOperator) return;
    const interval = setInterval(() => void this.#pollOperatorEvents(), this.#eventPollMs);
    const unref = interval as unknown as { unref?: () => void };
    if (typeof unref.unref === "function") unref.unref();
    this.#eventPoll = interval;
  }

  #stopEventPoll(): void {
    if (this.#eventPoll === undefined) return;
    clearInterval(this.#eventPoll);
    this.#eventPoll = undefined;
  }

  #scheduleAutoHide(): void {
    if (this.#persistent || this.#disposed) return;
    this.#clearAutoHide();
    const timer = setTimeout(() => void this.dismiss(), Math.max(1_000, this.#autoHideMs));
    const unref = timer as unknown as { unref?: () => void };
    if (typeof unref.unref === "function") unref.unref();
    this.#autoHide = timer;
  }

  #clearAutoHide(): void {
    if (this.#autoHide === undefined) return;
    clearTimeout(this.#autoHide);
    this.#autoHide = undefined;
  }
}
