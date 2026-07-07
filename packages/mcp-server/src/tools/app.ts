import type {
  AppDetectionResult,
  AppOpenResult,
  AppStrategyResult,
  AppStrategyTaskType,
  InstalledAppSummary,
  ToolResult
} from "@agenthost/core";
import { applyAdapterDetectionToAppResult, toolSuccess } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";
import type { AgentHostMcpContext } from "../context.js";

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

  const open: AgentHostToolDefinition<DetectInput, AppOpenResult, AgentHostMcpContext> = {
    name: "app.open",
    description: "Opens a detected Linux app through a generic launch path.",
    riskLevel: "medium",
    inputSchema: detectInputSchema,
    mcpInputSchema: appNameMcpInputSchema,
    inputSummary: "Open app",
    safety: {
      actionType: "app_launch",
      getInput: (input) => ({ appName: input.appName })
    },
    async handler(input, context): Promise<ToolResult<AppOpenResult>> {
      const data = await context.linux.openApp(input);
      return toolSuccess({
        tool: "app.open",
        riskLevel: "medium",
        strategy: data.strategy,
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
