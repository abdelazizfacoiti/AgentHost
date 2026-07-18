import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SafeFailureMemoryStore } from "../safe-failure-memory-store.js";

describe("safe route failure memory", () => {
  it("persists fingerprints only and rejects unknown routes/policy blocks", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "agenthost-failure-memory-"));
    const store = new SafeFailureMemoryStore(home);
    expect(await store.record({ goalCategory: "browser_navigation", routeFamily: "browser_bridge", failureCode: "renderer_unavailable", compatibilityFingerprint: "linux-x11", outcome: "verified_failure", invalidationVersion: "v1" })).toMatchObject({ routeFamily: "browser_bridge", outcome: "verified_failure", redacted: true });
    expect(await store.record({ goalCategory: "browser_navigation", routeFamily: "not_a_route" as never, failureCode: "verified_failure", compatibilityFingerprint: "linux-x11", outcome: "verified_failure", invalidationVersion: "v1" })).toBeUndefined();
    expect(await store.record({ goalCategory: "browser_navigation", routeFamily: "browser_bridge", failureCode: "policy_block", compatibilityFingerprint: "linux-x11", outcome: "verified_failure", invalidationVersion: "v1" })).toBeUndefined();
    expect(await store.record({ goalCategory: "browser_navigation", routeFamily: "browser_bridge", failureCode: "renderer_unavailable", compatibilityFingerprint: "linux-x11", outcome: "verified_failure", invalidationVersion: "private prompt" })).toBeUndefined();
    expect(await store.list({ goalCategory: "browser_navigation" })).toHaveLength(1);
    const persisted = await readFile(path.join(home, "strategies", "failures", "memory.json"), "utf8");
    expect(persisted).not.toContain("browser_navigation");
    expect(persisted).not.toContain("linux-x11");
  });
});
