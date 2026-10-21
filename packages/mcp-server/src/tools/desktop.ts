import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  evaluateSafety,
  normalizePathForPolicy,
  toolFailure,
  toolSuccess,
  type DesktopCapabilitiesResult,
  type DesktopClickResult,
  type DesktopPointerResult,
  type DesktopGetActiveWindowResult,
  type DesktopHotkeyResult,
  type DesktopScreenshotResult,
  type DesktopTypeTextResult,
  type DesktopWindowContext,
  type ToolResult
} from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";
import { createSafetyEvaluationContext } from "../grants.js";

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
    activeWindow: activeWindowSchema,
    dryRun: z.boolean().optional()
  })
  .strict();

const typeTextInputSchema = z
  .object({
    text: z.string().min(1).max(10_000),
    activeWindow: activeWindowSchema,
    dataSensitivity: z.enum(["none", "low", "sensitive", "secret"]).optional(),
    dryRun: z.boolean().optional()
  })
  .strict();

const clickInputSchema = z
  .object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    button: z.enum(["left", "middle", "right"]).optional(),
    activeWindow: activeWindowSchema,
    dryRun: z.boolean().optional()
  })
  .strict();

const pointerInputSchema = z.object({
  x: z.number().int().min(0).optional(), y: z.number().int().min(0).optional(),
  direction: z.enum(["up", "down", "left", "right"]).optional(), amount: z.number().int().min(1).max(20).optional(),
  startX: z.number().int().min(0).optional(), startY: z.number().int().min(0).optional(), endX: z.number().int().min(0).optional(), endY: z.number().int().min(0).optional(), durationMs: z.number().int().min(0).max(2000).optional(),
  activeWindow: activeWindowSchema, dryRun: z.boolean().optional()
}).strict();

type ScreenshotInput = z.infer<typeof screenshotInputSchema>;
type HotkeyInput = z.infer<typeof hotkeyInputSchema>;
type TypeTextInput = z.infer<typeof typeTextInputSchema>;
type ClickInput = z.infer<typeof clickInputSchema>;
type PointerInput = z.infer<typeof pointerInputSchema>;

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

