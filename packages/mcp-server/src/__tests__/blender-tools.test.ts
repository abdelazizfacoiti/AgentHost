import {
  createAdapterRegistry,
  createBaseCapabilityRegistry,
  getPolicyProfile,
  toolSuccess,
  type AgentHostConfig,
  type AppAdapter,
  type AuditLogEntry,
  type AuditLogger
} from "@agenthost/core";
import { describe, expect, it } from "vitest";
import { ConfirmationManager } from "../confirmation.js";
import { createAgentHostMcpServer } from "../server.js";
import type { AgentHostMcpContext, LinuxAutomation } from "../context.js";
import { ForgeStore } from "../forge-store.js";
import { GrantStore } from "../grants.js";
import { runTool } from "../tool-runner.js";
import { createAppTools } from "../tools/app.js";
import { createBlenderTools } from "../tools/blender.js";

class MemoryLogger implements AuditLogger {
  readonly entries: AuditLogEntry[] = [];

  async log(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
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
      reason: "Not used in blender tool tests."
    }),
    detectApp: async (input) => {
      if (input.appName === "Blender") {
        return {
          found: true,
          appId: "blender",
          displayName: "Blender",
          adapterAvailable: false,
          availableStrategies: ["guide_only"],
          recommendedStrategy: "guide_only",
          appSensitivity: "normal",
          reason: "Fake Blender detection."
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
      reason: "Not used in blender tool tests."
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
    ensureDir: async (input) => ({ path: input.path, exists: true, created: true }),
    getDesktopCapabilities: async () => ({
      platform: "linux",
      sessionType: "unknown",
      displayAvailable: false,
      backend: "unavailable",
      activeWindow: { supported: false, backend: "unavailable", reason: "Not used in blender tool tests." },
      screenshot: { supported: false, backend: "unavailable", reason: "Not used in blender tool tests." },
      windowList: { supported: false, backend: "unavailable", reason: "Not used in blender tool tests." },
      windowFocus: { supported: false, backend: "unavailable", reason: "Not used in blender tool tests." },
      accessibility: { supported: false, backend: "unavailable", reason: "Not used in blender tool tests." },
      guiInput: { supported: false, backend: "unavailable", reason: "Not used in blender tool tests." }
    }),
    getActiveWindow: async () => ({ supported: false, backend: "unavailable", reason: "Not used in blender tool tests." }),
    screenshot: async (input) => ({
      supported: false,
      backend: "unavailable",
      path: input.path,
      reason: "Not used in blender tool tests."
    }),
    listWindows: async () => ({
      supported: false,
      backend: "unavailable",
      windows: [],
      truncated: false,
      reason: "Not used in blender tool tests."
    }),
    focusWindow: async (input) => ({
      supported: false,
      backend: "unavailable",
      focused: false,
      window: {
        ...(input.windowId === undefined ? {} : { windowId: input.windowId }),
        ...(input.appName === undefined ? {} : { appName: input.appName }),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.pid === undefined ? {} : { pid: input.pid })
      },
      reason: "Not used in blender tool tests."
    }),
    hotkey: async (input) => ({
      supported: false,
      backend: "unavailable",
      sent: false,
      keys: input.keys,
      activeWindow: input.activeWindow,
      reason: "Not used in blender tool tests."
    }),
    typeText: async (input) => ({
      supported: false,
      backend: "unavailable",
      typed: false,
      characterCount: input.text.length,
      activeWindow: input.activeWindow,
      reason: "Not used in blender tool tests."
    }),
    click: async (input) => ({
      supported: false,
      backend: "unavailable",
      clicked: false,
      x: input.x,
      y: input.y,
      button: input.button ?? "left",
      activeWindow: input.activeWindow,
      reason: "Not used in blender tool tests."
    }),
    getAccessibilityTree: async () => ({
      supported: false,
      backend: "unavailable",
      nodeCount: 0,
      truncated: false,
      redacted: false,
      reason: "Not used in blender tool tests."
    }),
    findAccessibilityElement: async () => ({
      supported: false,
      backend: "unavailable",
      candidates: [],
      reason: "Not used in blender tool tests."
    }),
    inspectAccessibilityElement: async () => ({
      supported: false,
      backend: "unavailable",
      matched: false,
      ambiguous: false,
      redacted: false,
      reason: "Not used in blender tool tests."
    }),
    invokeAccessibilityAction: async (input) => ({
      supported: false,
      backend: "unavailable",
      matched: false,
      ambiguous: false,
      performed: false,
      redacted: false,
      actionName: input.actionName,
      reason: "Not used in blender tool tests."
    }),
    setAccessibilityValue: async () => ({
      supported: false,
      backend: "unavailable",
      matched: false,
      ambiguous: false,
      changed: false,
      redacted: true,
      redactedValue: true,
      reason: "Not used in blender tool tests."
    }),
    focusAccessibilityElement: async () => ({
      supported: false,
      backend: "unavailable",
      matched: false,
      ambiguous: false,
      focused: false,
      redacted: false,
      reason: "Not used in blender tool tests."
    })
  };
}

