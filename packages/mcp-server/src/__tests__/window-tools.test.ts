import {
  createAdapterRegistry,
  createBaseCapabilityRegistry,
  getPolicyProfile,
  type AgentHostConfig,
  type AuditLogEntry,
  type AuditLogger,
  type PolicyProfile
} from "@agenthost/core";
import { describe, expect, it } from "vitest";
import { ConfirmationManager } from "../confirmation.js";
import type { AgentHostMcpContext, LinuxAutomation } from "../context.js";
import { ForgeStore } from "../forge-store.js";
import { GrantStore } from "../grants.js";
import { runTool } from "../tool-runner.js";
import { createWindowTools } from "../tools/window.js";

class MemoryLogger implements AuditLogger {
  readonly entries: AuditLogEntry[] = [];

  async log(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

function createContext(
  policyOverride?: Partial<PolicyProfile>
): AgentHostMcpContext & { calls: string[]; logger: MemoryLogger } {
  const registry = createBaseCapabilityRegistry();
  const basePolicy = getPolicyProfile("dev");
  const policy = {
    ...basePolicy,
    ...policyOverride
  };
  const config: AgentHostConfig = {
    agentHostDir: "/tmp/agenthost-window-test",
    configPath: "/tmp/agenthost-window-test/config.json",
    logFile: "/tmp/agenthost-window-test/logs/agenthost.jsonl",
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
      sessionType: "x11",
      displayAvailable: true,
      backend: "x11",
      activeWindow: { supported: true, backend: "xdotool", reason: "unused" },
      screenshot: { supported: true, backend: "gnome-screenshot", reason: "unused" },
      windowList: { supported: true, backend: "wmctrl", reason: "unused" },
      windowFocus: { supported: true, backend: "wmctrl", reason: "unused" },
      accessibility: { supported: true, backend: "atspi", reason: "unused" },
      guiInput: { supported: true, backend: "xdotool", reason: "unused" }
    }),
    getActiveWindow: async () => ({ supported: false, backend: "unavailable", reason: "unused" }),
    screenshot: async (input) => ({
      supported: false,
      backend: "unavailable",
      path: input.path,
      reason: "unused"
    }),
    listWindows: async () => {
      calls.push("window.list");
      return {
        supported: true,
        backend: "wmctrl",
        windows: [
          {
            windowId: "42",
            appName: "Notes",
            title: "Draft",
            pid: 4200
          },
          {
            windowId: "84",
            appName: "Bitwarden",
            title: "Vault",
            pid: 8400
          }
        ],
        truncated: false,
        reason: "Fake window list."
      };
    },
    focusWindow: async (input) => {
      calls.push("window.focus");
      return {
        supported: true,
        backend: "wmctrl",
        focused: true,
        window: {
          ...(input.windowId === undefined ? {} : { windowId: input.windowId }),
          ...(input.appName === undefined ? {} : { appName: input.appName }),
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.pid === undefined ? {} : { pid: input.pid })
        },
        reason: "Fake focus."
      };
    },
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
    sessionId: "session_window",
    config,
    policy,
    registry,
    adapters: createAdapterRegistry({ platform: "linux" }),
    confirmations: new ConfirmationManager(),
    grants: new GrantStore({ persistentGrants: policy.grants }),
    forge: new ForgeStore(config.agentHostDir),
    logger,
    linux,
    calls
  };
}

async function callTool(context: AgentHostMcpContext, name: string, input: unknown) {
  const tool = createWindowTools().find((candidate) => candidate.name === name);
  expect(tool).toBeDefined();
  expect(tool?.safety).toBeDefined();
  return runTool(tool!, input, context);
}

function confirmationTokenOf(result: Awaited<ReturnType<typeof callTool>>): string {
  expect(result.ok).toBe(true);
  expect(result.preview).toBe(true);
  expect(result.data).not.toBeNull();
  const preview = result.data as { confirmationToken?: string };
  expect(preview.confirmationToken).toEqual(expect.any(String));
  return preview.confirmationToken!;
}

