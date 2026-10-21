import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { toolFailure, toolSuccess, type ToolResult } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";

interface AgentTask {
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
const updateInput = z.object({ taskId: z.string().trim().min(1).max(200), phase: z.string().trim().min(1).max(200).optional(), currentAction: z.string().trim().min(1).max(500).optional() }).strict();
const eventInput = z.object({ taskId: z.string().trim().min(1).max(200), kind: z.enum(["progress", "observation", "error", "recovery", "verification", "note"]), summary: z.string().trim().min(1).max(1000) }).strict();
const listInput = z.object({}).strict();

const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, ...(required.length > 0 ? { required } : {}), additionalProperties: false });

export function createTaskTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const create: AgentHostToolDefinition<z.infer<typeof createInput>, unknown, AgentHostMcpContext> = {
    name: "task.create", description: "Creates a persistent task with a user goal. Survives tool failure, app restart, and interruption.", riskLevel: "low",
    inputSchema: createInput, mcpInputSchema: schema({ goal: { type: "string", minLength: 1, maxLength: 2000 } }, ["goal"]), inputSummary: "Create task", safety: { actionType: "inspect" },
    async handler(input, context): Promise<ToolResult<unknown>> {
      const now = new Date().toISOString();
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
  const addEvent: AgentHostToolDefinition<z.infer<typeof eventInput>, unknown, AgentHostMcpContext> = {
    name: "task.add_event", description: "Adds an event to the task log.", riskLevel: "low",
    inputSchema: eventInput, mcpInputSchema: schema({ taskId: { type: "string" }, kind: { type: "string", enum: ["progress", "observation", "error", "recovery", "verification", "note"] }, summary: { type: "string" } }, ["taskId", "kind", "summary"]), inputSummary: "Add task event", safety: { actionType: "inspect" },
    async handler(input, context): Promise<ToolResult<unknown>> {
      const task = await load(context.config.agentHostDir, input.taskId);
      if (task === undefined) return toolFailure({ tool: "task.add_event", riskLevel: "low", error: { code: "task_not_found", message: "Task was not found." } });
      log(task, input.kind, input.summary);
      await save(context.config.agentHostDir, task);
      return toolSuccess({ tool: "task.add_event", riskLevel: "low", data: task });
    }
  };
  const list: AgentHostToolDefinition<z.infer<typeof listInput>, unknown, AgentHostMcpContext> = {
    name: "task.list", description: "Lists all tasks.", riskLevel: "observe",
    inputSchema: listInput, mcpInputSchema: schema({}), inputSummary: "List tasks", safety: { actionType: "observe" },
    async handler(_input, context): Promise<ToolResult<unknown>> {
      try {
        const { readdir } = await import("node:fs/promises");
        const files = await readdir(dir(context.config.agentHostDir)).catch(() => []);
        const tasks = await Promise.all(files.filter(f => f.endsWith(".json")).map(async (f) => {
          const task = await load(context.config.agentHostDir, f.slice(0, -5));
          return task ? { taskId: task.taskId, goal: task.goal, status: task.status, phase: task.phase, updatedAt: task.updatedAt } : null;
        }));
        return toolSuccess({ tool: "task.list", riskLevel: "observe", data: { tasks: tasks.filter(Boolean) }, observations: ["Listed tasks."] });
      } catch {
        return toolSuccess({ tool: "task.list", riskLevel: "observe", data: { tasks: [] }, observations: ["No tasks found."] });
      }
    }
  };

  return [create, get, update, addEvent, list];
}