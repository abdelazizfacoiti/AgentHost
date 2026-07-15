#!/usr/bin/env node
/* Explicit opt-in visual-only Build Week demo. Never controls target applications. */
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadAgentHostConfig } from "../packages/core/dist/index.js";
import { createAgentHostMcpServer } from "../packages/mcp-server/dist/index.js";
import { createOverlayTargetResolver } from "../packages/mcp-server/dist/tools/overlay.js";

const args = new Set(process.argv.slice(2));
const headless = args.has("--headless");
const requireGui = args.has("--require-gui");
const diagnoseOnly = args.has("--diagnose");
const mode = headless ? "headless" : (process.env.AGENTHOST_OVERLAY_MODE ?? "auto");
const demoHome = process.env.AGENTHOST_DEMO_HOME ?? path.join(os.tmpdir(), `agenthost-visual-copilot-${randomUUID()}`);

function safeStatus(value) {
  return JSON.stringify(value, null, 2);
}

async function closeContext(context) {
  await context.overlayControlSurface?.close().catch(() => undefined);
  await context.overlayAssistance?.close().catch(() => undefined);
  await context.overlay?.close().catch(() => undefined);
  await context.browserBridge?.close().catch(() => undefined);
}

async function main() {
  const env = { ...process.env, AGENTHOST_HOME: demoHome, AGENTHOST_OVERLAY_MODE: mode, AGENTHOST_PROFILE: "dev" };
  const config = await loadAgentHostConfig({ env, homeDir: os.homedir() });
  const runtime = await createAgentHostMcpServer({ config });
  const { context } = runtime;
  try {
    const diagnostics = await context.overlay?.diagnostics();
    if (diagnoseOnly) {
      console.log(safeStatus({ ok: true, mode, demoHome: "[isolated-demo-home]", renderer: diagnostics, recovery: "Use overlay.assistance_session_explain and overlay.control_surface_get for live status." }));
      return;
    }
    if (diagnostics?.rendererStatus !== "available" && requireGui) {
      console.error(safeStatus({ ok: false, code: "visual_renderer_unavailable", renderer: diagnostics, next: "Run overlay.renderer_setup_instructions or use --headless." }));
      process.exitCode = 1;
      return;
    }
    if (diagnostics?.rendererStatus !== "available") {
      console.log(safeStatus({ ok: false, supported: false, code: "visual_renderer_unavailable", renderer: diagnostics, next: "Use a supported X11 GTK3 session or run --headless." }));
      return;
    }
    const geometry = await context.linux.getScreenGeometry?.();
    if (geometry?.supported !== true || geometry.bounds === undefined) {
      console.log(safeStatus({ ok: false, supported: false, code: "screen_geometry_unavailable", next: "Use headless mode or a supported X11 display." }));
      if (requireGui) process.exitCode = 1;
      return;
    }
    const fixture = JSON.parse(await readFile(path.resolve("examples/visual-copilot/demo-template.json"), "utf8"));
    const templates = context.overlayAssistanceTemplates;
    const assistance = context.overlayAssistance;
    const surface = context.overlayControlSurface;
    if (templates === undefined || assistance === undefined || surface === undefined) throw new Error("visual_demo_services_unavailable");
    await templates.ensureStructure();
    await assistance.ensureStructure();
    await surface.ensureStructure();
    await templates.save(fixture);
    const instantiated = await templates.instantiate(fixture.templateId, {}, {}, false);
    const sessionId = instantiated.session.sessionId;
    const targetResolver = createOverlayTargetResolver(context);
    const center = { x: Math.round(geometry.bounds.x + geometry.bounds.width / 2), y: Math.round(geometry.bounds.y + geometry.bounds.height / 2) };
    const ask = async (message) => { const rl = readline.createInterface({ input, output }); try { await rl.question(`${message}\n`); } finally { rl.close(); } };
    console.log(safeStatus({ ok: true, phase: "draft_created", sessionId, renderer: diagnostics?.rendererStatus, actionsExecuted: false, confirmationTokensCreated: false }));
    await ask("Press Enter to explicitly start visual assistance.");
    await assistance.start(sessionId);
    const shownSurface = await surface.show(sessionId);
    console.log(safeStatus({ phase: "control_surface_visible", status: shownSurface.status, progress: shownSurface.progress, rendererHealth: shownSurface.rendererHealth }));
    const advanceCurrent = async () => {
      const state = await assistance.get(sessionId);
      const overlayId = state.currentOverlayId;
      const stepId = state.stepTypes[state.currentStepIndex] === "instruction" ? "intro" : state.stepTypes[state.currentStepIndex] === "pointer" ? "point" : "highlight";
      if (overlayId === undefined) throw new Error("visual_demo_overlay_missing");
      await assistance.applyEvent({ eventId: `demo_event_${randomUUID()}`, sessionId, stepId, overlayId, event: "accepted", createdAt: new Date().toISOString(), ownerSessionId: context.sessionId });
      await assistance.advance(sessionId);
    };
    await assistance.showCurrent(sessionId, targetResolver);
    console.log(safeStatus({ phase: "waiting_for_operator", explanation: await assistance.explain(sessionId, diagnostics) }));
    await ask("Press Enter to continue first visual step.");
    await advanceCurrent();
    console.log(safeStatus({ phase: "target_missing", explanation: await assistance.explain(sessionId, diagnostics) }));
    await ask("Press Enter to bind safe local screen target and render pointer.");
    await assistance.refreshTarget(sessionId, "point", { kind: "screen_point", point: center, trusted: true, expiresAt: new Date(Date.now() + 1_500).toISOString() }, targetResolver);
    await assistance.showCurrent(sessionId, targetResolver);
    console.log(safeStatus({ phase: "pointer_rendered", explanation: await assistance.explain(sessionId, diagnostics) }));
    await ask("Press Enter to test bounded stale-target recovery.");
    await new Promise((resolve) => setTimeout(resolve, 1_700));
    console.log(safeStatus({ phase: "target_stale", explanation: await assistance.explain(sessionId, diagnostics) }));
    await ask("Press Enter to refresh target explicitly and retry rendering.");
    await assistance.refreshTarget(sessionId, "point", { kind: "screen_point", point: center, trusted: true, expiresAt: new Date(Date.now() + 4_000).toISOString() }, targetResolver);
    await assistance.showCurrent(sessionId, targetResolver);
    await ask("Press Enter to continue after target recovery.");
    await advanceCurrent();
    await assistance.refreshTarget(sessionId, "highlight", { kind: "screen_point", point: center, trusted: true, expiresAt: new Date(Date.now() + 4_000).toISOString() }, targetResolver);
    await assistance.showCurrent(sessionId, targetResolver);
    await ask("Press Enter to accept final visual target.");
    await advanceCurrent();
    await assistance.showCurrent(sessionId, targetResolver);
    await assistance.advance(sessionId);
    console.log(safeStatus({ phase: "completed", session: await assistance.get(sessionId), actionsExecuted: false, confirmationTokensCreated: false }));
  } finally {
    await closeContext(context);
  }
}

main().catch((error) => { console.error(safeStatus({ ok: false, code: error instanceof Error ? error.message : "visual_demo_failed" })); process.exitCode = 1; });
