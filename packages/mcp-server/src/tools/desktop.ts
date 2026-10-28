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
const confirmationTokenSchema = z.string().trim().min(8).max(120).optional();
const executionMcpProperties = {
  dryRun: { type: "boolean" },
  confirmationToken: { type: "string", minLength: 8, maxLength: 120 }
};

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
    filename: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._-]+\.(?:png|jpg|jpeg)$/i).optional(),
    includeActiveWindowOnly: z.boolean().optional(),
    format: z.enum(["png", "jpeg"]).optional(),
    quality: z.number().int().min(1).max(100).optional(),
    scale: z.number().min(0.1).max(1).optional(),
    region: z.object({
      x: z.number().int().min(0),
      y: z.number().int().min(0),
      width: z.number().int().min(1).max(10000),
      height: z.number().int().min(1).max(10000)
    }).strict().optional(),
    dryRun: z.boolean().optional(),
    confirmationToken: confirmationTokenSchema
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.region !== undefined && input.includeActiveWindowOnly === true) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "region cannot be combined with includeActiveWindowOnly." });
    }
    const resolved = input.format ?? (/\.jpe?g$/i.test(input.filename ?? "") ? "jpeg" : "png");
    if (input.filename !== undefined) {
      const pngName = /\.png$/i.test(input.filename);
      if ((resolved === "png" && !pngName) || (resolved === "jpeg" && pngName)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "filename extension must match format." });
      }
    }
    if (input.quality !== undefined && resolved !== "jpeg") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "quality is only supported for jpeg." });
    }
  });

const hotkeyInputSchema = z
  .object({
    keys: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
    activeWindow: activeWindowSchema,
    dryRun: z.boolean().optional(),
    confirmationToken: confirmationTokenSchema
  })
  .strict();

const typeTextInputSchema = z
  .object({
    text: z.string().min(1).max(10_000),
    activeWindow: activeWindowSchema,
    dataSensitivity: z.enum(["none", "low", "sensitive", "secret"]).optional(),
    dryRun: z.boolean().optional(),
    confirmationToken: confirmationTokenSchema
  })
  .strict();

const clickInputSchema = z
  .object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    button: z.enum(["left", "middle", "right"]).optional(),
    activeWindow: activeWindowSchema,
    dryRun: z.boolean().optional(),
    confirmationToken: confirmationTokenSchema
  })
  .strict();

