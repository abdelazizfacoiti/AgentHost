import { createAdapterRegistry, createBaseCapabilityRegistry, getPolicyProfile, type AgentHostConfig, type AuditLogEntry, type AuditLogger } from "@agenthost/core";
import { HeadlessOverlayRenderer, OverlayManager } from "@agenthost/app-overlay";
import { describe, expect, it } from "vitest";
import { ConfirmationManager } from "../confirmation.js";
import type { AgentHostMcpContext } from "../context.js";
import { ForgeStore } from "../forge-store.js";
import { GrantStore } from "../grants.js";
import { runTool } from "../tool-runner.js";
import { createOverlayDiagnosticsTools } from "../tools/overlay-diagnostics.js";

class MemoryLogger implements AuditLogger { entries: AuditLogEntry[] = []; async log(entry: AuditLogEntry) { this.entries.push(entry); } }
function context(): AgentHostMcpContext { const dir = "/tmp/agenthost-overlay-diagnostics"; const policy = getPolicyProfile("dev"); const config: AgentHostConfig = { agentHostDir: dir, configPath: `${dir}/config.json`, logFile: `${dir}/logs/test.jsonl`, profile: "dev", policy }; return { sessionId: "diagnostics-test", config, policy, registry: createBaseCapabilityRegistry(), adapters: createAdapterRegistry(), logger: new MemoryLogger(), confirmations: new ConfirmationManager(), grants: new GrantStore({ persistentGrants: [] }), forge: new ForgeStore(dir), overlay: new OverlayManager(new HeadlessOverlayRenderer(), { sessionId: "diagnostics-test" }), linux: {} as AgentHostMcpContext["linux"] }; }
async function call(contextValue: AgentHostMcpContext, name: string, input: unknown = {}) { const tool = createOverlayDiagnosticsTools().find((item) => item.name === name); if (tool === undefined) throw new Error("tool_missing"); return runTool(tool, input, contextValue); }

describe("overlay renderer diagnostics", () => {
  it("reports headless status and setup instructions without executing commands", async () => {
    const value = context();
    expect(await call(value, "overlay.renderer_status")).toMatchObject({ ok: true, data: { effectiveBackend: "headless", childState: "stopped" } });
    expect(await call(value, "overlay.renderer_setup_instructions")).toMatchObject({ ok: true, data: { noAutomaticInstall: true, noPrivilegeEscalation: true } });
    const instructions = await call(value, "overlay.renderer_setup_instructions");
    expect((instructions.data as { modes: Array<{ mode: string }> }).modes.map((item) => item.mode)).toEqual(expect.arrayContaining(["auto", "gtk3-native", "headless", "disabled", "webkit-gtk-react"]));
    expect(await call(value, "overlay.renderer_restart", { dryRun: true })).toMatchObject({ ok: true, preview: true, data: { onlyVisualChild: true, wouldRestart: true } });
  });
});
