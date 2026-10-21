import { toolFailure, toolSuccess, type DesktopWindowContext, type ToolResult } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";

const observeInput = z.object({
  includeWindows: z.boolean().optional()
}).strict();

const windowMatch = z.object({
  windowId: z.string().trim().min(1).max(200).optional(),
  appName: z.string().trim().min(1).max(200).optional(),
  title: z.string().trim().min(1).max(500).optional(),
  pid: z.number().int().min(1).optional()
}).strict();

const waitInput = z.object({
  expectedActiveWindow: windowMatch.optional(),
  timeoutMs: z.number().int().min(200).max(30_000).optional()
}).strict();

function matches(expected: { windowId?: string | undefined; appName?: string | undefined; title?: string | undefined; pid?: number | undefined }, actual: DesktopWindowContext): boolean {
  return (expected.windowId === undefined || expected.windowId === actual.windowId)
    && (expected.appName === undefined || expected.appName === actual.appName)
    && (expected.pid === undefined || expected.pid === actual.pid)
    && (expected.title === undefined || expected.title === actual.title);
}

export function createComputerTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const observe: AgentHostToolDefinition<z.infer<typeof observeInput>, unknown, AgentHostMcpContext> = {
    name: "computer.observe_state",
    description: "Observes current computer state: active window, screen geometry, desktop capabilities, optionally window list. Call after actions to verify outcomes and recover from failures.",
    riskLevel: "observe",
    inputSchema: observeInput,
    mcpInputSchema: {
      type: "object",
      properties: {
        includeWindows: { type: "boolean" }
      },
      additionalProperties: false
    },
    inputSummary: "Observe computer state",
    safety: { actionType: "observe" },
    async handler(input, context): Promise<ToolResult<unknown>> {
      const [activeWindow, capabilities, geometry, windows] = await Promise.all([
        context.linux.getActiveWindow(),
        context.linux.getDesktopCapabilities(),
        context.linux.getScreenGeometry === undefined
          ? Promise.resolve({ supported: false, reason: "geometry_unavailable" })
          : context.linux.getScreenGeometry(),
        input.includeWindows === true
          ? context.linux.listWindows({ limit: 50 }).catch(() => ({ supported: false, backend: "unavailable", windows: [], truncated: false, reason: "window_list_unavailable" }))
          : Promise.resolve(undefined)
      ]);
      return toolSuccess({
        tool: "computer.observe_state",
        riskLevel: "observe",
        data: {
          activeWindow, capabilities, geometry,
          ...(windows === undefined ? {} : { windows })
        },
        observations: [
          "Observation only; no action was executed.",
          "If the observed state does not match the intended outcome, diagnose, re-observe, and retry or choose an alternative capability."
        ]
      });
    }
  };

  const waitFor: AgentHostToolDefinition<z.infer<typeof waitInput>, unknown, AgentHostMcpContext> = {
    name: "computer.wait_for",
    description: "Polls active-window state until it matches (or timeout). Replaces fixed multi-second sleeps: returns in ~150ms once the UI settles instead of burning a model turn waiting.",
    riskLevel: "observe",
    inputSchema: waitInput,
    mcpInputSchema: {
      type: "object",
      properties: {
        expectedActiveWindow: {
          type: "object",
          properties: {
            windowId: { type: "string" },
            appName: { type: "string" },
            title: { type: "string" },
            pid: { type: "integer" }
          },
          additionalProperties: false
        },
        timeoutMs: { type: "integer", minimum: 200, maximum: 30000 }
      },
      additionalProperties: false
    },
    inputSummary: "Wait for active window state",
    safety: { actionType: "observe" },
    async handler(input, context): Promise<ToolResult<unknown>> {
      const start = Date.now();
      const timeout = input.timeoutMs ?? 5000;
      while (Date.now() - start < timeout) {
        const current = await context.linux.getActiveWindow();
        if (current.supported && current.activeWindow !== undefined) {
          const expected = input.expectedActiveWindow ?? {};
          if (matches(expected, current.activeWindow)) {
            return toolSuccess({
              tool: "computer.wait_for",
              riskLevel: "observe",
              data: { matched: true, activeWindow: current.activeWindow, elapsedMs: Date.now() - start },
              observations: ["Active window matches expected state."]
            });
          }
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      return toolSuccess({
        tool: "computer.wait_for",
        riskLevel: "observe",
        data: { matched: false, elapsedMs: Date.now() - start },
        observations: ["Timeout waiting for active window to match expected state."]
      });
    }
  };

  return [observe, waitFor];
}