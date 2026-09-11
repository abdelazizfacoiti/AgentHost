import { randomUUID } from "node:crypto";
import { createAdapterRegistry, createBaseCapabilityRegistry, getPolicyProfile, type AgentHostConfig, type AuditLogger } from "@agenthost/core";
import { BrowserBridgeServer } from "@agenthost/app-browser";
import { describe, expect, it } from "vitest";
import { ConfirmationManager } from "../confirmation.js";
import type { AgentHostMcpContext } from "../context.js";
import { ForgeStore } from "../forge-store.js";
import { GrantStore } from "../grants.js";
import { runTool } from "../tool-runner.js";
import { createBrowserTools } from "../tools/browser.js";

class Logger implements AuditLogger { entries: unknown[] = []; async log(entry: unknown) { this.entries.push(entry); } }
function context(placement: "foreground" | "background" = "foreground"): AgentHostMcpContext { const root = `/tmp/agenthost-browser-background-${randomUUID()}`, policy = getPolicyProfile("dev"), config: AgentHostConfig = { agentHostDir: root, configPath: `${root}/config.json`, logFile: `${root}/logs/x.jsonl`, profile: "dev", policy, execution: { placement }, browserBridge: { enabled: false, port: 43117, pairingTokenFile: `${root}/browser/pairing-token` } }; return { sessionId: "browser-background", config, policy, registry: createBaseCapabilityRegistry(), adapters: createAdapterRegistry(), logger: new Logger(), confirmations: new ConfirmationManager(), grants: new GrantStore(), forge: new ForgeStore(root), browserBridge: new BrowserBridgeServer(config.browserBridge!), linux: {} as any }; }

describe("browser.background_status", () => {
  it("reports foreground placement with an isolated headless profile and spawns nothing", async () => {
    const value = context("foreground");
    const result = await runTool(createBrowserTools().find((tool) => tool.name === "browser.background_status")!, {}, value);
    expect(result).toMatchObject({ ok: true, tool: "browser.background_status", riskLevel: "observe" });
    const data = result.data as { placement: string; profileDir: string; headless: boolean; args: string[] };
    expect(data.placement).toBe("foreground");
    expect(data.profileDir).toBe(`${value.config.agentHostDir}/browser/profiles/background`);
    expect(data.headless).toBe(true);
    expect(data.args).toContain("--headless=new");
    expect(data.args).toContain(`--user-data-dir=${data.profileDir}`);
  });
  it("reports background placement when configured", async () => {
    const value = context("background");
    const result = await runTool(createBrowserTools().find((tool) => tool.name === "browser.background_status")!, {}, value);
    expect(result).toMatchObject({ ok: true, data: { placement: "background" } });
  });
});
