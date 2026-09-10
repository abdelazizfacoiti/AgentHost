import { toolSuccess, type ToolResult } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";

const empty = z.object({}).strict();

/**
 * First-class observation for the computer-use loop.
 * After every ACT, the agent calls observe to VERIFY the outcome before continuing.
 * Returns only metadata/summaries (no screenshots, keystrokes, or private content).
 */
export function createComputerTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const observe: AgentHostToolDefinition<z.infer<typeof empty>, unknown, AgentHostMcpContext> = {
    name: "computer.observe_state",
    description: "Observes current computer state: active window, screen geometry, desktop capabilities. Call after actions to verify outcomes and recover from failures.",
    riskLevel: "observe",
    inputSchema: empty,
    mcpInputSchema: { type: "object", properties: {}, additionalProperties: false },
    inputSummary: "Observe computer state",
    safety: { actionType: "observe" },
    async handler(_input, context): Promise<ToolResult<unknown>> {
      const [activeWindow, capabilities] = await Promise.all([
        context.linux.getActiveWindow(),
        context.linux.getDesktopCapabilities()
      ]);
      const geometry = context.linux.getScreenGeometry === undefined
        ? { supported: false, reason: "geometry_unavailable" }
        : await context.linux.getScreenGeometry();
      return toolSuccess({
        tool: "computer.observe_state",
        riskLevel: "observe",
        data: { activeWindow, capabilities, geometry },
        observations: [
          "Observation only; no action was executed.",
          "If the observed state does not match the intended outcome, diagnose, re-observe, and retry or choose an alternative capability."
        ]
      });
    }
  };
  return [observe];
}
