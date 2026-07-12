import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  evaluateSafety,
  normalizePathForPolicy,
  toolFailure,
  toolSuccess,
  type ActionPreviewResult,
  type DataSensitivity,
  type DesktopCapabilitiesResult,
  type DesktopClickResult,
  type DesktopPointerResult,
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
import type {
  AgentHostToolDefinition,
  AnyAgentHostToolDefinition,
  ToolExecutionRuntime
} from "../tool-runner.js";
import { createSafetyEvaluationContext } from "../grants.js";
import {
  acceptedConfirmation,
  buildPreviewResult,
  confirmationRequired,
  guideAlternative,
  missingConfirmationReason,
  rejectedConfirmation,
  summarizeWindow,
  toWindowPreviewTarget
} from "./preview.js";

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
    activeWindow: activeWindowSchema,
    dryRun: z.boolean().optional(),
    confirmationToken: z.string().trim().min(1).max(500).optional()
  })
  .strict();
const typeTextInputSchema = z
  .object({
    text: z.string().min(1).max(10_000),
    activeWindow: activeWindowSchema,
    dataSensitivity: z.enum(["none", "low", "sensitive", "secret"]).optional(),
    dryRun: z.boolean().optional(),
    confirmationToken: z.string().trim().min(1).max(500).optional()
  })
  .strict();
const clickInputSchema = z
  .object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    button: z.enum(["left", "middle", "right"]).optional(),
    activeWindow: activeWindowSchema,
    dryRun: z.boolean().optional(),
    confirmationToken: z.string().trim().min(1).max(500).optional()
  })
  .strict();

type EmptyInput = z.infer<typeof emptyInputSchema>;
type ScreenshotInput = z.infer<typeof screenshotInputSchema>;
type HotkeyInput = z.infer<typeof hotkeyInputSchema>;
type TypeTextInput = z.infer<typeof typeTextInputSchema>;
type ClickInput = z.infer<typeof clickInputSchema>;
const pointerInputSchema = z.object({
  x: z.number().int().min(0).optional(), y: z.number().int().min(0).optional(),
  direction: z.enum(["up", "down", "left", "right"]).optional(), amount: z.number().int().min(1).max(20).optional(),
  startX: z.number().int().min(0).optional(), startY: z.number().int().min(0).optional(), endX: z.number().int().min(0).optional(), endY: z.number().int().min(0).optional(), durationMs: z.number().int().min(0).max(2000).optional(),
  activeWindow: activeWindowSchema, dryRun: z.boolean().optional(), confirmationToken: z.string().trim().min(1).max(500).optional()
}).strict();
type PointerInput = z.infer<typeof pointerInputSchema>;

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
async function pngSize(filePath: string): Promise<{ width: number; height: number } | undefined> { try { const raw = await readFile(filePath); if (raw.length < 24 || raw.toString("ascii", 12, 16) !== "IHDR") return undefined; return { width: raw.readUInt32BE(16), height: raw.readUInt32BE(20) }; } catch { return undefined; } }

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

function sameText(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined) {
    return true;
  }

  return b !== undefined && a.toLowerCase() === b.toLowerCase();
}

function matchesActiveWindow(expected: DesktopWindowContext, actual: DesktopWindowContext): boolean {
  if (expected.windowId !== undefined && expected.windowId !== actual.windowId) {
    return false;
  }

  if (expected.pid !== undefined && expected.pid !== actual.pid) {
    return false;
  }

  if (!sameText(expected.appName, actual.appName)) {
    return false;
  }

  if (!sameText(expected.title, actual.title)) {
    return false;
  }

  return true;
}