describe("window MCP tools", () => {
  it("declares safety metadata for every window tool", () => {
    expect(createWindowTools().map((tool) => tool.name).sort()).toEqual(["window.focus", "window.list"]);
    expect(createWindowTools().every((tool) => tool.safety !== undefined)).toBe(true);
  });

  it("lists windows and logs the call", async () => {
    const context = createContext();
    const result = await callTool(context, "window.list", { includeTitles: true, limit: 5 });

    expect(result).toMatchObject({
      ok: true,
      data: {
        supported: true,
        windows: [{ appName: "Notes" }, { appName: "Bitwarden" }]
      }
    });
    expect(context.calls).toEqual(["window.list"]);
    expect(context.logger.entries).toHaveLength(1);
  });

  it("rejects ambiguous focus requests before execution", async () => {
    const context = createContext();
    const result = await callTool(context, "window.focus", {});

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("invalid_input");
    expect(context.calls).toEqual([]);
  });

  it("blocks sensitive window focus before execution", async () => {
    const context = createContext({
      allowGenericClick: true
    });
    const result = await callTool(context, "window.focus", { appName: "Bitwarden" });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("safety_blocked");
    expect(context.calls).toEqual([]);
  });

  it("focuses a normal app when policy allows generic GUI control after preview confirmation", async () => {
    const context = createContext({
      allowGenericClick: true
    });
    const preview = await callTool(context, "window.focus", { appName: "Notes", dryRun: true });
    const token = confirmationTokenOf(preview);
    const result = await callTool(context, "window.focus", { appName: "Notes", confirmationToken: token });

    expect(result).toMatchObject({
      ok: true,
      confirmation: {
        accepted: true
      },
      data: {
        supported: true,
        focused: true,
        window: {
          appName: "Notes"
        }
      }
    });
    expect(context.calls).toEqual(["window.list", "window.list", "window.focus"]);
  });

  it("previews window focus without focusing the window", async () => {
    const context = createContext({
      allowGenericClick: true
    });
    const result = await callTool(context, "window.focus", { appName: "Notes", dryRun: true });

    expect(result).toMatchObject({
      ok: true,
      preview: true,
      data: {
        preview: true,
        wouldExecute: true,
        wouldBeBlocked: false,
        targetSummary: 'Notes "Draft"',
        confirmationAvailable: true,
        confirmationRequired: true
      }
    });
    expect(context.calls).toEqual(["window.list"]);
    expect(context.logger.entries[0]?.preview).toBe(true);
  });

  it("requires confirmation tokens and rejects changed resolved window targets", async () => {
    const context = createContext({
      allowGenericClick: true
    });

    await expect(callTool(context, "window.focus", { appName: "Notes" })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "dry_run_required"
      }
    });

    const preview = await callTool(context, "window.focus", { appName: "Notes", dryRun: true });
    const token = confirmationTokenOf(preview);

    context.linux.listWindows = async () => ({
      supported: true,
      backend: "wmctrl",
      windows: [
        {
          windowId: "99",
          appName: "Notes",
          title: "Changed",
          pid: 9900
        }
      ],
      truncated: false,
      reason: "Changed window list."
    });

    await expect(callTool(context, "window.focus", { appName: "Notes", confirmationToken: token })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "confirmation_rejected",
        message: "Confirmation token target does not match the current resolved target."
      }
    });
  });

  it("focuses by windowId without listing windows", async () => {
    const context = createContext({
      allowGenericClick: true
    });
    context.linux.checkDependency = async () => ({
      found: true,
      kind: "command",
      name: "wmctrl",
      commandPath: "/usr/bin/wmctrl",
      reason: "Fake wmctrl."
    });
    const preview = await callTool(context, "window.focus", { windowId: "42", dryRun: true });
    const token = confirmationTokenOf(preview);
    const result = await callTool(context, "window.focus", { windowId: "42", confirmationToken: token });

    expect(result).toMatchObject({
      ok: true,
      confirmation: {
        accepted: true
      },
      data: {
        supported: true,
        focused: true,
        window: {
          windowId: "42"
        }
      }
    });
    // No window.list calls: the exact windowId binds the confirmation target.
    expect(context.calls).toEqual(["window.focus"]);
  });
});
