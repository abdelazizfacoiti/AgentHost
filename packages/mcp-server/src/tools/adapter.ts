import { toolFailure, toolSuccess, type AdapterRegistrySnapshot, type ToolResult } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";

const emptyInput = z.object({}).strict();
const idInput = z.object({ adapterId: z.string().trim().min(1).max(100) }).strict();

export function createAdapterTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const list: AgentHostToolDefinition<z.infer<typeof emptyInput>, AdapterRegistrySnapshot, AgentHostMcpContext> = {
    name: "adapter.list",
    description: "Lists registered adapters.",
    riskLevel: "observe",
    inputSchema: emptyInput,
    mcpInputSchema: { type: "object", properties: {}, additionalProperties: false },
    inputSummary: "List adapters",
    safety: { actionType: "observe" },
    async handler(_input, context) {
      return toolSuccess({ tool: "adapter.list", riskLevel: "observe", data: context.adapters, observations: ["Listed adapters."] });
    }
  };

  const get: AgentHostToolDefinition<z.infer<typeof idInput>, unknown, AgentHostMcpContext> = {
    name: "adapter.get",
    description: "Gets details for a specific adapter.",
    riskLevel: "observe",
    inputSchema: idInput,
    mcpInputSchema: { type: "object", properties: { adapterId: { type: "string" } }, required: ["adapterId"], additionalProperties: false },
    inputSummary: "Get adapter",
    safety: { actionType: "observe" },
    async handler(input, context) {
      const adapter = context.adapters.get(input.adapterId);
      if (!adapter) {
        return toolFailure({ tool: "adapter.get", riskLevel: "low", error: { code: "not_found", message: "Adapter not found." } });
      }
      return toolSuccess({ tool: "adapter.get", riskLevel: "observe", data: adapter, observations: ["Returned adapter details."] });
    }
  };

  return [list, get];
}