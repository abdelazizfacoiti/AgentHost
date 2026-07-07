import {
  APP_SENSITIVITIES,
  AUTOMATION_STRATEGIES,
  GUIDE_WORKFLOW_KINDS,
  RISK_LEVELS,
  createGuideSteps,
  explainGuideStrategy,
  toolSuccess,
  type AppStrategyTaskType,
  type AutomationStrategy,
  type GuideCreateStepsInput,
  type GuideExplainStrategyInput,
  type GuideResult,
  type GuideStrategyExplanationResult,
  type GuideWorkflowKind,
  type RiskLevel,
  type ToolResult
} from "@agenthost/core";
import { z } from "zod";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";
import type { AgentHostMcpContext } from "../context.js";

const appNameSchema = z.string().trim().min(1).max(200);
const taskTypeSchema = z.enum(["open", "inspect", "automate", "unknown"]);
const strategySchema = z.enum(AUTOMATION_STRATEGIES);
const workflowKindSchema = z.enum(GUIDE_WORKFLOW_KINDS);
const appSensitivitySchema = z.enum(APP_SENSITIVITIES);
const riskLevelSchema = z.enum(RISK_LEVELS);

const createStepsInputSchema = z
  .object({
    workflowGoal: z.string().trim().min(1).max(1000),
    appName: appNameSchema.optional(),
    appId: z.string().trim().min(1).max(200).optional(),
    workflowKind: workflowKindSchema.optional(),
    taskType: taskTypeSchema.optional(),
    reason: z.string().trim().min(1).max(1000).optional(),
    availableStrategies: z.array(strategySchema).max(AUTOMATION_STRATEGIES.length).optional(),
    knownAppSensitivity: appSensitivitySchema.optional(),
    knownRiskLevel: riskLevelSchema.optional()
  })
  .strict();

const explainStrategyInputSchema = z
  .object({
    appName: appNameSchema.optional(),
    taskType: taskTypeSchema.optional(),
    availableStrategies: z.array(strategySchema).max(AUTOMATION_STRATEGIES.length).optional(),
    recommendedStrategy: strategySchema.optional(),
    reason: z.string().trim().min(1).max(1000).optional(),
    knownAppSensitivity: appSensitivitySchema.optional()
  })
  .strict();

type CreateStepsInput = z.infer<typeof createStepsInputSchema>;
type ExplainStrategyInput = z.infer<typeof explainStrategyInputSchema>;

const strategyArrayMcpSchema = {
  type: "array",
  items: {
    type: "string",
    enum: [...AUTOMATION_STRATEGIES]
  },
  maxItems: AUTOMATION_STRATEGIES.length
};

function toGuideCreateInput(input: CreateStepsInput): GuideCreateStepsInput {
  const guideInput: GuideCreateStepsInput = {
    workflowGoal: input.workflowGoal
  };

  if (input.appName !== undefined) {
    guideInput.appName = input.appName;
  }

  if (input.appId !== undefined) {
    guideInput.appId = input.appId;
  }

  if (input.workflowKind !== undefined) {
    guideInput.workflowKind = input.workflowKind as GuideWorkflowKind;
  }

  if (input.taskType !== undefined) {
    guideInput.taskType = input.taskType as AppStrategyTaskType;
  }

  if (input.reason !== undefined) {
    guideInput.reason = input.reason;
  }

  if (input.availableStrategies !== undefined) {
    guideInput.availableStrategies = input.availableStrategies as AutomationStrategy[];
  }

  if (input.knownAppSensitivity !== undefined) {
    guideInput.knownAppSensitivity = input.knownAppSensitivity;
  }

  if (input.knownRiskLevel !== undefined) {
    guideInput.knownRiskLevel = input.knownRiskLevel as RiskLevel;
  }

  return guideInput;
}

function toGuideExplainInput(input: ExplainStrategyInput): GuideExplainStrategyInput {
  const guideInput: GuideExplainStrategyInput = {};

  if (input.appName !== undefined) {
    guideInput.appName = input.appName;
  }

  if (input.taskType !== undefined) {
    guideInput.taskType = input.taskType as AppStrategyTaskType;
  }

  if (input.availableStrategies !== undefined) {
    guideInput.availableStrategies = input.availableStrategies as AutomationStrategy[];
  }

  if (input.recommendedStrategy !== undefined) {
    guideInput.recommendedStrategy = input.recommendedStrategy as AutomationStrategy;
  }

  if (input.reason !== undefined) {
    guideInput.reason = input.reason;
  }

  if (input.knownAppSensitivity !== undefined) {
    guideInput.knownAppSensitivity = input.knownAppSensitivity;
  }

  return guideInput;
}

export function createGuideTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const createSteps: AgentHostToolDefinition<CreateStepsInput, GuideResult, AgentHostMcpContext> = {
    name: "guide.create_steps",
    description: "Creates structured guide-only steps for unsupported, unknown, sensitive, or unsafe workflows.",
    riskLevel: "observe",
    inputSchema: createStepsInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        workflowGoal: {
          type: "string",
          minLength: 1,
          maxLength: 1000
        },
        appName: {
          type: "string",
          minLength: 1,
          maxLength: 200
        },
        appId: {
          type: "string",
          minLength: 1,
          maxLength: 200
        },
        workflowKind: {
          type: "string",
          enum: [...GUIDE_WORKFLOW_KINDS]
        },
        taskType: {
          type: "string",
          enum: ["open", "inspect", "automate", "unknown"]
        },
        reason: {
          type: "string",
          minLength: 1,
          maxLength: 1000
        },
        availableStrategies: strategyArrayMcpSchema,
        knownAppSensitivity: {
          type: "string",
          enum: [...APP_SENSITIVITIES]
        },
        knownRiskLevel: {
          type: "string",
          enum: [...RISK_LEVELS]
        }
      },
      required: ["workflowGoal"],
      additionalProperties: false
    },
    inputSummary: "Create guide steps",
    safety: {
      actionType: "observe"
    },
    handler(input): ToolResult<GuideResult> {
      const data = createGuideSteps(toGuideCreateInput(input));

      return toolSuccess({
        tool: "guide.create_steps",
        riskLevel: data.riskLevel,
        strategy: "guide_only",
        data,
        observations: ["Returned structured guide-only steps without executing app actions."]
      });
    }
  };

  const explainStrategy: AgentHostToolDefinition<
    ExplainStrategyInput,
    GuideStrategyExplanationResult,
    AgentHostMcpContext
  > = {
    name: "guide.explain_strategy",
    description: "Explains why guide mode is recommended and suggests structured guide steps.",
    riskLevel: "observe",
    inputSchema: explainStrategyInputSchema,
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
        },
        availableStrategies: strategyArrayMcpSchema,
        recommendedStrategy: {
          type: "string",
          enum: [...AUTOMATION_STRATEGIES]
        },
        reason: {
          type: "string",
          minLength: 1,
          maxLength: 1000
        },
        knownAppSensitivity: {
          type: "string",
          enum: [...APP_SENSITIVITIES]
        }
      },
      additionalProperties: false
    },
    inputSummary: "Explain guide strategy",
    safety: {
      actionType: "observe"
    },
    handler(input): ToolResult<GuideStrategyExplanationResult> {
      const data = explainGuideStrategy(toGuideExplainInput(input));

      return toolSuccess({
        tool: "guide.explain_strategy",
        riskLevel: data.guideSuggestion.input.knownRiskLevel ?? "observe",
        strategy: "guide_only",
        data,
        observations: ["Explained guide-only strategy without executing app actions."]
      });
    }
  };

  return [createSteps, explainStrategy];
}
