import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createAdapterRegistry, createBaseCapabilityRegistry, getPolicyProfile, type AgentHostConfig, type AuditLogEntry, type AuditLogger } from "@agenthost/core";
import { HeadlessOverlayRenderer, OverlayManager } from "@agenthost/app-overlay";
import { describe, expect, it } from "vitest";
import { ConfirmationManager } from "../confirmation.js";
import type { AgentHostMcpContext } from "../context.js";
import { ForgeStore } from "../forge-store.js";
import { GrantStore } from "../grants.js";
import { OverlayAssistanceStore } from "../overlay-assistance-store.js";
import { OverlayAssistanceTemplateStore } from "../overlay-assistance-template-store.js";
import { runTool } from "../tool-runner.js";
import { createOverlayAssistanceInspectionTools } from "../tools/overlay-assistance-inspection.js";
import { createOverlayAssistanceTemplateTools } from "../tools/overlay-assistance-templates.js";

class MemoryLogger implements AuditLogger { entries: AuditLogEntry[] = []; async log(entry: AuditLogEntry) { this.entries.push(entry); } }
function context(): AgentHostMcpContext {
  const dir = `/tmp/agenthost-assistance-a2-${randomUUID()}`;
  const policy = getPolicyProfile("dev");
  const config: AgentHostConfig = { agentHostDir: dir, configPath: `${dir}/config.json`, logFile: `${dir}/logs/test.jsonl`, profile: "dev", policy };
  const overlay = new OverlayManager(new HeadlessOverlayRenderer(), { sessionId: "a2-test" });
  const assistance = new OverlayAssistanceStore(dir, overlay, "a2-test");
  return { sessionId: "a2-test", config, policy, registry: createBaseCapabilityRegistry(), adapters: createAdapterRegistry(), logger: new MemoryLogger(), confirmations: new ConfirmationManager(), grants: new GrantStore({ persistentGrants: [] }), forge: new ForgeStore(dir), overlay, overlayAssistance: assistance, overlayAssistanceTemplates: new OverlayAssistanceTemplateStore(dir, "a2-test", assistance), linux: {} as AgentHostMcpContext["linux"] };
}
async function call(contextValue: AgentHostMcpContext, name: string, input: unknown) {
  const tool = [...createOverlayAssistanceInspectionTools(), ...createOverlayAssistanceTemplateTools()].find((item) => item.name === name);
  if (tool === undefined) throw new Error("tool_missing");
  return runTool(tool, input, contextValue);
}
function rawTemplate() { return { templateId: "template_a2", name: "Public flow", parameters: [{ name: "label", type: "string", required: true, sensitivity: "public" }], steps: [{ stepId: "step_1", index: 0, type: "instruction", primitiveType: "instruction_card", label: "Show {{label}}" }], status: "draft" }; }

describe("A2 assistance UX and templates", () => {
  it("previews and explains without rendering or advancing", async () => {
    const value = context(); await value.overlayAssistance?.ensureStructure(); await value.overlayAssistanceTemplates?.ensureStructure();
    const created = await call(value, "overlay.assistance_template_instantiate", { templateId: "missing" });
    expect(created.ok).toBe(false);
    const saved = await call(value, "overlay.assistance_template_save", { template: rawTemplate() });
    expect(saved).toMatchObject({ ok: true, data: { status: "draft" } });
    const instantiated = await call(value, "overlay.assistance_template_instantiate", { templateId: "template_a2", parameters: { label: "safe target" } });
    expect(instantiated).toMatchObject({ ok: true, data: { execution: { draftOnly: true, started: false, rendered: false } } });
    const sessionId = (instantiated.data as { session: { sessionId: string } }).session.sessionId;
    expect((await value.overlay?.state())?.overlays).toHaveLength(0);
    expect(await call(value, "overlay.assistance_step_preview", { sessionId })).toMatchObject({ ok: true, data: { currentStepIndex: 0, canRender: true } });
    expect(await call(value, "overlay.assistance_session_explain", { sessionId })).toMatchObject({ ok: true, data: { status: "ready", remainingSteps: 1 } });
    expect((await value.overlayAssistance?.get(sessionId))?.currentOverlayId).toBeUndefined();
    expect(await call(value, "overlay.assistance_template_preview", { template: rawTemplate() })).toMatchObject({ ok: true, data: { valid: false, blockers: ["overlay_template_missing_parameter"] } });
  });

  it("keeps template lifecycle owner-bound and blocks unsafe fields", async () => {
    const value = context(); await value.overlayAssistanceTemplates?.ensureStructure();
    expect(await call(value, "overlay.assistance_template_validate", { template: { ...rawTemplate(), ownerSessionId: "other" } })).toMatchObject({ ok: false, error: { code: "overlay_template_owner_input_forbidden" } });
    expect(await call(value, "overlay.assistance_template_save", { template: { ...rawTemplate(), steps: [{ stepId: "bad", index: 0, type: "pointer", primitiveType: "pointer", callback: "shell.run" }] } })).toMatchObject({ ok: false });
    await call(value, "overlay.assistance_template_save", { template: rawTemplate() });
    expect(await call(value, "overlay.assistance_template_list", {})).toMatchObject({ ok: true, data: { templates: [{ templateId: "template_a2" }] } });
    expect(await call(value, "overlay.assistance_template_archive", { templateId: "template_a2" })).toMatchObject({ ok: true, data: { status: "archived" } });
    expect(await call(value, "overlay.assistance_template_instantiate", { templateId: "template_a2", parameters: { label: "x" } })).toMatchObject({ ok: false, error: { code: "overlay_template_archived" } });
  });

  it("rejects stale target placeholders and never persists private values", async () => {
    const value = context(); await value.overlayAssistanceTemplates?.ensureStructure();
    const privateTemplate = { templateId: "template_private", name: "Private flow", parameters: [{ name: "note", type: "string", required: true, sensitivity: "private" }], steps: [{ stepId: "step_1", index: 0, type: "instruction", primitiveType: "instruction_card", sensitivity: "private", label: "{{note}}" }], status: "draft" };
    expect(await call(value, "overlay.assistance_template_save", { template: privateTemplate })).toMatchObject({ ok: true });
    const stored = await readFile(`${value.config.agentHostDir}/overlays/assistance-templates/template_private.json`, "utf8");
    expect(stored).not.toContain("private-value");
    expect(await call(value, "overlay.assistance_template_instantiate", { templateId: "template_private", parameters: { note: "private-value" } })).toMatchObject({ ok: false, error: { code: "overlay_template_private_grant_required" } });
    const targetTemplate = { ...rawTemplate(), templateId: "template_target", steps: [{ stepId: "step_1", index: 0, type: "instruction", primitiveType: "instruction_card", targetPlaceholderId: "target", label: "Target" }], targetPlaceholders: [{ placeholderId: "target", bindingType: "screen_point", required: true, sensitivity: "public" }] };
    await call(value, "overlay.assistance_template_save", { template: targetTemplate });
    expect(await call(value, "overlay.assistance_template_instantiate", { templateId: "template_target", parameters: { label: "x" }, targetBindings: { target: { kind: "screen_point", point: { x: 1, y: 1 }, trusted: true, expiresAt: new Date(Date.now() - 1_000).toISOString() } } })).toMatchObject({ ok: false, error: { code: "overlay_target_expired" } });
  });
});
