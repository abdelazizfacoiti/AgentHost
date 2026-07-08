import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getPolicyProfile, type AgentHostConfig, type ToolContext } from "@agenthost/core";
import { COFFEE_CUP_DEMO_ID, createBlenderAdapter, runBlenderPython } from "../index.js";

function createConfig(agentHostDir: string): AgentHostConfig {
  const policy = getPolicyProfile("dev");

  return {
    agentHostDir,
    configPath: path.join(agentHostDir, "config.json"),
    logFile: path.join(agentHostDir, "logs", "agenthost.jsonl"),
    profile: "dev",
    policy
  };
}

function createToolContext(agentHostDir: string): ToolContext {
  const config = createConfig(agentHostDir);

  return {
    sessionId: "session_blender",
    config,
    policy: config.policy,
    registry: {
      listStrategies: () => [],
      listTools: () => [],
      listAppCapabilities: () => []
    }
  };
}

describe("Blender adapter", () => {
  it("exposes the shared adapter interface and capability metadata", () => {
    const adapter = createBlenderAdapter();

    expect(adapter.id).toBe("blender");
    expect(adapter.appIds).toEqual(["blender"]);
    expect(adapter.getCapabilities()).toEqual([
      expect.objectContaining({
        id: "blender.run_python",
        adapterId: "blender",
        appId: "blender",
        strategy: "app_adapter",
        riskLevel: "medium"
      })
    ]);
    expect(adapter.matchesApp?.({ appName: "Blender" })).toBe(true);
  });

  it("returns a clean error when Blender is not installed", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agenthost-blender-missing-"));
    const config = createConfig(dir);
    const result = await runBlenderPython(
      { demo: COFFEE_CUP_DEMO_ID },
      config,
      config.policy,
      { findBlenderPath: async () => undefined }
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("blender_not_found");
  });

  it("rejects unsafe custom Blender Python", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agenthost-blender-unsafe-"));
    const config = createConfig(dir);
    const result = await runBlenderPython(
      { script: "import os\nprint('nope')\n" },
      config,
      config.policy,
      { findBlenderPath: async () => "/usr/bin/blender" }
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("blender_python_rejected");
  });

  it("blocks outputs outside approved AgentHost folders", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agenthost-blender-output-"));
    const config = createConfig(dir);
    const result = await runBlenderPython(
      {
        demo: COFFEE_CUP_DEMO_ID,
        outputDir: "/etc/agenthost-blender"
      },
      config,
      config.policy,
      { findBlenderPath: async () => "/usr/bin/blender" }
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("blender_output_dir_blocked");
  });

  it("runs the coffee cup demo with mocked Blender and validates outputs", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agenthost-blender-success-"));
    const config = createConfig(dir);
    const result = await runBlenderPython(
      { demo: COFFEE_CUP_DEMO_ID, timeoutMs: 5_000 },
      config,
      config.policy,
      {
        findBlenderPath: async () => "/usr/bin/blender",
        now: () => 1234,
        runCommand: async (input) => {
          await writeFile(path.join(input.cwd ?? dir, "coffee-cup.blend"), "blend", "utf8");
          return {
            exitCode: 0,
            signal: null,
            stdout: "ok\n",
            stderr: "",
            durationMs: 12,
            timedOut: false,
            truncated: false
          };
        }
      }
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      adapterId: "blender",
      capabilityId: "blender.run_python",
      outputDir: path.join(config.agentHostDir, "outputs", "blender", "run-1234"),
      outputs: [
        {
          path: path.join(config.agentHostDir, "outputs", "blender", "run-1234", "coffee-cup.blend"),
          exists: true
        }
      ]
    });
  });

  it("returns an adapter ToolResult when executed through the shared adapter interface", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agenthost-blender-adapter-"));
    const adapter = createBlenderAdapter({
      findBlenderPath: async () => "/usr/bin/blender",
      now: () => 4321,
      runCommand: async (input) => {
        await writeFile(path.join(input.cwd ?? dir, "coffee-cup.blend"), "blend", "utf8");
        return {
          exitCode: 0,
          signal: null,
          stdout: "",
          stderr: "",
          durationMs: 5,
          timedOut: false,
          truncated: false
        };
      }
    });
    const result = await adapter.execute(
      {
        adapterId: "blender",
        capabilityId: "blender.run_python",
        appId: "blender",
        input: {
          demo: COFFEE_CUP_DEMO_ID
        }
      },
      createToolContext(dir)
    );

    expect(result.ok).toBe(true);
    expect(result.tool).toBe("blender.run_python");
    expect(result.strategy).toBe("app_adapter");
  });
});
