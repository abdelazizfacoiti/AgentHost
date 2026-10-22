import { toolFailure, toolSuccess, evaluateSafety, normalizePathForPolicy, type ShellRunResult, type ToolResult } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";
import { createSafetyEvaluationContext } from "../grants.js";

const runInput = z.object({
  command: z.string().trim().min(1).max(10000),
  args: z.array(z.string().trim().max(1000)).max(100).optional(),
  cwd: z.string().trim().max(1000).optional(),
  env: z.record(z.string()).optional(),
  timeoutMs: z.number().int().min(100).max(300_000).optional(),
  dryRun: z.boolean().optional(),
  confirmationToken: z.string().trim().min(8).max(120).optional()
}).strict();

const BLOCKED_ENV_KEYS = new Set(["PATH", "HOME", "LD_PRELOAD", "LD_LIBRARY_PATH", "NODE_OPTIONS", "PYTHONPATH", "BASH_ENV", "ENV"]);

function unsafeEnvKeys(env: Record<string, string> | undefined): string[] {
  return env === undefined ? [] : Object.keys(env).filter((key) => BLOCKED_ENV_KEYS.has(key));
}

function commandSummary(input: { command: string; args?: string[] | undefined }): string {
  const executable = input.command.trim().split(/\s+/)[0] ?? "command";
  return `Run ${executable} with ${input.args?.length ?? 0} argument(s)`;
}

function safetyFor(input: { command: string; args?: string[] | undefined; cwd?: string | undefined }, context: AgentHostMcpContext) {
  const shellCommand = [input.command, ...(input.args ?? [])].join(" ");
  const cwd = input.cwd === undefined ? undefined : normalizePathForPolicy(input.cwd, { agentHostDir: context.config.agentHostDir });
  const classifiedCommand = cwd === undefined ? shellCommand : `${shellCommand} cwd=${cwd}`;
  const safety = evaluateSafety(
    { tool: "shell.run", actionType: "shell_command", strategy: "cli_or_script", shellCommand: classifiedCommand },
    context.policy,
    createSafetyEvaluationContext(context)
  );
  return { shellCommand, cwd, safety };
}

export function createShellTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const run: AgentHostToolDefinition<z.infer<typeof runInput>, ShellRunResult, AgentHostMcpContext> = {
    name: "shell.run",
    description: "Runs a shell command with safety checks.",
    riskLevel: "high",
    inputSchema: runInput,
    mcpInputSchema: {
      type: "object",
      properties: {
        command: { type: "string", minLength: 1, maxLength: 10000 },
        args: { type: "array", items: { type: "string" }, maxItems: 100 },
        cwd: { type: "string" },
        env: { type: "object" },
        timeoutMs: { type: "integer", minimum: 100, maximum: 300000 },
        dryRun: { type: "boolean" },
        confirmationToken: { type: "string", minLength: 8, maxLength: 120 }
      },
      required: ["command"],
      additionalProperties: false
    },
    inputSummary: "Run shell command",
    auditInputSummary: commandSummary,
    auditOutputSummary: (result) => result.ok && result.data !== null ? `Shell command exited with code ${result.data.exitCode ?? "unknown"}.` : result.error?.code ?? "Shell command failed.",
    safety: { actionType: "shell_command", getInput: (i) => ({ shellCommand: [i.command, ...(i.args ?? [])].join(" ") }) },
    preview: {
      isDryRun: (i) => i.dryRun === true,
      resolveEffect: (i, context) => {
        const blockedKeys = unsafeEnvKeys(i.env);
        if (blockedKeys.length > 0) {
          return { summary: "Shell environment override blocked.", riskLevel: "blocked", approval: { required: false, status: "denied" }, blocked: true, reasons: [`Environment keys are operator-only: ${blockedKeys.join(", ")}`], data: { blockedEnvKeys: blockedKeys } };
        }
        const { shellCommand, cwd, safety } = safetyFor(i, context);
        const summary = cwd === undefined ? shellCommand : `${shellCommand} (cwd ${cwd})`;
        return { summary: summary.slice(0, 300), targetFingerprint: i.command, riskLevel: safety.riskLevel, approval: safety.approval, blocked: safety.blocked, reasons: safety.reasons, data: { command: i.command, argCount: i.args?.length ?? 0, cwd: cwd ?? null } };
      }
    },
    async handler(input, context): Promise<ToolResult<ShellRunResult>> {
      const blockedKeys = unsafeEnvKeys(input.env);
      if (blockedKeys.length > 0) {
        return toolFailure({
          tool: "shell.run",
          riskLevel: "blocked",
          error: { code: "unsafe_environment", message: `Environment keys are operator-only: ${blockedKeys.join(", ")}` },
          observations: ["No action was executed."]
        });
      }
      const { safety } = safetyFor(input, context);
      if (!safety.allowed) {
        return toolFailure({
          tool: "shell.run",
          riskLevel: safety.riskLevel,
          approval: safety.approval,
          error: { code: safety.blocked ? "safety_blocked" : "approval_required", message: safety.blocked ? "Blocked by safety engine." : "Requires approval.", details: safety },
          observations: safety.reasons
        });
      }

      try {
        const data = await context.linux.runSafeCommand({
          command: input.command,
          args: input.args ?? [],
          ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
          ...(input.env === undefined ? {} : { env: input.env }),
          ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
        });
        return toolSuccess({ tool: "shell.run", riskLevel: "high", data, observations: ["Ran shell command."] });
      } catch (e) {
        return toolFailure({ tool: "shell.run", riskLevel: "high", error: { code: "execution_failed", message: e instanceof Error ? e.message : "Execution failed" } });
      }
    }
  };

  return [run];
}