async function pngSize(filePath: string): Promise<{ width: number; height: number } | undefined> {
  try {
    const raw = await readFile(filePath);
    if (raw.length < 24 || raw.toString("ascii", 12, 16) !== "IHDR") return undefined;
    return { width: raw.readUInt32BE(16), height: raw.readUInt32BE(20) };
  } catch {
    return undefined;
  }
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
    activeWindow.windowId = /^0x[0-9a-fA-F]+$/.test(input.windowId.trim())
      ? String(parseInt(input.windowId.trim(), 16))
      : input.windowId;
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

function matchesActiveWindow(expected: DesktopWindowContext, actual: DesktopWindowContext): boolean {
  if (expected.windowId !== undefined && expected.windowId !== actual.windowId) {
    return false;
  }

  if (expected.pid !== undefined && expected.pid !== actual.pid) {
    return false;
  }

  if (expected.appName !== undefined && expected.appName.toLowerCase() !== actual.appName?.toLowerCase()) {
    return false;
  }

  if (expected.title !== undefined && expected.title.toLowerCase() !== actual.title?.toLowerCase()) {
    return false;
  }

  return true;
}

function initialGuiSafety(
  tool: string,
  context: AgentHostMcpContext,
  actionType: "gui_click" | "gui_type",
  activeWindow: DesktopWindowContext
) {
  return evaluateSafety(
    {
      tool,
      actionType,
      strategy: "gui_control",
      ...(activeWindow.appName === undefined ? {} : { appName: activeWindow.appName })
    },
    context.policy,
    createSafetyEvaluationContext(context)
  );
}

async function validateActiveWindow(context: AgentHostMcpContext, expected: DesktopWindowContext): Promise<{
  supported: boolean;
  backend?: string;
  reason?: string;
  activeWindow?: DesktopWindowContext;
  matched?: boolean;
}> {
  const current = await context.linux.getActiveWindow();
  if (!current.supported || current.activeWindow === undefined) {
    return { supported: false, reason: "active_window_unavailable", backend: current.backend };
  }
  if (!matchesActiveWindow(expected, current.activeWindow)) {
    return { supported: true, backend: current.backend, reason: "active_window_mismatch", activeWindow: current.activeWindow, matched: false };
  }
  return { supported: true, backend: current.backend, activeWindow: current.activeWindow, matched: true };
}

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

export function createDesktopTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const screenshot: AgentHostToolDefinition<ScreenshotInput, DesktopScreenshotResult, AgentHostMcpContext> = {
    name: "desktop.screenshot",
    description: "Captures a screenshot to an approved local folder. Use includeActiveWindowOnly for faster OCR.",
    riskLevel: "medium",
    inputSchema: screenshotInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        outputDir: { type: "string" },
        filename: { type: "string", pattern: "^[A-Za-z0-9._-]+\\.png$" },
        includeActiveWindowOnly: { type: "boolean" }
      },
      additionalProperties: false
    },
    inputSummary: "Capture screenshot",
    safety: {
      actionType: "file_write",
      getInput: (input) => ({ filePath: screenshotPath(input, { config: { agentHostDir: "" } } as any) })
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
        createSafetyEvaluationContext(context)
      );

      if (!postResolutionSafety.allowed) {
        return safetyFailure("desktop.screenshot", postResolutionSafety);
      }

      const data = await context.linux.screenshot({ path: outputPath, ...(input.includeActiveWindowOnly === undefined ? {} : { includeActiveWindowOnly: input.includeActiveWindowOnly }) });

      return toolSuccess({
        tool: "desktop.screenshot",
        riskLevel: "medium",
        strategy: "gui_control",
        data,
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
        activeWindow: activeWindowMcpSchema,
        dryRun: { type: "boolean" }
      },
      required: ["keys", "activeWindow"],
      additionalProperties: false
    },
    inputSummary: "Send hotkey",
    safety: {
      actionType: "inspect",
      getInput: (input) => {
        const appName = activeWindowAppName(toActiveWindowContext(input.activeWindow));
        return appName === undefined ? {} : { appName };
      }
    },
    async handler(input, context): Promise<ToolResult<DesktopHotkeyResult>> {
      const activeWindow = toActiveWindowContext(input.activeWindow);
      const validation = await validateActiveWindow(context, activeWindow);

      if (!validation.supported || !validation.matched) {
        return toolFailure({
          tool: "desktop.hotkey",
          riskLevel: "medium",
          strategy: "gui_control",
          error: {
            code: "active_window_mismatch",
            message: validation.reason ?? "Active window validation failed."
          },
          observations: [validation.reason ?? "Active window validation failed."]
        });
      }

      const postResolutionSafety = evaluateSafety(
        {
          tool: "desktop.hotkey",
          actionType: "gui_click",
          strategy: "gui_control",
          ...(validation.activeWindow!.appName === undefined ? {} : { appName: validation.activeWindow!.appName })
        },
        context.policy,
        createSafetyEvaluationContext(context)
      );

      if (!postResolutionSafety.allowed) {
        return safetyFailure("desktop.hotkey", postResolutionSafety);
      }

      const data = await context.linux.hotkey({ keys: input.keys, activeWindow: validation.activeWindow! });

      return toolSuccess({
        tool: "desktop.hotkey",
        riskLevel: "medium",
        strategy: "gui_control",
        data,
        observations: ["Sent hotkey to active window."]
      });
    }
  };

  const typeText: AgentHostToolDefinition<TypeTextInput, DesktopTypeTextResult, AgentHostMcpContext> = {
    name: "desktop.type_text",
    description: "Types text into the active window when policy and active-window context allow it.",
    riskLevel: "medium",
    inputSchema: typeTextInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        text: { type: "string", minLength: 1, maxLength: 10000 },
        activeWindow: activeWindowMcpSchema,
        dataSensitivity: { type: "string", enum: ["none", "low", "sensitive", "secret"] },
        dryRun: { type: "boolean" }
      },
      required: ["text", "activeWindow"],
      additionalProperties: false
    },
    inputSummary: "Type text",
    safety: {
      actionType: "inspect",
      getInput: (input) => {
        const appName = activeWindowAppName(toActiveWindowContext(input.activeWindow));
        return appName === undefined ? {} : { appName };
      }
    },
    async handler(input, context): Promise<ToolResult<DesktopTypeTextResult>> {
      const activeWindow = toActiveWindowContext(input.activeWindow);
      const validation = await validateActiveWindow(context, activeWindow);

      if (!validation.supported || !validation.matched) {
        return toolFailure({
          tool: "desktop.type_text",
          riskLevel: "medium",
          strategy: "gui_control",
          error: {
            code: "active_window_mismatch",
            message: validation.reason ?? "Active window validation failed."
          },
          observations: [validation.reason ?? "Active window validation failed."]
        });
      }

      const postResolutionSafety = evaluateSafety(
        {
          tool: "desktop.type_text",
          actionType: "gui_click",
          strategy: "gui_control",
          ...(input.dataSensitivity === undefined ? {} : { dataSensitivity: input.dataSensitivity }),
          ...(validation.activeWindow!.appName === undefined ? {} : { appName: validation.activeWindow!.appName })
        },
        context.policy,
        createSafetyEvaluationContext(context)
      );

      if (!postResolutionSafety.allowed) {
        return safetyFailure("desktop.type_text", postResolutionSafety);
      }

      const data = await context.linux.typeText({ text: input.text, activeWindow: validation.activeWindow! });

      return toolSuccess({
        tool: "desktop.type_text",
        riskLevel: "medium",
        strategy: "gui_control",
        data,
        observations: ["Typed text into active window."]
      });
    }
  };

  const click: AgentHostToolDefinition<ClickInput, DesktopClickResult, AgentHostMcpContext> = {
    name: "desktop.click",
    description: "Clicks at absolute screen coordinates when policy and active-window context allow it.",
    riskLevel: "medium",
    inputSchema: clickInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        x: { type: "integer", minimum: 0 },
        y: { type: "integer", minimum: 0 },
        button: { type: "string", enum: ["left", "middle", "right"] },
        activeWindow: activeWindowMcpSchema,
        dryRun: { type: "boolean" }
      },
      required: ["x", "y", "activeWindow"],
      additionalProperties: false
    },
    inputSummary: "Click at coordinates",
    safety: {
      actionType: "inspect",
      getInput: (input) => {
        const appName = activeWindowAppName(toActiveWindowContext(input.activeWindow));
        return appName === undefined ? {} : { appName };
      }
    },
    async handler(input, context): Promise<ToolResult<DesktopClickResult>> {
      const activeWindow = toActiveWindowContext(input.activeWindow);
      const validation = await validateActiveWindow(context, activeWindow);

      if (!validation.supported || !validation.matched) {
        return toolFailure({
          tool: "desktop.click",
          riskLevel: "medium",
          strategy: "gui_control",
          error: {
            code: "active_window_mismatch",
            message: validation.reason ?? "Active window validation failed."
          },
          observations: [validation.reason ?? "Active window validation failed."]
        });
      }

      const postResolutionSafety = evaluateSafety(
        {
          tool: "desktop.click",
          actionType: "gui_click",
          strategy: "gui_control",
          ...(validation.activeWindow!.appName === undefined ? {} : { appName: validation.activeWindow!.appName })
        },
        context.policy,
        createSafetyEvaluationContext(context)
      );

      if (!postResolutionSafety.allowed) {
        return safetyFailure("desktop.click", postResolutionSafety);
      }

      const data = await context.linux.click({
        x: input.x,
        y: input.y,
        button: input.button ?? "left",
        activeWindow: validation.activeWindow!
      });

      return toolSuccess({
        tool: "desktop.click",
        riskLevel: "medium",
        strategy: "gui_control",
        data,
        observations: ["Clicked at coordinates."]
      });
    }
  };

  const pointer: AgentHostToolDefinition<PointerInput, DesktopPointerResult, AgentHostMcpContext> = {
    name: "desktop.pointer",
    description: "Performs pointer actions (move, scroll, double-click, right-click, drag) when policy and active-window context allow it.",
    riskLevel: "medium",
    inputSchema: pointerInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        x: { type: "integer", minimum: 0 },
        y: { type: "integer", minimum: 0 },
        direction: { type: "string", enum: ["up", "down", "left", "right"] },
        amount: { type: "integer", minimum: 1, maximum: 20 },
        startX: { type: "integer", minimum: 0 },
        startY: { type: "integer", minimum: 0 },
        endX: { type: "integer", minimum: 0 },
        endY: { type: "integer", minimum: 0 },
        durationMs: { type: "integer", minimum: 0, maximum: 2000 },
        activeWindow: activeWindowMcpSchema,
        dryRun: { type: "boolean" }
      },
      required: ["activeWindow"],
      additionalProperties: false
    },
    inputSummary: "Pointer action",
    safety: {
      actionType: "inspect",
      getInput: (input) => {
        const appName = activeWindowAppName(toActiveWindowContext(input.activeWindow));
        return appName === undefined ? {} : { appName };
      }
    },
    async handler(input, context): Promise<ToolResult<DesktopPointerResult>> {
      const activeWindow = toActiveWindowContext(input.activeWindow);
      const validation = await validateActiveWindow(context, activeWindow);

      if (!validation.supported || !validation.matched) {
        return toolFailure({
          tool: "desktop.pointer",
          riskLevel: "medium",
          strategy: "gui_control",
          error: {
            code: "active_window_mismatch",
            message: validation.reason ?? "Active window validation failed."
          },
          observations: [validation.reason ?? "Active window validation failed."]
        });
      }

      const postResolutionSafety = evaluateSafety(
        {
          tool: "desktop.pointer",
          actionType: "gui_click",
          strategy: "gui_control",
          ...(validation.activeWindow!.appName === undefined ? {} : { appName: validation.activeWindow!.appName })
        },
        context.policy,
        createSafetyEvaluationContext(context)
      );

      if (!postResolutionSafety.allowed) {
        return safetyFailure("desktop.pointer", postResolutionSafety);
      }

      const data = await context.linux.pointer!({
        action: input.x !== undefined && input.y !== undefined ? "move_mouse" : input.direction !== undefined ? "scroll" : "move_mouse",
        activeWindow: validation.activeWindow!,
        ...(input.x === undefined ? {} : { x: input.x }),
        ...(input.y === undefined ? {} : { y: input.y }),
        ...(input.direction === undefined ? {} : { direction: input.direction }),
        ...(input.amount === undefined ? {} : { amount: input.amount }),
        ...(input.startX === undefined ? {} : { startX: input.startX }),
        ...(input.startY === undefined ? {} : { startY: input.startY }),
        ...(input.endX === undefined ? {} : { endX: input.endX }),
        ...(input.endY === undefined ? {} : { endY: input.endY }),
        ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs })
      });

      return toolSuccess({
        tool: "desktop.pointer",
        riskLevel: "medium",
        strategy: "gui_control",
        data,
        observations: ["Performed pointer action."]
      });
    }
  };

  return [screenshot, hotkey, typeText, click, pointer];
}