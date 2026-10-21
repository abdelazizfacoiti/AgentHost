import { toolFailure, toolSuccess, evaluateSafety, type WindowListResult, type WindowFocusResult, type DesktopWindowContext, type ToolResult } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";
import { createSafetyEvaluationContext } from "../grants.js";

const listInput = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  includeTitles: z.boolean().optional()
}).strict();

const focusInput = z.object({
  windowId: z.string().trim().min(1).max(200).optional(),
  appName: z.string().trim().min(1).max(200).optional(),
  title: z.string().trim().min(1).max(500).optional(),
  pid: z.number().int().min(1).optional()
}).strict().superRefine((input, ctx) => {
  if (input.windowId === undefined && input.appName === undefined && input.title === undefined && input.pid === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Must specify at least one of windowId, appName, title, or pid." });
  }
});

function safetyCheck(tool: string, context: AgentHostMcpContext, appName?: string) {
  return evaluateSafety(
    { tool, actionType: "inspect", strategy: "gui_control", ...(appName === undefined ? {} : { appName }) },
    context.policy,
    createSafetyEvaluationContext(context)
  );
}

function failure(tool: string, safety: ReturnType<typeof evaluateSafety>): ToolResult<never> {
  return toolFailure({
    tool,
    riskLevel: safety.riskLevel,
    approval: safety.approval,
    error: { code: safety.blocked ? "safety_blocked" : "approval_required", message: safety.blocked ? "Blocked by safety engine." : "Requires approval.", details: safety },
    observations: safety.reasons
  });
}

export function createWindowTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const list: AgentHostToolDefinition<z.infer<typeof listInput>, WindowListResult, AgentHostMcpContext> = {
    name: "window.list",
    description: "Lists visible windows.",
    riskLevel: "low",
    inputSchema: listInput,
    mcpInputSchema: { type: "object", properties: { limit: { type: "integer" }, includeTitles: { type: "boolean" } }, additionalProperties: false },
    inputSummary: "List windows",
    safety: { actionType: "observe" },
    async handler(input, context) {
      const safety = safetyCheck("window.list", context);
      if (!safety.allowed) return failure("window.list", safety);
      try {
        const data = await context.linux.listWindows({ limit: input.limit ?? 20, includeTitles: input.includeTitles ?? true });
        return toolSuccess({ tool: "window.list", riskLevel: "low", data, observations: ["Listed windows."] });
      } catch (e) {
        return toolFailure({ tool: "window.list", riskLevel: "low", error: { code: "list_failed", message: e instanceof Error ? e.message : "List failed" } });
      }
    }
  };

  const focus: AgentHostToolDefinition<z.infer<typeof focusInput>, WindowFocusResult, AgentHostMcpContext> = {
    name: "window.focus",
    description: "Focuses a window by ID, app name, title, or PID.",
    riskLevel: "medium",
    inputSchema: focusInput,
    mcpInputSchema: {
      type: "object",
      properties: { windowId: { type: "string" }, appName: { type: "string" }, title: { type: "string" }, pid: { type: "integer" } },
      additionalProperties: false
    },
    inputSummary: "Focus window",
    safety: { actionType: "window_action", getInput: (i) => ({ appName: i.appName }) },
    async handler(input, context) {
      const safety = safetyCheck("window.focus", context, input.appName);
      if (!safety.allowed) return failure("window.focus", safety);
      try {
        const data = await context.linux.focusWindow({
          ...(input.windowId === undefined ? {} : { windowId: input.windowId }),
          ...(input.appName === undefined ? {} : { appName: input.appName }),
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.pid === undefined ? {} : { pid: input.pid })
        });
        return toolSuccess({ tool: "window.focus", riskLevel: "medium", data, observations: ["Focused window."] });
      } catch (e) {
        return toolFailure({ tool: "window.focus", riskLevel: "medium", error: { code: "focus_failed", message: e instanceof Error ? e.message : "Focus failed" } });
      }
    }
  };

  return [list, focus];
}