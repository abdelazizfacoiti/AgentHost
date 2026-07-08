import type {
  ActionPreviewResult,
  AppDetectionResult,
  AppOpenResult,
  AppStrategyResult,
  AppStrategyTaskType,
  InstalledAppSummary,
  ToolResult
} from "@agenthost/core";
import { applyAdapterDetectionToAppResult, evaluateSafety, toolFailure, toolSuccess } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";
import type { AgentHostMcpContext } from "../context.js";
import { createSafetyEvaluationContext } from "../grants.js";
import {
  acceptedConfirmation,
  buildPreviewResult,
  confirmationRequired,
  guideAlternative,
  missingConfirmationReason,
  rejectedConfirmation,
  toAppPreviewTarget
} from "./preview.js";

const appNameSchema = z.string().trim().min(1).max(200);

const detectInputSchema = z.object({ appName: appNameSchema }).strict();
const listInstalledInputSchema = z
  .object({
    query: z.string().trim().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(500).optional()
  })
  .strict();
const strategyInputSchema = z
  .object({
    appName: appNameSchema,
    taskType: z.enum(["open", "inspect", "automate", "unknown"]).optional()
  })
  .strict();
const openInputSchema = z
  .object({
    appName: appNameSchema,
    dryRun: z.boolean().optional(),
    confirmationToken: z.string().trim().min(1).max(500).optional()
  })
  .strict();

const appNameMcpInputSchema = {
  type: "object",
  properties: {
    appName: {
      type: "string",
      minLength: 1,
      maxLength: 200
    }
  },
  required: ["appName"],
  additionalProperties: false
};

type DetectInput = z.infer<typeof detectInputSchema>;
type ListInstalledInput = z.infer<typeof listInstalledInputSchema>;
type StrategyInput = z.infer<typeof strategyInputSchema>;
type OpenInput = z.infer<typeof openInputSchema>;

function previewReasons(primaryReason: string, safetyReasons: string[]): string[] {
  return safetyReasons.includes(primaryReason) ? safetyReasons : [primaryReason, ...safetyReasons];
}

