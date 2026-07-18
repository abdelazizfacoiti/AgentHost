#!/usr/bin/env node
/* Explicit local runtime visual smoke. Never controls target applications. */
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { loadAgentHostConfig } from "../packages/core/dist/index.js";
import { createAgentHostMcpServer } from "../packages/mcp-server/dist/index.js";
import { runVisualRuntimeSmoke } from "../packages/mcp-server/dist/visual-runtime-smoke.js";

const args = new Set(process.argv.slice(2));
const headless = args.has("--headless");
const requireGui = args.has("--require-gui");
const diagnoseOnly = args.has("--diagnose");
const mode = headless ? "headless" : "gtk3-x11";
const demoHome = process.env.AGENTHOST_DEMO_HOME
  ?? path.join(os.tmpdir(), `agenthost-visual-smoke-${randomUUID()}`);

function safeStatus(value) {
  return JSON.stringify(value, null, 2);
}

async function closeContext(context) {
  await context.overlayControlSurface?.close().catch(() => undefined);
  await context.overlayAssistance?.close().catch(() => undefined);
  await context.runtimeActivityOverlay?.close().catch(() => undefined);
  await context.overlay?.close().catch(() => undefined);
  await context.browserBridge?.close().catch(() => undefined);
}

async function main() {
  const env = {
    ...process.env,
    AGENTHOST_HOME: demoHome,
    AGENTHOST_OVERLAY_MODE: mode,
    AGENTHOST_PROFILE: "dev"
  };
  const config = await loadAgentHostConfig({ env, homeDir: os.homedir() });
  const runtime = await createAgentHostMcpServer({ config });
  const { context } = runtime;
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await closeContext(context);
  };
  const onSignal = () => {
    void shutdown().finally(() => { process.exitCode = 130; });
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    const diagnostics = await context.overlay?.diagnostics();
    if (diagnoseOnly) {
      console.log(safeStatus({
        ok: true,
        mode,
        demoHome: "[isolated-demo-home]",
        renderer: diagnostics,
        smokeKind: "authoritative_runtime_activity",
        actionsExecuted: false,
        confirmationTokensCreated: false
      }));
      return;
    }
    if (context.runtimeActivity === undefined || context.overlay === undefined) {
      throw new Error("visual_runtime_smoke_unavailable");
    }
    if (!headless && diagnostics?.rendererStatus !== "available") {
      const result = {
        ok: false,
        supported: false,
        code: "visual_renderer_unavailable",
        renderer: diagnostics,
        next: "Use supported X11 GTK3 session or run --headless."
      };
      (requireGui ? console.error : console.log)(safeStatus(result));
      if (requireGui) process.exitCode = 1;
      return;
    }
    const result = await runVisualRuntimeSmoke(
      context.runtimeActivity,
      context.overlay,
      { requireVisible: !headless }
    );
    if (result.status !== "completed" || !result.verified) {
      throw new Error("visual_runtime_smoke_verification_failed");
    }
    if (!headless && !result.visible) {
      throw new Error("visual_runtime_smoke_not_visible");
    }
    console.log(safeStatus({
      ok: true,
      mode: headless ? "headless" : "visible",
      smokeKind: "authoritative_runtime_activity",
      ...result,
      note: headless
        ? "Runtime lifecycle verified; renderer honestly reports no visible surface."
        : "Visible renderer acknowledged authoritative runtime activity."
    }));
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await shutdown();
  }
}

main().catch((error) => {
  console.error(safeStatus({
    ok: false,
    code: error instanceof Error ? error.message : "visual_runtime_smoke_failed",
    actionsExecuted: false,
    confirmationTokensCreated: false
  }));
  process.exitCode = 1;
});
