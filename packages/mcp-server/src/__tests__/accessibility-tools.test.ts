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
import { createAccessibilityTools } from "../tools/accessibility.js";

class MemoryLogger implements AuditLogger {
  readonly entries: AuditLogEntry[] = [];

  async log(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

function createContext(): AgentHostMcpContext & { calls: string[]; logger: MemoryLogger } {
  const registry = createBaseCapabilityRegistry();
  const policy = getPolicyProfile("dev");
  const config: AgentHostConfig = {
    agentHostDir: "/tmp/agenthost-accessibility-test",
    configPath: "/tmp/agenthost-accessibility-test/config.json",
    logFile: "/tmp/agenthost-accessibility-test/logs/agenthost.jsonl",
    profile: "dev",
    policy
  };
  const calls: string[] = [];
  const logger = new MemoryLogger();
  const linux: LinuxAutomation = {
    getSystemInfo: () => ({
      platform: "linux",
      arch: "x64",
      nodeVersion: "v20.0.0",
      agentHostDir: config.agentHostDir,
      profile: "dev",
      strategies: registry.listStrategies(),
      tools: registry.listTools().map((tool) => tool.name)
    }),
    checkDependency: async () => ({ found: false, kind: "any", name: "noop", reason: "unused" }),
    detectApp: async () => ({
      found: false,
      appId: "unused",
      adapterAvailable: false,
      availableStrategies: ["guide_only"],
      recommendedStrategy: "guide_only",
      appSensitivity: "unknown",
      reason: "unused"
    }),
    listInstalledApps: async () => ({ apps: [], truncated: false }),
    openApp: async () => ({ opened: false, appId: "unused", strategy: "guide_only", reason: "unused" }),
    getAppStrategy: async () => ({
      found: false,
      appId: "unused",
      adapterAvailable: false,
      availableStrategies: ["guide_only"],
      recommendedStrategy: "guide_only",
      appSensitivity: "unknown",
      taskType: "unknown",
      reason: "unused"
    }),
    runSafeCommand: async () => ({
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      durationMs: 1,
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
      sessionType: "wayland",
      displayAvailable: true,
      backend: "wayland",
      activeWindow: { supported: false, backend: "wayland", reason: "unused" },
      screenshot: { supported: false, backend: "wayland", reason: "unused" },
      windowList: { supported: false, backend: "wayland", reason: "unused" },
      windowFocus: { supported: false, backend: "wayland", reason: "unused" },
      accessibility: { supported: false, backend: "wayland", reason: "unused" },
      guiInput: { supported: false, backend: "wayland", reason: "unused" }
    }),
    getActiveWindow: async () => ({ supported: false, backend: "wayland", reason: "unused" }),
    screenshot: async (input) => ({
      supported: false,
      backend: "wayland",
      path: input.path,
      reason: "unused"
    }),
    listWindows: async () => ({
      supported: false,
      backend: "wayland",
      windows: [],
      truncated: false,
      reason: "unused"
    }),
    focusWindow: async (input) => ({
      supported: false,
      backend: "wayland",
      focused: false,
      window: input,
      reason: "unused"
    }),
    hotkey: async (input) => ({
      supported: false,
      backend: "wayland",
      sent: false,
      keys: input.keys,
      activeWindow: input.activeWindow,
      reason: "unused"
    }),
    typeText: async (input) => ({
      supported: false,
      backend: "wayland",
      typed: false,
      characterCount: input.text.length,
      activeWindow: input.activeWindow,
      reason: "unused"
    }),
    click: async (input) => ({
      supported: false,
      backend: "wayland",
      clicked: false,
      x: input.x,
      y: input.y,
      button: input.button ?? "left",
      activeWindow: input.activeWindow,
      reason: "unused"
    }),
    getAccessibilityTree: async () => {
      calls.push("accessibility.get_tree");
      return {
        supported: false,
        backend: "wayland",
        nodeCount: 0,
        truncated: false,
        redacted: false,
        reason: "Accessibility is unavailable with the current safe backend."
      };
    },
    findAccessibilityElement: async () => {
      calls.push("accessibility.find_element");
      return {
        supported: false,
        backend: "wayland",
        candidates: [],
        reason: "Accessibility is unavailable with the current safe backend."
      };
    }
  };

  return {
    sessionId: "session_accessibility",
    config,
    policy,
    registry,
    adapters: createAdapterRegistry({ platform: "linux" }),
    logger,
    linux,
    calls
  };
}

async function callTool(context: AgentHostMcpContext, name: string, input: unknown) {
  const tool = createAccessibilityTools().find((candidate) => candidate.name === name);
  expect(tool).toBeDefined();
  expect(tool?.safety).toBeDefined();
  return runTool(tool!, input, context);
}

describe("accessibility MCP tools", () => {
  it("declares safety metadata for accessibility tools", () => {
    expect(createAccessibilityTools().map((tool) => tool.name).sort()).toEqual([
      "accessibility.find_element",
      "accessibility.get_tree"
    ]);
  });

  it("returns unsupported tree results cleanly and logs the call", async () => {
    const context = createContext();
    const result = await callTool(context, "accessibility.get_tree", { appName: "Notes", maxDepth: 2 });

    expect(result).toMatchObject({
      ok: true,
      data: {
        supported: false,
        backend: "wayland",
        nodeCount: 0
      }
    });
    expect(context.calls).toEqual(["accessibility.get_tree"]);
    expect(context.logger.entries).toHaveLength(1);
  });

  it("returns unsupported find results cleanly and logs the call", async () => {
    const context = createContext();
    const result = await callTool(context, "accessibility.find_element", { appName: "Notes", query: "Save" });

    expect(result).toMatchObject({
      ok: true,
      data: {
        supported: false,
        backend: "wayland",
        candidates: []
      }
    });
    expect(context.calls).toEqual(["accessibility.find_element"]);
    expect(context.logger.entries).toHaveLength(1);
  });
});
