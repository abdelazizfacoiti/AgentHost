import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAdapterRegistry, createBaseCapabilityRegistry, getPolicyProfile, type AgentHostConfig, type AuditLogger } from "@agenthost/core";
import { describe, expect, it } from "vitest";
import { ConfirmationManager } from "../confirmation.js";
import type { AgentHostMcpContext } from "../context.js";
import { EpisodicMemoryStore } from "../episodic-memory-store.js";
import { ForgeStore } from "../forge-store.js";
import { GrantStore } from "../grants.js";
import { runTool } from "../tool-runner.js";
import { createCapabilityStrategyTools } from "../tools/capability-strategy.js";

class Logger implements AuditLogger { entries: unknown[] = []; async log(entry: unknown) { this.entries.push(entry); } }

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-episode-tools-"));
  const policy = getPolicyProfile("dev");
  const config: AgentHostConfig = { agentHostDir: root, configPath: `${root}/config.json`, logFile: `${root}/logs/x.jsonl`, profile: "dev", policy };
  const context = { sessionId: "episodes", config, policy, registry: createBaseCapabilityRegistry(), adapters: createAdapterRegistry(), logger: new Logger(), confirmations: new ConfirmationManager(), grants: new GrantStore(), forge: new ForgeStore(root), episodicMemory: new EpisodicMemoryStore(root), linux: {} as never } as unknown as AgentHostMcpContext;
  const tools = createCapabilityStrategyTools();
  const call = (name: string, input: unknown) => runTool(tools.find((tool) => tool.name === name)! as never, input, context);
  return { context, call };
}

describe("strategy episode tools", () => {
  it("records a redacted episode and recalls it for the planner", async () => {
    const { call } = await fixture();
    const recorded = await call("strategy.record_episode", { goalCategory: "browser_navigation", strategyId: "builtin.browser-navigation", outcome: "verified_success", lesson: "Pair first; token=hunter2 must never appear." });
    expect(recorded).toMatchObject({ ok: true, tool: "strategy.record_episode" });
    const data = recorded.data as { episode: { lesson?: string } };
    expect(data.episode.lesson).not.toContain("hunter2");
    const recalled = await call("strategy.recall_episodes", { goalCategory: "browser_navigation" });
    expect(recalled).toMatchObject({ ok: true, tool: "strategy.recall_episodes" });
    expect((recalled.data as { episodes: unknown[] }).episodes).toHaveLength(1);
  });

  it("rejects policy aborts as learning evidence", async () => {
    const { call } = await fixture();
    const rejected = await call("strategy.record_episode", { goalCategory: "browser_navigation", outcome: "verified_failure", failureCode: "policy_block" });
    expect(rejected.ok).toBe(false);
  });
});
