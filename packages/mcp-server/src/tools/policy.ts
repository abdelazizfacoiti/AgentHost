import { listPolicyProfiles, toolSuccess, type PolicyProfile } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";

const emptyInput = z.object({}).strict();
const profileInput = z.object({ name: z.string().trim().min(1).max(100) }).strict();

export function createPolicyTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const getProfile: AgentHostToolDefinition<z.infer<typeof profileInput>, PolicyProfile, AgentHostMcpContext> = {
    name: "policy.get_profile",
    description: "Returns the active policy profile.",
    riskLevel: "observe",
    inputSchema: emptyInput,
    mcpInputSchema: { type: "object", properties: {}, additionalProperties: false },
    inputSummary: "Get policy profile",
    safety: { actionType: "observe" },
    async handler(_input, context) {
      return toolSuccess({ tool: "policy.get_profile", riskLevel: "observe", data: context.policy, observations: ["Returned active policy profile."] });
    }
  };

  const listProfiles: AgentHostToolDefinition<z.infer<typeof emptyInput>, { profiles: string[]; current: string }, AgentHostMcpContext> = {
    name: "policy.list_profiles",
    description: "Lists available policy profiles.",
    riskLevel: "observe",
    inputSchema: emptyInput,
    mcpInputSchema: { type: "object", properties: {}, additionalProperties: false },
    inputSummary: "List policy profiles",
    safety: { actionType: "observe" },
    async handler(_input, context) {
      const profiles = listPolicyProfiles().map((profile) => profile.name);
      return toolSuccess({ tool: "policy.list_profiles", riskLevel: "observe", data: { profiles, current: context.policy.name }, observations: ["Listed policy profiles."] });
    }
  };

  return [getProfile, listProfiles];
}