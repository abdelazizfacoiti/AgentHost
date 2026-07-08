import {
  evaluateSafety,
  toolFailure,
  toolSuccess,
  type ActionPreviewResult,
  type ToolResult,
  type WindowFocusResult,
  type WindowListResult
} from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type {
  AgentHostToolDefinition,
  AnyAgentHostToolDefinition,
  ToolExecutionRuntime
} from "../tool-runner.js";
import { buildPreviewResult, guideAlternative, summarizeWindow, toWindowPreviewTarget } from "./preview.js";

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
    pid: z.number().int().min(1).optional(),
    dryRun: z.boolean().optional()
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

function previewReasons(primaryReason: string, safetyReasons: string[]): string[] {
  return safetyReasons.includes(primaryReason) ? safetyReasons : [primaryReason, ...safetyReasons];
}

function initialFocusSafety(runtime: ToolExecutionRuntime | undefined, context: AgentHostMcpContext, input: FocusInput) {
  if (runtime?.safetyDecision !== undefined) {
    return runtime.safetyDecision;
  }

  return evaluateSafety(
    {
      tool: "window.focus",
      actionType: "gui_click",
      ...(input.appName === undefined ? {} : { appName: input.appName })
    },
    context.policy,
    { agentHostDir: context.config.agentHostDir }
  );
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

  const focus: AgentHostToolDefinition<FocusInput, WindowFocusResult | ActionPreviewResult, AgentHostMcpContext> = {
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
        pid: { type: "integer", minimum: 1 },
        dryRun: { type: "boolean" }
      },
      additionalProperties: false
    },
    inputSummary: "Focus window",
    safety: {
      actionType: "gui_click",
      getInput: (input) => (input.appName === undefined ? {} : { appName: input.appName })
    },
    preview: {
      isDryRun: (input) => input.dryRun === true
    },
    async handler(input, context, runtime): Promise<ToolResult<WindowFocusResult | ActionPreviewResult>> {
      const windows = await context.linux.listWindows({
        limit: 500,
        includeTitles: true
      });

      if (runtime?.isDryRun) {
        const preflightSafety = initialFocusSafety(runtime, context, input);

        if (!windows.supported) {
          return buildPreviewResult({
            tool: "window.focus",
            riskLevel: "medium",
            strategy: "gui_control",
            safety: preflightSafety,
            targetSummary: summarizeWindow(focusIdentity(input)),
            target: toWindowPreviewTarget(focusIdentity(input)),
            supported: false,
            backend: windows.backend,
            wouldExecute: false,
            reasons: previewReasons(windows.reason, preflightSafety.reasons),
            saferAlternative: guideAlternative("Use guide mode when safe window focus backends are unavailable."),
            observations: ["Previewed window focus without moving focus."]
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
          return buildPreviewResult({
            tool: "window.focus",
            riskLevel: "medium",
            strategy: "gui_control",
            safety: preflightSafety,
            targetSummary: summarizeWindow(focusIdentity(input)),
            target: toWindowPreviewTarget(focusIdentity(input)),
            supported: true,
            backend: windows.backend,
            wouldExecute: false,
            reasons: previewReasons("No visible window matched the requested identity.", preflightSafety.reasons),
            observations: ["Previewed window focus without moving focus."]
          });
        }

        if (matches.length > 1) {
          return buildPreviewResult({
            tool: "window.focus",
            riskLevel: "medium",
            strategy: "gui_control",
            safety: preflightSafety,
            targetSummary: summarizeWindow(focusIdentity(input)),
            target: toWindowPreviewTarget(focusIdentity(input)),
            supported: true,
            backend: windows.backend,
            ambiguous: true,
            wouldExecute: false,
            reasons: previewReasons(
              "The requested window identity matched multiple visible windows.",
              preflightSafety.reasons
            ),
            saferAlternative: guideAlternative("Narrow the window identity before using window.focus."),
            observations: ["Previewed window focus without moving focus."]
          });
        }

        const target = matches[0]!;
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

        return buildPreviewResult({
          tool: "window.focus",
          riskLevel: "medium",
          strategy: "gui_control",
          safety: postResolutionSafety,
          targetSummary: summarizeWindow(target),
          target: toWindowPreviewTarget(target),
          supported: true,
          backend: windows.backend,
          reasons: previewReasons("Would focus the resolved visible window.", postResolutionSafety.reasons),
          saferAlternative: postResolutionSafety.blocked
            ? guideAlternative("Sensitive app window focus should stay blocked or guide-only.")
            : undefined,
          observations: ["Previewed window focus without moving focus."]
        });
      }

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

      const target = matches[0]!;
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
