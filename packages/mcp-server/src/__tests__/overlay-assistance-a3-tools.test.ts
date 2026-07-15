import { randomUUID } from "node:crypto";
import { createAdapterRegistry, createBaseCapabilityRegistry, getPolicyProfile, type AgentHostConfig, type AuditLogEntry, type AuditLogger, type OverlayTargetBinding } from "@agenthost/core";
import { HeadlessOverlayRenderer, OverlayManager } from "@agenthost/app-overlay";
import { describe, expect, it } from "vitest";
import { ConfirmationManager } from "../confirmation.js";
import type { AgentHostMcpContext } from "../context.js";
import { ForgeStore } from "../forge-store.js";
import { GrantStore } from "../grants.js";
import { OverlayAssistanceStore } from "../overlay-assistance-store.js";
import { runTool } from "../tool-runner.js";
import { createOverlayAssistanceTools } from "../tools/overlay-assistance.js";
import { createOverlayAssistanceInspectionTools } from "../tools/overlay-assistance-inspection.js";

class MemoryLogger implements AuditLogger {
  entries: AuditLogEntry[] = [];
  async log(entry: AuditLogEntry) { this.entries.push(entry); }
}

function context(): AgentHostMcpContext {
  const dir = `/tmp/agenthost-assistance-a3-${randomUUID()}`;
  const policy = getPolicyProfile("dev");
  const config: AgentHostConfig = { agentHostDir: dir, configPath: `${dir}/config.json`, logFile: `${dir}/logs/test.jsonl`, profile: "dev", policy };
  const overlay = new OverlayManager(new HeadlessOverlayRenderer(), { sessionId: "a3-test" });
  const assistance = new OverlayAssistanceStore(dir, overlay, "a3-test");
  return {
    sessionId: "a3-test",
    config,
    policy,
    registry: createBaseCapabilityRegistry(),
    adapters: createAdapterRegistry(),
    logger: new MemoryLogger(),
    confirmations: new ConfirmationManager(),
    grants: new GrantStore({ persistentGrants: [] }),
    forge: new ForgeStore(dir),
    overlay,
    overlayAssistance: assistance,
    linux: {
      getScreenGeometry: () => ({ supported: true, bounds: { x: 0, y: 0, width: 1000, height: 800 }, reason: "test" })
    } as unknown as AgentHostMcpContext["linux"]
  };
}

async function call(value: AgentHostMcpContext, name: string, input: unknown) {
  const tool = [...createOverlayAssistanceTools(), ...createOverlayAssistanceInspectionTools()].find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error("tool_missing");
  return runTool(tool, input, value);
}

async function createSession(value: AgentHostMcpContext): Promise<string> {
  await value.overlayAssistance?.ensureStructure();
  const created = await call(value, "overlay.assistance_session_create", {
    name: "A3 demo",
    steps: [
      { stepId: "intro", index: 0, type: "instruction", primitive: { type: "instruction_card", label: "Ready", sensitivity: "public" }, requiresEvent: true, expectedEvent: "accepted" },
      { stepId: "target", index: 1, type: "pointer", requiresTarget: true, primitive: { type: "pointer", label: "Target", sensitivity: "public" }, requiresEvent: true, expectedEvent: "accepted" }
    ]
  });
  const sessionId = (created.data as { sessionId: string }).sessionId;
  await call(value, "overlay.assistance_session_start", { sessionId });
  await call(value, "overlay.assistance_step_show", { sessionId });
  const current = await value.overlayAssistance!.get(sessionId);
  await value.overlayAssistance!.applyEvent({ eventId: "intro-event", sessionId, stepId: "intro", overlayId: String(current.currentOverlayId), event: "accepted", createdAt: new Date().toISOString(), ownerSessionId: value.sessionId });
  await value.overlayAssistance!.advance(sessionId);
  return sessionId;
}

const target = (expiresAt = new Date(Date.now() + 10_000).toISOString()): OverlayTargetBinding => ({ kind: "screen_point", point: { x: 500, y: 400 }, trusted: true, expiresAt });

