import { randomUUID } from "node:crypto";
import { createAdapterRegistry, createBaseCapabilityRegistry, getPolicyProfile, type AgentHostConfig, type AuditLogger } from "@agenthost/core";
import { BrowserBridgeServer } from "@agenthost/app-browser";
import { describe, expect, it } from "vitest";
import { ConfirmationManager } from "../confirmation.js";
import type { AgentHostMcpContext } from "../context.js";
import { ForgeStore } from "../forge-store.js";
import { GrantStore } from "../grants.js";
import { runTool } from "../tool-runner.js";
import { createBrowserSetupTools } from "../tools/browser-setup.js";

class Logger implements AuditLogger { entries: unknown[] = []; async log(entry: unknown) { this.entries.push(entry); } }
function context(): AgentHostMcpContext { const root = `/tmp/agenthost-browser-setup-${randomUUID()}`, policy = getPolicyProfile("dev"), config: AgentHostConfig = { agentHostDir: root, configPath: `${root}/config.json`, logFile: `${root}/logs/x.jsonl`, profile: "dev", policy, browserBridge: { enabled: false, port: 43117, pairingTokenFile: `${root}/browser/pairing-token` } }; return { sessionId: "browser-setup", config, policy, registry: createBaseCapabilityRegistry(), adapters: createAdapterRegistry(), logger: new Logger(), confirmations: new ConfirmationManager(), grants: new GrantStore(), forge: new ForgeStore(root), browserBridge: new BrowserBridgeServer(config.browserBridge!), linux: {} as any }; }
async function call(contextValue: AgentHostMcpContext, name: string, input: unknown) { return runTool(createBrowserSetupTools().find((tool) => tool.name === name)!, input, contextValue); }

describe("browser setup tools", () => {
  it("reports disabled bridge and actionable diagnostics without a token", async () => { const value = context(); const status = await call(value, "browser.setup_status", {}); expect(status).toMatchObject({ ok: true, data: { state: "bridge_disabled", tokenExists: false } }); expect(JSON.stringify(status)).not.toContain("AH-"); const diagnose = await call(value, "browser.diagnose_bridge", {}); expect(diagnose).toMatchObject({ ok: true, data: { state: "bridge_disabled" } }); });
  it("returns install instructions and exposes setup tools", async () => { const value = context(); const install = await call(value, "browser.get_extension_install_instructions", { browser: "firefox" }); expect(install).toMatchObject({ ok: true, data: { browser: "firefox", neverAutoInstalled: true } }); expect(createBrowserSetupTools().map((tool) => tool.name)).toEqual(expect.arrayContaining(["browser.generate_pairing_token", "browser.reset_pairing", "browser.verify_pairing"])); });
});
