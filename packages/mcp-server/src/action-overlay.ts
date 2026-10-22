import type { OverlayManager } from "@agenthost/app-overlay";
import type { OverlayPlacement, OverlayWidget, OverlayWidgetComponent, RiskLevel, ToolResult } from "@agenthost/core";

export type ToolActionPhase = "running" | "waiting_approval" | "preview" | "done" | "halted" | "error";

export interface ToolActionInput {
  tool: string;
  summary: string;
  riskLevel: RiskLevel;
}

export interface ToolActionHandle {
  finish(result: ToolResult): Promise<void>;
}

export interface ToolActionOverlayOptions {
  widgetId?: string;
  placement?: OverlayPlacement;
  persistent?: boolean;
  autoHideMs?: number;
  heartbeatMs?: number;
  now?: () => number;
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
  waiting_approval: { status: "warning", text: "Waiting for approval" },
  preview: { status: "info", text: "Preview ready" },
  done: { status: "success", text: "Done" },
  halted: { status: "warning", text: "Halted" },
  error: { status: "danger", text: "Failed" }
};

const HALT_CODES = new Set(["emergency_stop_requested", "human_takeover_active", "safety_blocked"]);

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
  readonly #now: () => number;
  readonly #active = new Map<string, ActiveAction>();
  #last: LastAction | undefined;
  #renderQueue: Promise<void> = Promise.resolve();
  #heartbeat: ReturnType<typeof setInterval> | undefined;
  #autoHide: ReturnType<typeof setTimeout> | undefined;
  #started = false;
  #hiddenByOperator = false;
  #disposed = false;
  #sequence = 0;

  constructor(manager: OverlayManager, options: ToolActionOverlayOptions = {}) {
    this.#manager = manager;
    this.#widgetId = options.widgetId ?? "agenthost-action";
    this.#placement = options.placement ?? "top_right";
    this.#persistent = options.persistent ?? true;
    this.#autoHideMs = options.autoHideMs ?? 15_000;
    this.#heartbeatMs = Math.max(250, options.heartbeatMs ?? 1_000);
    this.#now = options.now ?? (() => Date.now());
  }

  async begin(input: ToolActionInput): Promise<ToolActionHandle> {
    if (this.#disposed) return this.#noopHandle();
    this.#hiddenByOperator = false;
    this.#clearAutoHide();
    const action: ActiveAction = {
      id: `action_${++this.#sequence}`,
      tool: safeToolName(input.tool),
      summary: safeDetail(input.summary) ?? "Working",
      riskLevel: input.riskLevel,
      startedAt: this.#now()
    };
    this.#active.set(action.id, action);
    this.#startHeartbeat();
    await this.#render();

    let settled = false;
    return {
      finish: async (result: ToolResult): Promise<void> => {
        if (settled) return;
        settled = true;
        this.#active.delete(action.id);
        if (this.#hiddenByOperator || this.#disposed) return;
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
          this.#scheduleAutoHide();
        } else {
          this.#startHeartbeat();
        }
        await this.#render();
      }
    };
  }

  snapshot(): { active: number; phase: ToolActionPhase; tool?: string; title?: string; started: boolean; hidden: boolean } {
    const phase = this.#currentPhase();
    const current = this.#currentAction();
    const tool = current?.tool ?? this.#last?.tool;
    return {
      active: this.#active.size,
      phase,
      ...(tool === undefined ? {} : { tool }),
      ...(this.#started ? { title: this.#widget().title } : {}),
      started: this.#started,
      hidden: this.#hiddenByOperator
    };
  }

  async refresh(): Promise<void> {
    await this.#render();
  }

  async dismiss(): Promise<void> {
    this.#stopHeartbeat();
    this.#clearAutoHide();
    this.#active.clear();
    this.#last = undefined;
    this.#hiddenByOperator = false;
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
    return { finish: async (): Promise<void> => undefined };
  }

  #currentAction(): ActiveAction | undefined {
    return [...this.#active.values()].sort((a, b) => a.startedAt - b.startedAt).at(-1);
  }

  #currentPhase(): ToolActionPhase {
    if (this.#active.size > 0) return "running";
    return this.#last?.phase ?? "running";
  }

  #detailText(phase: ToolActionPhase, current: ActiveAction | undefined): string {
    const summary = current?.summary ?? this.#last?.summary ?? "Working";
    if (phase === "waiting_approval") return `${summary} No action executed; review with "agenthost confirmations".`;
    if (phase === "preview") return `${summary} No action executed.`;
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
    if (this.#active.size > 1) components.push({ type: "key_value", key: "Actions", value: `${this.#active.size} running` });
    components.push({ type: "key_value", key: "Risk", value: riskLabel(risk) });
    components.push({ type: "key_value", key: "Elapsed", value: elapsedLabel(elapsed) });
    return {
      widgetId: this.#widgetId,
      title: this.#active.size > 1 ? `AgentHost · ${this.#active.size} actions running` : `AgentHost · ${tool}`,
      components,
      placement: this.#placement,
      sensitivity: "public",
      ttlMs: 300_000,
      ...(this.#persistent ? { persistent: true } : {})
    };
  }

  async #render(): Promise<void> {
    this.#renderQueue = this.#renderQueue.catch(() => undefined).then(async () => {
      if (this.#disposed || this.#hiddenByOperator) return;
      if (this.#active.size > 0) {
        const hidden = await this.#operatorHidden();
        if (hidden) return;
      }
      const widget = this.#widget();
      try {
        if (!this.#started) {
          const shown = await this.#manager.showWidget(widget);
          if (shown.ok) this.#started = true;
          return;
        }
        const result = await this.#manager.updateWidget(widget);
        if (!result.ok && result.reason === "overlay_not_found") {
          const shown = await this.#manager.showWidget(widget);
          if (shown.ok) this.#started = true;
        }
      } catch {
        /* Overlay rendering is advisory; tool execution continues. */
      }
    });
    await this.#renderQueue;
  }

  async #operatorHidden(): Promise<boolean> {
    try {
      const events = await this.#manager.pollEvents();
      if (!events.some((event) => event.overlayId === this.#widgetId && (event.event === "hide" || event.event === "dismissed"))) return false;
    } catch {
      return false;
    }
    this.#hiddenByOperator = true;
    this.#started = false;
    this.#active.clear();
    this.#last = undefined;
    this.#stopHeartbeat();
    this.#clearAutoHide();
    return true;
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