function createMockBlenderAdapter(): { adapter: AppAdapter; calls: () => number } {
  let executeCalls = 0;

  return {
    adapter: {
      id: "blender",
      displayName: "Blender",
      appIds: ["blender"],
      supportedPlatforms: ["linux"],
      matchesApp: (input) => input.appName?.toLowerCase() === "blender" || input.appId === "blender",
      getCapabilities: () => [
        {
          id: "blender.run_python",
          adapterId: "blender",
          appId: "blender",
          strategy: "app_adapter",
          riskLevel: "medium",
          description: "Mock Blender capability.",
          safety: {
            actionType: "file_write"
          }
        }
      ],
      async execute(action) {
        executeCalls += 1;
        return toolSuccess({
          tool: "blender.run_python",
          riskLevel: "medium",
          strategy: "app_adapter",
          data: {
            adapterId: "blender",
            capabilityId: action.capabilityId,
            outputDir: (action.input as { outputDir: string }).outputDir,
            outputs: []
          },
          observations: ["Mock Blender adapter executed."]
        });
      }
    },
    calls: () => executeCalls
  };
}

function createContext(profile: "strict" | "dev", withAdapter: boolean): AgentHostMcpContext & { logger: MemoryLogger; calls: () => number } {
  const registry = createBaseCapabilityRegistry();
  const adapters = createAdapterRegistry({ platform: "linux" });
  const policy = getPolicyProfile(profile);
  const config: AgentHostConfig = {
    agentHostDir: "/tmp/agenthost-blender-tool-test",
    configPath: "/tmp/agenthost-blender-tool-test/config.json",
    logFile: "/tmp/agenthost-blender-tool-test/logs/agenthost.jsonl",
    profile,
    policy
  };
  const logger = new MemoryLogger();
  let calls = () => 0;

  if (withAdapter) {
    const mock = createMockBlenderAdapter();
    adapters.register(mock.adapter);
    calls = mock.calls;
  }

  registry.registerTool({
    name: "blender.run_python",
    riskLevel: "medium",
    strategy: "app_adapter",
    description: "Mock Blender tool capability."
  });

  return {
    sessionId: "session_blender_tool",
    config,
    policy,
    registry,
    adapters,
    confirmations: new ConfirmationManager(),
    grants: new GrantStore({ persistentGrants: policy.grants }),
    forge: new ForgeStore(config.agentHostDir),
    logger,
    linux: createLinuxAutomation(config),
    calls
  };
}

async function callTool(context: AgentHostMcpContext, name: string, input: unknown) {
  const tool = [...createBlenderTools(), ...createAppTools()].find((candidate) => candidate.name === name);

  expect(tool).toBeDefined();
  expect(tool?.safety).toBeDefined();

  return runTool(tool!, input, context);
}

