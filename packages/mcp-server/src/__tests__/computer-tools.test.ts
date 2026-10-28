import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentHostMcpContext } from "../context.js";
import { runTool } from "../tool-runner.js";
import { createComputerTools } from "../tools/computer.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("computer state tools", () => {
  it("waits for active-window, any-window, and screen conditions with a snapshot", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "agenthost-computer-"));
    roots.push(home);
    const context = {
      sessionId: "test-session",
      config: { agentHostDir: home, configPath: path.join(home, "config.json"), logFile: path.join(home, "logs", "audit.jsonl") },
      logger: { log: async () => undefined },
      linux: {
        getActiveWindow: async () => ({ supported: true, backend: "test", activeWindow: { windowId: "1", appName: "Notes", title: "Plan" }, reason: "ok" }),
        getScreenGeometry: async () => ({ supported: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, reason: "ok" }),
        listWindows: async () => ({ supported: true, backend: "test", windows: [{ windowId: "2", appName: "Files", title: "Home" }], truncated: false, reason: "ok" })
      }
    } as unknown as AgentHostMcpContext;
    const wait = createComputerTools().find((tool) => tool.name === "computer.wait_for");
    expect(wait).toBeDefined();

    const result = await runTool(wait!, {
      expectedActiveWindow: { appName: "Notes" },
      expectedWindow: { title: "Home" },
      expectedScreen: { width: 1920, height: 1080 },
      timeoutMs: 500
    }, context);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      matched: true,
      activeWindow: { appName: "Notes" },
      window: { windowId: "2" },
      screen: { width: 1920, height: 1080 }
    });
    expect((result.data as { stateFingerprint?: string }).stateFingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect((result.data as { capturedAt?: string }).capturedAt).toBeDefined();
  });

  it("returns matched false after a bounded timeout", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "agenthost-computer-timeout-"));
    roots.push(home);
    const context = {
      sessionId: "test-session",
      config: { agentHostDir: home, configPath: path.join(home, "config.json"), logFile: path.join(home, "logs", "audit.jsonl") },
      logger: { log: async () => undefined },
      linux: {
        getActiveWindow: async () => ({ supported: true, backend: "test", activeWindow: { windowId: "1", appName: "Notes" }, reason: "ok" }),
        getScreenGeometry: async () => ({ supported: true, bounds: { x: 0, y: 0, width: 800, height: 600 }, reason: "ok" })
      }
    } as unknown as AgentHostMcpContext;
    const wait = createComputerTools().find((tool) => tool.name === "computer.wait_for")!;

    const result = await runTool(wait, { expectedActiveWindow: { appName: "Gmail" }, timeoutMs: 200 }, context);
    expect(result.data).toMatchObject({ matched: false });
  });
});
