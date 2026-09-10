import { toolFailure, toolSuccess, type ToolResult } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";
import { beginTakeover, clearStop, endTakeover, isStopRequested, isTakeoverActive, requestStop } from "../stop-flag.js";

const empty = z.object({}).strict();

/**
 * Agent control plane: status, hard stop/resume, human takeover, capability discovery.
 * Stop/takeover are enforced by the central runner, independent of model cooperation.
 */
export function createAgentTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const status: AgentHostToolDefinition<z.infer<typeof empty>, unknown, AgentHostMcpContext> = {
    name: "agent.status",
    description: "Returns agent operational status: stop flag, takeover state, loaded tool counts, and adapter summary.",
    riskLevel: "observe",
    inputSchema: empty,
    mcpInputSchema: { type: "object", properties: {}, additionalProperties: false },
    inputSummary: "Agent status",
    safety: { actionType: "observe" },
    async handler(_input, context): Promise<ToolResult<unknown>> {
      const stopped = await isStopRequested(context.config.agentHostDir);
      const takeover = await isTakeoverActive(context.config.agentHostDir);
      const tools = context.registry.listTools();
      const byClass: Record<string, number> = {};
      for (const tool of tools) {
        const key = (tool as { execution?: { executionClass?: string } }).execution?.executionClass ?? "unknown";
        byClass[key] = (byClass[key] ?? 0) + 1;
      }
      return toolSuccess({
        tool: "agent.status",
        riskLevel: "observe",
        data: { stopped, takeoverActive: takeover, toolCount: tools.length, byExecutionClass: byClass, adapters: context.adapters },
        observations: stopped
          ? ["Emergency stop is active; state-changing tools are halted until resume."]
          : takeover
            ? ["Human takeover is active; re-observe after it ends."]
            : ["Agent is accepting governed actions under policy."]
      });
    }
  };

  const stop: AgentHostToolDefinition<z.infer<typeof empty>, unknown, AgentHostMcpContext> = {
    name: "agent.stop",
    description: "Requests an immediate hard stop of further state-changing agent actions. Independent of model cooperation.",
    riskLevel: "low",
    inputSchema: empty,
    mcpInputSchema: { type: "object", properties: {}, additionalProperties: false },
    inputSummary: "Stop agent actions",
    safety: { actionType: "inspect" },
    async handler(_input, context): Promise<ToolResult<unknown>> {
      await requestStop(context.config.agentHostDir, "agent_stop_tool");
      return toolSuccess({ tool: "agent.stop", riskLevel: "low", data: { stopped: true }, observations: ["Stop requested; central runner now halts state-changing tools."] });
    }
  };

  const resume: AgentHostToolDefinition<z.infer<typeof empty>, unknown, AgentHostMcpContext> = {
    name: "agent.resume",
    description: "Clears a previous stop/takeover and resumes governed execution. The agent must re-observe before continuing.",
    riskLevel: "low",
    inputSchema: empty,
    mcpInputSchema: { type: "object", properties: {}, additionalProperties: false },
    inputSummary: "Resume agent actions",
    safety: { actionType: "inspect" },
    async handler(_input, context): Promise<ToolResult<unknown>> {
      await clearStop(context.config.agentHostDir);
      return toolSuccess({ tool: "agent.resume", riskLevel: "low", data: { stopped: false }, observations: ["Resumed. Re-observe computer state with computer.observe_state before continuing."] });
    }
  };

  const takeoverBegin: AgentHostToolDefinition<z.infer<typeof empty>, unknown, AgentHostMcpContext> = {
    name: "agent.takeover_begin",
    description: "Hands control to the human operator (mouse/keyboard/browser). Agent actions halt until takeover ends.",
    riskLevel: "low",
    inputSchema: empty,
    mcpInputSchema: { type: "object", properties: {}, additionalProperties: false },
    inputSummary: "Begin human takeover",
    safety: { actionType: "inspect" },
    async handler(_input, context): Promise<ToolResult<unknown>> {
      await beginTakeover(context.config.agentHostDir);
      return toolSuccess({ tool: "agent.takeover_begin", riskLevel: "low", data: { takeoverActive: true }, observations: ["Human now controls the machine."] });
    }
  };

  const takeoverEnd: AgentHostToolDefinition<z.infer<typeof empty>, unknown, AgentHostMcpContext> = {
    name: "agent.takeover_end",
    description: "Returns control from the human operator to the agent. The agent must re-observe before continuing.",
    riskLevel: "low",
    inputSchema: empty,
    mcpInputSchema: { type: "object", properties: {}, additionalProperties: false },
    inputSummary: "End human takeover",
    safety: { actionType: "inspect" },
    async handler(_input, context): Promise<ToolResult<unknown>> {
      await endTakeover(context.config.agentHostDir);
      return toolSuccess({ tool: "agent.takeover_end", riskLevel: "low", data: { takeoverActive: false }, observations: ["Control returned. Re-observe with computer.observe_state before continuing."] });
    }
  };

  const discover: AgentHostToolDefinition<z.infer<typeof empty>, unknown, AgentHostMcpContext> = {
    name: "agent.discover_capabilities",
    description: "Discovers runtime capabilities at runtime: capability families, loaded tool counts, adapters, browser/desktop/overlay/speech availability.",
    riskLevel: "observe",
    inputSchema: empty,
    mcpInputSchema: { type: "object", properties: {}, additionalProperties: false },
    inputSummary: "Discover capabilities",
    safety: { actionType: "observe" },
    async handler(_input, context): Promise<ToolResult<unknown>> {
      let browserStatus: unknown = { enabled: false };
      try {
        browserStatus = context.browser === undefined ? { enabled: false, reason: "browser_bridge_disabled" } : await context.browser.detect();
      } catch {
        browserStatus = { enabled: false, reason: "browser_probe_failed" };
      }
      let desktopCapabilities: unknown = {};
      try {
        desktopCapabilities = await context.linux.getDesktopCapabilities();
      } catch {
        desktopCapabilities = { supported: false };
      }
      const families = ["computer", "browser", "filesystem", "shell", "applications", "mcp", "network", "vision", "ocr", "speech", "skills"];
      return toolSuccess({
        tool: "agent.discover_capabilities",
        riskLevel: "observe",
        data: { families, toolCount: context.registry.listTools().length, adapters: context.adapters, browser: browserStatus, desktop: desktopCapabilities },
        observations: ["Compose these capabilities dynamically; no custom workflow is required per task."]
      });
    }
  };

  return [status, stop, resume, takeoverBegin, takeoverEnd, discover];
}
