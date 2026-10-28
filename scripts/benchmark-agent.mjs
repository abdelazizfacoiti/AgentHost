#!/usr/bin/env node

/*
 * Repeatable agent-level overhead benchmark. Each sample enters the real MCP
 * runner (schema, policy, gates, preview, handler, audit) in an isolated
 * AGENTHOST_HOME with overlays disabled. The workload is non-destructive:
 * observation, window listing, temporary file write/read, and a governed plan.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const ITERATIONS = Number.parseInt(process.env.AGENTHOST_BENCH_ITERATIONS ?? "7", 10);
const WARMUP = 2;

function percentile(values, fraction) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))] ?? 0;
}

function summarize(values) {
  return {
    medianMs: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: Math.max(...values)
  };
}

async function main() {
  const home = await mkdtemp(path.join(os.tmpdir(), "agenthost-bench-"));
  process.env.AGENTHOST_HOME = home;
  process.env.NODE_ENV = "test";
  const { loadAgentHostConfig } = await import("../packages/core/dist/index.js");
  const { createAgentHostMcpServer } = await import("../packages/mcp-server/dist/server.js");
  const { runTool } = await import("../packages/mcp-server/dist/tool-runner.js");
  const config = await loadAgentHostConfig();
  const server = await createAgentHostMcpServer({
    config: { ...config, overlay: { ...config.overlay, mode: "off" } },
    sessionId: "session_benchmark"
  });
  const tools = server.context.tools;
  const target = path.join(home, "outputs", "bench.txt");
  const calls = [
    { name: "system.get_info", input: {} },
    { name: "computer.observe_state", input: {} },
    { name: "window.list", input: { limit: 20 } },
    { name: "file.write", input: { path: target, content: "benchmark", createParents: true } },
    { name: "file.read", input: { path: target } },
    {
      name: "computer.run_steps",
      input: {
        steps: [
          { tool: "computer.observe_state", input: {} },
          { tool: "file.write", input: { path: target, content: "benchmark", createParents: true } },
          { tool: "file.read", input: { path: target } }
        ]
      }
    }
  ];

  const rows = [];
  try {
    for (const call of calls) {
      const tool = tools.get(call.name);
      if (tool === undefined) continue;
      for (let i = 0; i < WARMUP; i += 1) await runTool(tool, call.input, server.context);
      const samples = [];
      let ok = 0;
      for (let i = 0; i < ITERATIONS; i += 1) {
        const startedAt = performance.now();
        const result = await runTool(tool, call.input, server.context);
        samples.push(performance.now() - startedAt);
        if (result.ok) ok += 1;
      }
      rows.push({ tool: call.name, ...summarize(samples), ok, total: samples.length });
    }
  } finally {
    await server.closeResources();
    await rm(home, { recursive: true, force: true });
  }

  console.log(`AgentHost runner benchmark (${ITERATIONS} iterations, isolated home, overlay off)`);
  console.table(rows.map((row) => ({
    tool: row.tool,
    median_ms: row.medianMs.toFixed(1),
    p95_ms: row.p95Ms.toFixed(1),
    max_ms: row.maxMs.toFixed(1),
    ok: `${row.ok}/${row.total}`
  })));
  if (rows.some((row) => row.ok !== row.total)) process.exitCode = 1;
}

await main();
