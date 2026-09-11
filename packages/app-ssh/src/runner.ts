import {
  toolFailure,
  toolSuccess,
  type AgentHostConfig,
  type PolicyProfile,
  type SafetyEvaluationContext,
  type ToolResult
} from "@agenthost/core";
import { findCommandPath, runSafeLinuxCommand } from "@agenthost/os-linux";
import { describeSshTarget, validateRemoteCommand, validateSshTarget } from "./safety.js";

export interface SshRunCommandInput {
  host: string;
  user?: string;
  port?: number;
  command: string;
  timeoutMs?: number;
}

export interface SshRunCommandOutput {
  adapterId: "ssh";
  capabilityId: "ssh.run_command";
  target: string;
  sshCommand: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface SshRunnerDependencies {
  findSshPath?: (command: string) => Promise<string | undefined>;
  runCommand?: typeof runSafeLinuxCommand;
  now?: () => number;
}

const MAX_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

function deniedApproval(reason: string) {
  return {
    required: false,
    status: "denied" as const,
    reason
  };
}

function failure(code: string, message: string, observations: string[] = []): ToolResult<never> {
  return toolFailure({
    tool: "ssh.run_command",
    riskLevel: "medium",
    strategy: "app_adapter",
    approval: deniedApproval(message),
    error: { code, message },
    observations
  });
}

export async function runSshCommand(
  input: SshRunCommandInput,
  config: AgentHostConfig,
  policy: PolicyProfile,
  dependencies: SshRunnerDependencies = {},
  safetyContext: SafetyEvaluationContext = {}
): Promise<ToolResult<SshRunCommandOutput>> {
  const target = validateSshTarget({ host: input.host, ...(input.user === undefined ? {} : { user: input.user }), ...(input.port === undefined ? {} : { port: input.port }) });
  if ("error" in target) return failure("ssh_target_invalid", target.error);
  const commandCheck = validateRemoteCommand(input.command, policy, safetyContext);
  if (!commandCheck.ok) return failure("ssh_command_rejected", commandCheck.error);
  const timeoutMs = Math.max(1_000, Math.min(MAX_TIMEOUT_MS, Math.round(input.timeoutMs ?? 30_000)));

  const findSshPath = dependencies.findSshPath ?? ((command: string) => findCommandPath(command));
  const sshPath = await findSshPath("ssh");
  if (sshPath === undefined) return failure("ssh_not_found", "OpenSSH client is not installed on PATH.");
  const runCommand = dependencies.runCommand ?? runSafeLinuxCommand;
  const args = [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=accept-new",
    "-p", String(target.port ?? 22),
    `${target.user === undefined ? "" : `${target.user}@`}${target.host}`,
    input.command
  ];
  const startedAt = dependencies.now?.() ?? Date.now();
  let ran: Awaited<ReturnType<typeof runSafeLinuxCommand>>;
  try {
    ran = await runCommand({ command: sshPath, args, timeoutMs, maxOutputBytes: MAX_OUTPUT_BYTES, cwd: config.agentHostDir });
  } catch {
    return failure("ssh_spawn_failed", "The SSH subprocess could not be started.");
  }
  const output: SshRunCommandOutput = {
    adapterId: "ssh",
    capabilityId: "ssh.run_command",
    target: describeSshTarget(target),
    sshCommand: "ssh",
    exitCode: ran.exitCode,
    signal: ran.signal,
    stdout: ran.stdout.slice(0, MAX_OUTPUT_BYTES),
    stderr: ran.stderr.slice(0, MAX_OUTPUT_BYTES),
    durationMs: typeof dependencies.now === "function" ? Math.max(0, dependencies.now() - startedAt) : ran.durationMs,
    timedOut: ran.timedOut
  };
  if (ran.exitCode !== 0) {
    return {
      ...toolFailure({
        tool: "ssh.run_command",
        riskLevel: "medium",
        strategy: "app_adapter",
        approval: deniedApproval("Remote command exited non-zero."),
        error: { code: ran.timedOut ? "ssh_timed_out" : "ssh_command_failed", message: `Remote command exited ${ran.exitCode ?? ran.signal ?? "unknown"}.` },
        observations: ["Remote output is bounded; check exit code and stderr."]
      }),
      data: output
    };
  }
  return toolSuccess({ tool: "ssh.run_command", riskLevel: "medium", strategy: "app_adapter", data: output, observations: ["Remote command completed through the SSH device adapter."] });
}
