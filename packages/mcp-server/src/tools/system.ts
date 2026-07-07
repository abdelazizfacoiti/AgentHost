import type { CapabilityList, SystemInfo, ToolResult } from "@agenthost/core";
import { toolSuccess } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostToolDefinition, ToolExecutionContext } from "../tool-runner.js";

const emptyInputSchema = z.object({}).strict();

const emptyMcpInputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false
};

type EmptyInput = z.infer<typeof emptyInputSchema>;

export interface SystemToolContext extends ToolExecutionContext {
  getSystemInfo(): Promise<SystemInfo> | SystemInfo;
}

export function createSystemTools(): AgentHostToolDefinition<EmptyInput, unknown, SystemToolContext>[] {
  const getInfo: AgentHostToolDefinition<EmptyInput, SystemInfo, SystemToolContext> = {
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
        data: await context.getSystemInfo(),
        observations: ["Returned local runtime information."]
      });
    }
  };

  const listCapabilities: AgentHostToolDefinition<EmptyInput, CapabilityList, SystemToolContext> = {
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

  return [getInfo, listCapabilities];
}
