import {
  createAdapterRegistry,
  createBaseCapabilityRegistry,
  getPolicyProfile,
  type AgentHostConfig,
  type AuditLogEntry,
  type AuditLogger
} from "@agenthost/core";
import { describe, expect, it } from "vitest";
import type { AgentHostMcpContext, LinuxAutomation } from "../context.js";
import { runTool } from "../tool-runner.js";
import { createGuideTools } from "../tools/guide.js";

class MemoryLogger implements AuditLogger {
  readonly entries: AuditLogEntry[] = [];

  async log(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

function createContext(profile: "strict" | "dev" = "strict"): AgentHostMcpContext & { logger: MemoryLogger } {
  const registry = createBaseCapabilityRegistry();
  const policy = getPolicyProfile(profile);
  const config: AgentHostConfig = {
    agentHostDir: "/tmp/agenthost-guide-test",
    configPath: "/tmp/agenthost-guide-test/config.json",
    logFile: "/tmp/agenthost-guide-test/logs/agenthost.jsonl",
    profile,
    policy
  };
  const linux: LinuxAutomation = {
    getSystemInfo: () => ({
      platform: "linux",
      arch: "x64",
      nodeVersion: "v20.0.0",
      agentHostDir: config.agentHostDir,
      profile,
      strategies: registry.listStrategies(),
      tools: registry.listTools().map((tool) => tool.name)
    }),
    checkDependency: async (input) => ({
      found: false,
      kind: input.kind ?? "any",
      name: input.name,
      reason: "Not used in guide tests."
    }),
    detectApp: async (input) => ({
      found: false,
      appId: `unknown:${input.appName}`,
      adapterAvailable: false,
      availableStrategies: ["guide_only"],
      recommendedStrategy: "guide_only",
      appSensitivity: "unknown",
      reason: "Not used in guide tests."
    }),
    listInstalledApps: async () => ({ apps: [], truncated: false }),
    openApp: async (input) => ({
      opened: false,
      appId: `unknown:${input.appName}`,
      strategy: "guide_only",
      reason: "Not used in guide tests."
    }),
    getAppStrategy: async (input) => ({
      found: false,
      appId: `unknown:${input.appName}`,
      adapterAvailable: false,
      availableStrategies: ["guide_only"],
      recommendedStrategy: "guide_only",
      appSensitivity: "unknown",
      taskType: input.taskType ?? "unknown",
      reason: "Not used in guide tests."
    }),
    runSafeCommand: async () => ({
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      durationMs: 0,
      timedOut: false,
      truncated: false
    }),
    writeFile: async (input) => ({ path: input.path, bytesWritten: input.content.length, created: true }),
    readFile: async (input) => ({
      path: input.path,
      content: "",
      encoding: input.encoding ?? "utf8",
      bytesRead: 0,
      truncated: false
    }),
    fileExists: async (input) => ({ path: input.path, exists: false }),
    listDirectory: async (input) => ({ path: input.path, entries: [], truncated: false }),
    ensureDir: async (input) => ({ path: input.path, exists: true, created: true }),
    getDesktopCapabilities: async () => ({
      platform: "linux",
      sessionType: "unknown",
      displayAvailable: false,
      backend: "unavailable",
      activeWindow: { supported: false, backend: "unavailable", reason: "Not used in guide tests." },
      screenshot: { supported: false, backend: "unavailable", reason: "Not used in guide tests." },
      windowList: { supported: false, backend: "unavailable", reason: "Not used in guide tests." },
      windowFocus: { supported: false, backend: "unavailable", reason: "Not used in guide tests." },
      accessibility: { supported: false, backend: "unavailable", reason: "Not used in guide tests." },
      guiInput: { supported: false, backend: "unavailable", reason: "Not used in guide tests." }
    }),
    getActiveWindow: async () => ({ supported: false, backend: "unavailable", reason: "Not used in guide tests." }),
    screenshot: async (input) => ({
      supported: false,
      backend: "unavailable",
      path: input.path,
      reason: "Not used in guide tests."
    }),
    listWindows: async () => ({
      supported: false,
      backend: "unavailable",
      windows: [],
      truncated: false,
      reason: "Not used in guide tests."
    }),
    focusWindow: async (input) => ({
      supported: false,
      backend: "unavailable",
      focused: false,
      window: input,
      reason: "Not used in guide tests."
    }),
    hotkey: async (input) => ({
      supported: false,
      backend: "unavailable",
      sent: false,
      keys: input.keys,
      activeWindow: input.activeWindow,
      reason: "Not used in guide tests."
    }),
    typeText: async (input) => ({
      supported: false,
      backend: "unavailable",
      typed: false,
      characterCount: input.text.length,
      activeWindow: input.activeWindow,
      reason: "Not used in guide tests."
    }),
    click: async (input) => ({
      supported: false,
      backend: "unavailable",
      clicked: false,
      x: input.x,
      y: input.y,
      button: input.button ?? "left",
      activeWindow: input.activeWindow,
      reason: "Not used in guide tests."
    }),
    getAccessibilityTree: async () => ({
      supported: false,
      backend: "unavailable",
      nodeCount: 0,
      truncated: false,
      redacted: false,
      reason: "Not used in guide tests."
    }),
    findAccessibilityElement: async () => ({
      supported: false,
      backend: "unavailable",
      candidates: [],
      reason: "Not used in guide tests."
    }),
    inspectAccessibilityElement: async () => ({
      supported: false,
      backend: "unavailable",
      matched: false,
      ambiguous: false,
      redacted: false,
      reason: "Not used in guide tests."
    }),
    invokeAccessibilityAction: async (input) => ({
      supported: false,
      backend: "unavailable",
      matched: false,
      ambiguous: false,
      performed: false,
      redacted: false,
      actionName: input.actionName,
      reason: "Not used in guide tests."
    }),
    setAccessibilityValue: async () => ({
      supported: false,
      backend: "unavailable",
      matched: false,
      ambiguous: false,
      changed: false,
      redacted: true,
      redactedValue: true,
      reason: "Not used in guide tests."
    }),
    focusAccessibilityElement: async () => ({
      supported: false,
      backend: "unavailable",
      matched: false,
      ambiguous: false,
      focused: false,
      redacted: false,
      reason: "Not used in guide tests."
    })
  };
  const logger = new MemoryLogger();

  return {
    sessionId: "session_guide",
    config,
    policy,
    registry,
    adapters: createAdapterRegistry({ platform: "linux" }),
    logger,
    linux
  };
}

async function callGuideTool(context: AgentHostMcpContext, name: string, input: unknown) {
  const tool = createGuideTools().find((candidate) => candidate.name === name);
  expect(tool).toBeDefined();
  expect(tool?.safety).toBeDefined();
  return runTool(tool!, input, context);
}

describe("guide MCP tools", () => {
  it("declares safety metadata for guide tools", () => {
    const tools = createGuideTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(["guide.create_steps", "guide.explain_strategy"]);
    expect(tools.every((tool) => tool.safety?.actionType === "observe")).toBe(true);
  });

  it("returns unknown-app guide steps and logs the call", async () => {
    const context = createContext("strict");
    const result = await callGuideTool(context, "guide.create_steps", {
      workflowGoal: "Export a report",
      appName: "Mystery App",
      appId: "unknown:mystery-app",
      workflowKind: "unknown_app"
    });

    expect(result).toMatchObject({
      ok: true,
      tool: "guide.create_steps",
      strategy: "guide_only",
      data: {
        workflowKind: "unknown_app",
        strategy: "guide_only"
      }
    });
    expect(context.logger.entries).toHaveLength(1);
    expect(context.logger.entries[0]?.tool).toBe("guide.create_steps");
  });

  it("returns communication-app guidance without executing app actions", async () => {
    const context = createContext("strict");
    const result = await callGuideTool(context, "guide.create_steps", {
      workflowGoal: "Review a draft message",
      appName: "Gmail"
    });

    expect(result.ok).toBe(true);
    expect(result.approval.status).toBe("not_required");
    expect(result.data).toMatchObject({
      appSensitivity: "communication",
      workflowKind: "sensitive_app",
      canAutomateLater: false
    });
    expect(JSON.stringify(result.data)).toContain("Review Before Sending");
  });

  it("returns normal-app guide steps suitable for future automation", async () => {
    const context = createContext("dev");
    const result = await callGuideTool(context, "guide.create_steps", {
      workflowGoal: "Export an image",
      appName: "GIMP",
      knownAppSensitivity: "normal",
      availableStrategies: ["cli_or_script", "guide_only"]
    });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      appSensitivity: "normal",
      canAutomateLater: true
    });
    expect(JSON.stringify(result.data)).toContain("app.get_strategy");
  });

  it("explains guide strategy and returns a guide suggestion", async () => {
    const context = createContext("dev");
    const result = await callGuideTool(context, "guide.explain_strategy", {
      appName: "Slack",
      taskType: "automate",
      availableStrategies: ["guide_only"],
      recommendedStrategy: "guide_only"
    });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      recommendedStrategy: "guide_only",
      appSensitivity: "communication",
      guideSuggestion: {
        suggestedTool: "guide.create_steps"
      }
    });
  });
});
