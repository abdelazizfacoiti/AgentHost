import { randomUUID } from "node:crypto";
import { createAdapterRegistry, createBaseCapabilityRegistry, getPolicyProfile, type AgentHostConfig, type AuditLogEntry, type AuditLogger } from "@agenthost/core";
import { HeadlessOverlayRenderer, OverlayManager } from "@agenthost/app-overlay";
import { describe, expect, it } from "vitest";
import { ConfirmationManager } from "../confirmation.js";
import type { AgentHostMcpContext } from "../context.js";
import { ForgeStore } from "../forge-store.js";
import { GrantStore } from "../grants.js";
import { runTool } from "../tool-runner.js";
import { createOverlayTools } from "../tools/overlay.js";

class MemoryLogger implements AuditLogger { entries: AuditLogEntry[] = []; async log(entry: AuditLogEntry) { this.entries.push(entry); } }
function context(): AgentHostMcpContext { const dir = `/tmp/agenthost-overlay-${randomUUID()}`; const policy = getPolicyProfile("dev"); const config: AgentHostConfig = { agentHostDir: dir, configPath: `${dir}/config.json`, logFile: `${dir}/logs/test.jsonl`, profile: "dev", policy }; return { sessionId: "overlay-test", config, policy, registry: createBaseCapabilityRegistry(), adapters: createAdapterRegistry(), logger: new MemoryLogger(), confirmations: new ConfirmationManager(), grants: new GrantStore({ persistentGrants: [] }), forge: new ForgeStore(dir), overlay: new OverlayManager(new HeadlessOverlayRenderer(), { sessionId: "overlay-test" }), linux: { getScreenGeometry: async () => ({ supported: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, reason: "test" }) } as AgentHostMcpContext["linux"] }; }
async function call(contextValue: AgentHostMcpContext, name: string, input: unknown) { const tool = createOverlayTools().find((item) => item.name === name); if (tool === undefined) throw new Error("tool_missing"); return runTool(tool, input, contextValue); }
const point = { kind: "screen_point" as const, point: { x: 20, y: 30 }, trusted: true as const, expiresAt: new Date(Date.now() + 20_000).toISOString() };

describe("overlay MCP tools", () => {
  it("lists capabilities, supports dry-run, and never creates confirmation tokens", async () => {
    const value = context();
    expect(await call(value, "overlay.get_capabilities", {})).toMatchObject({ ok: true, data: { rendererStatus: "headless" } });
    const preview = await call(value, "overlay.show_pointer", { target: point, dryRun: true });
    expect(preview).toMatchObject({ ok: true, preview: true, data: { preview: true, wouldShow: true } });
    expect((await value.overlay?.state())?.overlays).toHaveLength(0);
    expect(value.confirmations).not.toHaveProperty("tokens");
  });

  it("shows, updates, and clears only local metadata", async () => {
    const value = context(); const shown = await call(value, "overlay.show_tooltip", { target: point, text: "Continue", sensitivity: "public" });
    expect(shown).toMatchObject({ ok: true, data: { overlayId: expect.any(String) } }); const overlayId = (shown.data as { overlayId: string }).overlayId;
    expect(await call(value, "overlay.update", { overlayId, patch: { text: "Updated" } })).toMatchObject({ ok: true });
    expect(await call(value, "overlay.clear", {})).toMatchObject({ ok: true });
    expect(await call(value, "overlay.get_state", {})).toMatchObject({ ok: true, data: { overlays: [] } });
  });

  it("rejects unsafe widget content and emergency-hides safely", async () => {
    const value = context();
    expect(await call(value, "overlay.show_widget", { widget: { title: "bad", sensitivity: "public", components: [{ type: "html", html: "<script>bad</script>" }] } })).toMatchObject({ ok: false, error: { code: expect.stringContaining("overlay") } });
    expect(await call(value, "overlay.emergency_hide", {})).toMatchObject({ ok: true });
  });
});
