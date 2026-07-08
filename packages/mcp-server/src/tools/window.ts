import { evaluateSafety, toolFailure, toolSuccess, type ToolResult, type WindowFocusResult, type WindowListResult } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";

const nonEmptyString = z.string().trim().min(1).max(500);

const listInputSchema = z
  .object({
    limit: z.number().int().min(1).max(500).optional(),
    includeTitles: z.boolean().optional()
  })
  .strict();

const focusInputSchema = z
  .object({
    windowId: z.string().trim().min(1).max(200).optional(),
    appName: z.string().trim().min(1).max(200).optional(),
    title: nonEmptyString.optional(),
    pid: z.number().int().min(1).optional()
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.windowId === undefined && input.appName === undefined && input.title === undefined && input.pid === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "window.focus requires at least one of windowId, appName, title, or pid."
      });
    }
  });

type ListInput = z.infer<typeof listInputSchema>;
type FocusInput = z.infer<typeof focusInputSchema>;

function safetyFailure(tool: string, safety: ReturnType<typeof evaluateSafety>): ToolResult<never> {
  return toolFailure({
    tool,
    riskLevel: safety.riskLevel,
    approval: safety.approval,
    error: {
      code: safety.blocked ? "safety_blocked" : "approval_required",
      message: safety.blocked
        ? "Tool execution was blocked by the safety engine."
        : "Tool execution requires approval before it can run.",
      details: safety
    },
    observations: safety.reasons
  });
}

function focusIdentity(input: FocusInput): { windowId?: string; appName?: string; title?: string; pid?: number } {
  const identity: { windowId?: string; appName?: string; title?: string; pid?: number } = {};

  if (input.windowId !== undefined) {
    identity.windowId = input.windowId;
  }

  if (input.appName !== undefined) {
    identity.appName = input.appName;
  }

  if (input.title !== undefined) {
    identity.title = input.title;
  }

  if (input.pid !== undefined) {
    identity.pid = input.pid;
  }

  return identity;
}

function toWindowListInput(input: ListInput) {
  return {
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.includeTitles === undefined ? {} : { includeTitles: input.includeTitles })
  };
}

export function createWindowTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const list: AgentHostToolDefinition<ListInput, WindowListResult, AgentHostMcpContext> = {
    name: "window.list",
    description: "Lists visible windows when a safe desktop backend is available.",
    riskLevel: "low",
    inputSchema: listInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 500 },
        includeTitles: { type: "boolean" }
      },
      additionalProperties: false
    },
    inputSummary: "List windows",
    safety: {
      actionType: "inspect"
    },
    async handler(input, context): Promise<ToolResult<WindowListResult>> {
      return toolSuccess({
        tool: "window.list",
        riskLevel: "low",
        strategy: "gui_control",
        data: await context.linux.listWindows(toWindowListInput(input)),
        observations: ["Listed visible windows using a safe desktop backend when available."]
      });
    }
  };

  const focus: AgentHostToolDefinition<FocusInput, WindowFocusResult, AgentHostMcpContext> = {
    name: "window.focus",
    description: "Focuses a window when a safe backend and policy allow it.",
    riskLevel: "medium",
    inputSchema: focusInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        windowId: { type: "string", minLength: 1, maxLength: 200 },
        appName: { type: "string", minLength: 1, maxLength: 200 },
        title: { type: "string", minLength: 1, maxLength: 500 },
        pid: { type: "integer", minimum: 1 }
      },
      additionalProperties: false
    },
    inputSummary: "Focus window",
    safety: {
      actionType: "gui_click",
      getInput: (input) => (input.appName === undefined ? {} : { appName: input.appName })
    },
    async handler(input, context): Promise<ToolResult<WindowFocusResult>> {
      const windows = await context.linux.listWindows({
        limit: 500,
        includeTitles: true
      });

      if (!windows.supported) {
        return toolSuccess({
          tool: "window.focus",
          riskLevel: "medium",
          strategy: "gui_control",
          data: {
            supported: false,
            backend: windows.backend,
            focused: false,
            window: focusIdentity(input),
            reason: windows.reason
          },
          observations: [windows.reason]
        });
      }

      const matches = windows.windows.filter((window) => {
        if (input.windowId !== undefined && window.windowId !== input.windowId) {
          return false;
        }

        if (input.pid !== undefined && window.pid !== input.pid) {
          return false;
        }

        if (input.appName !== undefined && window.appName?.toLowerCase() !== input.appName.toLowerCase()) {
          return false;
        }

        if (input.title !== undefined && window.title?.toLowerCase() !== input.title.toLowerCase()) {
          return false;
        }

        return true;
      });

      if (matches.length === 0) {
        return toolSuccess({
          tool: "window.focus",
          riskLevel: "medium",
          strategy: "gui_control",
          data: {
            supported: true,
            backend: windows.backend,
            focused: false,
            window: focusIdentity(input),
            reason: "No visible window matched the requested identity."
          },
          observations: ["Window focus request did not match any visible window."]
        });
      }

      if (matches.length > 1) {
        return toolSuccess({
          tool: "window.focus",
          riskLevel: "medium",
          strategy: "gui_control",
          data: {
            supported: true,
            backend: windows.backend,
            focused: false,
            window: focusIdentity(input),
            reason: "The requested window identity matched multiple visible windows."
          },
          observations: ["Window focus request was ambiguous."]
        });
      }

      const target = matches[0];

      if (target === undefined) {
        return toolSuccess({
          tool: "window.focus",
          riskLevel: "medium",
          strategy: "gui_control",
          data: {
            supported: true,
            backend: windows.backend,
            focused: false,
            window: focusIdentity(input),
            reason: "No visible window matched the requested identity."
          },
          observations: ["Window focus request did not match any visible window."]
        });
      }

      const postResolutionSafety = evaluateSafety(
        {
          tool: "window.focus",
          actionType: "gui_click",
          strategy: "gui_control",
          ...(target.appName === undefined ? {} : { appName: target.appName })
        },
        context.policy,
        { agentHostDir: context.config.agentHostDir }
      );

      if (!postResolutionSafety.allowed) {
        return safetyFailure("window.focus", postResolutionSafety);
      }

      return toolSuccess({
        tool: "window.focus",
        riskLevel: "medium",
        strategy: "gui_control",
        data: await context.linux.focusWindow({
          windowId: target.windowId,
          ...(target.appName === undefined ? {} : { appName: target.appName }),
          ...(target.title === undefined ? {} : { title: target.title }),
          ...(target.pid === undefined ? {} : { pid: target.pid })
        }),
        observations: ["Focused a visible window using a safe desktop backend when available."]
      });
    }
  };

  return [list, focus];
}
