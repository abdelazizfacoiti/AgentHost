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
import { ConfirmationManager } from "../confirmation.js";
import { GrantStore } from "../grants.js";
import { runTool } from "../tool-runner.js";
import { createForgeTools } from "../tools/forge.js";

class MemoryLogger implements AuditLogger {
  readonly entries: AuditLogEntry[] = [];

  async log(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

const validManifest = {
  schemaVersion: "agenthost.forge.v1",
  id: "example.generated-tool",
  displayName: "Example Generated Tool",
  version: "1.2.3",
  description: "Manifest for MCP tool tests.",
  kind: "tool",
  source: "generated",
  tools: [
    {
      name: "example.generated.preview",
      description: "Preview-only tool declaration.",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      riskLevel: "low",
      actionType: "inspect",
      strategy: "guide_only"
    }
  ],
  requestedPermissions: [
    {
      id: "write-output",
      tools: ["file.write"],
      fileRoots: ["~/.agenthost/outputs"],
      canWriteFiles: true
    }
  ],
  riskDeclaration: "medium",
  dataSensitivityDeclaration: "low",
  requirements: {
    requiresDryRun: true,
    requiresConfirmationToken: true
  }
} as const;

function createLinuxStub(config: AgentHostConfig, registry = createBaseCapabilityRegistry()): LinuxAutomation {
  return {
    getSystemInfo: () => ({
      platform: "linux",
      arch: "x64",
      nodeVersion: "v20.0.0",
      agentHostDir: config.agentHostDir,
      profile: config.profile,
      strategies: registry.listStrategies(),
      tools: registry.listTools().map((tool) => tool.name)
    }),
    checkDependency: async (input) => ({ found: false, kind: input.kind ?? "any", name: input.name, reason: "unused" }),
    detectApp: async (input) => ({
      found: false,
      appId: `unknown:${input.appName}`,
      adapterAvailable: false,
      availableStrategies: ["guide_only"],
      recommendedStrategy: "guide_only",
      appSensitivity: "unknown",
      reason: "unused"
    }),
    listInstalledApps: async () => ({ apps: [], truncated: false }),
    openApp: async (input) => ({ opened: false, appId: `unknown:${input.appName}`, strategy: "guide_only", reason: "unused" }),
    getAppStrategy: async (input) => ({
      found: false,
      appId: `unknown:${input.appName}`,
      adapterAvailable: false,
      availableStrategies: ["guide_only"],
      recommendedStrategy: "guide_only",
      appSensitivity: "unknown",
      taskType: input.taskType ?? "unknown",
      reason: "unused"
    }),
    runSafeCommand: async () => ({ exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 0, timedOut: false, truncated: false }),
    writeFile: async (input) => ({ path: input.path, bytesWritten: input.content.length, created: true }),
    readFile: async (input) => ({ path: input.path, content: "", encoding: input.encoding ?? "utf8", bytesRead: 0, truncated: false }),
    fileExists: async (input) => ({ path: input.path, exists: false }),
    listDirectory: async (input) => ({ path: input.path, entries: [], truncated: false }),
    ensureDir: async (input) => ({ path: input.path, exists: true, created: true }),
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
    getActiveWindow: async () => ({ supported: false, backend: "unavailable", reason: "unused" }),
    screenshot: async (input) => ({ supported: false, backend: "unavailable", path: input.path, reason: "unused" }),
    listWindows: async () => ({ supported: false, backend: "unavailable", windows: [], truncated: false, reason: "unused" }),
    focusWindow: async (input) => ({ supported: false, backend: "unavailable", focused: false, window: input, reason: "unused" }),
    hotkey: async (input) => ({ supported: false, backend: "unavailable", sent: false, keys: input.keys, activeWindow: input.activeWindow, reason: "unused" }),
    typeText: async (input) => ({ supported: false, backend: "unavailable", typed: false, characterCount: input.text.length, activeWindow: input.activeWindow, reason: "unused" }),
    click: async (input) => ({ supported: false, backend: "unavailable", clicked: false, x: input.x, y: input.y, button: input.button ?? "left", activeWindow: input.activeWindow, reason: "unused" }),
    getAccessibilityTree: async () => ({ supported: false, backend: "unavailable", nodeCount: 0, truncated: false, redacted: false, reason: "unused" }),
    findAccessibilityElement: async () => ({ supported: false, backend: "unavailable", candidates: [], reason: "unused" }),
    inspectAccessibilityElement: async () => ({ supported: false, backend: "unavailable", matched: false, ambiguous: false, redacted: false, reason: "unused" }),
    invokeAccessibilityAction: async (input) => ({ supported: false, backend: "unavailable", matched: false, ambiguous: false, performed: false, redacted: false, actionName: input.actionName, reason: "unused" }),
    setAccessibilityValue: async () => ({ supported: false, backend: "unavailable", matched: false, ambiguous: false, changed: false, redacted: true, redactedValue: true, reason: "unused" }),
    focusAccessibilityElement: async () => ({ supported: false, backend: "unavailable", matched: false, ambiguous: false, focused: false, redacted: false, reason: "unused" })
  };
}

function createContext(): AgentHostMcpContext & { logger: MemoryLogger } {
  const registry = createBaseCapabilityRegistry();
  const policy = getPolicyProfile("strict");
  const config: AgentHostConfig = {
    agentHostDir: "/tmp/agenthost-forge-tests",
    configPath: "/tmp/agenthost-forge-tests/config.json",
    logFile: "/tmp/agenthost-forge-tests/logs/agenthost.jsonl",
    profile: "strict",
    policy
  };
  const logger = new MemoryLogger();

  return {
    sessionId: "session_forge",
    config,
    policy,
    registry,
    adapters: createAdapterRegistry({ platform: "linux" }),
    logger,
    confirmations: new ConfirmationManager(),
    grants: new GrantStore({ persistentGrants: policy.grants }),
    linux: createLinuxStub(config, registry)
  };
}

describe("forge MCP tools", () => {
  it("validates a manifest and logs safely", async () => {
    const context = createContext();
    const tool = createForgeTools().find((candidate) => candidate.name === "forge.validate_manifest");

    const result = await runTool(tool!, { manifest: validManifest }, context);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ valid: true });
    expect(context.logger.entries[0]?.tool).toBe("forge.validate_manifest");
  });

  it("reviews a manifest without registering generated tools", async () => {
    const context = createContext();
    const tool = createForgeTools().find((candidate) => candidate.name === "forge.review_manifest");

    const result = await runTool(tool!, { manifest: validManifest }, context);

    expect(result.ok).toBe(true);
    expect((result.data as { missingGrants: string[] }).missingGrants).toEqual(["write-output"]);
    expect(context.registry.listTools().some((entry) => entry.name === "example.generated.preview")).toBe(false);
  });

  it("proposes grants without applying them", async () => {
    const context = createContext();
    const tool = createForgeTools().find((candidate) => candidate.name === "forge.propose_grants");

    const result = await runTool(tool!, { manifest: validManifest }, context);

    expect(result.ok).toBe(true);
    expect((result.data as { proposals: Array<{ grant: { id: string } }> }).proposals[0]?.grant.id).toBe(
      "forge.example.generated-tool.write-output"
    );
    expect(context.grants.listActiveGrants()).toHaveLength(0);
  });
});
