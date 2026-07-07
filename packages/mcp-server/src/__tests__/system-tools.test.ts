import {
  createBaseCapabilityRegistry,
  getPolicyProfile,
  type AgentHostConfig,
  type AuditLogEntry,
  type AuditLogger
} from "@agenthost/core";
import { describe, expect, it } from "vitest";
import { runTool, type ToolExecutionContext } from "../tool-runner.js";
import { createSystemTools } from "../tools/system.js";
import { z } from "zod";
import type { AgentHostMcpContext, LinuxAutomation } from "../context.js";

class MemoryLogger implements AuditLogger {
  readonly entries: AuditLogEntry[] = [];

  async log(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

function createContext(logger: MemoryLogger): AgentHostMcpContext {
  const registry = createBaseCapabilityRegistry();
  const policy = getPolicyProfile("strict");
  const config: AgentHostConfig = {
    agentHostDir: "/tmp/agenthost-test",
    configPath: "/tmp/agenthost-test/config.json",
    logFile: "/tmp/agenthost-test/logs/agenthost.jsonl",
    profile: "strict",
    policy
  };
  const linux: LinuxAutomation = {
    getSystemInfo: () => ({
      platform: "linux",
      arch: "x64",
      nodeVersion: "v20.0.0",
      agentHostDir: config.agentHostDir,
      profile: config.profile,
      strategies: registry.listStrategies(),
      tools: registry.listTools().map((tool) => tool.name)
    }),
    checkDependency: async (input) => ({
      found: false,
      kind: input.kind ?? "any",
      name: input.name,
      reason: "Not found in test context."
    }),
    detectApp: async (input) => ({
      found: false,
      appId: `unknown:${input.appName}`,
      adapterAvailable: false,
      availableStrategies: ["guide_only"],
      recommendedStrategy: "guide_only",
      appSensitivity: "unknown",
      reason: "Not found in test context."
    }),
    listInstalledApps: async () => ({ apps: [], truncated: false }),
    openApp: async (input) => ({
      opened: false,
      appId: `unknown:${input.appName}`,
      strategy: "guide_only",
      reason: "Not found in test context."
    }),
    getAppStrategy: async (input) => ({
      found: false,
      appId: `unknown:${input.appName}`,
      adapterAvailable: false,
      availableStrategies: ["guide_only"],
      recommendedStrategy: "guide_only",
      appSensitivity: "unknown",
      taskType: input.taskType ?? "unknown",
      reason: "Not found in test context."
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
    ensureDir: async (input) => ({ path: input.path, exists: true, created: true })
  };

  return {
    sessionId: "session_test",
    config,
    policy,
    registry,
    logger,
    linux
  };
}

describe("system tools", () => {
  it("returns system.get_info as a ToolResult and logs the call", async () => {
    const logger = new MemoryLogger();
    const context = createContext(logger);
    const tool = createSystemTools().find((candidate) => candidate.name === "system.get_info");

    expect(tool).toBeDefined();
    const result = await runTool(tool!, {}, context);

    expect(result.ok).toBe(true);
    expect(result.tool).toBe("system.get_info");
    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]?.tool).toBe("system.get_info");
  });

  it("returns registered capabilities", async () => {
    const logger = new MemoryLogger();
    const context = createContext(logger);
    const tool = createSystemTools().find((candidate) => candidate.name === "system.list_capabilities");

    expect(tool).toBeDefined();
    const result = await runTool(tool!, {}, context);

    expect(result.ok).toBe(true);
    const data = result.data as { tools: Array<{ name: string }> };
    expect(data.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["system.get_info", "system.list_capabilities", "system.check_dependency"])
    );
  });

  it("rejects unexpected input before execution", async () => {
    const logger = new MemoryLogger();
    const context = createContext(logger) as ToolExecutionContext;
    const tool = createSystemTools()[0];

    const result = await runTool(tool!, { unexpected: true }, context as AgentHostMcpContext);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("invalid_input");
    expect(logger.entries[0]?.ok).toBe(false);
  });

  it("blocks future-style unsafe tools before the handler runs", async () => {
    const logger = new MemoryLogger();
    const context = createContext(logger);
    let handlerCalled = false;

    const result = await runTool(
      {
        name: "desktop.click",
        description: "Future GUI click tool.",
        riskLevel: "medium",
        inputSchema: z.object({}).strict(),
        mcpInputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        },
        inputSummary: "Future GUI click",
        safety: {
          actionType: "gui_click"
        },
        handler() {
          handlerCalled = true;
          throw new Error("Handler should not run.");
        }
      },
      {},
      context
    );

    expect(handlerCalled).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("safety_blocked");
    expect(result.approval.status).toBe("denied");
  });

  it("stops approval-required actions before execution", async () => {
    const logger = new MemoryLogger();
    const context = createContext(logger);
    let handlerCalled = false;

    const result = await runTool(
      {
        name: "app.open",
        description: "Future app launch tool.",
        riskLevel: "medium",
        inputSchema: z.object({}).strict(),
        mcpInputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        },
        inputSummary: "Future app launch",
        safety: {
          actionType: "app_launch",
          getInput: () => ({ appName: "GIMP" })
        },
        handler() {
          handlerCalled = true;
          throw new Error("Handler should not run.");
        }
      },
      {},
      context
    );

    expect(handlerCalled).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("approval_required");
    expect(result.approval.status).toBe("required");
  });
});
