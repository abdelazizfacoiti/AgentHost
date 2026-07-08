import {
  evaluateSafety,
  summarizePolicyProfile,
  toolSuccess,
  listPolicyProfiles,
  type AutomationStrategy,
  type PolicyExplainDecisionResult,
  type PolicyGetProfileResult,
  type PolicyListGrantsResult,
  type PolicyListProfilesResult,
  type SafetyInput,
  type ToolResult
} from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";

const emptyInputSchema = z.object({}).strict();

const explainDecisionInputSchema = z
  .object({
    tool: z.string().trim().min(1).max(200),
    actionType: z.enum([
      "observe",
      "inspect",
      "app_launch",
      "shell_command",
      "file_read",
      "file_write",
      "file_delete",
      "gui_click",
      "gui_type",
      "accessibility_action",
      "accessibility_set_value",
      "accessibility_focus",
      "browser_action",
      "communication_send",
      "upload",
      "system_change",
      "unknown"
    ]),
    strategy: z
      .enum([
        "app_adapter",
        "official_api",
        "cli_or_script",
        "browser_automation",
        "accessibility",
        "gui_control",
        "guide_only"
      ])
      .optional(),
    generatedToolId: z.string().trim().min(1).max(200).optional(),
    generatedTool: z.boolean().optional(),
    appId: z.string().trim().min(1).max(200).optional(),
    appName: z.string().trim().min(1).max(200).optional(),
    url: z.string().trim().min(1).max(1000).optional(),
    filePath: z.string().trim().min(1).max(1000).optional(),
    shellCommand: z.string().trim().min(1).max(1000).optional(),
    dataSensitivity: z.enum(["none", "low", "sensitive", "secret"]).optional(),
    externalEffect: z.boolean().optional(),
    destructive: z.boolean().optional(),
    communicative: z.boolean().optional()
  })
  .strict();

type EmptyInput = z.infer<typeof emptyInputSchema>;
type ExplainDecisionInput = z.infer<typeof explainDecisionInputSchema>;

const emptyMcpInputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false
};

function toSafetyInput(input: ExplainDecisionInput): SafetyInput {
  return {
    tool: input.tool,
    actionType: input.actionType,
    ...(input.strategy === undefined ? {} : { strategy: input.strategy as AutomationStrategy }),
    ...(input.generatedToolId === undefined ? {} : { generatedToolId: input.generatedToolId }),
    ...(input.generatedTool === undefined ? {} : { generatedTool: input.generatedTool }),
    ...(input.appId === undefined ? {} : { appId: input.appId }),
    ...(input.appName === undefined ? {} : { appName: input.appName }),
    ...(input.url === undefined ? {} : { url: input.url }),
    ...(input.filePath === undefined ? {} : { filePath: input.filePath }),
    ...(input.shellCommand === undefined ? {} : { shellCommand: input.shellCommand }),
    ...(input.dataSensitivity === undefined ? {} : { dataSensitivity: input.dataSensitivity }),
    ...(input.externalEffect === undefined ? {} : { externalEffect: input.externalEffect }),
    ...(input.destructive === undefined ? {} : { destructive: input.destructive }),
    ...(input.communicative === undefined ? {} : { communicative: input.communicative })
  };
}