export function createAppTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const detect: AgentHostToolDefinition<DetectInput, AppDetectionResult, AgentHostMcpContext> = {
    name: "app.detect",
    description: "Detects a Linux app generically and reports available automation strategies.",
    riskLevel: "low",
    inputSchema: detectInputSchema,
    mcpInputSchema: appNameMcpInputSchema,
    inputSummary: "Detect app",
    safety: {
      actionType: "inspect",
      getInput: (input) => ({ appName: input.appName })
    },
    async handler(input, context): Promise<ToolResult<AppDetectionResult>> {
      const linuxResult = await context.linux.detectApp(input);
      const data = applyAdapterDetectionToAppResult(
        linuxResult,
        context.adapters.detectForApp({ appName: input.appName, appId: linuxResult.appId })
      );

      return toolSuccess({
        tool: "app.detect",
        riskLevel: "low",
        data,
        observations: ["Detected app using generic Linux discovery."]
      });
    }
  };

  const listInstalled: AgentHostToolDefinition<
    ListInstalledInput,
    { apps: InstalledAppSummary[]; truncated: boolean },
    AgentHostMcpContext
  > = {
    name: "app.list_installed",
    description: "Lists installed Linux desktop apps and commands on a best-effort basis.",
    riskLevel: "low",
    inputSchema: listInstalledInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: 200
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 500
        }
      },
      additionalProperties: false
    },
    inputSummary: "List installed apps",
    safety: {
      actionType: "inspect"
    },
    async handler(input, context): Promise<ToolResult<{ apps: InstalledAppSummary[]; truncated: boolean }>> {
      const listInput: { query?: string; limit?: number } = {};

      if (input.query !== undefined) {
        listInput.query = input.query;
      }

      if (input.limit !== undefined) {
        listInput.limit = input.limit;
      }

      return toolSuccess({
        tool: "app.list_installed",
        riskLevel: "low",
        data: await context.linux.listInstalledApps(listInput),
        observations: ["Listed apps using generic Linux discovery."]
      });
    }
  };

  const open: AgentHostToolDefinition<OpenInput, AppOpenResult | ActionPreviewResult, AgentHostMcpContext> = {
    name: "app.open",
    description: "Opens a detected Linux app through a generic launch path.",
    riskLevel: "medium",
    inputSchema: openInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        appName: {
          type: "string",
          minLength: 1,
          maxLength: 200
        },
        dryRun: {
          type: "boolean"
        },
        confirmationToken: {
          type: "string",
          minLength: 1,
          maxLength: 500
        }
      },
      required: ["appName"],
      additionalProperties: false
    },
    inputSummary: "Open app",
    safety: {
      actionType: "app_launch",
      getInput: (input) => ({ appName: input.appName })
    },
    preview: {
      isDryRun: (input) => input.dryRun === true
    },
    async handler(input, context, runtime): Promise<ToolResult<AppOpenResult | ActionPreviewResult>> {
      if (runtime?.isDryRun) {
        const safetyDecision =
          runtime.safetyDecision ??
          evaluateSafety(
            {
              tool: "app.open",
              actionType: "app_launch",
              appName: input.appName
            },
            context.policy,
            createSafetyEvaluationContext(context)
          );
        const linuxResult = await context.linux.detectApp({ appName: input.appName });
        const data = applyAdapterDetectionToAppResult(
          linuxResult,
          context.adapters.detectForApp({ appName: input.appName, appId: linuxResult.appId })
        );

        return buildPreviewResult({
          tool: "app.open",
          riskLevel: "medium",
          strategy: data.recommendedStrategy,
          safety: safetyDecision,
          targetSummary: data.displayName ?? data.appId,
          target: toAppPreviewTarget(input.appName, data.displayName ?? data.appId),
          supported: data.found,
          confirmation: {
            manager: context.confirmations,
            sessionId: context.sessionId,
            input,
            target: {
              appId: data.appId,
              displayName: data.displayName,
              appSensitivity: data.appSensitivity,
              recommendedStrategy: data.recommendedStrategy
            },
            explanation: "Use this token to open the exact previewed app before it expires.",
            riskLevel: safetyDecision.riskLevel,
            appSensitivity: safetyDecision.appSensitivity
          },
          reasons: previewReasons(data.reason, safetyDecision.reasons),
          saferAlternative: !safetyDecision.allowed || data.recommendedStrategy === "guide_only"
            ? guideAlternative("Use guide mode when direct app launch is blocked or unsupported.")
            : undefined,
          observations: ["Previewed app launch without opening the app."]
        });
      }

      const previewData = await context.linux.detectApp({ appName: input.appName });
      const resolvedData = applyAdapterDetectionToAppResult(
        previewData,
        context.adapters.detectForApp({ appName: input.appName, appId: previewData.appId })
      );
      if (input.confirmationToken === undefined) {
        const { code, reason } = missingConfirmationReason(runtime?.safetyDecision ?? {
          ...evaluateSafety(
            {
              tool: "app.open",
              actionType: "app_launch",
              appName: input.appName
            },
            context.policy,
            createSafetyEvaluationContext(context)
          )
        });
        return toolFailure({
          tool: "app.open",
          riskLevel: runtime?.safetyDecision?.riskLevel ?? "medium",
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
        tool: "app.open",
        input,
        target: {
          appId: resolvedData.appId,
          displayName: resolvedData.displayName,
          appSensitivity: resolvedData.appSensitivity,
          recommendedStrategy: resolvedData.recommendedStrategy
        },
        riskLevel: runtime?.safetyDecision?.riskLevel ?? "medium"
      });

      if (!verification.ok) {
        return toolFailure({
          tool: "app.open",
          riskLevel: runtime?.safetyDecision?.riskLevel ?? "medium",
          confirmation: rejectedConfirmation(verification.tokenId, verification.reason),
          error: {
            code: "confirmation_rejected",
            message: verification.reason
          },
          observations: [verification.reason]
        });
      }

      const data = await context.linux.openApp({ appName: input.appName });
      return toolSuccess({
        tool: "app.open",
        riskLevel: "medium",
        strategy: data.strategy,
        confirmation: acceptedConfirmation(verification.tokenId, true, "Confirmation token accepted and app open executed."),
        data,
        observations: [data.reason]
      });
    }
  };

  const getStrategy: AgentHostToolDefinition<StrategyInput, AppStrategyResult, AgentHostMcpContext> = {
    name: "app.get_strategy",
    description: "Recommends an app-agnostic automation strategy for an app and task type.",
    riskLevel: "low",
    inputSchema: strategyInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        appName: {
          type: "string",
          minLength: 1,
          maxLength: 200
        },
        taskType: {
          type: "string",
          enum: ["open", "inspect", "automate", "unknown"]
        }
      },
      required: ["appName"],
      additionalProperties: false
    },
    inputSummary: "Get app strategy",
    safety: {
      actionType: "inspect",
      getInput: (input) => ({ appName: input.appName })
    },
    async handler(input, context): Promise<ToolResult<AppStrategyResult>> {
      const strategyInput: { appName: string; taskType?: AppStrategyTaskType } = {
        appName: input.appName
      };

      if (input.taskType !== undefined) {
        strategyInput.taskType = input.taskType as AppStrategyTaskType;
      }

      const linuxResult = await context.linux.getAppStrategy(strategyInput);
      const data = applyAdapterDetectionToAppResult(
        linuxResult,
        context.adapters.detectForApp({ appName: input.appName, appId: linuxResult.appId })
      );

      return toolSuccess({
        tool: "app.get_strategy",
        riskLevel: "low",
        data,
        observations: ["Recommended an app-agnostic strategy."]
      });
    }
  };

  return [detect, listInstalled, open, getStrategy];
}
