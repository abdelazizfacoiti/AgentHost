import { appendTaskEvent, createTask, listTasks, loadTask, TaskError, transitionTask, updateTask, type AgentTask } from "@agenthost/core";
import { toolFailure, toolSuccess, type ToolResult } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";

const createInput = z.object({
  goal: z.string().trim().min(1).max(2000),
  definitionOfDone: z.array(z.string().trim().min(1).max(300)).max(12).optional()
}).strict();
const idInput = z.object({ taskId: z.string().trim().min(1).max(200) }).strict();
const updateInput = z.object({
  taskId: z.string().trim().min(1).max(200),
  phase: z.string().trim().min(1).max(200).optional(),
  currentAction: z.string().trim().min(1).max(500).optional()
}).strict();
const statusInput = z.object({
  taskId: z.string().trim().min(1).max(200),
  status: z.enum(["active", "paused", "completed", "cancelled"]),
  verifiedCriteria: z.array(z.string().trim().min(1).max(300)).max(12).optional()
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
    description: "Creates a persistent task with a user goal and observable definition-of-done criteria. Starting a new task clears any active task approval.",
    riskLevel: "low",
    inputSchema: createInput,
    mcpInputSchema: schema({
      goal: { type: "string", minLength: 1, maxLength: 2000 },
      definitionOfDone: { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 300 } }
    }, ["goal"]),
    inputSummary: "Create task",
    safety: { actionType: "inspect" },
    async handler(input, context): Promise<ToolResult<AgentTask>> {
      try {
        const task = await createTask(context.config.agentHostDir, input.goal, input.definitionOfDone);
        return toolSuccess({
          tool: "task.create",
          riskLevel: "low",
          data: task,
          observations: [
            "Define done as observable outcomes. Complete the task only after every criterion is verified.",
            "Fast path: inspect once, act, then verify. Avoid repeating unchanged discovery.",
            "Plan, inspect, act, observe, verify; log recovery events as you go."
          ]
        });
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
    description: "Pauses, resumes, completes, or cancels a task. Completing a task with definition-of-done criteria requires verifiedCriteria covering every criterion. Terminal tasks cannot change state.",
    riskLevel: "low",
    inputSchema: statusInput,
    mcpInputSchema: schema({
      taskId: { type: "string" },
      status: { type: "string", enum: ["active", "paused", "completed", "cancelled"] },
      verifiedCriteria: { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 300 } }
    }, ["taskId", "status"]),
    inputSummary: "Update task status",
    safety: { actionType: "inspect" },
    async handler(input, context): Promise<ToolResult<AgentTask>> {
      try {
        const existing = await loadTask(context.config.agentHostDir, input.taskId);
        if (existing === undefined) return taskNotFound("task.update_status");
        const criteria = existing.definitionOfDone ?? [];
        if (input.status === "completed" && existing.status !== "completed") {
          if (criteria.length > 0) {
            const verified = new Set((input.verifiedCriteria ?? []).map((criterion) => criterion.trim().toLowerCase()));
            const missing = criteria.filter((criterion) => !verified.has(criterion.trim().toLowerCase()));
            if (missing.length > 0) {
              return toolFailure({
                tool: "task.update_status",
                riskLevel: "low",
                error: {
                  code: "definition_of_done_unverified",
                  message: "Task was not completed because definition-of-done criteria are unverified.",
                  details: { missing }
                },
                observations: [
                  "No task state was changed.",
                  `Verify these criteria first: ${missing.join("; ")}`,
                  "Retry completion with verifiedCriteria listing every criterion."
                ]
              });
            }
            for (const criterion of criteria) {
              await appendTaskEvent(context.config.agentHostDir, input.taskId, "verification", `Definition of done met: ${criterion}`);
            }
          }
        }
        const task = await transitionTask(context.config.agentHostDir, input.taskId, input.status);
        return toolSuccess({
          tool: "task.update_status",
          riskLevel: "low",
          data: task,
          observations: input.status === "completed" && criteria.length > 0
            ? [`Definition of done verified (${criteria.length}/${criteria.length}): ${criteria.join("; ")}`, "Task is complete. Report the outcome instead of continuing to act."]
            : input.status === "completed"
              ? ["No definition of done was recorded; completion is unverified. Record observable criteria on the next task."]
              : [`Task status is now ${task.status}.`]
        });
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
