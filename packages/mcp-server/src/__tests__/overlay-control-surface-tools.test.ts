import { randomUUID } from "node:crypto";
import { createAdapterRegistry, createBaseCapabilityRegistry, getPolicyProfile, type AgentHostConfig, type AuditLogEntry, type AuditLogger } from "@agenthost/core";
import { HeadlessOverlayRenderer, OverlayManager } from "@agenthost/app-overlay";
import { describe, expect, it } from "vitest";
import { ConfirmationManager } from "../confirmation.js";
import type { AgentHostMcpContext } from "../context.js";
import { ForgeStore } from "../forge-store.js";
import { GrantStore } from "../grants.js";
import { OverlayAssistanceStore } from "../overlay-assistance-store.js";
import { OverlayControlSurfaceStore } from "../overlay-control-surface-store.js";
import { runTool } from "../tool-runner.js";
import { createOverlayAssistanceTools } from "../tools/overlay-assistance.js";
import { createOverlayControlSurfaceTools } from "../tools/overlay-control-surface.js";

class MemoryLogger implements AuditLogger { entries: AuditLogEntry[] = []; async log(entry: AuditLogEntry) { this.entries.push(entry); } }
function context(): AgentHostMcpContext {
  const dir = `/tmp/agenthost-control-surface-${randomUUID()}`;
  const policy = getPolicyProfile("dev");
  const config: AgentHostConfig = { agentHostDir: dir, configPath: `${dir}/config.json`, logFile: `${dir}/logs/test.jsonl`, profile: "dev", policy };
  const overlay = new OverlayManager(new HeadlessOverlayRenderer(), { sessionId: "control-surface-test" });
  const assistance = new OverlayAssistanceStore(dir, overlay, "control-surface-test");
  return { sessionId: "control-surface-test", config, policy, registry: createBaseCapabilityRegistry(), adapters: createAdapterRegistry(), logger: new MemoryLogger(), confirmations: new ConfirmationManager(), grants: new GrantStore({ persistentGrants: [] }), forge: new ForgeStore(dir), overlay, overlayAssistance: assistance, overlayControlSurface: new OverlayControlSurfaceStore(dir, overlay, assistance, "control-surface-test"), linux: {} as AgentHostMcpContext["linux"] };
}
async function call(contextValue: AgentHostMcpContext, name: string, input: unknown) {
  const tool = [...createOverlayAssistanceTools(), ...createOverlayControlSurfaceTools()].find((item) => item.name === name);
  if (tool === undefined) throw new Error("tool_missing");
  return runTool(tool, input, contextValue);
}
async function createActiveSession(value: AgentHostMcpContext): Promise<string> {
  await value.overlayAssistance?.ensureStructure();
  await value.overlayControlSurface?.ensureStructure();
  const created = await call(value, "overlay.assistance_session_create", { name: "control surface", steps: [{ stepId: "step-1", index: 0, type: "pointer", primitive: { type: "pointer", sensitivity: "public" } }] });
  const sessionId = (created.data as { sessionId: string }).sessionId;
  await call(value, "overlay.assistance_session_start", { sessionId });
  return sessionId;
}

describe("overlay control surface tools", () => {
  it("creates one surface and supports safe lifecycle", async () => {
    const value = context();
    const sessionId = await createActiveSession(value);
    const shown = await call(value, "overlay.control_surface_show", { assistanceSessionId: sessionId });
    expect(shown).toMatchObject({ ok: true, data: { status: "visible", bindingState: "bound", overlayId: expect.any(String), recommendedActions: expect.arrayContaining(["continue", "pause", "cancel"]), stepPreview: { targetFreshness: "missing" }, sessionExplanation: { status: "active" } } });
    const surfaceId = (shown.data as { controlSurfaceId: string }).controlSurfaceId;
    const overlayId = (shown.data as { overlayId: string }).overlayId;
    expect(await call(value, "overlay.control_surface_get", { assistanceSessionId: sessionId })).toMatchObject({ ok: true, data: { controlSurfaceId: surfaceId, status: "visible" } });
    expect(await call(value, "overlay.control_surface_apply_event", { assistanceSessionId: sessionId, controlSurfaceId: surfaceId, overlayId, eventId: "event-1", action: "pause", createdAt: new Date().toISOString() })).toMatchObject({ ok: true, data: { event: { outcome: "accepted" }, assistanceStatus: "paused" } });
    expect(await call(value, "overlay.control_surface_hide", { assistanceSessionId: sessionId, controlSurfaceId: surfaceId })).toMatchObject({ ok: true, data: { status: "hidden", bindingState: "unbound" } });
  });

  it("rejects untrusted ownership fields, duplicate events, and stale bindings", async () => {
    const value = context();
    const sessionId = await createActiveSession(value);
    const shown = await call(value, "overlay.control_surface_show", { assistanceSessionId: sessionId });
    const surfaceId = (shown.data as { controlSurfaceId: string }).controlSurfaceId;
    const overlayId = (shown.data as { overlayId: string }).overlayId;
    expect(await call(value, "overlay.control_surface_apply_event", { assistanceSessionId: sessionId, controlSurfaceId: surfaceId, overlayId, eventId: "event-2", action: "pause", createdAt: new Date().toISOString(), ownerSessionId: "attacker" })).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(await call(value, "overlay.control_surface_apply_event", { assistanceSessionId: sessionId, controlSurfaceId: surfaceId, overlayId, eventId: "event-3", action: "pause", createdAt: new Date().toISOString() })).toMatchObject({ ok: true });
    expect(await call(value, "overlay.control_surface_apply_event", { assistanceSessionId: sessionId, controlSurfaceId: surfaceId, overlayId, eventId: "event-3", action: "pause", createdAt: new Date().toISOString() })).toMatchObject({ ok: false, error: { code: "control_surface_event_reused" } });
    await value.overlay?.restartRenderer();
    expect(await call(value, "overlay.control_surface_get", { assistanceSessionId: sessionId })).toMatchObject({ ok: true, data: { status: "stale", bindingState: "stale" } });
  });

  it("keeps control surface tools visual-only and parity-ready", () => {
    for (const tool of createOverlayControlSurfaceTools()) expect(tool.execution).toMatchObject({ executionClass: "visual_only", externalEffect: false, requiresConfirmationToken: false, requiresDryRun: false, requiresExactTarget: false });
    expect(createOverlayControlSurfaceTools().map((tool) => tool.name)).toEqual(["overlay.control_surface_show", "overlay.control_surface_get", "overlay.control_surface_update", "overlay.control_surface_hide", "overlay.control_surface_apply_event"]);
  });
});
