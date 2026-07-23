import {
  createAdapterRegistry,
  createBaseCapabilityRegistry,
  getPolicyProfile,
  type AgentHostConfig,
  type AuditLogEntry,
  type AuditLogger
} from "@agenthost/core";
import { describe, expect, it } from "vitest";
import { runTool, type ToolExecutionContext } from "../tool-runner.js";
import { createSystemTools } from "../tools/system.js";
import { createPolicyTools } from "../tools/policy.js";
import { z } from "zod";
import type { AgentHostMcpContext, LinuxAutomation } from "../context.js";
import { ConfirmationManager } from "../confirmation.js";
import { ForgeStore } from "../forge-store.js";
import { GrantStore } from "../grants.js";

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
    ensureDir: async (input) => ({ path: input.path, exists: true, created: true }),
    getDesktopCapabilities: async () => ({
      platform: "linux",
      sessionType: "unknown",
      displayAvailable: false,
      backend: "unavailable",
      activeWindow: { supported: false, backend: "unavailable", reason: "Not used in system tests." },
      screenshot: { supported: false, backend: "unavailable", reason: "Not used in system tests." },
      windowList: { supported: false, backend: "unavailable", reason: "Not used in system tests." },
      windowFocus: { supported: false, backend: "unavailable", reason: "Not used in system tests." },
      accessibility: { supported: false, backend: "unavailable", reason: "Not used in system tests." },
      guiInput: { supported: false, backend: "unavailable", reason: "Not used in system tests." }
    }),
    getActiveWindow: async () => ({ supported: false, backend: "unavailable", reason: "Not used in system tests." }),
    screenshot: async (input) => ({
      supported: false,
      backend: "unavailable",
      path: input.path,
      reason: "Not used in system tests."
    }),
    listWindows: async () => ({
      supported: false,
      backend: "unavailable",
      windows: [],
      truncated: false,
      reason: "Not used in system tests."
    }),
    focusWindow: async (input) => ({
      supported: false,
      backend: "unavailable",
      focused: false,
      window: input,
      reason: "Not used in system tests."
    }),
    hotkey: async (input) => ({
      supported: false,
      backend: "unavailable",
      sent: false,
      keys: input.keys,
      activeWindow: input.activeWindow,
      reason: "Not used in system tests."
    }),
    typeText: async (input) => ({
      supported: false,
      backend: "unavailable",
      typed: false,
      characterCount: input.text.length,
      activeWindow: input.activeWindow,
      reason: "Not used in system tests."
    }),
    click: async (input) => ({
      supported: false,
      backend: "unavailable",
      clicked: false,
      x: input.x,
      y: input.y,
      button: input.button ?? "left",
      activeWindow: input.activeWindow,
      reason: "Not used in system tests."
    }),
    getAccessibilityTree: async () => ({
      supported: false,
      backend: "unavailable",
      nodeCount: 0,
      truncated: false,
      redacted: false,
      reason: "Not used in system tests."
    }),
    findAccessibilityElement: async () => ({
      supported: false,
      backend: "unavailable",
      candidates: [],
      reason: "Not used in system tests."
    }),
    inspectAccessibilityElement: async () => ({
      supported: false,
      backend: "unavailable",
      matched: false,
      ambiguous: false,
      redacted: false,
      reason: "Not used in system tests."
    }),
    invokeAccessibilityAction: async (input) => ({
      supported: false,
      backend: "unavailable",
      matched: false,
      ambiguous: false,
      performed: false,
      redacted: false,
      actionName: input.actionName,
      reason: "Not used in system tests."
    }),
    setAccessibilityValue: async () => ({
      supported: false,
      backend: "unavailable",
      matched: false,
      ambiguous: false,
      changed: false,
      redacted: true,
      redactedValue: true,
      reason: "Not used in system tests."
    }),
    focusAccessibilityElement: async () => ({
      supported: false,
      backend: "unavailable",
      matched: false,
      ambiguous: false,
      focused: false,
      redacted: false,
      reason: "Not used in system tests."
    })
  };

  return {
    sessionId: "session_test",
    config,
    policy,
    registry,
    adapters: createAdapterRegistry({ platform: "linux" }),
    logger,
    confirmations: new ConfirmationManager(),
    grants: new GrantStore({ persistentGrants: policy.grants }),
    forge: new ForgeStore(config.agentHostDir),
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
      expect.arrayContaining([
        "system.get_info",
        "system.list_capabilities",
        "system.check_dependency",
        "policy.get_profile",
        "policy.list_profiles",
        "policy.list_grants",
        "policy.explain_decision",
        "forge.validate_manifest",
        "forge.review_manifest",
        "forge.propose_grants",
        "forge.save_manifest",
        "forge.list_manifests",
        "forge.get_manifest",
        "forge.create_review",
        "forge.get_review",
        "forge.list_reviews",
        "forge.archive_manifest",
        "forge.apply_session_grants_from_review"
      ])
    );
  });

  it("returns built-in policy profiles and safe grant summaries", async () => {
    const logger = new MemoryLogger();
    const context = createContext(logger);
    context.grants = new GrantStore({
      persistentGrants: [
        {
          id: "allow-output-write",
          scope: "persistent",
          effect: "allow",
          match: {
            tools: ["file.write"],
            fileRoots: ["~/.agenthost/outputs"]
          },
          requirements: {
            requiresDryRun: true,
            requiresConfirmationToken: true
          }
        }
      ]
    });

    const listProfiles = createPolicyTools().find((candidate) => candidate.name === "policy.list_profiles");
    const listGrants = createPolicyTools().find((candidate) => candidate.name === "policy.list_grants");

    expect(listProfiles).toBeDefined();
    expect(listGrants).toBeDefined();

    const profilesResult = await runTool(listProfiles!, {}, context);
    const grantsResult = await runTool(listGrants!, {}, context);

    expect(profilesResult.ok).toBe(true);
    expect(profilesResult.data).toMatchObject({
      profiles: expect.arrayContaining([
        expect.objectContaining({ name: "strict" }),
        expect.objectContaining({ name: "dev" }),
        expect.objectContaining({ name: "gui-dev" }),
        expect.objectContaining({ name: "private-data" }),
        expect.objectContaining({ name: "autopilot-future-disabled-by-default" })
      ])
    });
    expect(grantsResult.ok).toBe(true);
    expect(grantsResult.data).toMatchObject({
      profile: "strict",
      grants: [
        expect.objectContaining({
          id: "allow-output-write",
          effect: "allow",
          active: true
        })
      ]
    });
  });

  it("explains policy decisions with matched grant metadata and logs the profile", async () => {
    const logger = new MemoryLogger();
    const context = createContext(logger);
    context.grants = new GrantStore({
      persistentGrants: [
        {
          id: "allow-private-read",
          scope: "persistent",
          effect: "allow",
          match: {
            tools: ["file.read"],
            dataSensitivities: ["sensitive"]
          }
        }
      ]
    });

    const explain = createPolicyTools().find((candidate) => candidate.name === "policy.explain_decision");
    expect(explain).toBeDefined();

    const result = await runTool(
      explain!,
      {
        tool: "file.read",
        actionType: "file_read",
        filePath: "/tmp/private.txt",
        dataSensitivity: "sensitive"
      },
      context
    );

    expect(result.ok).toBe(true);
    expect(result.grantDecision).toMatchObject({
      matchedGrantIds: ["allow-private-read"],
      allowedByGrantIds: ["allow-private-read"]
    });
    expect(logger.entries.at(-1)).toMatchObject({
      profile: "strict",
      matchedGrantIds: ["allow-private-read"]
    });
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
    expect(result.error?.code).toBe("action_target_missing");
    expect(result.approval.status).toBe("not_required");
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

  it("allows dry-run previews to return safety results without executing", async () => {
    const logger = new MemoryLogger();
    const context = createContext(logger);
    let handlerCalled = false;

    const result = await runTool(
      {
        name: "app.open",
        description: "Future app launch tool.",
        riskLevel: "medium",
        inputSchema: z.object({ dryRun: z.boolean().optional() }).strict(),
        mcpInputSchema: {
          type: "object",
          properties: {
            dryRun: {
              type: "boolean"
            }
          },
          additionalProperties: false
        },
        inputSummary: "Future app launch",
        safety: {
          actionType: "app_launch",
          getInput: () => ({ appName: "GIMP" })
        },
        preview: {
          isDryRun: (input) => input.dryRun === true
        },
        handler(_input, _context, runtime) {
          handlerCalled = true;
          return {
            ok: true,
            tool: "app.open",
            riskLevel: runtime?.safetyDecision?.riskLevel ?? "medium",
            preview: true,
            approval: runtime?.safetyDecision?.approval ?? { required: false, status: "not_required" },
            data: {
              preview: true,
              wouldExecute: false
            },
            observations: ["Preview only."],
            error: null
          };
        }
      },
      { dryRun: true },
      context
    );

    expect(handlerCalled).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.preview).toBe(true);
    expect(result.approval.status).toBe("required");
    expect(logger.entries[0]?.preview).toBe(true);
  });
});
