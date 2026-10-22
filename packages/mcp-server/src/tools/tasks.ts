import { appendTaskEvent, createTask, listTasks, loadTask, TaskError, transitionTask, updateTask, type AgentTask } from "@agenthost/core";
import { toolFailure, toolSuccess, type ToolResult } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";

const createInput = z.object({ goal: z.string().trim().min(1).max(2000) }).strict();
const idInput = z.object({ taskId: z.string().trim().min(1).max(200) }).strict();
const updateInput = z.object({
  taskId: z.string().trim().min(1).max(200),
  phase: z.string().trim().min(1).max(200).optional(),
  currentAction: z.string().trim().min(1).max(500).optional()
}).strict();
const statusInput = z.object({
  taskId: z.string().trim().min(1).max(200),
  status: z.enum(["active", "paused", "completed", "cancelled"])
}).strict();
const eventInput = z.object({
  taskId: z.string().trim().min(1).max(200),
  kind: z.enum(["progress", "observation", "error", "recovery", "verification", "note"]),
  summary: z.string().trim().min(1).max(1000)
}).strict();
const listInput = z.object({}).strict();

const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, ...(required.length > 0 ? { required } : {}), additionalProperties: false });

function taskFailure(tool: string, error: unknown): ToolResult<never> {
  if (error instanceof TaskError) {
    return toolFailure({ tool, riskLevel: "low", error: { code: error.code, message: error.message }, observations: ["No task state was changed."] });
  }
  return toolFailure({ tool, riskLevel: "low", error: { code: "task_store_failed", message: "Task state could not be updated." } });
}

function taskNotFound(tool: string): ToolResult<never> {
  return toolFailure({ tool, riskLevel: "low", error: { code: "task_not_found", message: "Task was not found." } });
}

export function createTaskTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const create: AgentHostToolDefinition<z.infer<typeof createInput>, AgentTask, AgentHostMcpContext> = {
    name: "task.create",
    description: "Creates a persistent task with a user goal. Starting a new task clears any active task approval.",
    riskLevel: "low",
    inputSchema: createInput,
    mcpInputSchema: schema({ goal: { type: "string", minLength: 1, maxLength: 2000 } }, ["goal"]),
    inputSummary: "Create task",
    safety: { actionType: "inspect" },
    async handler(input, context): Promise<ToolResult<AgentTask>> {
      try {
        const task = await createTask(context.config.agentHostDir, input.goal);
        return toolSuccess({ tool: "task.create", riskLevel: "low", data: task, observations: ["Plan, inspect, act, observe, verify; log recovery events as you go."] });
      } catch (error) {
        return taskFailure("task.create", error);
      }
    }
  };

  const get: AgentHostToolDefinition<z.infer<typeof idInput>, AgentTask, AgentHostMcpContext> = {
    name: "task.status",
    description: "Returns task state: goal, status, phase, current action, and recent events.",
    riskLevel: "observe",
    inputSchema: idInput,
    mcpInputSchema: schema({ taskId: { type: "string" } }, ["taskId"]),
    inputSummary: "Task status",
    safety: { actionType: "observe" },
    async handler(input, context): Promise<ToolResult<AgentTask>> {
      try {
        const task = await loadTask(context.config.agentHostDir, input.taskId);
        return task === undefined
          ? taskNotFound("task.status")
          : toolSuccess({ tool: "task.status", riskLevel: "observe", data: task });
      } catch (error) {
        return taskFailure("task.status", error);
      }
    }
  };

  const update: AgentHostToolDefinition<z.infer<typeof updateInput>, AgentTask, AgentHostMcpContext> = {
    name: "task.update",
    description: "Updates an active task's phase and current action.",
    riskLevel: "low",
    inputSchema: updateInput,
    mcpInputSchema: schema({ taskId: { type: "string" }, phase: { type: "string" }, currentAction: { type: "string" } }, ["taskId"]),
    inputSummary: "Update task",
    safety: { actionType: "inspect" },
    async handler(input, context): Promise<ToolResult<AgentTask>> {
      try {
        const task = await updateTask(context.config.agentHostDir, input.taskId, {
          ...(input.phase === undefined ? {} : { phase: input.phase }),
          ...(input.currentAction === undefined ? {} : { currentAction: input.currentAction })
        });
        return toolSuccess({ tool: "task.update", riskLevel: "low", data: task });
      } catch (error) {
        return taskFailure("task.update", error);
      }
    }
  };

  const setStatus: AgentHostToolDefinition<z.infer<typeof statusInput>, AgentTask, AgentHostMcpContext> = {
    name: "task.update_status",
    description: "Pauses, resumes, completes, or cancels a task. Terminal tasks cannot change state.",
    riskLevel: "low",
    inputSchema: statusInput,
    mcpInputSchema: schema({ taskId: { type: "string" }, status: { type: "string", enum: ["active", "paused", "completed", "cancelled"] } }, ["taskId", "status"]),
    inputSummary: "Update task status",
    safety: { actionType: "inspect" },
    async handler(input, context): Promise<ToolResult<AgentTask>> {
      try {
        const task = await transitionTask(context.config.agentHostDir, input.taskId, input.status);
        return toolSuccess({ tool: "task.update_status", riskLevel: "low", data: task });
      } catch (error) {
        return taskFailure("task.update_status", error);
      }
    }
  };

  const addEvent: AgentHostToolDefinition<z.infer<typeof eventInput>, AgentTask, AgentHostMcpContext> = {
    name: "task.add_event",
    description: "Adds a progress, observation, error, recovery, verification, or note event to a task log.",
    riskLevel: "low",
    inputSchema: eventInput,
    mcpInputSchema: schema({ taskId: { type: "string" }, kind: { type: "string", enum: ["progress", "observation", "error", "recovery", "verification", "note"] }, summary: { type: "string" } }, ["taskId", "kind", "summary"]),
    inputSummary: "Add task event",
    safety: { actionType: "inspect" },
    async handler(input, context): Promise<ToolResult<AgentTask>> {
      try {
        const task = await appendTaskEvent(context.config.agentHostDir, input.taskId, input.kind, input.summary);
        return toolSuccess({ tool: "task.add_event", riskLevel: "low", data: task });
      } catch (error) {
        return taskFailure("task.add_event", error);
      }
    }
  };

  const list: AgentHostToolDefinition<z.infer<typeof listInput>, { tasks: AgentTask[] }, AgentHostMcpContext> = {
    name: "task.list",
    description: "Lists persistent tasks, most recently updated first.",
    riskLevel: "observe",
    inputSchema: listInput,
    mcpInputSchema: schema({}),
    inputSummary: "List tasks",
    safety: { actionType: "observe" },
    async handler(_input, context): Promise<ToolResult<{ tasks: AgentTask[] }>> {
      try {
        const tasks = await listTasks(context.config.agentHostDir);
        return toolSuccess({ tool: "task.list", riskLevel: "observe", data: { tasks }, observations: [tasks.length === 0 ? "No tasks found." : `Found ${tasks.length} task(s).`] });
      } catch (error) {
        return taskFailure("task.list", error);
      }
    }
  };

  return [create, get, update, setStatus, addEvent, list];
}