describe("blender MCP tools", () => {
  it("declares safety metadata for blender.run_python", () => {
    const [tool] = createBlenderTools();

    expect(tool?.name).toBe("blender.run_python");
    expect(tool?.safety?.actionType).toBe("file_write");
  });

  it("returns a clean error when the Blender adapter is not registered", async () => {
    const context = createContext("dev", false);
    const result = await callTool(context, "blender.run_python", { demo: "coffee_cup" });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("blender_adapter_unavailable");
    expect(context.calls()).toBe(0);
  });

  it("stops Blender execution when strict policy requires approval", async () => {
    const context = createContext("strict", true);
    const result = await callTool(context, "blender.run_python", { demo: "coffee_cup" });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("approval_required");
    expect(context.calls()).toBe(0);
  });

  it("runs the registered Blender adapter in dev profile and logs the call", async () => {
    const context = createContext("dev", true);
    const preview = await callTool(context, "blender.run_python", { demo: "coffee_cup", dryRun: true });
    const token = (preview.data as { confirmationToken?: string } | null)?.confirmationToken;
    expect(preview).toMatchObject({ ok: true, preview: true });
    expect(token).toEqual(expect.any(String));
    const result = await callTool(context, "blender.run_python", { demo: "coffee_cup", confirmationToken: token });

    expect(result).toMatchObject({
      ok: true,
      tool: "blender.run_python",
      strategy: "app_adapter"
    });
    expect(context.calls()).toBe(1);
    expect(context.logger.entries).toHaveLength(2);
    expect(context.logger.entries.every((entry) => entry.tool === "blender.run_python")).toBe(true);
  });

  it("reports Blender through adapter discovery and app strategy", async () => {
    const context = createContext("dev", true);
    const detect = await callTool(context, "app.detect", { appName: "Blender" });
    const strategy = await callTool(context, "app.get_strategy", { appName: "Blender", taskType: "automate" });

    expect(detect).toMatchObject({
      ok: true,
      data: {
        adapterAvailable: true,
        adapterIds: ["blender"],
        recommendedStrategy: "app_adapter"
      }
    });
    expect(strategy).toMatchObject({
      ok: true,
      data: {
        adapterAvailable: true,
        recommendedStrategy: "app_adapter"
      }
    });
  });

  it("keeps optional Blender adapter disabled unless explicitly enabled", async () => {
    const { context } = await createAgentHostMcpServer({
      config: {
        agentHostDir: "/tmp/agenthost-blender-server",
        configPath: "/tmp/agenthost-blender-server/config.json",
        logFile: "/tmp/agenthost-blender-server/logs/agenthost.jsonl",
        profile: "dev",
        policy: getPolicyProfile("dev")
      },
      logger: new MemoryLogger(),
      linux: createLinuxAutomation({
        agentHostDir: "/tmp/agenthost-blender-server",
        configPath: "/tmp/agenthost-blender-server/config.json",
        logFile: "/tmp/agenthost-blender-server/logs/agenthost.jsonl",
        profile: "dev",
        policy: getPolicyProfile("dev")
      })
    });

    expect(context.adapters.detectForApp({ appName: "Blender", appId: "blender" }).adapterAvailable).toBe(false);
    expect(context.registry.listTools().some((tool) => tool.name === "blender.run_python")).toBe(false);
  });

  it("loads Blender only with explicit experimental opt-in", async () => {
    const config: AgentHostConfig = {
      agentHostDir: "/tmp/agenthost-blender-server-optin",
      configPath: "/tmp/agenthost-blender-server-optin/config.json",
      logFile: "/tmp/agenthost-blender-server-optin/logs/agenthost.jsonl",
      profile: "dev",
      optionalAdapters: { blender: { enabled: true } },
      policy: getPolicyProfile("dev")
    };
    const { context } = await createAgentHostMcpServer({ config, logger: new MemoryLogger(), linux: createLinuxAutomation(config) });
    expect(context.adapters.detectForApp({ appName: "Blender", appId: "blender" }).adapterAvailable).toBe(true);
    expect(context.registry.listTools()).toEqual(expect.arrayContaining([expect.objectContaining({ name: "blender.run_python" })]));
  });
});
