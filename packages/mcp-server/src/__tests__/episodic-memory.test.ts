import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EpisodicMemoryStore } from "../episodic-memory-store.js";

async function store() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-episodes-"));
  return { root, memory: new EpisodicMemoryStore(root) };
}

describe("EpisodicMemoryStore", () => {
  it("records and recalls redacted episodes by goal and strategy", async () => {
    const { memory } = await store();
    const episode = await memory.record({ taskId: "task_1", goalCategory: "browser_navigation", strategyId: "builtin.browser-navigation", outcome: "verified_success", lesson: "Pair the bridge before opening tabs." });
    expect(episode).toMatchObject({ schemaVersion: 1, goalCategory: "browser_navigation", outcome: "verified_success", redacted: true });
    expect(episode?.episodeId).toMatch(/^episode_/);
    await memory.record({ goalCategory: "browser_navigation", strategyId: "builtin.other", outcome: "verified_failure", failureCode: "browser_busy" });
    expect((await memory.list({ goalCategory: "browser_navigation" })).length).toBe(2);
    expect((await memory.list({ goalCategory: "browser_navigation", strategyId: "builtin.browser-navigation" })).length).toBe(1);
    expect((await memory.list({ goalCategory: "file_operation" })).length).toBe(0);
  });

  it("scrubs secrets from lessons and rejects policy aborts as evidence", async () => {
    const { memory } = await store();
    const episode = await memory.record({ goalCategory: "webpage_inspection", outcome: "verified_failure", failureCode: "timeout", lesson: "Login failed with password=hunter2 for ops." });
    expect(episode?.lesson).not.toContain("hunter2");
    expect(await memory.record({ goalCategory: "webpage_inspection", outcome: "verified_failure", failureCode: "policy_block" })).toBeUndefined();
    expect(await memory.record({ goalCategory: "webpage_inspection", outcome: "verified_failure", failureCode: "user_cancelled" })).toBeUndefined();
    expect((await memory.list({})).length).toBe(1);
  });

  it("persists redacted JSON without raw task content", async () => {
    const { root, memory } = await store();
    await memory.record({ goalCategory: "file_operation", outcome: "verified_success", lesson: "Check checksums first." });
    const raw = await readFile(path.join(root, "memory", "episodes.json"), "utf8");
    expect(raw).toContain("redacted");
    expect(JSON.parse(raw)).toHaveLength(1);
  });
});
