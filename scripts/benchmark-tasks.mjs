#!/usr/bin/env node

import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const scenarios = JSON.parse(await readFile(new URL("../benchmarks/tasks/scenarios.json", import.meta.url), "utf8"));
const home = await mkdtemp(path.join(os.tmpdir(), "agenthost-task-bench-"));
process.env.AGENTHOST_HOME = home;
process.env.NODE_ENV = "test";

const { loadAgentHostConfig, toolSuccess } = await import("../packages/core/dist/index.js");
const { createAgentHostMcpServer } = await import("../packages/mcp-server/dist/server.js");
const { runTool } = await import("../packages/mcp-server/dist/tool-runner.js");
const { ToolActionOverlay } = await import("../packages/mcp-server/dist/action-overlay.js");

const config = await loadAgentHostConfig();
const server = await createAgentHostMcpServer({ config: { ...config, overlay: { ...config.overlay, mode: "off" } }, sessionId: "session_task_benchmark" });
const context = server.context;
const tools = context.tools;
const outputDir = path.join(home, "outputs", "task-benchmark");
const target = path.join(outputDir, "sample.txt");
const second = path.join(outputDir, "second.txt");
const rows = [];
const timings = [];

function tool(name) {
  const value = tools.get(name);
  if (value === undefined) throw new Error(`Missing benchmark tool ${name}`);
  return value;
}

async function call(name, input) {
  const started = performance.now();
  const result = await runTool(tool(name), input, context);
  const elapsedMs = performance.now() - started;
  timings.push({ name, elapsedMs, ok: result.ok });
  if (!result.ok) throw new Error(`${name}: ${result.error?.code ?? "failed"}`);
  return result;
}

