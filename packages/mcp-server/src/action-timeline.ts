import type { OverlayManager } from "@agenthost/app-overlay";
import { OVERLAY_TIMELINE_MAX_ENTRIES, type OverlayTimelineEntry, type OverlayTimelineState, type OverlayWidget, type OverlayWidgetComponent, type ToolResult } from "@agenthost/core";

/*
 * The dock timeline: a running, newest-first list of what the agent did, so a
 * human glancing at the screen can follow the sequence of actions. Labels are
 * built from a small allowlist of input fields (coordinates, key names, app
 * names, counts) - never typed text, file contents, or full commands.
 */

export interface TimelineAlertState {
  stopped: boolean;
  paused: boolean;
  /** Present while an agent client or AgentHost waits for the user. */
  attention?: { source: string; reason: string };
}

export interface ActionTimelineOptions {
  sessionId: string;
  maxEntries?: number;
  alertPollMs?: number;
  now?: () => number;
  /** Clock label for entries; injectable so tests do not depend on the local timezone. */
  clock?: (epochMs: number) => string;
  readAlerts?: () => Promise<TimelineAlertState>;
}

interface Entry {
  id: number;
  label: string;
  detail?: string;
  state: OverlayTimelineState;
  startedAt: number;
  finishedAt?: number;
}

const HALT_CODES = new Set(["emergency_stop_requested", "human_takeover_active", "pause_requested"]);

function record(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

function text(value: unknown, limit = 60): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, limit) : undefined;
}

function basename(value: unknown): string | undefined {
  const raw = text(value, 400);
  return raw === undefined ? undefined : raw.split("/").filter(Boolean).pop()?.slice(0, 60);
}

function point(input: Record<string, unknown>): string {
  return typeof input.x === "number" && typeof input.y === "number" ? ` (${input.x},${input.y})` : "";
}

