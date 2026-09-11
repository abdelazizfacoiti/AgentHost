import { classifyShellCommand, type PolicyProfile, type SafetyEvaluationContext } from "@agenthost/core";

export interface SshTarget {
  host: string;
  user?: string;
  port?: number;
}

const HOST_PATTERN = /^([A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9a-fA-F:.]+\])$/;
const USER_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/i;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
export const SSH_MAX_COMMAND_CHARS = 4000;

/** Strict device-target validation: no shell metacharacters ever reach argv. */
export function validateSshTarget(input: { host?: string; user?: string; port?: number }): SshTarget | { error: string } {
  const host = input.host?.trim() ?? "";
  if (host.length === 0 || host.length > 253 || !HOST_PATTERN.test(host)) {
    return { error: "SSH target host must be a plain hostname or IP address." };
  }
  if (input.user !== undefined && !USER_PATTERN.test(input.user)) {
    return { error: "SSH target user must be a plain login name." };
  }
  if (input.port !== undefined && (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)) {
    return { error: "SSH target port must be an integer between 1 and 65535." };
  }
  return { host, ...(input.user === undefined ? {} : { user: input.user }), ...(input.port === undefined ? {} : { port: input.port }) };
}

/**
 * Remote commands run through the remote shell, so they inherit the local
 * shell safety posture: blocked patterns stay blocked, the rest is
 * approval-gated upstream. Key authentication only; BatchMode forbids
 * password prompts, so no credential can be typed into ssh.
 */
export function validateRemoteCommand(
  command: string,
  policy: PolicyProfile,
  context: SafetyEvaluationContext = {}
): { ok: true } | { ok: false; error: string } {
  if (command.length === 0 || command.length > SSH_MAX_COMMAND_CHARS) {
    return { ok: false, error: `Remote command must be 1-${SSH_MAX_COMMAND_CHARS} characters.` };
  }
  if (CONTROL_CHARS.test(command)) {
    return { ok: false, error: "Remote command must not contain control characters." };
  }
  const decision = classifyShellCommand(command, policy, context);
  if (decision.blocked) {
    return { ok: false, error: `Remote command is blocked: ${decision.matchedRules.join(",")}` };
  }
  return { ok: true };
}

export function describeSshTarget(target: SshTarget): string {
  return `${target.user === undefined ? "" : `${target.user}@`}${target.host}${target.port === undefined ? "" : `:${target.port}`}`;
}
