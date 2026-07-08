import path from "node:path";
import {
  evaluateSafety,
  normalizePathForPolicy,
  toolFailure,
  toolSuccess,
  type DataSensitivity,
  type DesktopCapabilitiesResult,
  type DesktopClickResult,
  type DesktopGetActiveWindowResult,
  type DesktopHotkeyResult,
  type DesktopMouseButton,
  type DesktopScreenshotResult,
  type DesktopTypeTextResult,
  type DesktopWindowContext,
  type ToolResult
} from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";

const nonEmptyString = z.string().trim().min(1).max(1000);

const activeWindowSchema = z
  .object({
    windowId: z.string().trim().min(1).max(200).optional(),
    appName: z.string().trim().min(1).max(200).optional(),
    title: z.string().trim().min(1).max(500).optional(),
    pid: z.number().int().min(1).optional()
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.windowId === undefined && input.appName === undefined && input.title === undefined && input.pid === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Active-window context must include at least one of windowId, appName, title, or pid."
      });
    }
  });

const emptyInputSchema = z.object({}).strict();
const screenshotInputSchema = z
  .object({
    outputDir: nonEmptyString.optional(),
    filename: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._-]+\.png$/).optional(),
    includeActiveWindowOnly: z.boolean().optional()
  })
  .strict();
const hotkeyInputSchema = z
  .object({
    keys: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
    activeWindow: activeWindowSchema
  })
  .strict();
const typeTextInputSchema = z
  .object({
    text: z.string().min(1).max(10_000),
    activeWindow: activeWindowSchema,
    dataSensitivity: z.enum(["none", "low", "sensitive", "secret"]).optional()
  })
  .strict();
const clickInputSchema = z
  .object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    button: z.enum(["left", "middle", "right"]).optional(),
    activeWindow: activeWindowSchema
  })
  .strict();

type EmptyInput = z.infer<typeof emptyInputSchema>;
type ScreenshotInput = z.infer<typeof screenshotInputSchema>;
type HotkeyInput = z.infer<typeof hotkeyInputSchema>;
type TypeTextInput = z.infer<typeof typeTextInputSchema>;
type ClickInput = z.infer<typeof clickInputSchema>;

const emptyMcpInputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false
};

const activeWindowMcpSchema = {
  type: "object",
  properties: {
    windowId: { type: "string", minLength: 1, maxLength: 200 },
    appName: { type: "string", minLength: 1, maxLength: 200 },
    title: { type: "string", minLength: 1, maxLength: 500 },
    pid: { type: "integer", minimum: 1 }
  },
  additionalProperties: false
};

function screenshotPath(input: ScreenshotInput, context: AgentHostMcpContext): string {
  const outputDir =
    input.outputDir === undefined
      ? path.join(context.config.agentHostDir, "screenshots")
      : normalizePathForPolicy(input.outputDir, { agentHostDir: context.config.agentHostDir });
  const filename = input.filename ?? `screenshot-${context.sessionId}-${Date.now()}.png`;
  return normalizePathForPolicy(path.join(outputDir, filename), { agentHostDir: context.config.agentHostDir });
}

