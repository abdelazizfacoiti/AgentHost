import {
  createAdapterRegistry,
  createBaseCapabilityRegistry,
  getPolicyProfile,
  type AccessibilityElementDetails,
  type AgentHostConfig,
  type AuditLogEntry,
  type AuditLogger,
  type PolicyProfile
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

interface ContextOptions {
  policyOverride?: Partial<PolicyProfile>;
  inspectResult?: {
    supported: boolean;
    backend: string;
    matched: boolean;
    ambiguous: boolean;
    redacted: boolean;
    reason: string;
    element?: AccessibilityElementDetails;
  };
  invokeResult?: {
    supported: boolean;
    backend: string;
    matched: boolean;
    ambiguous: boolean;
    performed: boolean;
    redacted: boolean;
    actionName?: string;
    reason: string;
    target?: AccessibilityElementDetails;
  };
  setValueResult?: {
    supported: boolean;
    backend: string;
    matched: boolean;
    ambiguous: boolean;
    changed: boolean;
    redacted: boolean;
    redactedValue: boolean;
    reason: string;
    target?: AccessibilityElementDetails;
  };
  focusResult?: {
    supported: boolean;
    backend: string;
    matched: boolean;
    ambiguous: boolean;
    focused: boolean;
    redacted: boolean;
    reason: string;
    target?: AccessibilityElementDetails;
  };
}

function createContext(options: ContextOptions = {}): AgentHostMcpContext & { calls: string[]; logger: MemoryLogger } {
  const registry = createBaseCapabilityRegistry();
  const basePolicy = getPolicyProfile("dev");
  const policy = {
    ...basePolicy,
    ...options.policyOverride
  };
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
    },
    inspectAccessibilityElement: async () => {
      calls.push("accessibility.inspect_element");
      return (
        options.inspectResult ?? {
          supported: false,
          backend: "wayland",
          matched: false,
          ambiguous: false,
          redacted: false,
          reason: "Accessibility is unavailable with the current safe backend."
        }
      );
    },
    invokeAccessibilityAction: async (input) => {
      calls.push("accessibility.invoke_action");
      return (
        options.invokeResult ?? {
          supported: false,
          backend: "wayland",
          matched: false,
          ambiguous: false,
          performed: false,
          redacted: false,
          actionName: input.actionName,
          reason: "Accessibility is unavailable with the current safe backend."
        }
      );
    },
    setAccessibilityValue: async () => {
      calls.push("accessibility.set_value");
      return (
        options.setValueResult ?? {
          supported: false,
          backend: "wayland",
          matched: false,
          ambiguous: false,
          changed: false,
          redacted: true,
          redactedValue: true,
          reason: "Accessibility is unavailable with the current safe backend."
        }
      );
    },
    focusAccessibilityElement: async () => {
      calls.push("accessibility.focus_element");
      return (
        options.focusResult ?? {
          supported: false,
          backend: "wayland",
          matched: false,
          ambiguous: false,
          focused: false,
          redacted: false,
          reason: "Accessibility is unavailable with the current safe backend."
        }
      );
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

function normalElement(overrides: Partial<AccessibilityElementDetails> = {}): AccessibilityElementDetails {
  return {
    elementId: "123:0/1/2",
    role: "push button",
    name: "Save",
    states: ["enabled", "focusable"],
    availableActions: ["click"],
    appName: "GIMP",
    pid: 123,
    dataSensitivity: "none",
    ...overrides
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
      "accessibility.focus_element",
      "accessibility.get_tree",
      "accessibility.inspect_element",
      "accessibility.invoke_action",
      "accessibility.set_value"
    ]);
  });

  it("returns unsupported inspect results cleanly and logs the call", async () => {
    const context = createContext();
    const result = await callTool(context, "accessibility.inspect_element", { query: "Save" });

    expect(result).toMatchObject({
      ok: true,
      data: {
        supported: false,
        backend: "wayland",
        matched: false
      }
    });
    expect(context.calls).toEqual(["accessibility.inspect_element"]);
    expect(context.logger.entries).toHaveLength(1);
  });

  it("returns unsupported invoke results cleanly and logs the call", async () => {
    const context = createContext();
    const result = await callTool(context, "accessibility.invoke_action", { query: "Save", actionName: "click" });

    expect(result).toMatchObject({
      ok: true,
      data: {
        supported: false,
        backend: "wayland",
        performed: false
      }
    });
    expect(context.calls).toEqual(["accessibility.inspect_element"]);
    expect(context.logger.entries).toHaveLength(1);
  });

  it("previews a safe accessibility action without invoking it", async () => {
    const context = createContext({
      inspectResult: {
        supported: true,
        backend: "atspi",
        matched: true,
        ambiguous: false,
        redacted: false,
        reason: "Resolved one accessibility element through AT-SPI.",
        element: normalElement()
      }
    });
    const result = await callTool(context, "accessibility.invoke_action", {
      query: "Save",
      actionName: "click",
      dryRun: true
    });

    expect(result).toMatchObject({
      ok: true,
      preview: true,
      data: {
        preview: true,
        wouldExecute: true,
        wouldBeBlocked: false,
        targetSummary: 'push button "Save" in GIMP'
      }
    });
    expect(context.calls).toEqual(["accessibility.inspect_element"]);
    expect(context.logger.entries[0]?.preview).toBe(true);
  });

  it("returns unsupported set_value results cleanly and logs the call", async () => {
    const context = createContext();
    const result = await callTool(context, "accessibility.set_value", { query: "Name", value: "hello" });

    expect(result).toMatchObject({
      ok: true,
      data: {
        supported: false,
        backend: "wayland",
        changed: false,
        redactedValue: true
      }
    });
    expect(context.calls).toEqual(["accessibility.inspect_element"]);
    expect(context.logger.entries).toHaveLength(1);
  });

  it("previews ambiguous accessibility targets without invoking actions", async () => {
    const context = createContext({
      inspectResult: {
        supported: true,
        backend: "atspi",
        matched: false,
        ambiguous: true,
        redacted: false,
        reason: "The requested accessibility target matched multiple elements."
      }
    });
    const result = await callTool(context, "accessibility.invoke_action", {
      query: "Save",
      actionName: "click",
      dryRun: true
    });

    expect(result).toMatchObject({
      ok: true,
      preview: true,
      data: {
        preview: true,
        ambiguous: true,
        wouldExecute: false
      }
    });
    expect(context.calls).toEqual(["accessibility.inspect_element"]);
  });

  it("returns unsupported focus results cleanly and logs the call", async () => {
    const context = createContext();
    const result = await callTool(context, "accessibility.focus_element", { query: "Save" });

    expect(result).toMatchObject({
      ok: true,
      data: {
        supported: false,
        backend: "wayland",
        focused: false
      }
    });
    expect(context.calls).toEqual(["accessibility.inspect_element"]);
    expect(context.logger.entries).toHaveLength(1);
  });

  it("rejects ambiguous targets without performing accessibility actions", async () => {
    const context = createContext({
      inspectResult: {
        supported: true,
        backend: "atspi",
        matched: false,
        ambiguous: true,
        redacted: false,
        reason: "The requested accessibility target matched multiple elements."
      }
    });
    const result = await callTool(context, "accessibility.invoke_action", { query: "Save", actionName: "click" });

    expect(result).toMatchObject({
      ok: true,
      data: {
        supported: true,
        ambiguous: true,
        performed: false
      }
    });
    expect(context.calls).toEqual(["accessibility.inspect_element"]);
  });

  it("blocks sensitive app actions before execution", async () => {
    const context = createContext({
      inspectResult: {
        supported: true,
        backend: "atspi",
        matched: true,
        ambiguous: false,
        redacted: false,
        reason: "Resolved one accessibility element through AT-SPI.",
        element: normalElement({
          appName: "Bitwarden",
          appSensitivity: "credential_or_security"
        })
      }
    });
    const result = await callTool(context, "accessibility.focus_element", { query: "Vault" });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("safety_blocked");
    expect(context.calls).toEqual(["accessibility.inspect_element"]);
  });

  it("redacts set_value results and audit summaries", async () => {
    const secretValue = "super-secret-value";
    const context = createContext({
      policyOverride: {
        requireApprovalForMediumRisk: false
      },
      inspectResult: {
        supported: true,
        backend: "atspi",
        matched: true,
        ambiguous: false,
        redacted: false,
        reason: "Resolved one accessibility element through AT-SPI.",
        element: normalElement({
          role: "entry",
          dataSensitivity: "low",
          valueMetadata: {
            supportsText: true,
            supportsValue: false,
            editable: true,
            readOnly: false
          }
        })
      },
      setValueResult: {
        supported: true,
        backend: "atspi",
        matched: true,
        ambiguous: false,
        changed: true,
        redacted: true,
        redactedValue: true,
        reason: "Set the accessibility text value.",
        target: normalElement({
          role: "entry",
          dataSensitivity: "low",
          valueMetadata: {
            supportsText: true,
            supportsValue: false,
            editable: true,
            readOnly: false
          }
        })
      }
    });
    const result = await callTool(context, "accessibility.set_value", { query: "Name", value: secretValue });

    expect(result).toMatchObject({
      ok: true,
      data: {
        changed: true,
        redactedValue: true
      }
    });
    expect(JSON.stringify(result.data)).not.toContain(secretValue);
    expect(context.logger.entries).toHaveLength(1);
    expect(context.logger.entries[0]?.outputSummary).not.toContain(secretValue);
    expect(context.calls).toEqual(["accessibility.inspect_element", "accessibility.set_value"]);
  });

  it("previews secret set_value requests without leaking the secret", async () => {
    const secretValue = "preview-secret-value";
    const context = createContext({
      inspectResult: {
        supported: true,
        backend: "atspi",
        matched: true,
        ambiguous: false,
        redacted: false,
        reason: "Resolved one accessibility element through AT-SPI.",
        element: normalElement({
          role: "entry",
          dataSensitivity: "low",
          valueMetadata: {
            supportsText: true,
            supportsValue: false,
            editable: true,
            readOnly: false
          }
        })
      }
    });
    const result = await callTool(context, "accessibility.set_value", {
      query: "Name",
      value: secretValue,
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
        dataSensitivity: "secret"
      }
    });
    expect(JSON.stringify(result.data)).not.toContain(secretValue);
    expect(context.logger.entries[0]?.outputSummary).not.toContain(secretValue);
    expect(context.logger.entries[0]?.preview).toBe(true);
    expect(context.calls).toEqual(["accessibility.inspect_element"]);
  });
});
