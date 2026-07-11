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
    expect(config.forgeRuntimeSandboxMode).toBe("auto");
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
        forgeRuntimeSandboxMode: "none",
        logFile: "~/agenthost-test-log.jsonl"
      }),
      "utf8"
    );

    const config = await loadAgentHostConfig({ env: {}, homeDir, configPath });

    expect(config.profile).toBe("dev");
    expect(config.forgeRuntimeSandboxMode).toBe("none");
    expect(config.logFile).toBe(path.join(homeDir, "agenthost-test-log.jsonl"));
  });

  it("loads persistent grants from config and applies richer profile names", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-config-grants-"));
    const agentHostDir = path.join(homeDir, ".agenthost");
    await mkdir(agentHostDir, { recursive: true });
    const configPath = path.join(agentHostDir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        profile: "gui-dev",
        grants: [
          {
            id: "allow-output-write",
            scope: "persistent",
            effect: "allow",
            match: {
              tools: ["file.write"],
              fileRoots: ["~/.agenthost/outputs"]
            },
            requirements: {
              requiresDryRun: true,
              requiresConfirmationToken: true
            }
          }
        ]
      }),
      "utf8"
    );

    const config = await loadAgentHostConfig({ env: {}, homeDir, configPath });

    expect(config.profile).toBe("gui-dev");
    expect(config.policy.name).toBe("gui-dev");
    expect(config.policy.grants).toHaveLength(1);
    expect(config.policy.grants[0]).toMatchObject({
      id: "allow-output-write",
      scope: "persistent",
      effect: "allow",
      match: {
        tools: ["file.write"],
        fileRoots: ["~/.agenthost/outputs"]
      },
      requirements: {
        requiresDryRun: true,
        requiresConfirmationToken: true
      }
    });
  });

  it("loads local demo profile", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-config-demo-"));
    const config = await loadAgentHostConfig({ env: { AGENTHOST_PROFILE: "demo-unlocked-local" }, homeDir });
    expect(config.policy.name).toBe("demo-unlocked-local");
    expect(config.policy.allowFileWriteRoots).toContain("~/Desktop/agenthost-demo");
    expect(config.policy.grants.some((grant) => grant.id === "demo-unlocked-local.runtime-supported")).toBe(true);
  });

  it("allows environment to override Forge sandbox mode", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-config-sandbox-"));
    const config = await loadAgentHostConfig({ env: { AGENTHOST_FORGE_RUNTIME_SANDBOX_MODE: "bubblewrap" }, homeDir });
    expect(config.forgeRuntimeSandboxMode).toBe("bubblewrap");
  });
});