function safetyFailure(
  tool: string,
  safety: ReturnType<typeof evaluateSafety>
): ToolResult<never> {
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

function activeWindowAppName(activeWindow: DesktopWindowContext): string | undefined {
  return activeWindow.appName;
}

function toActiveWindowContext(input: {
  windowId?: string | undefined;
  appName?: string | undefined;
  title?: string | undefined;
  pid?: number | undefined;
}): DesktopWindowContext {
  const activeWindow: DesktopWindowContext = {};

  if (input.windowId !== undefined) {
    activeWindow.windowId = input.windowId;
  }

  if (input.appName !== undefined) {
    activeWindow.appName = input.appName;
  }

  if (input.title !== undefined) {
    activeWindow.title = input.title;
  }

  if (input.pid !== undefined) {
    activeWindow.pid = input.pid;
  }

  return activeWindow;
}

export function createDesktopTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const getCapabilities: AgentHostToolDefinition<EmptyInput, DesktopCapabilitiesResult, AgentHostMcpContext> = {
    name: "desktop.get_capabilities",
    description: "Reports detected desktop session and safe backend capabilities.",
    riskLevel: "low",
    inputSchema: emptyInputSchema,
    mcpInputSchema: emptyMcpInputSchema,
    inputSummary: "Get desktop capabilities",
    safety: {
      actionType: "inspect"
    },
    async handler(_input, context): Promise<ToolResult<DesktopCapabilitiesResult>> {
      return toolSuccess({
        tool: "desktop.get_capabilities",
        riskLevel: "low",
        strategy: "gui_control",
        data: await context.linux.getDesktopCapabilities(),
        observations: ["Reported detected desktop and backend capabilities without taking any desktop action."]
      });
    }
  };

  const getActiveWindow: AgentHostToolDefinition<EmptyInput, DesktopGetActiveWindowResult, AgentHostMcpContext> = {
    name: "desktop.get_active_window",
    description: "Returns best-effort metadata about the current active window.",
    riskLevel: "low",
    inputSchema: emptyInputSchema,
    mcpInputSchema: emptyMcpInputSchema,
    inputSummary: "Get active window",
    safety: {
      actionType: "inspect"
    },
    async handler(_input, context): Promise<ToolResult<DesktopGetActiveWindowResult>> {
      return toolSuccess({
        tool: "desktop.get_active_window",
        riskLevel: "low",
        strategy: "gui_control",
        data: await context.linux.getActiveWindow(),
        observations: ["Returned best-effort active-window metadata."]
      });
    }
  };

  const screenshot: AgentHostToolDefinition<ScreenshotInput, DesktopScreenshotResult, AgentHostMcpContext> = {
    name: "desktop.screenshot",
    description: "Captures a screenshot into an approved local AgentHost folder.",
    riskLevel: "medium",
    inputSchema: screenshotInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        outputDir: { type: "string", minLength: 1, maxLength: 1000 },
        filename: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          pattern: "^[A-Za-z0-9._-]+\\.png$"
        },
        includeActiveWindowOnly: { type: "boolean" }
      },
      additionalProperties: false
    },
    inputSummary: "Capture screenshot",
    safety: {
      actionType: "file_write",
      getInput: (input) => ({
        ...(input.outputDir === undefined ? {} : { filePath: input.outputDir })
      })
    },
    async handler(input, context): Promise<ToolResult<DesktopScreenshotResult>> {
      const outputPath = screenshotPath(input, context);
      const postResolutionSafety = evaluateSafety(
        {
          tool: "desktop.screenshot",
          actionType: "file_write",
          strategy: "gui_control",
          filePath: outputPath
        },
        context.policy,
        { agentHostDir: context.config.agentHostDir }
      );

      if (!postResolutionSafety.allowed) {
        return safetyFailure("desktop.screenshot", postResolutionSafety);
      }

      return toolSuccess({
        tool: "desktop.screenshot",
        riskLevel: "medium",
        strategy: "gui_control",
        data: await context.linux.screenshot({
          path: outputPath,
          ...(input.includeActiveWindowOnly === undefined
            ? {}
            : { includeActiveWindowOnly: input.includeActiveWindowOnly })
        }),
        observations: ["Saved a screenshot locally under an approved AgentHost folder."]
      });
    }
  };

  const hotkey: AgentHostToolDefinition<HotkeyInput, DesktopHotkeyResult, AgentHostMcpContext> = {
    name: "desktop.hotkey",
    description: "Sends a desktop hotkey when policy and active-window context allow it.",
    riskLevel: "medium",
    inputSchema: hotkeyInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        keys: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 100 },
          minItems: 1,
          maxItems: 10
        },
        activeWindow: activeWindowMcpSchema
      },
      required: ["keys", "activeWindow"],
      additionalProperties: false
    },
    inputSummary: "Send hotkey",
    safety: {
      actionType: "gui_click",
      getInput: (input) => {
        const appName = activeWindowAppName(toActiveWindowContext(input.activeWindow));
        return appName === undefined ? {} : { appName };
      }
    },
    async handler(input, context): Promise<ToolResult<DesktopHotkeyResult>> {
      const hotkeyInput = {
        keys: input.keys,
        activeWindow: toActiveWindowContext(input.activeWindow)
      };

      return toolSuccess({
        tool: "desktop.hotkey",
        riskLevel: "medium",
        strategy: "gui_control",
        data: await context.linux.hotkey(hotkeyInput),
        observations: ["Sent a desktop hotkey using the generic GUI fallback backend."]
      });
    }
  };

  const typeText: AgentHostToolDefinition<TypeTextInput, DesktopTypeTextResult, AgentHostMcpContext> = {
    name: "desktop.type_text",
    description: "Types text into the active window when policy and safety allow it.",
    riskLevel: "medium",
    inputSchema: typeTextInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        text: { type: "string", minLength: 1, maxLength: 10000 },
        activeWindow: activeWindowMcpSchema,
        dataSensitivity: {
          type: "string",
          enum: ["none", "low", "sensitive", "secret"]
        }
      },
      required: ["text", "activeWindow"],
      additionalProperties: false
    },
    inputSummary: "Type text",
    safety: {
      actionType: "gui_type",
      getInput: (input) => {
        const activeWindow = toActiveWindowContext(input.activeWindow);
        const appName = activeWindowAppName(activeWindow);
        const safetyInput: {
          appName?: string;
          dataSensitivity?: DataSensitivity;
        } = {};

        if (appName !== undefined) {
          safetyInput.appName = appName;
        }

        if (input.dataSensitivity !== undefined) {
          safetyInput.dataSensitivity = input.dataSensitivity;
        }

        return safetyInput;
      }
    },
    async handler(input, context): Promise<ToolResult<DesktopTypeTextResult>> {
      const activeWindow = toActiveWindowContext(input.activeWindow);
      return toolSuccess({
        tool: "desktop.type_text",
        riskLevel: "medium",
        strategy: "gui_control",
        data: await context.linux.typeText({
          text: input.text,
          activeWindow
        }),
        observations: ["Typed text using the generic GUI fallback backend."]
      });
    }
  };

  const click: AgentHostToolDefinition<ClickInput, DesktopClickResult, AgentHostMcpContext> = {
    name: "desktop.click",
    description: "Clicks screen coordinates when policy and active-window context allow it.",
    riskLevel: "medium",
    inputSchema: clickInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        x: { type: "integer", minimum: 0 },
        y: { type: "integer", minimum: 0 },
        button: { type: "string", enum: ["left", "middle", "right"] },
        activeWindow: activeWindowMcpSchema
      },
      required: ["x", "y", "activeWindow"],
      additionalProperties: false
    },
    inputSummary: "Click desktop coordinates",
    safety: {
      actionType: "gui_click",
      getInput: (input) => {
        const appName = activeWindowAppName(toActiveWindowContext(input.activeWindow));
        return appName === undefined ? {} : { appName };
      }
    },
    async handler(input, context): Promise<ToolResult<DesktopClickResult>> {
      const clickInput: {
        x: number;
        y: number;
        button?: DesktopMouseButton;
        activeWindow: DesktopWindowContext;
      } = {
        x: input.x,
        y: input.y,
        activeWindow: toActiveWindowContext(input.activeWindow)
      };

      if (input.button !== undefined) {
        const button: DesktopMouseButton = input.button;
        clickInput.button = button;
      }

      return toolSuccess({
        tool: "desktop.click",
        riskLevel: "medium",
        strategy: "gui_control",
        data: await context.linux.click(clickInput),
        observations: ["Clicked desktop coordinates using the generic GUI fallback backend."]
      });
    }
  };

  return [getActiveWindow, getCapabilities, screenshot, hotkey, typeText, click];
}
