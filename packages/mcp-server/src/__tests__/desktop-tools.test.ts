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
import { createDesktopTools } from "../tools/desktop.js";

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
    agentHostDir: "/tmp/agenthost-desktop-test",
    configPath: "/tmp/agenthost-desktop-test/config.json",
    logFile: "/tmp/agenthost-desktop-test/logs/agenthost.jsonl",
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
    getDesktopCapabilities: async () => {
      calls.push("desktop.get_capabilities");
      return {
        platform: "linux",
        sessionType: "x11",
        displayAvailable: true,
        backend: "x11",
        activeWindow: { supported: true, backend: "xdotool", reason: "Fake active window support." },
        screenshot: { supported: true, backend: "gnome-screenshot", reason: "Fake screenshot support." },
        windowList: { supported: true, backend: "wmctrl", reason: "Fake window listing support." },
        windowFocus: { supported: true, backend: "wmctrl", reason: "Fake window focus support." },
        accessibility: { supported: false, backend: "unavailable", reason: "Fake accessibility support." },
        guiInput: { supported: true, backend: "xdotool", reason: "Fake GUI input support." }
      };
    },
    getActiveWindow: async () => {
      calls.push("desktop.get_active_window");
      return {
        supported: true,
        backend: "xdotool",
        activeWindow: {
          windowId: "42",
          appName: "Notes",
          title: "Notes - Draft"
        },
        reason: "Fake active window."
      };
    },
    screenshot: async (input) => {
      calls.push("desktop.screenshot");
      return {
        supported: true,
        backend: "gnome-screenshot",
        path: input.path,
        bytesWritten: 128,
        reason: "Fake screenshot."
      };
    },
    listWindows: async () => ({
      supported: true,
      backend: "wmctrl",
      windows: [],
      truncated: false,
      reason: "Fake windows."
    }),
    focusWindow: async (input) => ({
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
    }),
    hotkey: async (input) => {
      calls.push("desktop.hotkey");
      return {
        supported: true,
        backend: "xdotool",
        sent: true,
        keys: input.keys,
        activeWindow: input.activeWindow,
        reason: "Fake hotkey."
      };
    },
    typeText: async (input) => {
      calls.push("desktop.type_text");
      return {
        supported: true,
        backend: "xdotool",
        typed: true,
        characterCount: input.text.length,
        activeWindow: input.activeWindow,
        reason: "Fake typed text."
      };
    },
    click: async (input) => {
      calls.push("desktop.click");
      return {
        supported: true,
        backend: "xdotool",
        clicked: true,
        x: input.x,
        y: input.y,
        button: input.button ?? "left",
        activeWindow: input.activeWindow,
        reason: "Fake click."
      };
    },
    getAccessibilityTree: async () => ({
      supported: false,
      backend: "unavailable",
      nodeCount: 0,
      truncated: false,
      redacted: false,
      reason: "Fake tree."
    }),
    findAccessibilityElement: async () => ({
      supported: false,
      backend: "unavailable",
      candidates: [],
      reason: "Fake candidates."
    }),
    inspectAccessibilityElement: async () => ({
      supported: false,
      backend: "unavailable",
      matched: false,
      ambiguous: false,
      redacted: false,
      reason: "Fake inspect."
    }),
    invokeAccessibilityAction: async (input) => ({
      supported: false,
      backend: "unavailable",
      matched: false,
      ambiguous: false,
      performed: false,
      redacted: false,
      actionName: input.actionName,
      reason: "Fake invoke."
    }),
    setAccessibilityValue: async () => ({
      supported: false,
      backend: "unavailable",
      matched: false,
      ambiguous: false,
      changed: false,
      redacted: true,
      redactedValue: true,
      reason: "Fake set."
    }),
    focusAccessibilityElement: async () => ({
      supported: false,
      backend: "unavailable",
      matched: false,
      ambiguous: false,
      focused: false,
      redacted: false,
      reason: "Fake focus."
    })
  };

  return {
    sessionId: "session_desktop",
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

function allTools() {
  return [...createDesktopTools()];
}

async function callTool(context: AgentHostMcpContext, name: string, input: unknown) {
  const tool = allTools().find((candidate) => candidate.name === name);
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

describe("desktop MCP tools", () => {
  it("declares safety metadata for every desktop tool", () => {
    expect(allTools().map((tool) => tool.name).sort()).toEqual([
      "desktop.click",
      "desktop.double_click",
      "desktop.drag",
      "desktop.get_active_window",
      "desktop.get_capabilities",
      "desktop.hotkey",
      "desktop.move_mouse",
      "desktop.right_click",
      "desktop.screenshot",
      "desktop.scroll",
      "desktop.type_text"
    ]);
    expect(allTools().every((tool) => tool.safety !== undefined)).toBe(true);
  });

  it("runs allowed inspect and screenshot tools", async () => {
    const context = createContext();

    await expect(callTool(context, "desktop.get_capabilities", {})).resolves.toMatchObject({
      ok: true,
      data: {
        backend: "x11",
        activeWindow: {
          supported: true
        }
      }
    });
    await expect(callTool(context, "desktop.get_active_window", {})).resolves.toMatchObject({
      ok: true,
      data: {
        supported: true,
        activeWindow: {
          appName: "Notes"
        }
      }
    });
    await expect(callTool(context, "desktop.screenshot", { filename: "screen.png" })).resolves.toMatchObject({
      ok: true,
      data: {
        supported: true,
        path: "/tmp/agenthost-desktop-test/screenshots/screen.png"
      }
    });

    expect(context.calls).toEqual(["desktop.get_capabilities", "desktop.get_active_window", "desktop.screenshot"]);
    expect(context.logger.entries).toHaveLength(3);
  });

  it("does not execute click or type when generic GUI control is disabled by policy", async () => {
    const context = createContext();
    const activeWindow = { appName: "Notes" };

    await expect(callTool(context, "desktop.hotkey", { keys: ["ctrl+l"], activeWindow })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "safety_blocked"
      }
    });
    await expect(callTool(context, "desktop.type_text", { text: "hello", activeWindow })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "safety_blocked"
      }
    });
    await expect(callTool(context, "desktop.click", { x: 10, y: 20, activeWindow })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "safety_blocked"
      }
    });

    expect(context.calls).toEqual(["desktop.get_active_window", "desktop.get_active_window"]);
  });

  it("previews a desktop click by validating the active window without clicking", async () => {
    const context = createContext({
      allowGenericClick: true
    });
    const result = await callTool(context, "desktop.click", {
      x: 10,
      y: 20,
      activeWindow: { appName: "Notes" },
      dryRun: true
    });

    expect(result).toMatchObject({
      ok: true,
      preview: true,
      data: {
        preview: true,
        wouldExecute: true,
        wouldBeBlocked: false,
        targetSummary: 'Notes "Notes - Draft"',
        confirmationAvailable: true,
        confirmationRequired: true
      }
    });
    expect(context.calls).toEqual(["desktop.get_active_window"]);
    expect(context.logger.entries[0]?.preview).toBe(true);
  });

  it("previews desktop typing without sending sensitive text", async () => {
    const context = createContext({
      allowGenericType: true
    });
    const secret = "my-preview-secret";
    const result = await callTool(context, "desktop.type_text", {
      text: secret,
      activeWindow: { appName: "Notes" },
      dataSensitivity: "secret",
      dryRun: true
    });

    expect(result).toMatchObject({
      ok: true,
      preview: true,
      data: {
        preview: true,
        wouldExecute: false,
        wouldBeBlocked: true,
        confirmationAvailable: false,
        dataSensitivity: "secret"
      }
    });
    expect(JSON.stringify(result.data)).not.toContain(secret);
    expect(context.calls).toEqual(["desktop.get_active_window"]);
    expect(context.logger.entries[0]?.outputSummary).not.toContain(secret);
  });

  it("does not execute approval-required screenshots in strict-like policy", async () => {
    const context = createContext({
      requireApprovalForMediumRisk: true
    });
    const result = await callTool(context, "desktop.screenshot", { filename: "screen.png" });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("approval_required");
    expect(context.calls).toEqual([]);
  });

  it("blocks sensitive GUI typing and clicking even when generic GUI control is enabled", async () => {
    const context = createContext({
      allowGenericClick: true,
      allowGenericType: true
    });
    context.linux.getActiveWindow = async () => ({
      supported: true,
      backend: "xdotool",
      activeWindow: {
        windowId: "99",
        appName: "Bitwarden",
        title: "Vault"
      },
      reason: "Fake sensitive active window."
    });

    await expect(
      callTool(context, "desktop.type_text", {
        text: "secret",
        activeWindow: { appName: "Bitwarden" }
      })
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "safety_blocked"
      }
    });

    await expect(
      callTool(context, "desktop.click", {
        x: 1,
        y: 2,
        activeWindow: { appName: "Bitwarden" }
      })
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "safety_blocked"
      }
    });

    expect(context.calls).toEqual([]);
  });

  it("returns structured unsupported results from the Linux backend", async () => {
    const context = createContext();
    context.linux.getActiveWindow = async () => ({
      supported: false,
      backend: "wayland",
      reason: "Unsupported backend."
    });

    const result = await callTool(context, "desktop.get_active_window", {});

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      supported: false,
      backend: "wayland"
    });
  });

  it("requires confirmation tokens for desktop click and never logs the raw token", async () => {
    const context = createContext({
      allowGenericClick: true
    });

    await expect(
      callTool(context, "desktop.click", {
        x: 10,
        y: 20,
        activeWindow: { appName: "Notes" }
      })
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "dry_run_required"
      }
    });

    const preview = await callTool(context, "desktop.click", {
      x: 10,
      y: 20,
      activeWindow: { appName: "Notes" },
      dryRun: true
    });
    const token = confirmationTokenOf(preview);

    expect(JSON.stringify(context.logger.entries[1])).not.toContain(token);

    await expect(
      callTool(context, "desktop.click", {
        x: 10,
        y: 20,
        activeWindow: { appName: "Notes" },
        confirmationToken: token
      })
    ).resolves.toMatchObject({
      ok: true,
      confirmation: {
        accepted: true
      }
    });
  });

  it("previews bounded pointer tools without executing", async () => {
    const context = createContext({ allowGenericClick: true });
    const cases: Array<[string, Record<string, unknown>]> = [
      ["desktop.move_mouse", { x: 10, y: 20 }],
      ["desktop.scroll", { direction: "down", amount: 2 }],
      ["desktop.double_click", { x: 10, y: 20 }],
      ["desktop.right_click", {}],
      ["desktop.drag", { startX: 1, startY: 2, endX: 10, endY: 20, durationMs: 100 }]
    ];
    for (const [name, input] of cases) {
      const result = await callTool(context, name, { ...input, activeWindow: { appName: "Notes" }, dryRun: true });
      expect(result.preview).toBe(true);
    }
    expect(context.calls).toEqual(["desktop.get_active_window", "desktop.get_active_window", "desktop.get_active_window", "desktop.get_active_window", "desktop.get_active_window"]);
  });
});
