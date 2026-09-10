import { toolFailure, toolSuccess, type DesktopWindowContext, type ToolResult } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";

const observeInput = z.object({
  includeWindows: z.boolean().optional(),
  includeBrowserTabs: z.boolean().optional()
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

/**
 * First-class observation for the computer-use loop.
 * After every ACT, the agent calls observe to VERIFY the outcome before continuing.
 * Returns only metadata/summaries (no screenshots, keystrokes, or private content).
 * Optional window/tab inclusion folds three observation turns into one.
 */
export function createComputerTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const observe: AgentHostToolDefinition<z.infer<typeof observeInput>, unknown, AgentHostMcpContext> = {
    name: "computer.observe_state",
    description: "Observes current computer state: active window, screen geometry, desktop capabilities, optionally window list and browser tabs. Call after actions to verify outcomes and recover from failures.",
    riskLevel: "observe",
    inputSchema: observeInput,
    mcpInputSchema: {
      type: "object",
      properties: {
        includeWindows: { type: "boolean" },
        includeBrowserTabs: { type: "boolean" }
      },
      additionalProperties: false
    },
    inputSummary: "Observe computer state",
    safety: { actionType: "observe" },
    async handler(input, context): Promise<ToolResult<unknown>> {
      const [activeWindow, capabilities, geometry] = await Promise.all([
        context.linux.getActiveWindow(),
        context.linux.getDesktopCapabilities(),
        context.linux.getScreenGeometry === undefined
          ? Promise.resolve({ supported: false, reason: "geometry_unavailable" })
          : context.linux.getScreenGeometry()
      ]);
      const windows = input.includeWindows === true
        ? await context.linux.listWindows({ limit: 50 }).catch(() => ({ supported: false, backend: "unavailable", windows: [], truncated: false, reason: "window_list_unavailable" }))
        : undefined;
      let browserTabs: unknown = undefined;
      if (input.includeBrowserTabs === true) {
        try {
          browserTabs = context.browser === undefined
            ? { available: false, reason: "browser_bridge_disabled" }
            : { available: true, tabs: await context.browser.listTabs(25) };
        } catch {
          browserTabs = { available: false, reason: "browser_probe_failed" };
        }
      }
      return toolSuccess({
        tool: "computer.observe_state",
        riskLevel: "observe",
        data: {
          activeWindow, capabilities, geometry,
          ...(windows === undefined ? {} : { windows }),
          ...(browserTabs === undefined ? {} : { browser: browserTabs })
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
            pid: { type: "integer", minimum: 1 }
          },
          additionalProperties: false
        },
        timeoutMs: { type: "integer", minimum: 200, maximum: 30000 }
      },
      additionalProperties: false
    },
    inputSummary: "Wait for computer state",
    safety: { actionType: "observe" },
    async handler(input, context): Promise<ToolResult<unknown>> {
      const timeoutMs = input.timeoutMs ?? 5000;
      const started = Date.now();
      let attempts = 0;
      for (;;) {
        attempts += 1;
        const current = await context.linux.getActiveWindow();
        const matched = input.expectedActiveWindow === undefined
          || (current.supported && current.activeWindow !== undefined && matches(input.expectedActiveWindow, current.activeWindow));
        if (matched) {
          return toolSuccess({
            tool: "computer.wait_for",
            riskLevel: "observe",
            data: { matched: true, attempts, durationMs: Date.now() - started, activeWindow: current },
            observations: ["State matched; continue without extra settling delay."]
          });
        }
        if (Date.now() - started >= timeoutMs) {
          return toolFailure({
            tool: "computer.wait_for",
            riskLevel: "low",
            error: { code: "wait_timeout", message: "Expected computer state did not arrive before timeout." },
            observations: [`Observed ${attempts} states in ${Date.now() - started}ms; diagnose and retry or choose another capability.`]
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  };
  return [observe, waitFor];
}