async function withMockDesktop(fn) {
  const original = context.linux;
  let active = { windowId: "100", appName: "MockEditor", title: "Draft" };
  const windows = [
    { windowId: "100", appName: "MockEditor", title: "Draft", bounds: { x: 20, y: 30, width: 500, height: 400 } },
    { windowId: "200", appName: "MockTerminal", title: "Shell", bounds: { x: 600, y: 30, width: 500, height: 400 } }
  ];
  const typed = [];
  const clicked = [];
  context.linux = new Proxy(original, {
    get(targetObject, property) {
      if (property === "getActiveWindow") return async () => ({ supported: true, backend: "mock", activeWindow: active, reason: "mock" });
      if (property === "listWindows") return async () => ({ supported: true, backend: "mock", windows, truncated: false, reason: "mock" });
      if (property === "getScreenGeometry") return async () => ({ supported: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, reason: "mock" });
      if (property === "focusWindow") return async ({ windowId }) => { active = windows.find((entry) => entry.windowId === windowId) ?? active; return { supported: true, backend: "mock", focused: true, previousWindow: { windowId: "100" }, reason: "mock" }; };
      if (property === "typeText") return async (input) => { typed.push(input.text); return { supported: true, backend: "mock", typed: true, characterCount: input.text.length, activeWindow: input.activeWindow, method: "direct", reason: "mock" }; };
      if (property === "click") return async (input) => { clicked.push({ x: input.x, y: input.y }); return { supported: true, backend: "mock", clicked: true, activeWindow: input.activeWindow, reason: "mock" }; };
      if (property === "screenshot") return async ({ path: imagePath }) => { await mkdir(path.dirname(imagePath), { recursive: true }); await import("node:fs/promises").then(({ writeFile }) => writeFile(imagePath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"))); return { supported: true, backend: "mock", path: imagePath, bytesWritten: 68, reason: "mock" }; };
      if (property === "analyzeImage") return async () => ({ supported: true, backend: "tesseract", mode: "ocr", image: { width: 1920, height: 1080, source: "agenthost_screenshot", basename: "screen.png", pathRedacted: true }, textItems: [{ id: "text_001", text: "Save", redactedText: "Save", bounds: { x: 120, y: 220, width: 40, height: 20 }, center: { x: 140, y: 230 }, confidence: 0.99, kind: "text", page: 1, block: 1, paragraph: 1, line: 1, redacted: false }], groups: [], targetCandidates: [], warnings: [], redactionCounts: {}, truncated: false, reason: "mock" });
      return Reflect.get(targetObject, property);
    }
  });
  try {
    return await fn({ typed, clicked, windows });
  } finally {
    context.linux = original;
  }
}

async function runScenario(id) {
  switch (id) {
    case "system_info": await call("system.get_info", {}); break;
    case "capabilities": await call("system.list_capabilities", {}); break;
    case "observe_state": await call("computer.observe_state", {}); break;
    case "window_list": await call("window.list", { limit: 10 }); break;
    case "directory_create": await call("file.ensure_dir", { path: outputDir }); break;
    case "file_create": await call("file.write", { path: target, content: "alpha\nneedle\n", createParents: true }); break;
    case "file_edit": await call("file.write", { path: second, content: "needle again\n", createParents: true }); break;
    case "file_verify": { const result = await call("file.read", { path: target }); if (!result.data?.content.includes("needle")) throw new Error("file verification failed"); break; }
    case "file_exists": await call("file.exists", { path: target }); break;
    case "file_list": await call("file.list", { path: outputDir }); break;
    case "file_read_many": await call("file.read_many", { paths: [target, second] }); break;
    case "file_search": await call("file.search", { path: outputDir, query: "needle", recursive: true }); break;
    case "file_recursive_list": await call("file.list", { path: path.dirname(outputDir), recursive: true, maxDepth: 2, limit: 20 }); break;
    case "wait_for_file": await call("computer.wait_for", { fileExists: target, timeoutMs: 500 }); break;
    case "governed_plan": await call("computer.run_steps", { steps: [{ tool: "file.read", input: { path: target } }, { tool: "file.exists", input: { path: target } }] }); break;
    case "terminal_command": await call("shell.run", { command: "pwd", args: [], cwd: home }); break;
    case "focus_type_verify": await withMockDesktop(async ({ typed }) => { await call("window.focus", { target: { windowId: "100" } }); await call("desktop.type_text", { text: "safe benchmark", target: { windowId: "100" } }); if (typed[0] !== "safe benchmark") throw new Error("typing verification failed"); }); break;
    case "ocr_click_verify": await withMockDesktop(async ({ clicked }) => { const result = await call("vision.find_text_on_screen", { query: "Save" }); const point = result.data.matches[0].screenCenter; await call("desktop.click", { x: point.x, y: point.y, target: { windowId: "100" } }); if (clicked.length !== 1) throw new Error("click verification failed"); }); break;
    case "multi_window_switch": await withMockDesktop(async () => { await call("window.focus", { target: { windowId: "200" } }); await call("window.focus", { target: { windowId: "100" } }); }); break;
    case "overlay_sequence": {
      const calls = [];
      const manager = { showWidget: async () => { calls.push("widget"); return { ok: true, errors: [] }; }, updateWidget: async () => ({ ok: true, reason: "updated" }), showPrimitive: async (input) => { calls.push(`primitive:${input.type}`); return { ok: true, errors: [] }; }, dismiss: async () => ({ ok: true, reason: "dismissed" }), pollEvents: async () => [] };
      const overlay = new ToolActionOverlay(manager, { widgetId: "benchmark-action", targetRingLeadMs: 0, minDisplayMs: 0 });
      const handle = await overlay.begin({ tool: "desktop.click", summary: "Benchmark click", riskLevel: "medium", target: { x: 10, y: 20 } });
      await handle.finish(toolSuccess({ tool: "desktop.click", riskLevel: "medium", data: { clicked: true } }));
      await overlay.close();
      if (calls[0] !== "widget" || calls[1] !== "primitive:frame" || calls[2] !== "primitive:target_ring") throw new Error(`overlay ordering failed: ${calls.join(",")}`);
      break;
    }
    default: throw new Error(`Unknown scenario ${id}`);
  }
}

try {
  for (const scenario of scenarios) {
    const started = performance.now();
    const before = timings.length;
    let ok = true;
    let error;
    try { await runScenario(scenario.id); } catch (cause) { ok = false; error = cause instanceof Error ? cause.message : String(cause); }
    rows.push({ id: scenario.id, calls: timings.length - before, wallMs: performance.now() - started, ok, ...(error === undefined ? {} : { error }) });
  }
} finally {
  await server.closeResources();
  await rm(home, { recursive: true, force: true });
}

console.log(JSON.stringify({ homeIsolated: true, scenarioCount: rows.length, successfulScenarios: rows.filter((row) => row.ok).length, totalToolCalls: rows.reduce((sum, row) => sum + row.calls, 0), totalWallMs: rows.reduce((sum, row) => sum + row.wallMs, 0), rows, phaseTimings: timings }, null, 2));
if (rows.some((row) => !row.ok)) process.exitCode = 1;
