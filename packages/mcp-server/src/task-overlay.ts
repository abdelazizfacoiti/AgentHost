import type { OverlayPlacement, AgentTask, ToolResult } from "@agenthost/core";
import {
  clearActiveTaskApproval,
  clearPause,
  listTasks,
  readRunState,
  requestPause,
  requestStop
} from "@agenthost/core";
import { TaskProgressOverlay, type TaskProgressAction, type TaskProgressStep } from "@agenthost/app-overlay";
import type { OverlayManager } from "@agenthost/app-overlay";

export interface TaskActivityOverlayOptions {
  manager: OverlayManager;
  agentHostDir: string;
  sessionId?: string;
  placement?: OverlayPlacement;
  persistent?: boolean;
  autoHideMs?: number;
  heartbeatMs?: number;
  maxResumeAgeMs?: number;
  now?: () => number;
}

export interface ActivityNote {
  toolName: string;
  summary: string;
  outcome?: "running" | "done" | "failed";
}

const TERMINAL_TASK_STATUSES = new Set<AgentTask["status"]>(["completed", "cancelled"]);
const TERMINAL_CARD_STATUSES = new Set(["done", "error", "stopped"]);

function isAgentTask(value: unknown): value is AgentTask {
  if (value === null || typeof value !== "object") return false;
  const task = value as Partial<AgentTask>;
  return typeof task.taskId === "string"
    && typeof task.goal === "string"
    && (task.status === "active" || task.status === "paused" || task.status === "completed" || task.status === "cancelled")
    && typeof task.phase === "string"
    && typeof task.currentAction === "string"
    && Array.isArray(task.events);
}

function taskSteps(task: AgentTask): TaskProgressStep[] {
  const criteria = task.definitionOfDone ?? [];
  if (criteria.length === 0) return [];
  const verified = new Set(
    task.events
      .filter((event) => event.kind === "verification")
      .map((event) => event.summary.toLowerCase())
  );
  const firstOpen = criteria.findIndex((criterion) => !verified.has(`definition of done met: ${criterion}`.toLowerCase()));
  return criteria.map((criterion, index) => ({
    id: `criterion-${index + 1}`,
    label: criterion,
    state: verified.has(`definition of done met: ${criterion}`.toLowerCase())
      ? "done"
      : index === firstOpen
        ? "active"
        : "pending"
  }));
}

function taskDetail(task: AgentTask): string {
  const parts = [task.phase, task.currentAction].filter((part) => part.length > 0);
  const latest = [...task.events].reverse().find((event) => event.kind === "error" || event.kind === "recovery");
  if (latest !== undefined) parts.push(`${latest.kind}: ${latest.summary}`);
  return parts.join(" · ").slice(0, 300);
}

/** Keeps one persistent public card on screen for the task currently being worked. */
export class TaskActivityOverlay {
  readonly #options: TaskActivityOverlayOptions;
  readonly #manager: OverlayManager;
  #task: AgentTask | undefined;
  #controller: TaskProgressOverlay | undefined;
  #poll: ReturnType<typeof setInterval> | undefined;
  #dismissedTaskId: string | undefined;
  #runningTaskCount = 1;
  #stoppedByOperator = false;
  #pollCount = 0;
  #closed = false;

  constructor(options: TaskActivityOverlayOptions) {
    this.#options = options;
    this.#manager = options.manager;
  }