async function validateActiveWindowForPreview(context: AgentHostMcpContext, expected: DesktopWindowContext) {
  const activeWindow = await context.linux.getActiveWindow();

  if (!activeWindow.supported) {
    return {
      supported: false as const,
      backend: activeWindow.backend,
      reason: activeWindow.reason
    };
  }

  if (activeWindow.activeWindow === undefined) {
    return {
      supported: false as const,
      backend: activeWindow.backend,
      reason: "No active window metadata was available from the safe backend."
    };
  }

  if (!matchesActiveWindow(expected, activeWindow.activeWindow)) {
    return {
      supported: true as const,
      backend: activeWindow.backend,
      matched: false as const,
      reason: "The provided active-window context does not match the current active window.",
      activeWindow: activeWindow.activeWindow
    };
  }

  return {
    supported: true as const,
    backend: activeWindow.backend,
    matched: true as const,
    reason: activeWindow.reason,
    activeWindow: activeWindow.activeWindow
  };
}

function previewReasons(primaryReason: string, safetyReasons: string[]): string[] {
  return safetyReasons.includes(primaryReason) ? safetyReasons : [primaryReason, ...safetyReasons];
}

function initialGuiSafety(
  runtime: ToolExecutionRuntime | undefined,
  context: AgentHostMcpContext,
  tool: "desktop.hotkey" | "desktop.type_text" | "desktop.click",
  actionType: "gui_click" | "gui_type",
  activeWindow: DesktopWindowContext,
  dataSensitivity?: DataSensitivity
) {
  if (runtime?.safetyDecision !== undefined) {
    return runtime.safetyDecision;
  }

  return evaluateSafety(
    {
      tool,
      actionType,
      ...(activeWindow.appName === undefined ? {} : { appName: activeWindow.appName }),
      ...(dataSensitivity === undefined ? {} : { dataSensitivity })
    },
    context.policy,
    createSafetyEvaluationContext(context)
  );
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
        createSafetyEvaluationContext(context)
      );

      if (!postResolutionSafety.allowed) {
        return safetyFailure("desktop.screenshot", postResolutionSafety);
      }

      const data = await context.linux.screenshot({ path: outputPath, ...(input.includeActiveWindowOnly === undefined ? {} : { includeActiveWindowOnly: input.includeActiveWindowOnly }) });
      if (data.supported && data.path !== undefined && context.visionEvidence !== undefined) { const size = await pngSize(data.path); const current = await context.linux.getActiveWindow(); const display = await context.linux.getScreenGeometry?.(); const window = await context.linux.getActiveWindowBounds?.(); if (size !== undefined && current.activeWindow !== undefined) { const evidence = await context.visionEvidence.saveScreenshot({ sessionId: context.sessionId, imagePath: data.path, captureKind: input.includeActiveWindowOnly === true ? "active_window" : "full_screen", imageWidth: size.width, imageHeight: size.height, ...(display?.bounds === undefined ? {} : { displayBounds: display.bounds }), ...(window?.bounds === undefined ? {} : { windowBounds: window.bounds }), activeWindow: current.activeWindow }); data.screenshotMetadata = { screenshotId: evidence.screenshotId, capturedAt: new Date(evidence.capturedAt).toISOString(), captureKind: evidence.captureKind, imageWidth: size.width, imageHeight: size.height, geometryAvailable: evidence.displayBounds !== undefined && (evidence.captureKind === "full_screen" || evidence.windowBounds !== undefined) }; } }

      return toolSuccess({
        tool: "desktop.screenshot",
        riskLevel: "medium",
        strategy: "gui_control",
        data,
        observations: ["Saved a screenshot locally under an approved AgentHost folder."]
      });
    }
  };

  const hotkey: AgentHostToolDefinition<HotkeyInput, DesktopHotkeyResult | ActionPreviewResult, AgentHostMcpContext> = {
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
        dryRun: { type: "boolean" },
        confirmationToken: { type: "string", minLength: 1, maxLength: 500 }
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
    preview: {
      isDryRun: (input) => input.dryRun === true
    },
    async handler(input, context, runtime): Promise<ToolResult<DesktopHotkeyResult | ActionPreviewResult>> {
      const activeWindow = toActiveWindowContext(input.activeWindow);

      if (runtime?.isDryRun) {
        const preflightSafety = initialGuiSafety(runtime, context, "desktop.hotkey", "gui_click", activeWindow);
        const validation = await validateActiveWindowForPreview(context, activeWindow);
        const previewTarget = validation.supported && "activeWindow" in validation
          ? validation.activeWindow
          : activeWindow;

        if (!validation.supported || ("matched" in validation && !validation.matched)) {
          return buildPreviewResult({
            tool: "desktop.hotkey",
            riskLevel: "medium",
            strategy: "gui_control",
            safety: preflightSafety,
            targetSummary: summarizeWindow(previewTarget),
            target: toWindowPreviewTarget(previewTarget),
            supported: validation.supported,
            backend: validation.backend,
            wouldExecute: false,
            reasons: previewReasons(validation.reason, preflightSafety.reasons),
            saferAlternative: guideAlternative("Resolve the active window manually before using generic GUI hotkeys."),
            observations: ["Previewed a desktop hotkey without sending it."]
          });
        }

        const postResolutionSafety = evaluateSafety(
          {
            tool: "desktop.hotkey",
            actionType: "gui_click",
            strategy: "gui_control",
            ...(validation.activeWindow.appName === undefined ? {} : { appName: validation.activeWindow.appName })
          },
          context.policy,
          createSafetyEvaluationContext(context)
        );

        return buildPreviewResult({
          tool: "desktop.hotkey",
          riskLevel: "medium",
          strategy: "gui_control",
          safety: postResolutionSafety,
          targetSummary: summarizeWindow(validation.activeWindow),
          target: toWindowPreviewTarget(validation.activeWindow),
          supported: true,
          backend: validation.backend,
          confirmation: {
            manager: context.confirmations,
            sessionId: context.sessionId,
            input,
            target: validation.activeWindow,
            explanation: "Use this token to send the exact previewed hotkey to the same active window before it expires.",
            riskLevel: postResolutionSafety.riskLevel,
            appSensitivity: postResolutionSafety.appSensitivity
          },
          reasons: previewReasons(`Would send hotkey ${input.keys.join("+")} to the active window.`, postResolutionSafety.reasons),
          saferAlternative: postResolutionSafety.blocked
            ? guideAlternative("Sensitive app hotkeys should stay blocked or guide-only.")
            : undefined,
          observations: ["Previewed a desktop hotkey without sending it."]
        });
      }

      const hotkeyInput = {
        keys: input.keys,
        activeWindow
      };
      const validation = await validateActiveWindowForPreview(context, activeWindow);

        if (!validation.supported || !("matched" in validation) || !validation.matched) {
          return toolFailure({
            tool: "desktop.hotkey",
            riskLevel: runtime?.safetyDecision?.riskLevel ?? "medium",
            strategy: "gui_control",
            confirmation: rejectedConfirmation(undefined, validation.reason),
            error: {
              code: "confirmation_rejected",
              message: validation.reason
            },
            observations: [validation.reason]
          });
        }

        const postResolutionSafety = evaluateSafety(
          {
            tool: "desktop.hotkey",
            actionType: "gui_click",
            strategy: "gui_control",
            ...(validation.activeWindow.appName === undefined ? {} : { appName: validation.activeWindow.appName })
          },
          context.policy,
          createSafetyEvaluationContext(context)
        );

      if (!postResolutionSafety.allowed) {
        return safetyFailure("desktop.hotkey", postResolutionSafety);
      }

      if (input.confirmationToken === undefined) {
        const { code, reason } = missingConfirmationReason(postResolutionSafety);
        return toolFailure({
          tool: "desktop.hotkey",
          riskLevel: postResolutionSafety.riskLevel,
          strategy: "gui_control",
          confirmation: confirmationRequired(reason),
          error: {
            code,
            message: reason
          },
          observations: [reason]
        });
      }

      const verification = context.confirmations.verifyAndConsume(input.confirmationToken, {
        sessionId: context.sessionId,
        tool: "desktop.hotkey",
        input,
        target: validation.activeWindow,
        riskLevel: postResolutionSafety.riskLevel
      });

      if (!verification.ok) {
        return toolFailure({
          tool: "desktop.hotkey",
          riskLevel: postResolutionSafety.riskLevel,
          strategy: "gui_control",
          confirmation: rejectedConfirmation(verification.tokenId, verification.reason),
          error: {
            code: "confirmation_rejected",
            message: verification.reason
          },
          observations: [verification.reason]
        });
      }

      return toolSuccess({
        tool: "desktop.hotkey",
        riskLevel: "medium",
        strategy: "gui_control",
        confirmation: acceptedConfirmation(verification.tokenId, true, "Confirmation token accepted and desktop hotkey executed."),
        data: await context.linux.hotkey(hotkeyInput),
        observations: ["Sent a desktop hotkey using the generic GUI fallback backend."]
      });
    }
  };

  const typeText: AgentHostToolDefinition<TypeTextInput, DesktopTypeTextResult | ActionPreviewResult, AgentHostMcpContext> = {
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
        },
        dryRun: { type: "boolean" },
        confirmationToken: { type: "string", minLength: 1, maxLength: 500 }
      },
      required: ["text", "activeWindow"],
      additionalProperties: false
    },
    inputSummary: "Type text",
    safety: {
      actionType: "inspect",
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
    preview: {
      isDryRun: (input) => input.dryRun === true
    },
    async handler(input, context, runtime): Promise<ToolResult<DesktopTypeTextResult | ActionPreviewResult>> {
      const activeWindow = toActiveWindowContext(input.activeWindow);

      if (runtime?.isDryRun) {
        const preflightSafety = initialGuiSafety(
          runtime,
          context,
          "desktop.type_text",
          "gui_type",
          activeWindow,
          input.dataSensitivity
        );
        const validation = await validateActiveWindowForPreview(context, activeWindow);
        const previewTarget = validation.supported && "activeWindow" in validation
          ? validation.activeWindow
          : activeWindow;

        if (!validation.supported || ("matched" in validation && !validation.matched)) {
          return buildPreviewResult({
            tool: "desktop.type_text",
            riskLevel: "medium",
            strategy: "gui_control",
            safety: preflightSafety,
            targetSummary: summarizeWindow(previewTarget),
            target: toWindowPreviewTarget(previewTarget),
            dataSensitivity: input.dataSensitivity,
            supported: validation.supported,
            backend: validation.backend,
            wouldExecute: false,
            reasons: previewReasons(validation.reason, preflightSafety.reasons),
            saferAlternative: guideAlternative("Resolve the active window manually before using generic GUI typing."),
            observations: ["Previewed desktop typing without sending any text."]
          });
        }

        const postResolutionSafety = evaluateSafety(
          {
            tool: "desktop.type_text",
            actionType: "gui_type",
            strategy: "gui_control",
            ...(validation.activeWindow.appName === undefined ? {} : { appName: validation.activeWindow.appName }),
            ...(input.dataSensitivity === undefined ? {} : { dataSensitivity: input.dataSensitivity })
          },
          context.policy,
          createSafetyEvaluationContext(context)
        );

        return buildPreviewResult({
          tool: "desktop.type_text",
          riskLevel: "medium",
          strategy: "gui_control",
          safety: postResolutionSafety,
          targetSummary: summarizeWindow(validation.activeWindow),
          target: toWindowPreviewTarget(validation.activeWindow),
          dataSensitivity: input.dataSensitivity,
          supported: true,
          backend: validation.backend,
          confirmation: {
            manager: context.confirmations,
            sessionId: context.sessionId,
            input,
            target: validation.activeWindow,
            explanation: "Use this token to type the exact previewed text into the same active window before it expires.",
            riskLevel: postResolutionSafety.riskLevel,
            appSensitivity: postResolutionSafety.appSensitivity,
            dataSensitivity: input.dataSensitivity
          },
          reasons: previewReasons(`Would type ${input.text.length} characters into the active window.`, postResolutionSafety.reasons),
          saferAlternative: postResolutionSafety.blocked
            ? guideAlternative("Sensitive app text entry should stay blocked or guide-only.")
            : undefined,
          observations: ["Previewed desktop typing without sending any text."]
        });
      }

      const validation = await validateActiveWindowForPreview(context, activeWindow);

        if (!validation.supported || !("matched" in validation) || !validation.matched) {
          return toolFailure({
            tool: "desktop.type_text",
            riskLevel: runtime?.safetyDecision?.riskLevel ?? "medium",
            strategy: "gui_control",
            confirmation: rejectedConfirmation(undefined, validation.reason),
            error: {
              code: "confirmation_rejected",
              message: validation.reason
            },
            observations: [validation.reason]
          });
        }

        const postResolutionSafety = evaluateSafety(
          {
            tool: "desktop.type_text",
            actionType: "gui_type",
            strategy: "gui_control",
            ...(validation.activeWindow.appName === undefined ? {} : { appName: validation.activeWindow.appName }),
            ...(input.dataSensitivity === undefined ? {} : { dataSensitivity: input.dataSensitivity })
          },
          context.policy,
          createSafetyEvaluationContext(context)
        );

      if (!postResolutionSafety.allowed) {
        return safetyFailure("desktop.type_text", postResolutionSafety);
      }

      if (input.confirmationToken === undefined) {
        const { code, reason } = missingConfirmationReason(postResolutionSafety);
        return toolFailure({
          tool: "desktop.type_text",
          riskLevel: postResolutionSafety.riskLevel,
          strategy: "gui_control",
          confirmation: confirmationRequired(reason),
          error: {
            code,
            message: reason
          },
          observations: [reason]
        });
      }
      const verification = context.confirmations.verifyAndConsume(input.confirmationToken, {
        sessionId: context.sessionId,
        tool: "desktop.type_text",
        input,
        target: validation.activeWindow,
        riskLevel: postResolutionSafety.riskLevel
      });

      if (!verification.ok) {
        return toolFailure({
          tool: "desktop.type_text",
          riskLevel: postResolutionSafety.riskLevel,
          strategy: "gui_control",
          confirmation: rejectedConfirmation(verification.tokenId, verification.reason),
          error: {
            code: "confirmation_rejected",
            message: verification.reason
          },
          observations: [verification.reason]
        });
      }

      return toolSuccess({
        tool: "desktop.type_text",
        riskLevel: "medium",
        strategy: "gui_control",
        confirmation: acceptedConfirmation(verification.tokenId, true, "Confirmation token accepted and desktop typing executed."),
        data: await context.linux.typeText({
          text: input.text,
          activeWindow
        }),
        observations: ["Typed text using the generic GUI fallback backend."]
      });
    }
  };

  const click: AgentHostToolDefinition<ClickInput, DesktopClickResult | ActionPreviewResult, AgentHostMcpContext> = {
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
        activeWindow: activeWindowMcpSchema,
        dryRun: { type: "boolean" },
        confirmationToken: { type: "string", minLength: 1, maxLength: 500 }
      },
      required: ["x", "y", "activeWindow"],
      additionalProperties: false
    },
    inputSummary: "Click desktop coordinates",
    safety: {
      actionType: "inspect",
      getInput: (input) => {
        const appName = activeWindowAppName(toActiveWindowContext(input.activeWindow));
        return appName === undefined ? {} : { appName };
      }
    },
    preview: {
      isDryRun: (input) => input.dryRun === true
    },
    async handler(input, context, runtime): Promise<ToolResult<DesktopClickResult | ActionPreviewResult>> {
      const activeWindow = toActiveWindowContext(input.activeWindow);

      if (runtime?.isDryRun) {
        const preflightSafety = initialGuiSafety(runtime, context, "desktop.click", "gui_click", activeWindow);
        const validation = await validateActiveWindowForPreview(context, activeWindow);
        const previewTarget = validation.supported && "activeWindow" in validation
          ? validation.activeWindow
          : activeWindow;

        if (!validation.supported || ("matched" in validation && !validation.matched)) {
          return buildPreviewResult({
            tool: "desktop.click",
            riskLevel: "medium",
            strategy: "gui_control",
            safety: preflightSafety,
            targetSummary: summarizeWindow(previewTarget),
            target: toWindowPreviewTarget(previewTarget),
            supported: validation.supported,
            backend: validation.backend,
            wouldExecute: false,
            reasons: previewReasons(validation.reason, preflightSafety.reasons),
            saferAlternative: guideAlternative("Resolve the active window manually before using generic GUI clicking."),
            observations: ["Previewed a desktop click without sending input."]
          });
        }

        const postResolutionSafety = evaluateSafety(
          {
            tool: "desktop.click",
            actionType: "gui_click",
            strategy: "gui_control",
            ...(validation.activeWindow.appName === undefined ? {} : { appName: validation.activeWindow.appName })
          },
          context.policy,
          createSafetyEvaluationContext(context)
        );

        return buildPreviewResult({
          tool: "desktop.click",
          riskLevel: "medium",
          strategy: "gui_control",
          safety: postResolutionSafety,
          targetSummary: summarizeWindow(validation.activeWindow),
          target: toWindowPreviewTarget(validation.activeWindow),
          supported: true,
          backend: validation.backend,
          confirmation: {
            manager: context.confirmations,
            sessionId: context.sessionId,
            input,
            target: validation.activeWindow,
            explanation: "Use this token to click the exact previewed coordinates in the same active window before it expires.",
            riskLevel: postResolutionSafety.riskLevel,
            appSensitivity: postResolutionSafety.appSensitivity
          },
          reasons: previewReasons(
            `Would click (${input.x}, ${input.y}) with ${input.button ?? "left"} button in the active window.`,
            postResolutionSafety.reasons
          ),
          saferAlternative: postResolutionSafety.blocked
            ? guideAlternative("Sensitive app clicking should stay blocked or guide-only.")
            : undefined,
          observations: ["Previewed a desktop click without sending input."]
        });
      }

      const clickInput: {
        x: number;
        y: number;
        button?: DesktopMouseButton;
        activeWindow: DesktopWindowContext;
      } = {
        x: input.x,
        y: input.y,
        activeWindow
      };

      if (input.button !== undefined) {
        clickInput.button = input.button;
      }

      const validation = await validateActiveWindowForPreview(context, activeWindow);

        if (!validation.supported || !("matched" in validation) || !validation.matched) {
          return toolFailure({
            tool: "desktop.click",
            riskLevel: runtime?.safetyDecision?.riskLevel ?? "medium",
            strategy: "gui_control",
            confirmation: rejectedConfirmation(undefined, validation.reason),
            error: {
              code: "confirmation_rejected",
              message: validation.reason
            },
            observations: [validation.reason]
          });
        }

        const postResolutionSafety = evaluateSafety(
          {
            tool: "desktop.click",
            actionType: "gui_click",
            strategy: "gui_control",
            ...(validation.activeWindow.appName === undefined ? {} : { appName: validation.activeWindow.appName })
          },
          context.policy,
          createSafetyEvaluationContext(context)
        );

      if (!postResolutionSafety.allowed) {
        return safetyFailure("desktop.click", postResolutionSafety);
      }

      if (input.confirmationToken === undefined) {
        const { code, reason } = missingConfirmationReason(postResolutionSafety);
        return toolFailure({
          tool: "desktop.click",
          riskLevel: postResolutionSafety.riskLevel,
          strategy: "gui_control",
          confirmation: confirmationRequired(reason),
          error: {
            code,
            message: reason
          },
          observations: [reason]
        });
      }
      const verification = context.confirmations.verifyAndConsume(input.confirmationToken, {
        sessionId: context.sessionId,
        tool: "desktop.click",
        input,
        target: validation.activeWindow,
        riskLevel: postResolutionSafety.riskLevel
      });

      if (!verification.ok) {
        return toolFailure({
          tool: "desktop.click",
          riskLevel: postResolutionSafety.riskLevel,
          strategy: "gui_control",
          confirmation: rejectedConfirmation(verification.tokenId, verification.reason),
          error: {
            code: "confirmation_rejected",
            message: verification.reason
          },
          observations: [verification.reason]
        });
      }

      return toolSuccess({
        tool: "desktop.click",
        riskLevel: "medium",
        strategy: "gui_control",
        confirmation: acceptedConfirmation(verification.tokenId, true, "Confirmation token accepted and desktop click executed."),
        data: await context.linux.click(clickInput),
        observations: ["Clicked desktop coordinates using the generic GUI fallback backend."]
      });
    }
  };

  function pointerTool(name: "desktop.move_mouse" | "desktop.scroll" | "desktop.double_click" | "desktop.right_click" | "desktop.drag", action: "move_mouse" | "scroll" | "double_click" | "right_click" | "drag", required: string[]): AgentHostToolDefinition<PointerInput, DesktopPointerResult | ActionPreviewResult, AgentHostMcpContext> {
    return {
      name, description: `Performs safe bounded desktop pointer action: ${action}.`, riskLevel: "medium", inputSchema: pointerInputSchema,
      mcpInputSchema: { type: "object", properties: { x: { type: "integer", minimum: 0 }, y: { type: "integer", minimum: 0 }, direction: { type: "string", enum: ["up", "down", "left", "right"] }, amount: { type: "integer", minimum: 1, maximum: 20 }, startX: { type: "integer", minimum: 0 }, startY: { type: "integer", minimum: 0 }, endX: { type: "integer", minimum: 0 }, endY: { type: "integer", minimum: 0 }, durationMs: { type: "integer", minimum: 0, maximum: 2000 }, activeWindow: activeWindowMcpSchema, dryRun: { type: "boolean" }, confirmationToken: { type: "string", minLength: 1, maxLength: 500 } }, required: ["activeWindow", ...required], additionalProperties: false },
      inputSummary: `Desktop pointer ${action}`,
      safety: { actionType: "inspect", getInput: (input) => input.activeWindow.appName === undefined ? {} : { appName: input.activeWindow.appName } },
      preview: { isDryRun: (input) => input.dryRun === true },
      async handler(input, context, runtime): Promise<ToolResult<DesktopPointerResult | ActionPreviewResult>> {
        const activeWindow = toActiveWindowContext(input.activeWindow);
        const missing = required.some((key) => input[key as keyof PointerInput] === undefined) || ((action === "double_click" || action === "right_click") && ((input.x === undefined) !== (input.y === undefined)));
        if (missing) return toolFailure({ tool: name, riskLevel: "medium", error: { code: "invalid_input", message: "Pointer action is missing required coordinates or has incomplete coordinate pair." }, observations: ["Rejected pointer action before desktop access."] });
        const validation = await validateActiveWindowForPreview(context, activeWindow);
        const safety = evaluateSafety({ tool: name, actionType: "gui_click", strategy: "gui_control", ...(validation.supported && "activeWindow" in validation && validation.activeWindow.appName !== undefined ? { appName: validation.activeWindow.appName } : activeWindow.appName === undefined ? {} : { appName: activeWindow.appName }) }, context.policy, createSafetyEvaluationContext(context));
        const target = { activeWindow: validation.supported && "activeWindow" in validation ? validation.activeWindow : activeWindow, action, x: input.x, y: input.y, direction: input.direction, amount: input.amount, startX: input.startX, startY: input.startY, endX: input.endX, endY: input.endY, durationMs: input.durationMs };
        if (runtime?.isDryRun) return buildPreviewResult({ tool: name, riskLevel: "medium", strategy: "gui_control", safety, targetSummary: summarizeWindow(target.activeWindow), target: toWindowPreviewTarget(target.activeWindow), supported: validation.supported && "matched" in validation && validation.matched, backend: validation.backend, wouldExecute: validation.supported && "matched" in validation && validation.matched && safety.allowed, confirmation: validation.supported && "matched" in validation && validation.matched && safety.allowed ? { manager: context.confirmations, sessionId: context.sessionId, input, target, explanation: "Use token only for exact previewed pointer action.", riskLevel: safety.riskLevel, appSensitivity: safety.appSensitivity } : undefined, reasons: previewReasons(`Would perform ${action}; prefer accessibility action when semantic element exists.`, safety.reasons), saferAlternative: guideAlternative("Prefer accessibility.find_element and accessibility.invoke_action for named controls."), observations: ["Previewed pointer action without moving pointer or clicking."] });
        if (!validation.supported || !("matched" in validation) || !validation.matched) return toolFailure({ tool: name, riskLevel: safety.riskLevel, error: { code: "active_window_mismatch", message: validation.reason }, observations: [validation.reason] });
        if (!safety.allowed) return safetyFailure(name, safety);
        if (input.confirmationToken === undefined) { const { code, reason } = missingConfirmationReason(safety); return toolFailure({ tool: name, riskLevel: safety.riskLevel, confirmation: confirmationRequired(reason), error: { code, message: reason }, observations: [reason] }); }
        const verification = context.confirmations.verifyAndConsume(input.confirmationToken, { sessionId: context.sessionId, tool: name, input, target, riskLevel: safety.riskLevel });
        if (!verification.ok) return toolFailure({ tool: name, riskLevel: safety.riskLevel, confirmation: rejectedConfirmation(verification.tokenId, verification.reason), error: { code: "confirmation_rejected", message: verification.reason }, observations: [verification.reason] });
        const data = context.linux.pointer === undefined ? { supported: false, backend: "unavailable", performed: false, action, activeWindow: validation.activeWindow, reason: "Pointer backend is unavailable." } : await context.linux.pointer({ action, activeWindow: validation.activeWindow, ...(input.x === undefined ? {} : { x: input.x }), ...(input.y === undefined ? {} : { y: input.y }), ...(input.direction === undefined ? {} : { direction: input.direction }), ...(input.amount === undefined ? {} : { amount: input.amount }), ...(input.startX === undefined ? {} : { startX: input.startX }), ...(input.startY === undefined ? {} : { startY: input.startY }), ...(input.endX === undefined ? {} : { endX: input.endX }), ...(input.endY === undefined ? {} : { endY: input.endY }), ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }) });
        return toolSuccess({ tool: name, riskLevel: safety.riskLevel, strategy: "gui_control", confirmation: acceptedConfirmation(verification.tokenId, true, "Confirmation token accepted and pointer action executed."), data, observations: [`${action} on ${summarizeWindow(validation.activeWindow)} executed with bounded pointer parameters.`] });
      }
    };
  }

  const moveMouse = pointerTool("desktop.move_mouse", "move_mouse", ["x", "y"]);
  const scroll = pointerTool("desktop.scroll", "scroll", ["direction", "amount"]);
  const doubleClick = pointerTool("desktop.double_click", "double_click", []);
  const rightClick = pointerTool("desktop.right_click", "right_click", []);
  const drag = pointerTool("desktop.drag", "drag", ["startX", "startY", "endX", "endY"]);
  return [getActiveWindow, getCapabilities, screenshot, hotkey, typeText, click, moveMouse, scroll, doubleClick, rightClick, drag];
}
