import { randomUUID } from "node:crypto";
import { createAdapterRegistry, createBaseCapabilityRegistry, getPolicyProfile, type AgentHostConfig, type AuditLogEntry, type AuditLogger } from "@agenthost/core";
import { HeadlessOverlayRenderer, OverlayManager } from "@agenthost/app-overlay";
import { describe, expect, it } from "vitest";
import { ConfirmationManager } from "../confirmation.js";
import type { AgentHostMcpContext } from "../context.js";
import { ForgeStore } from "../forge-store.js";
import { GrantStore } from "../grants.js";
import { runTool } from "../tool-runner.js";
import { createGuideOverlayTools } from "../tools/guide-overlay.js";

class MemoryLogger implements AuditLogger { entries: AuditLogEntry[] = []; async log(entry: AuditLogEntry) { this.entries.push(entry); } }
function context(): AgentHostMcpContext {
  const dir = `/tmp/agenthost-guide-${randomUUID()}`;
  const policy = getPolicyProfile("dev");
  const config: AgentHostConfig = { agentHostDir: dir, configPath: `${dir}/config.json`, logFile: `${dir}/logs/test.jsonl`, profile: "dev", policy };
  return { sessionId: "guide-test", config, policy, registry: createBaseCapabilityRegistry(), adapters: createAdapterRegistry(), logger: new MemoryLogger(), confirmations: new ConfirmationManager(), grants: new GrantStore({ persistentGrants: [] }), forge: new ForgeStore(dir), overlay: new OverlayManager(new HeadlessOverlayRenderer(), { sessionId: "guide-test" }), linux: {} as AgentHostMcpContext["linux"] };
}
async function call(contextValue: AgentHostMcpContext, name: string, input: unknown) {
  const tool = createGuideOverlayTools().find((item) => item.name === name);
  if (tool === undefined) throw new Error("tool_missing");
  return runTool(tool, input, contextValue);
}

describe("visual guide overlays", () => {
  it("presents checklist, highlight, and tooltip in one call", async () => {
    const value = context();
    const result = await call(value, "overlay.guide_present", {
      title: "Pair the browser",
      steps: [
        { title: "Open extensions", instruction: "Open the extensions page.", target: { kind: "screen_point", point: { x: 100, y: 100 } } },
        { title: "Click Pair", instruction: "Choose Pair with AgentHost." }
      ]
    });
    expect(result.ok).toBe(true);
    const data = result.data as { guideId: string; stepCount: number; overlayIds: string[] };
    expect(data.stepCount).toBe(2);
    expect(data.overlayIds.length).toBe(3);
    expect((await value.overlay?.state())?.overlays.length).toBeGreaterThan(0);
  });

  it("advances through steps and dismisses everything when done", async () => {
    const value = context();
    const presented = await call(value, "overlay.guide_present", {
      title: "Two steps",
      steps: [
        { title: "First", instruction: "Do first." },
        { title: "Second", instruction: "Do second." }
      ]
    });
    const guideId = (presented.data as { guideId: string }).guideId;
    const advanced = await call(value, "overlay.guide_advance", { guideId });
    expect(advanced).toMatchObject({ ok: true, data: { done: false, currentIndex: 1 } });
    const done = await call(value, "overlay.guide_advance", { guideId });
    expect(done).toMatchObject({ ok: true, data: { done: true } });
    expect((await value.overlay?.state())?.overlays).toHaveLength(0);
  });

  it("dismisses on demand and rejects unknown guides", async () => {
    const value = context();
    const presented = await call(value, "overlay.guide_present", { title: "Once", steps: [{ title: "Only", instruction: "Do it." }] });
    const guideId = (presented.data as { guideId: string }).guideId;
    expect(await call(value, "overlay.guide_dismiss", { guideId })).toMatchObject({ ok: true, data: { dismissed: true } });
    expect(await call(value, "overlay.guide_advance", { guideId })).toMatchObject({ ok: false, error: { code: "guide_not_found" } });
    expect(await call(value, "overlay.guide_present", { title: "Empty", steps: [] })).toMatchObject({ ok: false });
  });
});
