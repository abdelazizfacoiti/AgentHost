import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadAgentHostConfig } from "../index.js";

describe("loadAgentHostConfig", () => {
  it("uses safe defaults", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-config-default-"));
    const config = await loadAgentHostConfig({ env: {}, homeDir });

    expect(config.agentHostDir).toBe(path.join(homeDir, ".agenthost"));
    expect(config.profile).toBe("strict");
    expect(config.policy.name).toBe("strict");
  });

  it("loads profile and paths from a config file", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-config-file-"));
    const agentHostDir = path.join(homeDir, ".agenthost");
    await mkdir(agentHostDir, { recursive: true });
    const configPath = path.join(agentHostDir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        profile: "dev",
        logFile: "~/agenthost-test-log.jsonl"
      }),
      "utf8"
    );

    const config = await loadAgentHostConfig({ env: {}, homeDir, configPath });

    expect(config.profile).toBe("dev");
    expect(config.logFile).toBe(path.join(homeDir, "agenthost-test-log.jsonl"));
  });
});
