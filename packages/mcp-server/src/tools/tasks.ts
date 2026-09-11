import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { evaluateSafety, toolFailure, toolSuccess, type ToolResult } from "@agenthost/core";
import { clearTaskApproval } from "../task-approval.js";
import { createSafetyEvaluationContext } from "../grants.js";
import { isStopRequested, isTakeoverActive } from "../stop-flag.js";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import { runTool, type AgentHostToolDefinition, type AnyAgentHostToolDefinition } from "../tool-runner.js";
import { acceptedConfirmation, buildPreviewResult, confirmationRequired, missingConfirmationReason, rejectedConfirmation } from "./preview.js";

/** Persistent long-running task state: goal, completed work, remaining work, failures, resumability. */
export interface AgentTask {
  taskId: string;
  goal: string;
  status: "active" | "paused" | "completed" | "cancelled";
  phase: string;
  currentAction: string;
  events: Array<{ at: string; kind: string; summary: string }>;
  createdAt: string;
  updatedAt: string;
}

function dir(agentHostDir: string): string {
  return path.join(agentHostDir, "tasks");
}

function file(agentHostDir: string, taskId: string): string {
  return path.join(dir(agentHostDir), `${taskId}.json`);
}

async function load(agentHostDir: string, taskId: string): Promise<AgentTask | undefined> {
  try {
    return JSON.parse(await readFile(file(agentHostDir, taskId), "utf8")) as AgentTask;
  } catch {
    return undefined;
  }
}

async function save(agentHostDir: string, task: AgentTask): Promise<void> {
  await mkdir(dir(agentHostDir), { recursive: true, mode: 0o700 });
  const temp = `${file(agentHostDir, task.taskId)}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(task, null, 2)}\n`, { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, file(agentHostDir, task.taskId));
  await chmod(file(agentHostDir, task.taskId), 0o600);
}

function log(task: AgentTask, kind: string, summary: string): void {
  task.events.push({ at: new Date().toISOString(), kind, summary: summary.slice(0, 500) });
  task.events = task.events.slice(-200);
  task.updatedAt = new Date().toISOString();
}

const createInput = z.object({ goal: z.string().trim().min(1).max(2000) }).strict();
const idInput = z.object({ taskId: z.string().trim().min(1).max(200) }).strict();
const MAX_PLAN_STEPS = 10;
const MAX_PLAN_BYTES = 8192;
const planStepInput = z.object({ tool: z.string().trim().min(1).max(200), input: z.unknown().optional() }).strict();
const planInput = z.object({ taskId: z.string().trim().min(1).max(200), steps: z.array(planStepInput).min(1).max(MAX_PLAN_STEPS), dryRun: z.boolean().optional(), confirmationToken: z.string().trim().min(1).max(500).optional() }).strict();
const updateInput = z.object({ taskId: z.string().trim().min(1).max(200), phase: z.string().trim().min(1).max(200).optional(), currentAction: z.string().trim().min(1).max(500).optional() }).strict();
const eventInput = z.object({ taskId: z.string().trim().min(1).max(200), kind: z.enum(["progress", "observation", "error", "recovery", "verification", "note"]), summary: z.string().trim().min(1).max(1000) }).strict();
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, ...(required.length > 0 ? { required } : {}), additionalProperties: false });