export function createPolicyTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const getProfile: AgentHostToolDefinition<EmptyInput, PolicyGetProfileResult, AgentHostMcpContext> = {
    name: "policy.get_profile",
    description: "Returns the active AgentHost permission profile and default grant requirements.",
    riskLevel: "observe",
    inputSchema: emptyInputSchema,
    mcpInputSchema: emptyMcpInputSchema,
    inputSummary: "Get policy profile",
    safety: {
      actionType: "observe"
    },
    handler(_input, context): ToolResult<PolicyGetProfileResult> {
      return toolSuccess({
        tool: "policy.get_profile",
        riskLevel: "observe",
        data: {
          activeProfile: summarizePolicyProfile(context.policy)
        },
        observations: ["Returned the active permission profile."]
      });
    }
  };

  const listProfiles: AgentHostToolDefinition<EmptyInput, PolicyListProfilesResult, AgentHostMcpContext> = {
    name: "policy.list_profiles",
    description: "Lists built-in AgentHost permission profiles and their default behavior.",
    riskLevel: "observe",
    inputSchema: emptyInputSchema,
    mcpInputSchema: emptyMcpInputSchema,
    inputSummary: "List policy profiles",
    safety: {
      actionType: "observe"
    },
    handler(): ToolResult<PolicyListProfilesResult> {
      return toolSuccess({
        tool: "policy.list_profiles",
        riskLevel: "observe",
        data: {
          profiles: listPolicyProfiles().map((profile) => summarizePolicyProfile(profile))
        },
        observations: ["Returned built-in permission profile summaries."]
      });
    }
  };

  const listGrants: AgentHostToolDefinition<EmptyInput, PolicyListGrantsResult, AgentHostMcpContext> = {
    name: "policy.list_grants",
    description: "Lists active persistent and session grants as safe summaries.",
    riskLevel: "observe",
    inputSchema: emptyInputSchema,
    mcpInputSchema: emptyMcpInputSchema,
    inputSummary: "List policy grants",
    safety: {
      actionType: "observe"
    },
    handler(_input, context): ToolResult<PolicyListGrantsResult> {
      return toolSuccess({
        tool: "policy.list_grants",
        riskLevel: "observe",
        data: {
          profile: context.policy.name,
          grants: context.grants.listGrantSummaries()
        },
        observations: ["Returned persistent and session grant summaries."]
      });
    }
  };

  const explainDecision: AgentHostToolDefinition<
    ExplainDecisionInput,
    PolicyExplainDecisionResult,
    AgentHostMcpContext
  > = {
    name: "policy.explain_decision",
    description: "Explains how the active profile and grants classify a potential action.",
    riskLevel: "low",
    inputSchema: explainDecisionInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        tool: { type: "string", minLength: 1, maxLength: 200 },
        actionType: {
          type: "string",
          enum: [
            "observe",
            "inspect",
            "app_launch",
            "shell_command",
            "file_read",
            "file_write",
            "file_delete",
            "gui_click",
            "gui_type",
            "accessibility_action",
            "accessibility_set_value",
            "accessibility_focus",
            "browser_action",
            "communication_send",
            "upload",
            "system_change",
            "unknown"
          ]
        },
        strategy: {
          type: "string",
          enum: [
            "app_adapter",
            "official_api",
            "cli_or_script",
            "browser_automation",
            "accessibility",
            "gui_control",
            "guide_only"
          ]
        },
        generatedToolId: { type: "string", minLength: 1, maxLength: 200 },
        generatedTool: { type: "boolean" },
        appId: { type: "string", minLength: 1, maxLength: 200 },
        appName: { type: "string", minLength: 1, maxLength: 200 },
        url: { type: "string", minLength: 1, maxLength: 1000 },
        filePath: { type: "string", minLength: 1, maxLength: 1000 },
        shellCommand: { type: "string", minLength: 1, maxLength: 1000 },
        dataSensitivity: { type: "string", enum: ["none", "low", "sensitive", "secret"] },
        externalEffect: { type: "boolean" },
        destructive: { type: "boolean" },
        communicative: { type: "boolean" }
      },
      required: ["tool", "actionType"],
      additionalProperties: false
    },
    inputSummary: "Explain policy decision",
    safety: {
      actionType: "inspect"
    },
    handler(input, context): ToolResult<PolicyExplainDecisionResult> {
      const safetyInput = toSafetyInput(input);
      const decision = evaluateSafety(safetyInput, context.policy, {
        agentHostDir: context.config.agentHostDir,
        grants: context.grants.listActiveGrants()
      });

      return toolSuccess({
        tool: "policy.explain_decision",
        riskLevel: "low",
        data: {
          profile: context.policy.name,
          input: safetyInput,
          decision
        },
        grantDecision: decision.grantDecision,
        observations: ["Explained how the active profile and grants classify the requested action."]
      });
    }
  };

  return [getProfile, listProfiles, listGrants, explainDecision];
}
