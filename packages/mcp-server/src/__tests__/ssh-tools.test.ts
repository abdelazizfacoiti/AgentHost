import {
  createAdapterRegistry,
  createBaseCapabilityRegistry,
  getPolicyProfile,
  toolSuccess,
  type AgentHostConfig,
  type AppAdapter,
  type AuditLogEntry,
  type AuditLogger
} from "@agenthost/core";
import { describe, expect, it } from "vitest";
import { ConfirmationManager } from "../confirmation.js";
import type { AgentHostMcpContext } from "../context.js";
import { ForgeStore } from "../forge-store.js";
import { GrantStore } from "../grants.js";
import { runTool } from "../tool-runner.js";
import { createSshTools } from "../tools/ssh.js";

class MemoryLogger implements AuditLogger {
  readonly entries: AuditLogEntry[] = [];

  async log(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

function createMockSshAdapter(): { adapter: AppAdapter; calls: () => number } {
  let executeCalls = 0;

  return {
    adapter: {
      id: "ssh",
      displayName: "SSH device",
      appIds: ["ssh"],
      supportedPlatforms: ["linux"],
      optionalExecutionPolicy: {
        enabledByDefault: false,
        stability: "experimental",
        execution: {
          executionClass: "state_changing",
          externalEffect: true,
          requiresDryRun: true,
          requiresConfirmationToken: true,
          requiresExactTarget: true,
          source: "optional_adapter",
          availability: "available"
        },
        fingerprinting: "required",
        subprocess: { required: true, shell: false, commandAllowlist: ["ssh"] },
        environment: { allowlist: ["PATH", "LANG", "LC_ALL", "TMPDIR"], inherit: false },
        limits: { maxRuntimeMs: 60_000, maxOutputBytes: 64 * 1024 },
        filesystem: { allowedOutputRoots: ["$AGENTHOST_HOME/outputs/ssh"], broadFilesystem: false },
        audit: { redacted: true, rawInput: false, rawOutput: false }
      },
      matchesApp: (input) => input.appId === "ssh",
      getCapabilities: () => [
        {
          id: "ssh.run_command",
          adapterId: "ssh",
          appId: "ssh",
          strategy: "app_adapter",
          riskLevel: "medium",
          description: "Mock SSH capability.",
          safety: { actionType: "shell_command" }
        }
      ],
      async execute(action) {
        executeCalls += 1;
        return toolSuccess({
          tool: "ssh.run_command",
          riskLevel: "medium",
          strategy: "app_adapter",
          data: {
            adapterId: "ssh",
            capabilityId: "ssh.run_command",
            target: "pi@pi.lan",
            exitCode: 0,
            stdout: "ok\n",
            input: action.input
          }
        });
      }
    },
    calls: () => executeCalls
  };
}

function createContext(profile: "strict" | "dev", withAdapter: boolean): AgentHostMcpContext & { logger: MemoryLogger; calls: () => number } {
  const registry = createBaseCapabilityRegistry();
  const adapters = createAdapterRegistry({ platform: "linux" });
  const policy = getPolicyProfile(profile);
  const config: AgentHostConfig = {
    agentHostDir: "/tmp/agenthost-ssh-tool-test",
    configPath: "/tmp/agenthost-ssh-tool-test/config.json",
    logFile: "/tmp/agenthost-ssh-tool-test/logs/agenthost.jsonl",
    profile,
    policy
  };
  const logger = new MemoryLogger();
  let calls = () => 0;

  if (withAdapter) {
    const mock = createMockSshAdapter();
    adapters.register(mock.adapter);
    calls = mock.calls;
  }

  return {
    sessionId: "session_ssh_tool",
    config,
    policy,
    registry,
    adapters,
    confirmations: new ConfirmationManager(),
    grants: new GrantStore({ persistentGrants: policy.grants }),
    forge: new ForgeStore(config.agentHostDir),
    logger,
    linux: {} as never,
    calls
  };
}

async function callTool(context: AgentHostMcpContext, name: string, input: unknown) {
  const tool = createSshTools().find((candidate) => candidate.name === name);

  expect(tool).toBeDefined();
  expect(tool?.safety).toBeDefined();

  return runTool(tool!, input, context);
}

describe("ssh MCP tools", () => {
  it("declares safety metadata for ssh.run_command", () => {
    const [tool] = createSshTools();

    expect(tool?.name).toBe("ssh.run_command");
    expect(tool?.safety?.actionType).toBe("shell_command");
    expect(tool?.execution).toMatchObject({ executionClass: "state_changing", source: "optional_adapter", requiresExactTarget: true });
  });

  it("returns a clean error when the SSH adapter is not registered", async () => {
    const context = createContext("dev", false);
    const result = await callTool(context, "ssh.run_command", { host: "pi.lan", command: "uptime" });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("dry_run_required");
    expect(context.calls()).toBe(0);
  });

  it("runs the registered SSH adapter in dev profile through dry-run and token", async () => {
    const context = createContext("dev", true);
    const preview = await callTool(context, "ssh.run_command", { host: "pi.lan", command: "uptime", dryRun: true });
    const token = (preview.data as { confirmationToken?: string } | null)?.confirmationToken;
    expect(preview).toMatchObject({ ok: true, preview: true });
    expect(typeof token).toBe("string");
    const executed = await callTool(context, "ssh.run_command", { host: "pi.lan", command: "uptime", confirmationToken: token });
    expect(executed.ok).toBe(true);
    expect(context.calls()).toBe(1);
    expect(executed.data).toMatchObject({ target: "pi@pi.lan", exitCode: 0 });
  });
});
