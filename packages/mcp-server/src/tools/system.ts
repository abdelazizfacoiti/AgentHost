import type { CapabilityList, DependencyCheckResult, DependencyKind, SystemInfo, ToolResult } from "@agenthost/core";
import { toolSuccess } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";
import type { AgentHostMcpContext } from "../context.js";

const emptyInputSchema = z.object({}).strict();

const emptyMcpInputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false
};

type EmptyInput = z.infer<typeof emptyInputSchema>;

const checkDependencyInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    kind: z.enum(["command", "desktop_app", "any"]).optional()
  })
  .strict();

type CheckDependencyInput = z.infer<typeof checkDependencyInputSchema>;

export function createSystemTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const getInfo: AgentHostToolDefinition<EmptyInput, SystemInfo, AgentHostMcpContext> = {
    name: "system.get_info",
    description: "Returns local system information and AgentHost runtime details.",
    riskLevel: "observe",
    inputSchema: emptyInputSchema,
    mcpInputSchema: emptyMcpInputSchema,
    inputSummary: "Get system info",
    safety: {
      actionType: "observe"
    },
    async handler(_input, context): Promise<ToolResult<SystemInfo>> {
      return toolSuccess({
        tool: "system.get_info",
        riskLevel: "observe",
        data: await context.linux.getSystemInfo(),
        observations: ["Returned local runtime information."]
      });
    }
  };

  const listCapabilities: AgentHostToolDefinition<EmptyInput, CapabilityList, AgentHostMcpContext> = {
    name: "system.list_capabilities",
    description: "Lists AgentHost strategies, tools, and registered app capabilities.",
    riskLevel: "observe",
    inputSchema: emptyInputSchema,
    mcpInputSchema: emptyMcpInputSchema,
    inputSummary: "List AgentHost capabilities",
    safety: {
      actionType: "observe"
    },
    handler(_input, context): ToolResult<CapabilityList> {
      return toolSuccess({
        tool: "system.list_capabilities",
        riskLevel: "observe",
        data: {
          strategies: context.registry.listStrategies(),
          tools: context.registry.listTools(),
          appCapabilities: context.registry.listAppCapabilities()
        },
        observations: ["Returned registered Phase 0 and Phase 1 capabilities."]
      });
    }
  };

  const checkDependency: AgentHostToolDefinition<CheckDependencyInput, DependencyCheckResult, AgentHostMcpContext> = {
    name: "system.check_dependency",
    description: "Checks whether a command or desktop app appears to be available.",
    riskLevel: "low",
    inputSchema: checkDependencyInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          minLength: 1,
          maxLength: 200
        },
        kind: {
          type: "string",
          enum: ["command", "desktop_app", "any"]
        }
      },
      required: ["name"],
      additionalProperties: false
    },
    inputSummary: "Check dependency",
    safety: {
      actionType: "inspect"
    },
    async handler(input, context): Promise<ToolResult<DependencyCheckResult>> {
      const dependencyInput: { name: string; kind?: DependencyKind } = {
        name: input.name
      };

      if (input.kind !== undefined) {
        dependencyInput.kind = input.kind;
      }

      return toolSuccess({
        tool: "system.check_dependency",
        riskLevel: "low",
        data: await context.linux.checkDependency(dependencyInput),
        observations: ["Checked dependency availability without executing it."]
      });
    }
  };

  return [getInfo, listCapabilities, checkDependency];
}
