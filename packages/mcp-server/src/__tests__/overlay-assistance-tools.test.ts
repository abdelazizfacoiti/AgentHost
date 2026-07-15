import { randomUUID } from "node:crypto";
import { createAdapterRegistry, createBaseCapabilityRegistry, getPolicyProfile, type AgentHostConfig, type AuditLogEntry, type AuditLogger } from "@agenthost/core";
import { HeadlessOverlayRenderer, OverlayManager } from "@agenthost/app-overlay";
import { describe, expect, it } from "vitest";
import { ConfirmationManager } from "../confirmation.js";
import type { AgentHostMcpContext } from "../context.js";
import { ForgeStore } from "../forge-store.js";
import { GrantStore } from "../grants.js";
import { OverlayAssistanceStore } from "../overlay-assistance-store.js";
import { runTool } from "../tool-runner.js";
import { createOverlayAssistanceTools } from "../tools/overlay-assistance.js";

class MemoryLogger implements AuditLogger { entries: AuditLogEntry[] = []; async log(entry: AuditLogEntry) { this.entries.push(entry); } }
function context(): AgentHostMcpContext { const dir = `/tmp/agenthost-assistance-${randomUUID()}`; const policy = getPolicyProfile("dev"); const config: AgentHostConfig = { agentHostDir: dir, configPath: `${dir}/config.json`, logFile: `${dir}/logs/test.jsonl`, profile: "dev", policy }; const overlay = new OverlayManager(new HeadlessOverlayRenderer(), { sessionId: "assistance-test" }); return { sessionId: "assistance-test", config, policy, registry: createBaseCapabilityRegistry(), adapters: createAdapterRegistry(), logger: new MemoryLogger(), confirmations: new ConfirmationManager(), grants: new GrantStore({ persistentGrants: [] }), forge: new ForgeStore(dir), overlay, overlayAssistance: new OverlayAssistanceStore(dir, overlay, "assistance-test"), linux: { getScreenGeometry: async () => ({ supported: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, reason: "test" }) } as AgentHostMcpContext["linux"] }; }
async function call(contextValue: AgentHostMcpContext, name: string, input: unknown) { const tool = createOverlayAssistanceTools().find((item) => item.name === name); if (tool === undefined) throw new Error("tool_missing"); return runTool(tool, input, contextValue); }

describe("overlay assistance tools", () => {
  it("creates, starts, shows, advances, handles event, and completes one step at a time", async () => {
    const value = context(); await value.overlayAssistance?.ensureStructure();
    const created = await call(value, "overlay.assistance_session_create", { name: "safe visual flow", steps: [
      { stepId: "step-1", index: 0, type: "pointer", primitive: { type: "pointer", sensitivity: "public" } },
      { stepId: "step-2", index: 1, type: "wait_for_event", requiresEvent: true, expectedEvent: "accepted", widget: { title: "Continue", sensitivity: "public", interaction: { interactive: true, focus: "never", dismissible: true, allowedEvents: ["accepted"] }, components: [{ type: "button", label: "Continue", event: "accepted" }] } }
    ] });
    expect(created).toMatchObject({ ok: true, data: { status: "ready" } });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    expect(await call(value, "overlay.assistance_session_start", { sessionId })).toMatchObject({ ok: true, data: { status: "active" } });
    expect(await call(value, "overlay.assistance_step_show", { sessionId })).toMatchObject({ ok: true, data: { currentStepIndex: 0 } });
    expect(await call(value, "overlay.assistance_step_advance", { sessionId })).toMatchObject({ ok: true, data: { currentStepIndex: 1 } });
    const shown = await call(value, "overlay.assistance_step_show", { sessionId });
    expect(shown).toMatchObject({ ok: true, data: { status: "waiting_for_operator" } });
    const overlayId = (shown.data as { currentOverlayId: string }).currentOverlayId;
    expect(await call(value, "overlay.assistance_step_apply_event", { sessionId, stepId: "step-2", overlayId, eventId: "event-1", event: "accepted", createdAt: new Date().toISOString() })).toMatchObject({ ok: true });
    expect(await call(value, "overlay.assistance_step_advance", { sessionId })).toMatchObject({ ok: true, data: { status: "completed" } });
    expect(await call(value, "overlay.assistance_session_get", { sessionId })).toMatchObject({ ok: true, data: { status: "completed", ephemeralMaterialAvailable: true } });
  });

  it("rejects wrong/stale events and cancellation clears only visual state", async () => {
    const value = context(); await value.overlayAssistance?.ensureStructure();
    const created = await call(value, "overlay.assistance_session_create", { name: "event flow", steps: [{ stepId: "step-1", index: 0, type: "wait_for_event", requiresEvent: true, widget: { title: "Ack", sensitivity: "public", interaction: { interactive: true, focus: "never", dismissible: true, allowedEvents: ["accepted"] }, components: [{ type: "button", label: "Ack", event: "accepted" }] } }] });
    const sessionId = (created.data as { sessionId: string }).sessionId; await call(value, "overlay.assistance_session_start", { sessionId }); await call(value, "overlay.assistance_step_show", { sessionId });
    expect(await call(value, "overlay.assistance_step_apply_event", { sessionId, stepId: "wrong", eventId: "event-1", event: "accepted", createdAt: new Date().toISOString() })).toMatchObject({ ok: false, error: { code: "assistance_event_mismatch" } });
    expect(await call(value, "overlay.assistance_session_cancel", { sessionId })).toMatchObject({ ok: true, data: { status: "cancelled" } });
    expect((await value.overlay?.state())?.overlays).toHaveLength(0);
    expect(await call(value, "overlay.assistance_step_show", { sessionId })).toMatchObject({ ok: false, error: { code: "assistance_session_cancelled" } });
  });

  it("rejects unknown primitive types before renderer dispatch", async () => {
    const value = context(); await value.overlayAssistance?.ensureStructure();
    const created = await call(value, "overlay.assistance_session_create", { name: "invalid primitive", steps: [{ stepId: "step-1", index: 0, type: "pointer", primitive: { type: "arbitrary_command", sensitivity: "public" } }] });
    expect(created).toMatchObject({ ok: true, data: { status: "blocked", blockers: ["assistance_primitive_type_invalid"] } });
  });
});