  async initialize(): Promise<void> {
    if (this.#closed) return;
    try {
      const tasks = await listTasks(this.#options.agentHostDir);
      this.#runningTaskCount = Math.max(1, tasks.filter((task) => !TERMINAL_TASK_STATUSES.has(task.status)).length);
      const current = tasks.find((task) => !TERMINAL_TASK_STATUSES.has(task.status) && this.#isFresh(task));
      if (current !== undefined) await this.#sync(current);
    } catch {
      /* The task card is advisory; startup never depends on it. */
    }
  }

  async noteActivity(note: ActivityNote): Promise<void> {
    if (this.#closed) return;
    const current = this.#task;
    if (current !== undefined && !this.#isImplicitTask(current.taskId)) return;
    const taskId = this.#implicitTaskId();
    if (this.#dismissedTaskId === taskId) return;
    const summary = `${note.summary}${note.outcome === "done" ? " · done" : note.outcome === "failed" ? " · failed" : ""}`.slice(0, 300);
    const now = new Date().toISOString();
    const task: AgentTask = current === undefined
      ? {
          taskId,
          goal: "Computer activity",
          status: "active",
          phase: note.toolName.slice(0, 100),
          currentAction: summary,
          events: [],
          createdAt: now,
          updatedAt: now
        }
      : {
          ...current,
          phase: note.toolName.slice(0, 100),
          currentAction: summary,
          updatedAt: now
        };
    try {
      await this.#sync(task);
    } catch {
      /* Activity feedback is advisory. */
    }
  }

  async observe(toolName: string, result: ToolResult): Promise<void> {
    if (this.#closed || !toolName.startsWith("task.")) return;
    try {
      if (toolName === "task.list") {
        const data = result.data as unknown;
        const tasks = data !== null && typeof data === "object" && Array.isArray((data as { tasks?: unknown }).tasks)
          ? (data as { tasks: AgentTask[] }).tasks
          : [];
        this.#runningTaskCount = Math.max(1, tasks.filter((task) => !TERMINAL_TASK_STATUSES.has(task.status)).length);
        if (this.#task === undefined) {
          const current = tasks.find((task) => !TERMINAL_TASK_STATUSES.has(task.status) && this.#isFresh(task));
          if (current !== undefined) await this.#sync(current);
        } else if (this.#controller !== undefined) {
          await this.#controller.setRunningTaskCount(this.#runningTaskCount);
        }
        return;
      }
      if (!result.ok || !isAgentTask(result.data)) return;
      await this.#refreshRunningCount();
      await this.#sync(result.data);
    } catch {
      /* Task card updates never affect task results. */
    }
  }

  async pollOnce(): Promise<TaskProgressAction[]> {
    if (this.#closed || this.#controller === undefined) return [];
    const actions = await this.#controller.pollEvents().catch(() => [] as TaskProgressAction[]);
    if (actions.includes("dismiss")) {
      this.#dismissedTaskId = this.#task?.taskId;
      this.#controller = undefined;
      this.#stopPolling();
      return actions;
    }
    this.#pollCount += 1;
    if (this.#pollCount % 4 === 0) await this.#syncRunState();
    return actions;
  }

  async operatorStopped(): Promise<void> {
    const controller = this.#controller;
    if (controller === undefined) return;
    this.#stoppedByOperator = true;
    await controller.stopped("Stopped by operator");
  }

  snapshot(): { taskId?: string; status?: string; implicit: boolean; dismissed: boolean } {
    return {
      ...(this.#task === undefined ? {} : { taskId: this.#task.taskId }),
      ...(this.#controller === undefined ? {} : { status: this.#controller.snapshot().status }),
      implicit: this.#task !== undefined && this.#isImplicitTask(this.#task.taskId),
      dismissed: this.#dismissedTaskId !== undefined && this.#dismissedTaskId === this.#task?.taskId
    };
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#stopPolling();
    const controller = this.#controller;
    this.#controller = undefined;
    if (controller !== undefined) await controller.dismiss().catch(() => undefined);
  }

  #implicitTaskId(): string {
    const session = (this.#options.sessionId ?? "default").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
    return `agenthost-activity-${session}`;
  }

  #isImplicitTask(taskId: string): boolean {
    return taskId === this.#implicitTaskId();
  }

  #isFresh(task: AgentTask): boolean {
    const maxAge = this.#options.maxResumeAgeMs ?? 24 * 60 * 60 * 1_000;
    const updatedAt = Date.parse(task.updatedAt);
    return Number.isFinite(updatedAt) && (this.#options.now?.() ?? Date.now()) - updatedAt <= maxAge;
  }

  async #refreshRunningCount(): Promise<void> {
    const tasks = await listTasks(this.#options.agentHostDir);
    this.#runningTaskCount = Math.max(1, tasks.filter((task) => !TERMINAL_TASK_STATUSES.has(task.status)).length);
  }

  async #sync(task: AgentTask): Promise<void> {
    if (this.#closed || this.#dismissedTaskId === task.taskId) return;
    if (this.#task?.taskId !== task.taskId) {
      await this.#replaceTask(task);
      return;
    }
    this.#task = task;
    const controller = this.#controller;
    if (controller === undefined) {
      await this.#createController(task);
      return;
    }
    await controller.setRunningTaskCount(this.#runningTaskCount);
    await controller.setSteps(taskSteps(task));
    await controller.setDetail(taskDetail(task));
    if (task.status === "completed") {
      await controller.complete(taskDetail(task));
      return;
    }
    if (task.status === "cancelled") {
      await controller.stopped(taskDetail(task));
      return;
    }
    if (task.status === "paused") {
      if (controller.snapshot().status !== "paused") await controller.pause();
      return;
    }
    const snapshot = controller.snapshot().status;
    if (snapshot === "paused" || snapshot === "pause_requested" || snapshot === "waiting_approval") {
      const state = await readRunState(this.#options.agentHostDir).catch(() => undefined);
      if (state?.pause.requested !== true && state?.stop.requested !== true) await controller.resume();
    }
  }

  async #replaceTask(task: AgentTask): Promise<void> {
    this.#stopPolling();
    const previous = this.#controller;
    this.#controller = undefined;
    if (previous !== undefined) await previous.dismiss().catch(() => undefined);
    this.#task = task;
    this.#dismissedTaskId = undefined;
    this.#stoppedByOperator = false;
    this.#pollCount = 0;
    await this.#createController(task);
  }

  async #createController(task: AgentTask): Promise<void> {
    const controller = new TaskProgressOverlay({
      manager: this.#manager,
      taskId: task.taskId,
      title: `AgentHost · ${task.goal.slice(0, 150)}`,
      steps: taskSteps(task),
      placement: this.#options.placement ?? "bottom_right",
      persistent: this.#options.persistent ?? true,
      ...(this.#options.autoHideMs === undefined ? {} : { autoHideMs: this.#options.autoHideMs }),
      ...(this.#options.heartbeatMs === undefined ? {} : { heartbeatMs: this.#options.heartbeatMs }),
      runningTaskCount: this.#runningTaskCount,
      onAction: (action) => { void this.#handleAction(action); }
    });
    this.#controller = controller;
    await controller.setDetail(taskDetail(task));
    if (task.status === "completed") await controller.setStatus("done");
    else if (task.status === "cancelled") await controller.setStatus("stopped");
    else if (task.status === "paused") await controller.setStatus("paused");
    if (!(await controller.start())) {
      await controller.dismiss().catch(() => undefined);
      if (this.#controller === controller) this.#controller = undefined;
      return;
    }
    this.#startPolling();
  }

  async #handleAction(action: TaskProgressAction): Promise<void> {
    const task = this.#task;
    const controller = this.#controller;
    if (task === undefined || controller === undefined) return;
    if (action === "pause") {
      try {
        await requestPause(this.#options.agentHostDir, `agent_task_overlay_pause:${task.taskId}`);
        await controller.pause();
      } catch {
        await controller.resume();
      }
      return;
    }
    if (action === "resume") {
      try {
        const state = await readRunState(this.#options.agentHostDir);
        if (state.pause.requested && state.pause.reason !== `agent_task_overlay_pause:${task.taskId}`) {
          await controller.pause();
        } else if (state.pause.requested) {
          await clearPause(this.#options.agentHostDir);
        }
      } catch {
        await controller.pause();
      }
      return;
    }
    if (action === "stop") {
      try {
        await requestStop(this.#options.agentHostDir, `agent_task_overlay_stop:${task.taskId}`);
        await clearActiveTaskApproval(this.#options.agentHostDir);
        this.#stoppedByOperator = true;
        await controller.stopped("Stopped by operator");
      } catch {
        await controller.fail("Stop request failed. State-changing actions may still run.");
      }
      return;
    }
    if (action === "dismiss") {
      this.#dismissedTaskId = task.taskId;
      this.#controller = undefined;
      this.#stopPolling();
    }
  }

  async #syncRunState(): Promise<void> {
    const task = this.#task;
    const controller = this.#controller;
    if (task === undefined || controller === undefined || task.status !== "active") return;
    try {
      const state = await readRunState(this.#options.agentHostDir);
      const cardStatus = controller.snapshot().status;
      if (state.stop.requested) {
        this.#stoppedByOperator = true;
        if (!TERMINAL_CARD_STATUSES.has(cardStatus)) await controller.stopped(state.stop.reason ?? "Stopped by operator");
        return;
      }
      if (this.#stoppedByOperator) {
        this.#stoppedByOperator = false;
        if (cardStatus === "stopped") await controller.resume();
      }
      if (state.pause.requested) {
        if (cardStatus === "running") await controller.pause();
      } else if (cardStatus === "paused" || cardStatus === "pause_requested") {
        await controller.resume();
      }
    } catch {
      /* Run-state mirroring is advisory. */
    }
  }

  #startPolling(): void {
    this.#stopPolling();
    if (this.#closed) return;
    const interval = setInterval(() => { void this.pollOnce(); }, 250);
    const unref = interval as unknown as { unref?: () => void };
    if (typeof unref.unref === "function") unref.unref();
    this.#poll = interval;
  }

  #stopPolling(): void {
    if (this.#poll === undefined) return;
    clearInterval(this.#poll);
    this.#poll = undefined;
  }
}