export function createTaskTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const create: AgentHostToolDefinition<z.infer<typeof createInput>, unknown, AgentHostMcpContext> = {
    name: "task.create", description: "Creates a persistent task with a user goal. Survives tool failure, app restart, and interruption.", riskLevel: "low",
    inputSchema: createInput, mcpInputSchema: schema({ goal: { type: "string", minLength: 1, maxLength: 2000 } }, ["goal"]), inputSummary: "Create task", safety: { actionType: "inspect" },
    async handler(input, context): Promise<ToolResult<unknown>> {
      const now = new Date().toISOString();
      await clearTaskApproval(context.config.agentHostDir).catch(() => undefined);
      const task: AgentTask = { taskId: `task_${randomUUID()}`, goal: input.goal, status: "active", phase: "understand", currentAction: "inspect environment", events: [], createdAt: now, updatedAt: now };
      log(task, "note", `Task created: ${input.goal.slice(0, 200)}`);
      await save(context.config.agentHostDir, task);
      return toolSuccess({ tool: "task.create", riskLevel: "low", data: task, observations: ["Plan, inspect, act, observe, verify; log recovery events as you go."] });
    }
  };
  const get: AgentHostToolDefinition<z.infer<typeof idInput>, unknown, AgentHostMcpContext> = {
    name: "task.status", description: "Returns task state: goal, completed work, remaining work, failures, current computer state summary.", riskLevel: "observe",
    inputSchema: idInput, mcpInputSchema: schema({ taskId: { type: "string" } }, ["taskId"]), inputSummary: "Task status", safety: { actionType: "observe" },
    async handler(input, context): Promise<ToolResult<unknown>> {
      const task = await load(context.config.agentHostDir, input.taskId);
      if (task === undefined) return toolFailure({ tool: "task.status", riskLevel: "low", error: { code: "task_not_found", message: "Task was not found." } });
      return toolSuccess({ tool: "task.status", riskLevel: "observe", data: task });
    }
  };
  const update: AgentHostToolDefinition<z.infer<typeof updateInput>, unknown, AgentHostMcpContext> = {
    name: "task.update", description: "Updates task phase and current action.", riskLevel: "low",
    inputSchema: updateInput, mcpInputSchema: schema({ taskId: { type: "string" }, phase: { type: "string" }, currentAction: { type: "string" } }, ["taskId"]), inputSummary: "Update task", safety: { actionType: "inspect" },
    async handler(input, context): Promise<ToolResult<unknown>> {
      const task = await load(context.config.agentHostDir, input.taskId);
      if (task === undefined) return toolFailure({ tool: "task.update", riskLevel: "low", error: { code: "task_not_found", message: "Task was not found." } });
      if (input.phase !== undefined) task.phase = input.phase;
      if (input.currentAction !== undefined) task.currentAction = input.currentAction;
      log(task, "progress", `Phase: ${task.phase}; action: ${task.currentAction}`);
      await save(context.config.agentHostDir, task);
      return toolSuccess({ tool: "task.update", riskLevel: "low", data: task });
    }
  };
  const logEvent: AgentHostToolDefinition<z.infer<typeof eventInput>, unknown, AgentHostMcpContext> = {
    name: "task.log_event", description: "Appends a bounded progress/observation/error/recovery/verification event to the task history.", riskLevel: "low",
    inputSchema: eventInput, mcpInputSchema: schema({ taskId: { type: "string" }, kind: { type: "string" }, summary: { type: "string" } }, ["taskId", "kind", "summary"]), inputSummary: "Log task event", safety: { actionType: "inspect" },
    async handler(input, context): Promise<ToolResult<unknown>> {
      const task = await load(context.config.agentHostDir, input.taskId);
      if (task === undefined) return toolFailure({ tool: "task.log_event", riskLevel: "low", error: { code: "task_not_found", message: "Task was not found." } });
      log(task, input.kind, input.summary);
      await save(context.config.agentHostDir, task);
      return toolSuccess({ tool: "task.log_event", riskLevel: "low", data: { taskId: task.taskId, eventCount: task.events.length } });
    }
  };
  const pause: AgentHostToolDefinition<z.infer<typeof idInput>, unknown, AgentHostMcpContext> = {
    name: "task.pause", description: "Pauses a task without losing state.", riskLevel: "low",
    inputSchema: idInput, mcpInputSchema: schema({ taskId: { type: "string" } }, ["taskId"]), inputSummary: "Pause task", safety: { actionType: "inspect" },
    async handler(input, context): Promise<ToolResult<unknown>> {
      const task = await load(context.config.agentHostDir, input.taskId);
      if (task === undefined) return toolFailure({ tool: "task.pause", riskLevel: "low", error: { code: "task_not_found", message: "Task was not found." } });
      task.status = "paused";
      log(task, "note", "Task paused by operator or agent.");
      await save(context.config.agentHostDir, task);
      return toolSuccess({ tool: "task.pause", riskLevel: "low", data: task });
    }
  };
  const resume: AgentHostToolDefinition<z.infer<typeof idInput>, unknown, AgentHostMcpContext> = {
    name: "task.resume", description: "Resumes a paused task. Re-observe the computer before continuing.", riskLevel: "low",
    inputSchema: idInput, mcpInputSchema: schema({ taskId: { type: "string" } }, ["taskId"]), inputSummary: "Resume task", safety: { actionType: "inspect" },
    async handler(input, context): Promise<ToolResult<unknown>> {
      const task = await load(context.config.agentHostDir, input.taskId);
      if (task === undefined) return toolFailure({ tool: "task.resume", riskLevel: "low", error: { code: "task_not_found", message: "Task was not found." } });
      task.status = "active";
      log(task, "note", "Task resumed; re-observing environment before continuing.");
      await save(context.config.agentHostDir, task);
      return toolSuccess({ tool: "task.resume", riskLevel: "low", data: task, observations: ["Re-observe with computer.observe_state before continuing."] });
    }
  };
  const complete: AgentHostToolDefinition<z.infer<typeof idInput>, unknown, AgentHostMcpContext> = {
    name: "task.complete", description: "Marks a task complete after verifying the outcome.", riskLevel: "low",
    inputSchema: idInput, mcpInputSchema: schema({ taskId: { type: "string" } }, ["taskId"]), inputSummary: "Complete task", safety: { actionType: "inspect" },
    async handler(input, context): Promise<ToolResult<unknown>> {
      const task = await load(context.config.agentHostDir, input.taskId);
      if (task === undefined) return toolFailure({ tool: "task.complete", riskLevel: "low", error: { code: "task_not_found", message: "Task was not found." } });
      task.status = "completed";
      log(task, "verification", "Task marked complete after outcome verification.");
      await save(context.config.agentHostDir, task);
      await context.runtimeActivityOverlay?.hideNow().catch(() => undefined);
      return toolSuccess({ tool: "task.complete", riskLevel: "low", data: task, observations: ["Working widget hidden; overlays expire on their TTL."] });
    }
  };
  const executePlan: AgentHostToolDefinition<z.infer<typeof planInput>, unknown, AgentHostMcpContext> = {
    name: "task.execute_plan", description: "Executes a bounded sequence of tools against one active task with stop-gate checks, per-step task logging, and fail-fast recovery guidance. Each step still passes the full safety/confirmation pipeline; mint each step's token with dry-runs first. Never nests task.execute_plan.", riskLevel: "medium",
    inputSchema: planInput, mcpInputSchema: schema({ taskId: { type: "string" }, steps: { type: "array", items: { type: "object" }, minItems: 1, maxItems: MAX_PLAN_STEPS }, dryRun: { type: "boolean" }, confirmationToken: { type: "string" } }, ["taskId", "steps"]), inputSummary: "Execute task plan", auditInputSummary: (input) => `Execute plan with ${input.steps.length} steps for ${input.taskId}`, safety: { actionType: "inspect" },
    preview: { isDryRun: (input) => input.dryRun === true },
    async handler(input, context, runtime): Promise<ToolResult<unknown>> {
      const task = await load(context.config.agentHostDir, input.taskId);
      if (task === undefined) return toolFailure({ tool: "task.execute_plan", riskLevel: "low", error: { code: "task_not_found", message: "Task was not found." } });
      const problems: string[] = [];
      if (task.status !== "active") problems.push(`task_not_active:Task status is ${task.status}; resume it before executing a plan.`);
      if (JSON.stringify(input.steps).length > MAX_PLAN_BYTES) problems.push("plan_too_large:Plan inputs exceed the bounded size; split into smaller plans.");
      const unknownTools = [...new Set(input.steps.map((step) => step.tool).filter((name) => name === "task.execute_plan" || context.tools?.get(name) === undefined))];
      if (unknownTools.length > 0) problems.push(`unknown_tools:${unknownTools.join(",")}`);
      const safety = evaluateSafety({ tool: "task.execute_plan", actionType: "inspect" }, context.policy, createSafetyEvaluationContext(context));
      const target = { taskId: task.taskId, stepCount: input.steps.length };
      if (runtime?.isDryRun) {
        return buildPreviewResult({
          tool: "task.execute_plan", riskLevel: safety.riskLevel, safety,
          targetSummary: `Execute ${input.steps.length} plan steps for ${task.taskId}`,
          wouldExecute: safety.allowed && problems.length === 0,
          effectFingerprint: runtime?.effectFingerprint,
          confirmation: { manager: context.confirmations, sessionId: context.sessionId, input, target, explanation: "Use this token to execute the exact previewed plan steps in order.", riskLevel: safety.riskLevel, appSensitivity: safety.appSensitivity },
          reasons: problems.length > 0 ? problems : undefined,
          observations: ["Plan validated without executing any step."]
        });
      }
      if (problems.length > 0) return toolFailure({ tool: "task.execute_plan", riskLevel: "low", error: { code: "plan_invalid", message: problems.join(" ") } });
      if (!safety.allowed) return toolFailure({ tool: "task.execute_plan", riskLevel: safety.riskLevel, error: { code: "safety_blocked", message: "Plan execution is blocked by policy." }, observations: safety.reasons });
      if (input.confirmationToken === undefined) {
        const missing = missingConfirmationReason(safety);
        return toolFailure({ tool: "task.execute_plan", riskLevel: safety.riskLevel, confirmation: confirmationRequired(missing.reason), error: { code: missing.code, message: missing.reason } });
      }
      const verification = context.confirmations.verifyAndConsume(input.confirmationToken, { sessionId: context.sessionId, tool: "task.execute_plan", input, target, riskLevel: safety.riskLevel });
      if (!verification.ok) return toolFailure({ tool: "task.execute_plan", riskLevel: safety.riskLevel, confirmation: rejectedConfirmation(verification.tokenId, verification.reason), error: { code: "confirmation_rejected", message: verification.reason } });
      const summarize = () => steps.map((step) => `${step.tool}:${step.ok ? "ok" : step.errorCode ?? "failed"}`).join(", ");
      const done = (ok: boolean, data: unknown, extra: { error?: { code: string; message: string }; observations: string[] }): ToolResult<unknown> => ok
        ? toolSuccess({ tool: "task.execute_plan", riskLevel: safety.riskLevel, confirmation: acceptedConfirmation(verification.tokenId, true, "Plan token accepted and steps executed."), data, observations: extra.observations })
        : toolFailure({ tool: "task.execute_plan", riskLevel: safety.riskLevel, confirmation: acceptedConfirmation(verification.tokenId, true, "Plan token accepted; execution halted."), error: extra.error!, observations: [...extra.observations, `Steps (${steps.length}/${input.steps.length} attempted): ${summarize()}`] });
      const steps: Array<{ tool: string; ok: boolean; preview?: boolean; errorCode?: string }> = [];
      for (let index = 0; index < input.steps.length; index += 1) {
        const step = input.steps[index]!;
        if (await isStopRequested(context.config.agentHostDir)) {
          log(task, "error", "Operator stop requested; plan halted.");
          await save(context.config.agentHostDir, task);
          return done(false, { taskId: task.taskId, completed: steps.length, total: input.steps.length, steps }, { error: { code: "operator_stopped", message: `Stop was requested after ${steps.length}/${input.steps.length} steps; resume the task to continue.` }, observations: ["Stop gate checked before every step."] });
        }
        if (await isTakeoverActive(context.config.agentHostDir)) {
          log(task, "error", "Human takeover active; plan halted.");
          await save(context.config.agentHostDir, task);
          return done(false, { taskId: task.taskId, completed: steps.length, total: input.steps.length, steps }, { error: { code: "human_takeover_active", message: `Human takeover is active after ${steps.length}/${input.steps.length} steps; plan halted.` }, observations: ["Takeover gate checked before every step."] });
        }
        const definition = context.tools!.get(step.tool)!;
        task.currentAction = step.tool;
        let result: ToolResult<unknown>;
        try {
          result = await runTool(definition, (step.input ?? {}) as never, context);
        } catch (error) {
          result = toolFailure({ tool: step.tool, riskLevel: "low", error: { code: "plan_step_crashed", message: error instanceof Error ? error.message : "Step crashed." } });
        }
        log(task, result.ok ? "progress" : "error", `${step.tool}: ${result.ok ? "ok" : result.error?.code ?? "failed"}`);
        steps.push({ tool: step.tool, ok: result.ok, ...(result.preview === true ? { preview: true } : {}), ...(result.error?.code === undefined ? {} : { errorCode: result.error.code }) });
        await save(context.config.agentHostDir, task);
        if (!result.ok) {
          return done(false, { taskId: task.taskId, completed: steps.length - 1, total: input.steps.length, steps }, { error: { code: result.error?.code ?? "plan_step_failed", message: `Step ${steps.length}/${input.steps.length} (${step.tool}) failed; the task event log has details.` }, observations: ["Plan halted at the first failure; dry-run the failing step and re-run the remaining steps as a new plan."] });
        }
      }
      return done(true, { taskId: task.taskId, completed: steps.length, total: input.steps.length, steps }, { observations: ["All plan steps completed; verify the outcome before task.complete."] });
    }
  };
  return [create, get, update, logEvent, pause, resume, complete, executePlan];
}
