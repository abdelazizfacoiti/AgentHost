import { createHash } from "node:crypto";
import { toolSuccess, type DesktopWindowBounds, type DesktopWindowContext, type ToolResult } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";
import { createRunStepsTool } from "./run-steps.js";

const observeInput = z.object({
  includeWindows: z.boolean().optional()
}).strict();

const windowMatch = z.object({
  windowId: z.string().trim().min(1).max(200).optional(),
  appName: z.string().trim().min(1).max(200).optional(),
  title: z.string().trim().min(1).max(500).optional(),
  pid: z.number().int().min(1).optional()
}).strict();

const screenMatch = z.object({
  x: z.number().int().min(0).optional(),
  y: z.number().int().min(0).optional(),
  width: z.number().int().min(1).optional(),
  height: z.number().int().min(1).optional()
}).strict();

const waitInput = z.object({
  expectedActiveWindow: windowMatch.optional(),
  expectedWindow: windowMatch.optional(),
  expectedScreen: screenMatch.optional(),
  timeoutMs: z.number().int().min(200).max(30_000).optional()
}).strict().superRefine((value, ctx) => {
  if (value.expectedActiveWindow === undefined && value.expectedWindow === undefined && value.expectedScreen === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide expectedActiveWindow, expectedWindow, or expectedScreen." });
  }
});

function matches(expected: { windowId?: string | undefined; appName?: string | undefined; title?: string | undefined; pid?: number | undefined }, actual: DesktopWindowContext): boolean {
  return (expected.windowId === undefined || expected.windowId === actual.windowId)
    && (expected.appName === undefined || expected.appName === actual.appName)
    && (expected.pid === undefined || expected.pid === actual.pid)
    && (expected.title === undefined || expected.title === actual.title);
}

function screenMatches(expected: { x?: number | undefined; y?: number | undefined; width?: number | undefined; height?: number | undefined }, actual: DesktopWindowBounds): boolean {
  return (expected.x === undefined || expected.x === actual.x)
    && (expected.y === undefined || expected.y === actual.y)
    && (expected.width === undefined || expected.width === actual.width)
    && (expected.height === undefined || expected.height === actual.height);
}

function stateFingerprint(state: unknown): string {
  return createHash("sha256").update(JSON.stringify(state)).digest("hex").slice(0, 16);
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
    description: "Polls active-window, any-window, or screen conditions until they match (or timeout), returning a timestamped state snapshot and fingerprint. Replaces fixed multi-second sleeps.",
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
        expectedWindow: {
          type: "object",
          properties: {
            windowId: { type: "string" },
            appName: { type: "string" },
            title: { type: "string" },
            pid: { type: "integer" }
          },
          additionalProperties: false
        },
        expectedScreen: {
          type: "object",
          properties: {
            x: { type: "integer", minimum: 0 },
            y: { type: "integer", minimum: 0 },
            width: { type: "integer", minimum: 1 },
            height: { type: "integer", minimum: 1 }
          },
          additionalProperties: false
        },
        timeoutMs: { type: "integer", minimum: 200, maximum: 30000 }
      },
      additionalProperties: false
    },
    inputSummary: "Wait for window or screen state",
    safety: { actionType: "observe" },
    async handler(input, context): Promise<ToolResult<unknown>> {
      const start = Date.now();
      const timeout = input.timeoutMs ?? 5000;
      let lastState: Record<string, unknown> | undefined;
      while (Date.now() - start < timeout) {
        const screenPromise: Promise<{ supported: boolean; bounds?: DesktopWindowBounds; reason: string }> =
          context.linux.getScreenGeometry === undefined
            ? Promise.resolve({ supported: false, reason: "geometry_unavailable" })
            : context.linux.getScreenGeometry();
        const [active, screen, windows] = await Promise.all([
          context.linux.getActiveWindow(),
          screenPromise,
          input.expectedWindow === undefined
            ? Promise.resolve(undefined)
            : context.linux.listWindows({ limit: 50 }).catch(() => undefined)
        ]);
        const activeMatched = input.expectedActiveWindow === undefined
          || (active.supported && active.activeWindow !== undefined && matches(input.expectedActiveWindow, active.activeWindow));
        const screenMatched = input.expectedScreen === undefined
          || (screen.supported && screen.bounds !== undefined && screenMatches(input.expectedScreen, screen.bounds));
        const matchedWindow = input.expectedWindow === undefined
          ? undefined
          : windows?.windows.find((entry) => matches(input.expectedWindow ?? {}, entry));
        const windowMatched = input.expectedWindow === undefined || matchedWindow !== undefined;
        const state = {
          activeWindow: active.activeWindow,
          screen: screen.supported ? screen.bounds : undefined,
          window: matchedWindow,
          capturedAt: new Date().toISOString()
        };
        lastState = state;
        if (activeMatched && screenMatched && windowMatched) {
          return toolSuccess({
            tool: "computer.wait_for",
            riskLevel: "observe",
            data: { matched: true, elapsedMs: Date.now() - start, stateFingerprint: stateFingerprint(state), ...state },
            observations: ["Computer state matches expected conditions."]
          });
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      return toolSuccess({
        tool: "computer.wait_for",
        riskLevel: "observe",
        data: {
          matched: false,
          elapsedMs: Date.now() - start,
          ...(lastState === undefined ? {} : { ...lastState, stateFingerprint: stateFingerprint(lastState) })
        },
        observations: ["Timeout waiting for computer state to match expected conditions."]
      });
    }
  };

  return [observe, waitFor, createRunStepsTool()];
}