const pointerInputSchema = z.object({
  x: z.number().int().min(0).optional(), y: z.number().int().min(0).optional(),
  direction: z.enum(["up", "down", "left", "right"]).optional(), amount: z.number().int().min(1).max(20).optional(),
  startX: z.number().int().min(0).optional(), startY: z.number().int().min(0).optional(), endX: z.number().int().min(0).optional(), endY: z.number().int().min(0).optional(), durationMs: z.number().int().min(0).max(2000).optional(),
  activeWindow: activeWindowSchema, dryRun: z.boolean().optional(), confirmationToken: confirmationTokenSchema
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

function screenshotFormat(input: ScreenshotInput): "png" | "jpeg" {
  if (input.format !== undefined) return input.format;
  return /\.jpe?g$/i.test(input.filename ?? "") ? "jpeg" : "png";
}

function screenshotPath(input: ScreenshotInput, context: AgentHostMcpContext): string {
  const outputDir =
    input.outputDir === undefined
      ? path.join(context.config.agentHostDir, "screenshots")
      : normalizePathForPolicy(input.outputDir, { agentHostDir: context.config.agentHostDir });
  const scope = input.includeActiveWindowOnly === true ? "window" : "screen";
  const extension = screenshotFormat(input) === "jpeg" ? "jpg" : "png";
  const filename = input.filename ?? `screenshot-${context.sessionId.replace(/[^A-Za-z0-9._-]/g, "_")}-${scope}.${extension}`;
  return normalizePathForPolicy(path.join(outputDir, filename), { agentHostDir: context.config.agentHostDir });
}

async function imageSize(filePath: string): Promise<{ width: number; height: number } | undefined> {
  try {
    const raw = await readFile(filePath);
    if (raw.length >= 24 && raw.toString("ascii", 12, 16) === "IHDR") {
      return { width: raw.readUInt32BE(16), height: raw.readUInt32BE(20) };
    }
    if (raw.length >= 4 && raw[0] === 0xff && raw[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < raw.length) {
        if (raw[offset] !== 0xff) return undefined;
        const marker = raw[offset + 1];
        const length = raw.readUInt16BE(offset + 2);
        if (marker !== undefined && marker >= 0xc0 && marker <= 0xc3) {
          return { height: raw.readUInt16BE(offset + 5), width: raw.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
    }
    return undefined;
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
  activeWindow: DesktopWindowContext,
  dataSensitivity?: "none" | "low" | "sensitive" | "secret"
) {
  return evaluateSafety(
    {
      tool,
      actionType,
      strategy: "gui_control",
      ...(dataSensitivity === undefined ? {} : { dataSensitivity }),
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

function failedDesktopAction<T>(
  tool: string,
  code: string,
  data: { supported: boolean; backend: string; reason: string }
): ToolResult<T> {
  const message = data.reason.trim().length > 0 ? data.reason : `${tool} did not complete.`;
  return toolFailure<T>({
    tool,
    riskLevel: "medium",
    strategy: "gui_control",
    error: {
      code,
      message,
      details: { backend: data.backend, supported: data.supported }
    },
    observations: [message]
  });
}

async function desktopPreview(
  tool: string,
  actionType: "gui_click" | "gui_type",
  input: { activeWindow: z.infer<typeof activeWindowSchema> },
  context: AgentHostMcpContext,
  summary: (window: string) => string,
  target: (window: string) => string,
  data: Record<string, unknown>,
  dataSensitivity?: "none" | "low" | "sensitive" | "secret"
) {
  const activeWindow = toActiveWindowContext(input.activeWindow);
  const validation = await validateActiveWindow(context, activeWindow);
  const windowLabel = activeWindow.windowId ?? activeWindow.appName ?? activeWindow.title ?? String(activeWindow.pid ?? "unknown");
  if (!validation.supported || !validation.matched) {
    return {
      summary: summary(windowLabel),
      targetFingerprint: target(windowLabel),
      riskLevel: "medium" as const,
      approval: { required: false, status: "not_required" as const },
      blocked: true,
      reasons: [validation.reason ?? "active_window_mismatch"],
      data: { activeWindow: validation.activeWindow ?? null, requestedWindow: activeWindow, ...data }
    };
  }
  const safety = initialGuiSafety(tool, context, actionType, validation.activeWindow!, dataSensitivity);
  return {
    summary: summary(windowLabel),
    targetFingerprint: target(windowLabel),
    riskLevel: safety.riskLevel,
    approval: safety.approval,
    blocked: safety.blocked,
    reasons: safety.reasons,
    requiresConfirmation: safety.grantDecision.requiresConfirmationToken
      || safety.riskLevel === "high"
      || safety.appSensitivity === "communication"
      || safety.appSensitivity === "financial",
    data: { activeWindow: validation.activeWindow, ...data }
  };
}

export function createDesktopTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const screenshot: AgentHostToolDefinition<ScreenshotInput, DesktopScreenshotResult, AgentHostMcpContext> = {
    name: "desktop.screenshot",
    description: "Captures a PNG/JPEG screenshot to an approved local folder with optional region, scale, and JPEG quality. Use includeActiveWindowOnly or a region for faster OCR.",
    riskLevel: "medium",
    inputSchema: screenshotInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        outputDir: { type: "string" },
        filename: { type: "string", pattern: "^[A-Za-z0-9._-]+\\.(png|jpg|jpeg)$" },
        includeActiveWindowOnly: { type: "boolean" },
        format: { type: "string", enum: ["png", "jpeg"] },
        quality: { type: "integer", minimum: 1, maximum: 100 },
        scale: { type: "number", minimum: 0.1, maximum: 1 },
        region: {
          type: "object",
          properties: {
            x: { type: "integer", minimum: 0 },
            y: { type: "integer", minimum: 0 },
            width: { type: "integer", minimum: 1, maximum: 10000 },
            height: { type: "integer", minimum: 1, maximum: 10000 }
          },
          required: ["x", "y", "width", "height"],
          additionalProperties: false
        },
        ...executionMcpProperties
      },
      additionalProperties: false
    },
    inputSummary: "Capture screenshot",
    safety: { actionType: "file_write" },
    preview: {
      isDryRun: (input) => input.dryRun === true,
      resolveEffect: (input, context) => {
        const outputPath = screenshotPath(input, context);
        const safety = evaluateSafety(
          { tool: "desktop.screenshot", actionType: "file_write", strategy: "gui_control", filePath: outputPath },
          context.policy,
          createSafetyEvaluationContext(context)
        );
        return {
          summary: `Capture screenshot to ${outputPath}`,
          targetFingerprint: outputPath,
          riskLevel: safety.riskLevel,
          approval: safety.approval,
          blocked: safety.blocked,
          reasons: safety.reasons,
          data: {
            path: outputPath,
            includeActiveWindowOnly: input.includeActiveWindowOnly ?? false,
            format: screenshotFormat(input),
            ...(input.region === undefined ? {} : { region: input.region }),
            ...(input.scale === undefined ? {} : { scale: input.scale }),
            ...(input.quality === undefined ? {} : { quality: input.quality })
          }
        };
      }
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

      const capture = () => context.linux.screenshot({
        path: outputPath,
        ...(input.includeActiveWindowOnly === undefined ? {} : { includeActiveWindowOnly: input.includeActiveWindowOnly }),
        format: input.format ?? screenshotFormat(input),
        ...(input.quality === undefined ? {} : { quality: input.quality }),
        ...(input.scale === undefined ? {} : { scale: input.scale }),
        ...(input.region === undefined ? {} : { region: input.region })
      });
      const data = context.overlayScreenshotSuppression === undefined
        ? await capture()
        : await context.overlayScreenshotSuppression(capture);

      if (data.supported !== true || data.path === undefined || data.bytesWritten === undefined || data.bytesWritten <= 0) {
        return failedDesktopAction("desktop.screenshot", "screenshot_failed", data);
      }

      const size = await imageSize(outputPath);
      if (size !== undefined) {
        data.screenshotMetadata = {
          screenshotId: path.basename(outputPath),
          capturedAt: new Date().toISOString(),
          captureKind: input.includeActiveWindowOnly === true ? "active_window" : "full_screen",
          imageWidth: size.width,
          imageHeight: size.height,
          geometryAvailable: true,
          format: screenshotFormat(input),
          ...(input.scale === undefined ? {} : { scale: input.scale }),
          ...(input.region === undefined ? {} : { region: input.region })
        };
      }
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
        ...executionMcpProperties
      },
      required: ["keys", "activeWindow"],
      additionalProperties: false
    },
    inputSummary: "Send hotkey",
    auditInputSummary: (i) => `Send hotkey ${i.keys.join("+")} to ${activeWindowAppName(toActiveWindowContext(i.activeWindow)) ?? "active window"}.`,
    preview: {
      isDryRun: (i) => i.dryRun === true,
      resolveEffect: (i, context) => desktopPreview("desktop.hotkey", "gui_click", i, context, (window) => `Send hotkey ${i.keys.join("+")} to ${window}.`, (window) => `hotkey:${window}:${i.keys.join("+")}`, { keys: i.keys })
    },
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

      if (data.supported !== true || data.sent !== true) {
        return failedDesktopAction("desktop.hotkey", "hotkey_failed", data);
      }

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
        ...executionMcpProperties
      },
      required: ["text", "activeWindow"],
      additionalProperties: false
    },
    inputSummary: "Type text",
    auditInputSummary: (i) => `Type ${i.text.length} characters into ${activeWindowAppName(toActiveWindowContext(i.activeWindow)) ?? "active window"}.`,
    preview: {
      isDryRun: (i) => i.dryRun === true,
      resolveEffect: (i, context) => desktopPreview("desktop.type_text", "gui_type", i, context, (window) => `Type ${i.text.length} characters into ${window}.`, (window) => `type:${window}:${i.text.length}`, { textLength: i.text.length, dataSensitivity: i.dataSensitivity ?? "none" }, i.dataSensitivity)
    },
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
          actionType: "gui_type",
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

      if (data.supported !== true || data.typed !== true) {
        return failedDesktopAction("desktop.type_text", "type_failed", data);
      }

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
        ...executionMcpProperties
      },
      required: ["x", "y", "activeWindow"],
      additionalProperties: false
    },
    inputSummary: "Click at coordinates",
    auditInputSummary: (i) => `Click ${i.button ?? "left"} at (${i.x}, ${i.y}) in ${activeWindowAppName(toActiveWindowContext(i.activeWindow)) ?? "active window"}.`,
    preview: {
      isDryRun: (i) => i.dryRun === true,
      resolveEffect: (i, context) => desktopPreview("desktop.click", "gui_click", i, context, (window) => `Click ${i.button ?? "left"} at (${i.x}, ${i.y}) in ${window}.`, (window) => `click:${window}:${i.x}:${i.y}:${i.button ?? "left"}`, { x: i.x, y: i.y, button: i.button ?? "left" })
    },
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

      if (data.supported !== true || data.clicked !== true) {
        return failedDesktopAction("desktop.click", "click_failed", data);
      }

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
        ...executionMcpProperties
      },
      required: ["activeWindow"],
      additionalProperties: false
    },
    inputSummary: "Pointer action",
    auditInputSummary: (i) => `Pointer ${i.direction ?? (i.startX !== undefined ? "drag" : "action")} in ${activeWindowAppName(toActiveWindowContext(i.activeWindow)) ?? "active window"}.`,
    preview: {
      isDryRun: (i) => i.dryRun === true,
      resolveEffect: (i, context) => desktopPreview("desktop.pointer", "gui_click", i, context, (window) => `Pointer action in ${window}.`, (window) => `pointer:${window}:${i.x ?? ""}:${i.y ?? ""}:${i.direction ?? ""}:${i.startX ?? ""}:${i.startY ?? ""}:${i.endX ?? ""}:${i.endY ?? ""}`, { x: i.x, y: i.y, direction: i.direction, amount: i.amount, startX: i.startX, startY: i.startY, endX: i.endX, endY: i.endY })
    },
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

      if (data.supported !== true || data.performed !== true) {
        return failedDesktopAction("desktop.pointer", "pointer_failed", data);
      }

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