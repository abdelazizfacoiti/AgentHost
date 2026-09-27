#!/usr/bin/env node

/*
 * Local-only desktop backend latency benchmark. It measures the real os-linux
 * backends (xdotool/wmctrl/screenshot) with a NON-DESTRUCTIVE subset only:
 * active-window reads, window listing (cold + warm cache), re-focusing the
 * already-active window, geometry probes, and a tmp screenshot. It never
 * clicks, types, sends hotkeys, or switches apps, so it is safe to run on a
 * live workstation. No display session -> prints unsupported and exits 0.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  captureLinuxScreenshot,
  clearWindowListCache,
  focusLinuxWindow,
  getLinuxActiveWindow,
  getLinuxActiveWindowBounds,
  getLinuxScreenGeometry,
  listLinuxWindows
} from "../packages/os-linux/dist/index.js";

const ITERATIONS = 21;

function percentile(values, fraction) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))] ?? 0;
}

function summary(samples) {
  return { medianMs: percentile(samples, 0.5), p95Ms: percentile(samples, 0.95) };
}

async function measure(name, fn, options = {}) {
  const samples = [];
  let ok = 0;
  for (let i = 0; i < (options.iterations ?? ITERATIONS); i += 1) {
    if (options.clearCache === true) clearWindowListCache();
    const start = performance.now();
    try {
      await fn(i);
      ok += 1;
    } catch {
      /* A failed probe still yields a latency sample. */
    }
    samples.push(performance.now() - start);
  }
  return { name, ...summary(samples), ok, total: samples.length };
}

const display = process.env.DISPLAY ?? "";
const sessionType = (process.env.XDG_SESSION_TYPE ?? "").toLowerCase();
if (display.length === 0 && sessionType !== "x11") {
  console.log("benchmark:desktop unsupported (no X11 display session); skipping.");
  process.exit(0);
}

const context = {};
const rows = [];
rows.push(await measure("active_window", () => getLinuxActiveWindow(context)));
rows.push(await measure("window_list_cold", () => listLinuxWindows({ limit: 100 }, context), { clearCache: true }));
rows.push(await measure("window_list_warm", () => listLinuxWindows({ limit: 100 }, context)));
const active = await getLinuxActiveWindow(context).catch(() => undefined);
if (active?.supported === true && active.activeWindow?.windowId !== undefined) {
  const self = active.activeWindow.windowId;
  rows.push(await measure("focus_self_by_id", () => focusLinuxWindow({ windowId: self }, context)));
} else {
  rows.push({ name: "focus_self_by_id", medianMs: 0, p95Ms: 0, ok: 0, total: 0 });
}
rows.push(await measure("screen_geometry", () => getLinuxScreenGeometry(context)));
rows.push(await measure("window_bounds", () => getLinuxActiveWindowBounds(context)));
const shotDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-benchmark-"));
try {
  rows.push(await measure("screenshot_tmp", (i) => captureLinuxScreenshot({ path: path.join(shotDir, `bench-${i}.png`) }, context), { iterations: 5 }));
} finally {
  await rm(shotDir, { recursive: true, force: true });
}

console.log("| backend operation | median | p95 | ok/total |");
console.log("|-------------------|--------|-----|----------|");
for (const row of rows) {
  console.log(`| ${row.name} | ${row.medianMs.toFixed(1)} ms | ${row.p95Ms.toFixed(1)} ms | ${row.ok}/${row.total} |`);
}
