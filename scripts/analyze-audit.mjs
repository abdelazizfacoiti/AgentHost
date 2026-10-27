#!/usr/bin/env node
import { createReadStream, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const file = path.resolve(process.argv[2] ?? path.join(process.env.AGENTHOST_HOME ?? path.join(os.homedir(), ".agenthost"), "logs", "agenthost.jsonl"));
if (!existsSync(file)) {
  console.error(`analyze-audit: audit log not found: ${file}`);
  process.exitCode = 1;
} else {
  const entries = [];
  const lines = readline.createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim().length === 0) continue;
    try {
      const entry = JSON.parse(line);
      if (typeof entry?.tool !== "string" || typeof entry?.timestamp !== "string") continue;
      const timestamp = Date.parse(entry.timestamp);
      if (!Number.isFinite(timestamp)) continue;
      entries.push({ ...entry, timestampMs: timestamp });
    } catch {
    }
  }
  report(entries);
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))] ?? 0;
}

function milliseconds(value) {
  return `${Math.round(value)} ms`;
}

function name(value) {
  return String(value).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 120);
}

function report(entries) {
  entries.sort((left, right) => left.timestampMs - right.timestampMs);
  console.log(`Audit file: ${file}`);
  console.log(`Entries: ${entries.length}${entries.length === 0 ? "" : ` (${entries[0].timestamp} .. ${entries.at(-1).timestamp})`}`);
  if (entries.length === 0) return;

  const tools = new Map();
  let overlayWait = 0;
  let total = 0;
  for (const entry of entries) {
    const timing = entry.timings ?? {};
    const handler = Number.isFinite(timing.handler) ? Math.max(0, timing.handler) : 0;
    const overlay = Number.isFinite(timing.overlayWait) ? Math.max(0, timing.overlayWait) : 0;
    const entryTotal = Number.isFinite(timing.total) ? Math.max(0, timing.total) : 0;
    overlayWait += overlay;
    total += entryTotal;
    const tool = name(entry.tool);
    const current = tools.get(tool) ?? { calls: 0, errors: 0, handler: [], totals: [], overlay: 0, total: 0 };
    current.calls += 1;
    if (entry.ok === false) current.errors += 1;
    current.handler.push(handler);
    current.totals.push(entryTotal);
    current.overlay += overlay;
    current.total += entryTotal;
    tools.set(tool, current);
  }

  console.log("");
  console.log("| tool | calls | errors | handler median | handler p95 | overlay wait share | total median |");
  console.log("|---|---:|---:|---:|---:|---:|---:|");
  for (const [tool, value] of [...tools].sort((left, right) => right[1].calls - left[1].calls || left[0].localeCompare(right[0]))) {
    const share = value.total > 0 ? (value.overlay / value.total) * 100 : 0;
    console.log(`| ${tool} | ${value.calls} | ${value.errors} | ${milliseconds(percentile(value.handler, 0.5))} | ${milliseconds(percentile(value.handler, 0.95))} | ${share.toFixed(1)}% | ${milliseconds(percentile(value.totals, 0.5))} |`);
  }
  console.log("");
  console.log(`Overall overlay wait share: ${(total > 0 ? (overlayWait / total) * 100 : 0).toFixed(1)}%`);

  const gaps = [];
  for (let index = 1; index < entries.length; index += 1) {
    const gap = entries[index].timestampMs - entries[index - 1].timestampMs;
    if (gap >= 0) gaps.push(gap);
  }
  const maxGap = gaps.reduce((largest, gap) => Math.max(largest, gap), 0);
  console.log(`Idle gaps between calls: median ${milliseconds(percentile(gaps, 0.5))}, p95 ${milliseconds(percentile(gaps, 0.95))}, max ${milliseconds(maxGap)}`);

  const sequences = new Map();
  for (let index = 1; index < entries.length; index += 1) {
    const key = `${name(entries[index - 1].tool)} -> ${name(entries[index].tool)}`;
    sequences.set(key, (sequences.get(key) ?? 0) + 1);
  }
  console.log("");
  console.log("Frequent tool sequences:");
  const top = [...sequences].sort((left, right) => right[1] - left[1]).slice(0, 8);
  if (top.length === 0) console.log("  (none)");
  for (const [sequence, count] of top) console.log(`  ${count}x ${sequence}`);
}
