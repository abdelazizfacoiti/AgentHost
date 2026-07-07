import {
  createAdapterRegistry,
  createBaseCapabilityRegistry,
  getPolicyProfile,
  type AgentHostConfig,
  type AppAdapter,
  type AuditLogEntry,
  type AuditLogger
} from "@agenthost/core";
import { describe, expect, it } from "vitest";
import type { AgentHostMcpContext, LinuxAutomation } from "../context.js";
import { runTool } from "../tool-runner.js";
import { createAdapterTools } from "../tools/adapter.js";
import { createAppTools } from "../tools/app.js";
import { createSystemTools } from "../tools/system.js";

class MemoryLogger implements AuditLogger {
  readonly entries: AuditLogEntry[] = [];

  async log(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

function createMockAdapter(): { adapter: AppAdapter; executeCalls: () => number } {
  let calls = 0;
  const adapter: AppAdapter = {
    id: "test.mock",
    displayName: "Test Mock Adapter",
    appIds: ["gimp", "gmail"],
    supportedPlatforms: ["linux"],
    getCapabilities: () => [
      {
        id: "mock.export",
        adapterId: "test.mock",
        appId: "gimp",
        strategy: "app_adapter",
        riskLevel: "low",
        description: "Mock export capability.",
        safety: {
          actionType: "inspect"
        }
      },
      {
        id: "mock.review",
        adapterId: "test.mock",
        appId: "gmail",
        strategy: "app_adapter",
        riskLevel: "medium",
        description: "Mock review capability.",
        safety: {
          actionType: "inspect"
        }
      }
    ],
    async execute(): Promise<never> {
      calls += 1;
      throw new Error("Mock adapter execution must not be called in Phase 5.");
    }
  };

  return {
    adapter,
    executeCalls: () => calls
  };
}

function createLinuxAutomation(config: AgentHostConfig): LinuxAutomation {
  return {
    getSystemInfo: () => ({
      platform: "linux",
      arch: "x64",
      nodeVersion: "v20.0.0",
      agentHostDir: config.agentHostDir,
      profile: config.profile,
      strategies: [],
      tools: []
    }),
    checkDependency: async (input) => ({
      found: false,
      kind: input.kind ?? "any",
      name: input.name,
      reason: "Not used in adapter tests."
    }),
    detectApp: async (input) => {
      if (input.appName === "GIMP") {
        return {
          found: true,
          appId: "gimp",
          displayName: "GIMP",
          adapterAvailable: false,
          availableStrategies: ["cli_or_script", "guide_only"],
          recommendedStrategy: "guide_only",
          appSensitivity: "normal",
          reason: "Fake GIMP detection."
        };
      }

      if (input.appName === "Gmail") {
        return {
          found: true,
          appId: "gmail",
          displayName: "Gmail",
          adapterAvailable: false,
          availableStrategies: ["guide_only"],
          recommendedStrategy: "guide_only",
          appSensitivity: "communication",
          reason: "Fake Gmail detection."
        };
      }

      return {
        found: false,
        appId: `unknown:${input.appName.toLowerCase()}`,
        adapterAvailable: false,
        availableStrategies: ["guide_only"],
        recommendedStrategy: "guide_only",
        appSensitivity: "unknown",
        reason: "Fake unknown app."
      };
    },
    listInstalledApps: async () => ({ apps: [], truncated: false }),
    openApp: async (input) => ({
      opened: false,
      appId: input.appName,
      strategy: "guide_only",
      reason: "Not used in adapter tests."
    }),
    getAppStrategy: async (input) => {
      const detection = await createLinuxAutomation(config).detectApp({ appName: input.appName });

      return {
        ...detection,
        taskType: input.taskType ?? "unknown"
      };
    },
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
    ensureDir: async (input) => ({ path: input.path, exists: true, created: true })
  };
}

function createContext(withAdapter: boolean): AgentHostMcpContext & { logger: MemoryLogger; executeCalls: () => number } {
  const registry = createBaseCapabilityRegistry();
  const adapters = createAdapterRegistry({ platform: "linux" });
  const policy = getPolicyProfile("dev");
  const config: AgentHostConfig = {
    agentHostDir: "/tmp/agenthost-adapter-test",
    configPath: "/tmp/agenthost-adapter-test/config.json",
    logFile: "/tmp/agenthost-adapter-test/logs/agenthost.jsonl",
    profile: "dev",
    policy
  };
  const logger = new MemoryLogger();
  let executeCalls = () => 0;

  if (withAdapter) {
    const mock = createMockAdapter();
    adapters.register(mock.adapter);
    executeCalls = mock.executeCalls;
  }

  return {
    sessionId: "session_adapter",
    config,
    policy,
    registry,
    adapters,
    logger,
    linux: createLinuxAutomation(config),
    executeCalls
  };
}

function allTools() {
  return [...createAdapterTools(), ...createAppTools(), ...createSystemTools()];
}

async function callTool(context: AgentHostMcpContext, name: string, input: unknown) {
  const tool = allTools().find((candidate) => candidate.name === name);

  expect(tool).toBeDefined();
  expect(tool?.safety).toBeDefined();

  return runTool(tool!, input, context);
}

describe("adapter MCP tools", () => {
  it("declares safety metadata for adapter tools", () => {
    const tools = createAdapterTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "adapter.detect_for_app",
      "adapter.get_capabilities",
      "adapter.list"
    ]);
    expect(tools.every((tool) => tool.safety !== undefined)).toBe(true);
  });

  it("lists adapters and logs the discovery call", async () => {
    const context = createContext(true);
    const result = await callTool(context, "adapter.list", {});

    expect(result).toMatchObject({
      ok: true,
      tool: "adapter.list",
      data: {
        adapters: [
          {
            id: "test.mock",
            capabilityCount: 2
          }
        ]
      }
    });
    expect(context.logger.entries).toHaveLength(1);
    expect(context.logger.entries[0]?.tool).toBe("adapter.list");
    expect(context.executeCalls()).toBe(0);
  });

  it("lists adapter capabilities with filters", async () => {
    const context = createContext(true);
    const result = await callTool(context, "adapter.get_capabilities", { adapterId: "test.mock", appId: "gimp" });

    expect(result).toMatchObject({
      ok: true,
      data: {
        adapterId: "test.mock",
        appId: "gimp",
        capabilities: [
          {
            id: "mock.export",
            adapterId: "test.mock",
            appId: "gimp",
            strategy: "app_adapter"
          }
        ]
      }
    });
    expect(context.logger.entries[0]?.tool).toBe("adapter.get_capabilities");
    expect(context.executeCalls()).toBe(0);
  });

  it("detects adapters for supported apps", async () => {
    const context = createContext(true);
    const result = await callTool(context, "adapter.detect_for_app", { appName: "GIMP", appId: "gimp" });

    expect(result).toMatchObject({
      ok: true,
      strategy: "app_adapter",
      data: {
        adapterAvailable: true,
        recommendedStrategy: "app_adapter",
        adapters: [
          {
            id: "test.mock"
          }
        ]
      }
    });
    expect(context.logger.entries[0]?.tool).toBe("adapter.detect_for_app");
    expect(context.executeCalls()).toBe(0);
  });

  it("keeps apps without adapters guide-only", async () => {
    const context = createContext(false);
    const result = await callTool(context, "app.detect", { appName: "Unknown" });

    expect(result).toMatchObject({
      ok: true,
      data: {
        adapterAvailable: false,
        recommendedStrategy: "guide_only",
        availableStrategies: ["guide_only"]
      }
    });
  });

  it("prefers app_adapter for normal apps with adapters", async () => {
    const context = createContext(true);
    const result = await callTool(context, "app.detect", { appName: "GIMP" });

    expect(result).toMatchObject({
      ok: true,
      data: {
        adapterAvailable: true,
        adapterIds: ["test.mock"],
        recommendedStrategy: "app_adapter"
      }
    });
    expect(result.data?.availableStrategies).toEqual(["app_adapter", "cli_or_script", "guide_only"]);
    expect(context.executeCalls()).toBe(0);
  });

  it("reports adapter availability but keeps sensitive apps guide-only", async () => {
    const context = createContext(true);
    const result = await callTool(context, "app.get_strategy", { appName: "Gmail", taskType: "automate" });

    expect(result).toMatchObject({
      ok: true,
      data: {
        adapterAvailable: true,
        adapterIds: ["test.mock"],
        appSensitivity: "communication",
        recommendedStrategy: "guide_only",
        taskType: "automate"
      }
    });
    expect(result.data?.availableStrategies).toContain("app_adapter");
    expect(context.executeCalls()).toBe(0);
  });

  it("includes adapter capabilities in system.list_capabilities", async () => {
    const context = createContext(true);
    const result = await callTool(context, "system.list_capabilities", {});

    expect(result).toMatchObject({
      ok: true,
      data: {
        appCapabilities: [
          {
            id: "mock.export",
            adapterId: "test.mock"
          },
          {
            id: "mock.review",
            adapterId: "test.mock"
          }
        ]
      }
    });
  });
});
