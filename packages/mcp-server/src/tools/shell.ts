import { toolFailure, toolSuccess, evaluateSafety, type ShellRunResult, type ToolResult } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";
import { createSafetyEvaluationContext } from "../grants.js";

const runInput = z.object({
  command: z.string().trim().min(1).max(10000),
  args: z.array(z.string().trim().max(1000)).max(100).optional(),
  cwd: z.string().trim().max(1000).optional(),
  env: z.record(z.string()).optional(),
  timeoutMs: z.number().int().min(100).max(300_000).optional()
}).strict();

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
        timeoutMs: { type: "integer", minimum: 100, maximum: 300000 }
      },
      required: ["command"],
      additionalProperties: false
    },
    inputSummary: "Run shell command",
    safety: { actionType: "shell_command", getInput: (i) => ({ command: i.command, args: i.args }) },
    async handler(input, context): Promise<ToolResult<ShellRunResult>> {
      const safety = evaluateSafety(
        { tool: "shell.run", actionType: "shell_command", strategy: "cli_or_script" },
        context.policy,
        createSafetyEvaluationContext(context)
      );
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