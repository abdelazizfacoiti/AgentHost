import { toolFailure, toolSuccess, evaluateSafety, type AppOpenResult, type ToolResult } from "@agenthost/core";
import { URL_OPEN_BROWSERS, type UrlOpenResult } from "@agenthost/os-linux";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";
import { createSafetyEvaluationContext } from "../grants.js";

const openAppInput = z.object({
  appName: z.string().trim().min(1).max(200)
}).strict();

const openUrlInput = z.object({
  url: z.string().trim().min(1).max(4000),
  browser: z.enum(URL_OPEN_BROWSERS).optional()
}).strict();

function launchSafety(tool: string, context: AgentHostMcpContext, target: { appName?: string; url?: string }) {
  return evaluateSafety(
    { tool, actionType: "app_launch", strategy: "cli_or_script", ...target },
    context.policy,
    createSafetyEvaluationContext(context)
  );
}

function safetyFailure(tool: string, safety: ReturnType<typeof evaluateSafety>): ToolResult<never> {
  return toolFailure({
    tool,
    riskLevel: safety.riskLevel,
    approval: safety.approval,
    error: { code: safety.blocked ? "safety_blocked" : "approval_required", message: safety.blocked ? "Blocked by safety engine." : "Requires approval.", details: safety },
    observations: safety.reasons
  });
}

// Query strings and fragments can carry tokens; audit and previews keep only origin + path.
function redactedUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "file:" ? "file://(local file)" : `${parsed.origin}${parsed.pathname}`.slice(0, 200);
  } catch {
    return "(invalid url)";
  }
}

export function createAppTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const openApp: AgentHostToolDefinition<z.infer<typeof openAppInput>, AppOpenResult, AgentHostMcpContext> = {
    name: "app.open",
    description: "Launches an installed desktop app by name through its desktop entry or executable. Follow with computer.wait_for windowAppears to confirm the window.",
    riskLevel: "low",
    inputSchema: openAppInput,
    mcpInputSchema: {
      type: "object",
      properties: { appName: { type: "string", minLength: 1, maxLength: 200 } },
      required: ["appName"],
      additionalProperties: false
    },
    inputSummary: "Open app",
    auditInputSummary: (i) => `Open app ${i.appName}.`,
    safety: { actionType: "app_launch", getInput: (i) => ({ appName: i.appName }) },
    async handler(input, context) {
      const safety = launchSafety("app.open", context, { appName: input.appName });
      if (!safety.allowed) return safetyFailure("app.open", safety);
      try {
        const data = await context.linux.openApp({ appName: input.appName });
        if (!data.opened) {
          return toolFailure({ tool: "app.open", riskLevel: "low", error: { code: "open_failed", message: data.reason }, observations: [data.reason] });
        }
        return toolSuccess({ tool: "app.open", riskLevel: "low", data, observations: ["Launched app; verify its window appeared before acting on it."] });
      } catch (e) {
        return toolFailure({ tool: "app.open", riskLevel: "low", error: { code: "open_failed", message: e instanceof Error ? e.message : "Open failed" } });
      }
    }
  };

  const openUrl: AgentHostToolDefinition<z.infer<typeof openUrlInput>, UrlOpenResult, AgentHostMcpContext> = {
    name: "app.open_url",
    description: "Opens an http(s) or file:// URL in the default handler, or in a new tab of a named browser (reusing its logged-in profile). Faster and layout-safe compared to typing into the address bar.",
    riskLevel: "low",
    inputSchema: openUrlInput,
    mcpInputSchema: {
      type: "object",
      properties: {
        url: { type: "string", minLength: 1, maxLength: 4000 },
        browser: { type: "string", enum: [...URL_OPEN_BROWSERS] }
      },
      required: ["url"],
      additionalProperties: false
    },
    inputSummary: "Open URL",
    auditInputSummary: (i) => `Open URL ${redactedUrl(i.url)}${i.browser === undefined ? "" : ` in ${i.browser}`}.`,
    safety: { actionType: "app_launch", getInput: (i) => ({ url: i.url, ...(i.browser === undefined ? {} : { appName: i.browser }) }) },
    async handler(input, context) {
      const safety = launchSafety("app.open_url", context, { url: input.url, ...(input.browser === undefined ? {} : { appName: input.browser }) });
      if (!safety.allowed) return safetyFailure("app.open_url", safety);
      if (context.linux.openUrl === undefined) {
        return toolFailure({ tool: "app.open_url", riskLevel: "low", error: { code: "unsupported", message: "URL opening is not available on this host." } });
      }
      try {
        const data = await context.linux.openUrl({ url: input.url, ...(input.browser === undefined ? {} : { browser: input.browser }) });
        if (!data.opened) {
          return toolFailure({ tool: "app.open_url", riskLevel: "low", error: { code: "open_failed", message: data.reason }, observations: [data.reason] });
        }
        return toolSuccess({
          tool: "app.open_url",
          riskLevel: "low",
          data: { ...data, url: redactedUrl(data.url) },
          observations: ["Opened URL; use computer.wait_for titleMatches to confirm the page loaded."]
        });
      } catch (e) {
        return toolFailure({ tool: "app.open_url", riskLevel: "low", error: { code: "open_failed", message: e instanceof Error ? e.message : "Open failed" } });
      }
    }
  };

  return [openApp, openUrl];
}