describe("A3 visual assistance recovery", () => {
  it("blocks missing and stale targets before rendering, then allows explicit refresh", async () => {
    const value = context();
    const sessionId = await createSession(value);
    expect(await call(value, "overlay.assistance_step_show", { sessionId })).toMatchObject({ ok: false, error: { code: "assistance_target_missing" } });
    expect(await call(value, "overlay.assistance_target_refresh", { sessionId, stepId: "target", target: target(new Date(Date.now() + 100).toISOString()) })).toMatchObject({ ok: true, data: { target: { kind: "screen_point" }, recovery: { state: "retry_available" } } });
    expect(await call(value, "overlay.assistance_step_show", { sessionId })).toMatchObject({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 140));
    expect(await call(value, "overlay.assistance_step_preview", { sessionId })).toMatchObject({ ok: true, data: { targetFreshness: "stale" } });
  });

  it("limits target refreshes and keeps ownership/tool safety", async () => {
    const value = context();
    const sessionId = await createSession(value);
    expect(await call(value, "overlay.assistance_target_refresh", { sessionId, stepId: "target", target: target() })).toMatchObject({ ok: true });
    expect(await call(value, "overlay.assistance_target_refresh", { sessionId, stepId: "target", target: target() })).toMatchObject({ ok: true });
    expect(await call(value, "overlay.assistance_target_refresh", { sessionId, stepId: "target", target: target() })).toMatchObject({ ok: false, error: { code: "assistance_target_refresh_limit" } });
    expect(createOverlayAssistanceTools().find((item) => item.name === "overlay.assistance_target_refresh")?.execution).toMatchObject({ executionClass: "visual_only", externalEffect: false, requiresConfirmationToken: false });
  });

  it("serializes concurrent target refreshes before applying the bounded limit", async () => {
    const value = context();
    const sessionId = await createSession(value);
    const resolver = async (binding: OverlayTargetBinding) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { ok: true as const, summary: { kind: binding.kind, targetId: "concurrent", sensitivity: "public" as const, validatedAt: new Date().toISOString(), expiresAt: binding.expiresAt } };
    };
    const attempts = await Promise.allSettled([
      value.overlayAssistance!.refreshTarget(sessionId, "target", target(), resolver),
      value.overlayAssistance!.refreshTarget(sessionId, "target", target(), resolver),
      value.overlayAssistance!.refreshTarget(sessionId, "target", target(), resolver)
    ]);
    expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(2);
    expect(attempts.filter((item) => item.status === "rejected").map((item) => item.reason?.message)).toContain("assistance_target_refresh_limit");
    expect((await value.overlayAssistance!.get(sessionId)).targetRefreshCount).toBe(2);
  });

  it("requires the explicit terminal finish advance for completion", async () => {
    const value = context();
    await value.overlayAssistance?.ensureStructure();
    const created = await call(value, "overlay.assistance_session_create", { name: "finish flow", steps: [
      { stepId: "intro", index: 0, type: "instruction", primitive: { type: "instruction_card", label: "Ready", sensitivity: "public" }, requiresEvent: true, expectedEvent: "accepted" },
      { stepId: "finish", index: 1, type: "finish" }
    ] });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await call(value, "overlay.assistance_session_start", { sessionId });
    const shown = await call(value, "overlay.assistance_step_show", { sessionId });
    await call(value, "overlay.assistance_step_apply_event", { sessionId, stepId: "intro", overlayId: (shown.data as { currentOverlayId: string }).currentOverlayId, eventId: "finish-event", event: "accepted", createdAt: new Date().toISOString() });
    expect(await call(value, "overlay.assistance_step_advance", { sessionId })).toMatchObject({ ok: true, data: { status: "active", currentStepIndex: 1 } });
    await call(value, "overlay.assistance_step_show", { sessionId });
    expect(await call(value, "overlay.assistance_step_advance", { sessionId })).toMatchObject({ ok: true, data: { status: "completed", currentStepIndex: 2 } });
  });

  it("rejects wrong step and expired bindings", async () => {
    const value = context();
    const sessionId = await createSession(value);
    expect(await call(value, "overlay.assistance_target_refresh", { sessionId, stepId: "intro", target: target() })).toMatchObject({ ok: false, error: { code: "assistance_current_step_mismatch" } });
    expect(await call(value, "overlay.assistance_target_refresh", { sessionId, stepId: "target", target: target(new Date(Date.now() - 1).toISOString()) })).toMatchObject({ ok: false, error: { code: "overlay_target_expired" } });
  });

  it("advertises the same discriminated target shapes accepted by validation", () => {
    const tool = createOverlayAssistanceTools().find((item) => item.name === "overlay.assistance_target_refresh");
    const schema = tool?.mcpInputSchema as { properties?: { target?: { oneOf?: unknown[] } } } | undefined;
    expect(schema?.properties?.target?.oneOf).toHaveLength(6);
  });
});
