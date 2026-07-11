import { toolSuccess, type SandboxSupportProbeResult, type ToolResult } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";

const emptyInputSchema = z.object({}).strict();
const emptyMcpInputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false
};

function unavailableProbe(): SandboxSupportProbeResult {
  const unavailable = (id: SandboxSupportProbeResult["availableBackends"][number]["id"]) => ({
    id,
    detected: false as const,
    reason: "Linux probe is unavailable in this server context."
  });

  return {
    platform: process.platform,
    supported: false,
    availableBackends: [],
    unavailableBackends: [
      unavailable("bubblewrap"),
      unavailable("firejail"),
      unavailable("unshare"),
      unavailable("flatpak-spawn"),
      unavailable("nsjail"),
      unavailable("systemd-run")
    ],
    recommendedBackend: null,
    kernelFeatures: {
      userNamespaces: { status: "unknown", reason: "Linux probe is unavailable in this server context." },
      seccomp: { status: "unknown", reason: "Linux probe is unavailable in this server context." },
      appArmor: { status: "unknown", reason: "Linux probe is unavailable in this server context." },
      flatpakContainer: { status: "unknown", reason: "Linux probe is unavailable in this server context." }
    },
    limitations: ["This result is a safe fallback; no sandbox command was executed."],
    requiresInstall: true,
    requiresSudo: false,
    safeForAgentHostUse: false,
    notes: ["Phase 22 only probes availability; it does not enable sandbox execution."]
  };
}

export function createForgeSandboxTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const checkSandboxSupport: AgentHostToolDefinition<
    Record<string, never>,
    SandboxSupportProbeResult,
    AgentHostMcpContext
  > = {
    name: "forge.check_sandbox_support",
    description: "Reports read-only OS-level sandbox support without executing a sandbox or changing system state.",
    riskLevel: "observe",
    inputSchema: emptyInputSchema,
    mcpInputSchema: emptyMcpInputSchema,
    inputSummary: "Check OS sandbox support",
    safety: {
      actionType: "observe"
    },
    async handler(_input, context): Promise<ToolResult<SandboxSupportProbeResult>> {
      const data = context.linux.checkSandboxSupport === undefined
        ? unavailableProbe()
        : await context.linux.checkSandboxSupport();

      return toolSuccess({
        tool: "forge.check_sandbox_support",
        riskLevel: "observe",
        data,
        observations: [
          "Checked fixed sandbox executable names and bounded kernel markers without executing commands.",
          "No install, sudo, network access, generated code, or runtime behavior change was performed."
        ]
      });
    }
  };

  return [checkSandboxSupport];
}
