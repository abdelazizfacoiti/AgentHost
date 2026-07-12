import { createAdapterRegistry, createBaseCapabilityRegistry, getPolicyProfile, type AgentHostConfig, type AuditLogger } from "@agenthost/core";
import { describe, expect, it } from "vitest";
import { ConfirmationManager } from "../confirmation.js";
import type { AgentHostMcpContext } from "../context.js";
import { ForgeStore } from "../forge-store.js";
import { GrantStore } from "../grants.js";
import { runTool } from "../tool-runner.js";
import { createCheckpointTools } from "../tools/checkpoint.js";
class Logger implements AuditLogger { entries: any[] = []; async log(entry: any) { this.entries.push(entry); } }
function context(): AgentHostMcpContext { const policy = getPolicyProfile("dev"); const config: AgentHostConfig = { agentHostDir: "/tmp/agenthost-checkpoint", configPath: "/tmp/x", logFile: "/tmp/x", profile: "dev", policy }; return { sessionId: "checkpoint", config, policy, registry: createBaseCapabilityRegistry(), adapters: createAdapterRegistry(), logger: new Logger(), confirmations: new ConfirmationManager(), grants: new GrantStore({ persistentGrants: [] }), forge: new ForgeStore(config.agentHostDir), linux: { getActiveWindow: async () => ({ supported: true, backend: "test", activeWindow: { windowId: "1", appName: "Notes", title: "Ready" }, reason: "ok" }), fileExists: async ({ path }: any) => ({ path, exists: path === "/tmp/exists" }), findAccessibilityElement: async () => ({ supported: true, backend: "test", candidates: [{ elementId: "a" }], reason: "ok" }) } as any }; }
async function call(contextValue: AgentHostMcpContext, name: string, value: unknown) { return runTool(createCheckpointTools().find((tool) => tool.name === name)!, value, contextValue); }
describe("checkpoint tools", () => {
  it("evaluates active window and file metadata without action", async () => { const value = context(); const result = await call(value, "checkpoint.evaluate", { checkpoints: [{ kind: "active_window_matches", description: "window", sensitivity: "public", expected: { windowId: "1" } }, { kind: "file_exists", description: "file", sensitivity: "public", expected: { path: "/tmp/exists" } }] }); expect(result).toMatchObject({ ok: true, data: { status: "passed" } }); expect(value.linux).not.toHaveProperty("click"); });
  it("blocks secret and times out observation only", async () => { const value = context(); const secret = await call(value, "checkpoint.evaluate", { checkpoints: [{ kind: "manual_check", description: "secret", sensitivity: "secret", expected: {} }] }); expect(secret).toMatchObject({ ok: true, data: { status: "blocked" } }); const wait = await call(value, "checkpoint.wait_for", { timeoutMs: 100, pollIntervalMs: 250, checkpoints: [{ kind: "file_exists", description: "missing", sensitivity: "public", expected: { path: "/tmp/missing" } }] }); expect(wait).toMatchObject({ ok: true, data: { status: "timeout" } }); });
});
