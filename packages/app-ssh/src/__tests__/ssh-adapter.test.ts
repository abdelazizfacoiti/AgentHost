import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getPolicyProfile, type AgentHostConfig, type ToolContext } from "@agenthost/core";
import { createSshAdapter, runSshCommand } from "../index.js";
import { describeSshTarget, validateRemoteCommand, validateSshTarget } from "../safety.js";

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
    sessionId: "session_ssh",
    config,
    policy: config.policy,
    registry: {
      listStrategies: () => [],
      listTools: () => [],
      listAppCapabilities: () => []
    }
  };
}

describe("SSH device adapter", () => {
  it("exposes the shared adapter interface and capability metadata", () => {
    const adapter = createSshAdapter();
    expect(adapter.id).toBe("ssh");
    expect(adapter.appIds).toEqual(["ssh"]);
    expect(adapter.getCapabilities()).toEqual([
      expect.objectContaining({
        id: "ssh.run_command",
        adapterId: "ssh",
        appId: "ssh",
        strategy: "app_adapter",
        riskLevel: "medium"
      })
    ]);
    expect(adapter.matchesApp?.({ appId: "ssh-device" })).toBe(true);
    expect(adapter.optionalExecutionPolicy).toMatchObject({ enabledByDefault: false, stability: "experimental" });
  });

  it("rejects hostile targets and blocked commands before any subprocess", async () => {
    expect(validateSshTarget({ host: "evil; rm -rf /" })).toMatchObject({ error: expect.any(String) });
    expect(validateSshTarget({ host: "example.test", user: "root;id" })).toMatchObject({ error: expect.any(String) });
    expect(validateSshTarget({ host: "example.test", port: 99999 })).toMatchObject({ error: expect.any(String) });
    expect(validateSshTarget({ host: "pi.lan", user: "pi", port: 22 })).toMatchObject({ host: "pi.lan", user: "pi", port: 22 });
    expect(describeSshTarget({ host: "pi.lan", user: "pi" })).toBe("pi@pi.lan");

    const dir = await mkdtemp(path.join(os.tmpdir(), "agenthost-ssh-safety-"));
    const config = createConfig(dir);
    expect(validateRemoteCommand("sudo rm -rf /", config.policy).ok).toBe(false);
    const result = await runSshCommand({ host: "example.test", command: "sudo id" }, config, config.policy, {
      findSshPath: async () => "/usr/bin/ssh",
      runCommand: async () => { throw new Error("must not spawn"); }
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("ssh_command_rejected");
  });

  it("returns a clean error when OpenSSH is not installed", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agenthost-ssh-missing-"));
    const config = createConfig(dir);
    const result = await runSshCommand({ host: "example.test", command: "uptime" }, config, config.policy, {
      findSshPath: async () => undefined
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("ssh_not_found");
  });

  it("runs a remote command with key-only argv and bounded output", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agenthost-ssh-success-"));
    const config = createConfig(dir);
    let seenArgs: string[] = [];
    const result = await runSshCommand({ host: "pi.lan", user: "pi", command: "uptime", timeoutMs: 5_000 }, config, config.policy, {
      findSshPath: async () => "/usr/bin/ssh",
      runCommand: (async (input: { command: string; args?: string[] }) => {
        seenArgs = input.args ?? [];
        return { exitCode: 0, signal: null, stdout: "12:00 up 1 day\n", stderr: "", durationMs: 12, timedOut: false, truncated: false };
      }) as never
    });
    expect(result.ok).toBe(true);
    expect(seenArgs).toContain("BatchMode=yes");
    expect(seenArgs).toContain("pi@pi.lan");
    expect(seenArgs).toContain("uptime");
    expect(seenArgs).not.toContain("sudo");
    expect(result.data).toMatchObject({ adapterId: "ssh", capabilityId: "ssh.run_command", target: "pi@pi.lan", exitCode: 0 });
  });

  it("returns adapter ToolResults with remote output on failure", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agenthost-ssh-fail-"));
    const adapter = createSshAdapter({
      findSshPath: async () => "/usr/bin/ssh",
      runCommand: (async () => ({ exitCode: 1, signal: null, stdout: "", stderr: "ssh: connect timeout\n", durationMs: 5, timedOut: false, truncated: false })) as never
    });
    const result = await adapter.execute(
      { adapterId: "ssh", capabilityId: "ssh.run_command", appId: "ssh", input: { host: "pi.lan", command: "uptime" } },
      createToolContext(dir)
    );
    expect(result.ok).toBe(false);
    expect(result.tool).toBe("ssh.run_command");
    expect(result.error?.code).toBe("ssh_command_failed");
    expect(result.data).toMatchObject({ target: "pi.lan" });
    const unknown = await adapter.execute(
      { adapterId: "ssh", capabilityId: "ssh.nope", appId: "ssh", input: {} },
      createToolContext(dir)
    );
    expect(unknown.error?.code).toBe("unknown_ssh_capability");
  });
});