function hostOf(url: unknown): string | undefined {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === "file:" ? "local file" : parsed.hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function targetApp(input: Record<string, unknown>): string | undefined {
  const target = record(input.target);
  const active = record(input.activeWindow);
  return text(target.appName, 40) ?? text(active.appName, 40) ?? text(input.appName, 40);
}

/** Short human label for one tool call, built only from non-sensitive fields. */
export function describeAction(tool: string, rawInput: unknown): string {
  const input = record(rawInput);
  const app = targetApp(input);
  const where = app === undefined ? "" : ` · ${app}`;
  switch (tool) {
    case "desktop.click": return `Click${point(input)}${where}`;
    case "desktop.type_text": return `Type ${typeof input.text === "string" ? input.text.length : 0} chars${where}`;
    case "desktop.hotkey": return `Keys ${Array.isArray(input.keys) ? input.keys.map((key) => String(key).slice(0, 20)).join("+").slice(0, 40) : ""}${where}`;
    case "desktop.screenshot": return input.includeActiveWindowOnly === true ? "Screenshot (window)" : "Screenshot";
    case "desktop.pointer": {
      const action = text(input.action, 20) ?? (input.startX !== undefined ? "drag" : input.direction !== undefined ? "scroll" : "move_mouse");
      if (action === "scroll") return `Scroll ${text(input.direction, 10) ?? ""} ×${typeof input.amount === "number" ? input.amount : 3}${point(input)}${where}`;
      return `${action.replace("_", " ").replace(/^./, (first) => first.toUpperCase())}${point(input)}${where}`;
    }
    case "window.focus": return `Focus ${text(record(input.target).appName, 40) ?? text(input.appName, 40) ?? "window"}`;
    case "window.list": return "List windows";
    case "app.open": return `Open app ${text(input.appName, 40) ?? ""}`;
    case "app.open_url": return `Open ${hostOf(input.url) ?? "URL"}${input.browser === undefined ? "" : ` in ${String(input.browser).slice(0, 20)}`}`;
    case "shell.run": return `Run ${basename(input.command)?.split(/\s+/)[0] ?? "command"}`;
    case "file.write": return `Write ${basename(input.path) ?? "file"}`;
    case "file.read": return `Read ${basename(input.path) ?? "file"}`;
    case "file.copy": case "file.move": return `${tool === "file.copy" ? "Copy" : "Move"} ${basename(input.source) ?? "file"}`;
    case "file.delete": return `Delete ${basename(input.path) ?? "file"}`;
    case "computer.wait": return `Wait ${typeof input.ms === "number" ? `${(input.ms / 1000).toFixed(1)}s` : ""}`;
    case "computer.wait_for": return "Wait for screen state";
    case "computer.run_steps": return `Plan · ${Array.isArray(input.steps) ? input.steps.length : 0} steps`;
    case "vision.find_text_on_screen": return "Read screen text";
    case "ui.tree": return `Read UI${app === undefined ? "" : ` of ${app}`}`;
    case "ui.find": return `Find "${text(input.query, 30) ?? ""}"${where}`;
    case "ui.activate": return `Press ${text(input.query, 30) === undefined ? "element" : `"${text(input.query, 30)}"`}${where}`;
    case "ui.set_text": return `Fill ${typeof input.value === "string" ? input.value.length : 0} chars${where}`;
    default: return tool.slice(0, 60);
  }
}

function outcomeState(result: ToolResult): OverlayTimelineState {
  if (result.ok) return "done";
  const code = result.error?.code ?? "";
  if (code === "confirmation_required" || code === "approval_required") return "waiting";
  if (HALT_CODES.has(code)) return "halted";
  return "failed";
}

function defaultClock(epochMs: number): string {
  return new Date(epochMs).toTimeString().slice(0, 8);
}

export class ActionTimeline {
  readonly #manager: OverlayManager;
  readonly #widgetId: string;
  readonly #max: number;
  readonly #now: () => number;
  readonly #clock: (epochMs: number) => string;
  readonly #readAlerts: (() => Promise<TimelineAlertState>) | undefined;
  readonly #entries: Entry[] = [];
  #sequence = 0;
  #started = false;
  #disposed = false;
  #alerts: TimelineAlertState = { stopped: false, paused: false };
  #renderQueue: Promise<void> = Promise.resolve();
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #alertTimer: ReturnType<typeof setInterval> | undefined;

  constructor(manager: OverlayManager, options: ActionTimelineOptions) {
    this.#manager = manager;
    this.#widgetId = `agenthost-timeline-${options.sessionId}`.slice(0, 120);
    this.#max = Math.max(1, Math.min(OVERLAY_TIMELINE_MAX_ENTRIES, options.maxEntries ?? OVERLAY_TIMELINE_MAX_ENTRIES));
    this.#now = options.now ?? Date.now;
    this.#clock = options.clock ?? defaultClock;
    this.#readAlerts = options.readAlerts;
    if (this.#readAlerts !== undefined) {
      this.#alertTimer = setInterval(() => { void this.#refreshAlerts(); }, options.alertPollMs ?? 1_000);
      const timer = this.#alertTimer as unknown as { unref?: () => void };
      timer.unref?.();
    }
  }

  get widgetId(): string { return this.#widgetId; }

  begin(tool: string, input: unknown): (result: ToolResult) => Promise<void> {
    const entry: Entry = { id: ++this.#sequence, label: describeAction(tool, input), state: "running", startedAt: this.#now() };
    this.#entries.unshift(entry);
    this.#entries.length = Math.min(this.#entries.length, this.#max);
    void this.#render();
    return async (result: ToolResult) => {
      entry.state = outcomeState(result);
      entry.finishedAt = this.#now();
      const seconds = (entry.finishedAt - entry.startedAt) / 1000;
      entry.detail = entry.state === "done"
        ? `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`
        : entry.state === "waiting"
          ? "Waiting for your approval"
          : (result.error?.code ?? "failed").slice(0, 60);
      await this.#render();
    };
  }

  entries(): OverlayTimelineEntry[] {
    return this.#entries.map((entry) => ({
      label: entry.label,
      state: entry.state,
      time: this.#clock(entry.startedAt),
      ...(entry.detail === undefined ? {} : { detail: entry.detail })
    }));
  }

  widget(): OverlayWidget {
    const components: OverlayWidgetComponent[] = [];
    const alerts = this.#alerts;
    if (alerts.attention !== undefined) {
      components.push({ type: "status_badge", status: "warning", text: "Waiting for you" });
      components.push({ type: "warning", text: alerts.attention.source === "agenthost" ? "AgentHost needs approval: run agenthost confirmations in the agent terminal." : `${alerts.attention.source} is asking for permission in its terminal.` });
    } else if (alerts.stopped) {
      components.push({ type: "status_badge", status: "danger", text: "Stopped" });
      components.push({ type: "warning", text: "Actions are blocked. Resume from the task card or run: agenthost agent resume --stop" });
    } else if (alerts.paused) {
      components.push({ type: "status_badge", status: "warning", text: "Paused" });
    } else {
      const running = this.#entries.some((entry) => entry.state === "running");
      components.push({ type: "status_badge", status: running ? "info" : "neutral", text: running ? "Working" : "Idle" });
    }
    components.push({ type: "timeline", entries: this.entries() });
    return {
      widgetId: this.#widgetId,
      title: "Agent activity",
      components,
      placement: "top_right",
      style: { semantic: alerts.attention !== undefined || alerts.paused ? "warning" : alerts.stopped ? "danger" : "info", elevation: "low" },
      interaction: { interactive: false, focus: "never", dismissible: false, allowedEvents: [] },
      sensitivity: "public",
      ttlMs: 300_000,
      persistent: true
    };
  }

  async close(): Promise<void> {
    this.#disposed = true;
    if (this.#alertTimer !== undefined) clearInterval(this.#alertTimer);
    if (this.#retryTimer !== undefined) clearTimeout(this.#retryTimer);
    await this.#renderQueue.catch(() => undefined);
  }

  async #refreshAlerts(): Promise<void> {
    if (this.#disposed || this.#readAlerts === undefined) return;
    try {
      const next = await this.#readAlerts();
      if (JSON.stringify(next) === JSON.stringify(this.#alerts)) return;
      this.#alerts = next;
      // Surface stop/approval state even before the first action of a session.
      await this.#render();
    } catch {
      /* Alerts are advisory. */
    }
  }

  async #render(): Promise<void> {
    this.#renderQueue = this.#renderQueue.catch(() => undefined).then(async () => {
      if (this.#disposed) return;
      const widget = this.widget();
      const result = this.#started ? await this.#manager.updateWidget(widget) : await this.#manager.showWidget(widget);
      if (result.ok) {
        this.#started = true;
        return;
      }
      // Rejected while a screenshot holds surfaces suppressed: paint again once it is done.
      if (this.#retryTimer === undefined) {
        this.#retryTimer = setTimeout(() => { this.#retryTimer = undefined; void this.#render(); }, 300);
        const timer = this.#retryTimer as unknown as { unref?: () => void };
        timer.unref?.();
      }
    }).catch(() => undefined);
    await this.#renderQueue;
  }
}
