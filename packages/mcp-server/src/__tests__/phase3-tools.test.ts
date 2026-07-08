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
import { createAppTools } from "../tools/app.js";
import { createFileTools } from "../tools/file.js";
import { createShellTools } from "../tools/shell.js";
import { createSystemTools } from "../tools/system.js";

class MemoryLogger implements AuditLogger {
  readonly entries: AuditLogEntry[] = [];

  async log(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

function createContext(profile: "strict" | "dev" = "dev"): AgentHostMcpContext & { calls: string[] } {
  const registry = createBaseCapabilityRegistry();
  const policy = getPolicyProfile(profile);
  const config: AgentHostConfig = {
    agentHostDir: "/tmp/agenthost-phase3-test",
    configPath: "/tmp/agenthost-phase3-test/config.json",
    logFile: "/tmp/agenthost-phase3-test/logs/agenthost.jsonl",
    profile,
    policy
  };
  const calls: string[] = [];
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
    checkDependency: async (input) => {
      calls.push("system.check_dependency");
      return {
        found: input.name === "node",
        kind: input.kind ?? "any",
        name: input.name,
        reason: "Fake dependency check."
      };
    },
    detectApp: async (input) => {
      calls.push("app.detect");
      return {
        found: false,
        appId: `unknown:${input.appName}`,
        adapterAvailable: false,
        availableStrategies: ["guide_only"],
        recommendedStrategy: "guide_only",
        appSensitivity: "unknown",
        reason: "Fake unknown app."
      };
    },
    listInstalledApps: async () => {
      calls.push("app.list_installed");
      return { apps: [], truncated: false };
    },
    openApp: async (input) => {
      calls.push("app.open");
      return {
        opened: true,
        appId: input.appName,
        strategy: "cli_or_script",
        command: input.appName,
        reason: "Fake app launch."
      };
    },
    getAppStrategy: async (input) => {
      calls.push("app.get_strategy");
      return {
        found: false,
        appId: `unknown:${input.appName}`,
        adapterAvailable: false,
        availableStrategies: ["guide_only"],
        recommendedStrategy: "guide_only",
        appSensitivity: "unknown",
        taskType: input.taskType ?? "unknown",
        reason: "Fake strategy."
      };
    },
    runSafeCommand: async () => {
      calls.push("shell.run_safe");
      return {
        exitCode: 0,
        signal: null,
        stdout: "ok\n",
        stderr: "",
        durationMs: 1,
        timedOut: false,
        truncated: false
      };
    },
    writeFile: async (input) => {
      calls.push("file.write");
      return { path: input.path, bytesWritten: input.content.length, created: true };
    },
    readFile: async (input) => {
      calls.push("file.read");
      return {
        path: input.path,
        content: "ok",
        encoding: input.encoding ?? "utf8",
        bytesRead: 2,
        truncated: false
      };
    },
    fileExists: async (input) => {
      calls.push("file.exists");
      return { path: input.path, exists: true, type: "file" };
    },
    listDirectory: async (input) => {
      calls.push("file.list");
      return { path: input.path, entries: [], truncated: false };
    },
    ensureDir: async (input) => {
      calls.push("file.ensure_dir");
      return { path: input.path, exists: true, created: true };
    },
    getDesktopCapabilities: async () => ({
      platform: "linux",
      sessionType: "unknown",
      displayAvailable: false,
      backend: "unavailable",
      activeWindow: { supported: false, backend: "unavailable", reason: "unused" },
      screenshot: { supported: false, backend: "unavailable", reason: "unused" },
      windowList: { supported: false, backend: "unavailable", reason: "unused" },
      windowFocus: { supported: false, backend: "unavailable", reason: "unused" },
      accessibility: { supported: false, backend: "unavailable", reason: "unused" },
      guiInput: { supported: false, backend: "unavailable", reason: "unused" }
    }),
    getActiveWindow: async () => ({
      supported: false,
      backend: "unavailable",
      reason: "unused"
    }),
    screenshot: async (input) => ({
      supported: false,
      backend: "unavailable",
      path: input.path,
      reason: "unused"
    }),
    listWindows: async () => ({
      supported: false,
      backend: "unavailable",
      windows: [],
      truncated: false,
      reason: "unused"
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
      reason: "unused"
    }),
    hotkey: async (input) => ({
      supported: false,
      backend: "unavailable",
      sent: false,
      keys: input.keys,
      activeWindow: input.activeWindow,
      reason: "unused"
    }),
    typeText: async (input) => ({
      supported: false,
      backend: "unavailable",
      typed: false,
      characterCount: input.text.length,
      activeWindow: input.activeWindow,
      reason: "unused"
    }),
    click: async (input) => ({
      supported: false,
      backend: "unavailable",
      clicked: false,
      x: input.x,
      y: input.y,
      button: input.button ?? "left",
      activeWindow: input.activeWindow,
      reason: "unused"
    }),
    getAccessibilityTree: async () => ({
      supported: false,
      backend: "unavailable",
      nodeCount: 0,
      truncated: false,
      redacted: false,
      reason: "unused"
    }),
    findAccessibilityElement: async () => ({
      supported: false,
      backend: "unavailable",
      candidates: [],
      reason: "unused"
    }),
    inspectAccessibilityElement: async () => ({
      supported: false,
      backend: "unavailable",
      matched: false,
      ambiguous: false,
      redacted: false,
      reason: "unused"
    }),
    invokeAccessibilityAction: async (input) => ({
      supported: false,
      backend: "unavailable",
      matched: false,
      ambiguous: false,
      performed: false,
      redacted: false,
      actionName: input.actionName,
      reason: "unused"
    }),
    setAccessibilityValue: async () => ({
      supported: false,
      backend: "unavailable",
      matched: false,
      ambiguous: false,
      changed: false,
      redacted: true,
      redactedValue: true,
      reason: "unused"
    }),
    focusAccessibilityElement: async () => ({
      supported: false,
      backend: "unavailable",
      matched: false,
      ambiguous: false,
      focused: false,
      redacted: false,
      reason: "unused"
    })
  };

  return {
    sessionId: "session_phase3",
    config,
    policy,
    registry,
    adapters: createAdapterRegistry({ platform: "linux" }),
    logger: new MemoryLogger(),
    linux,
    calls
  };
}

function allTools() {
  return [...createSystemTools(), ...createAppTools(), ...createShellTools(), ...createFileTools()];
}

async function callTool(context: AgentHostMcpContext, name: string, input: unknown) {
  const tool = allTools().find((candidate) => candidate.name === name);
  expect(tool).toBeDefined();
  expect(tool?.safety).toBeDefined();
  return runTool(tool!, input, context);
}

describe("Phase 3 MCP tools", () => {
  it("declares safety metadata for every Phase 3 tool", () => {
    const phase3Tools = allTools().filter((tool) => !["system.get_info", "system.list_capabilities"].includes(tool.name));

    expect(phase3Tools.map((tool) => tool.name).sort()).toEqual([
      "app.detect",
      "app.get_strategy",
      "app.list_installed",
      "app.open",
      "file.ensure_dir",
      "file.exists",
      "file.list",
      "file.read",
      "file.write",
      "shell.run_safe",
      "system.check_dependency"
    ]);
    expect(phase3Tools.every((tool) => tool.safety !== undefined)).toBe(true);
  });

  it("runs inspect tools through safety and handlers", async () => {
    const context = createContext("dev");

    await expect(callTool(context, "system.check_dependency", { name: "node" })).resolves.toMatchObject({ ok: true });
    await expect(callTool(context, "app.detect", { appName: "Mystery" })).resolves.toMatchObject({
      ok: true,
      data: {
        recommendedStrategy: "guide_only"
      }
    });
    await expect(callTool(context, "app.list_installed", {})).resolves.toMatchObject({ ok: true });
    await expect(callTool(context, "app.get_strategy", { appName: "Mystery" })).resolves.toMatchObject({
      ok: true,
      data: {
        recommendedStrategy: "guide_only"
      }
    });

    expect(context.calls).toEqual([
      "system.check_dependency",
      "app.detect",
      "app.list_installed",
      "app.get_strategy"
    ]);
  });

  it("runs safe dev shell and file tools inside approved roots", async () => {
    const context = createContext("dev");
    const safePath = "/tmp/agenthost-phase3-test/output.txt";

    await expect(callTool(context, "shell.run_safe", { command: "node", args: ["--version"] })).resolves.toMatchObject({
      ok: true
    });
    await expect(callTool(context, "file.write", { path: safePath, content: "ok" })).resolves.toMatchObject({
      ok: true
    });
    await expect(callTool(context, "file.read", { path: safePath })).resolves.toMatchObject({ ok: true });
    await expect(callTool(context, "file.exists", { path: safePath })).resolves.toMatchObject({ ok: true });
    await expect(callTool(context, "file.list", { path: "/tmp/agenthost-phase3-test" })).resolves.toMatchObject({
      ok: true
    });
    await expect(callTool(context, "file.ensure_dir", { path: "/tmp/agenthost-phase3-test/subdir" })).resolves.toMatchObject({
      ok: true
    });

    expect(context.calls).toEqual([
      "shell.run_safe",
      "file.write",
      "file.read",
      "file.exists",
      "file.list",
      "file.ensure_dir"
    ]);
  });

  it("does not execute approval-required app.open in strict profile", async () => {
    const context = createContext("strict");
    const result = await callTool(context, "app.open", { appName: "GIMP" });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("approval_required");
    expect(context.calls).toEqual([]);
  });

  it("does not execute dangerous shell commands", async () => {
    const context = createContext("dev");
    const result = await callTool(context, "shell.run_safe", { command: "rm", args: ["-rf", "/tmp/example"] });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("safety_blocked");
    expect(context.calls).toEqual([]);
  });

  it("does not execute unsafe file paths", async () => {
    const context = createContext("dev");

    await expect(callTool(context, "file.read", { path: "~/.ssh/id_rsa" })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "safety_blocked"
      }
    });
    await expect(callTool(context, "file.write", { path: "/tmp/outside.txt", content: "nope" })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "safety_blocked"
      }
    });
    expect(context.calls).toEqual([]);
  });
});
