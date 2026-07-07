import type { ShellRunResult, ToolResult } from "@agenthost/core";
import { toolSuccess } from "@agenthost/core";
import { formatCommandForSafety } from "@agenthost/os-linux";
import { z } from "zod";
import type { AgentHostToolDefinition } from "../tool-runner.js";
import type { AgentHostMcpContext } from "../context.js";

const shellInputSchema = z
  .object({
    command: z.string().trim().min(1).max(300),
    args: z.array(z.string().max(1000)).max(100).optional(),
    cwd: z.string().trim().min(1).max(1000).optional(),
    timeoutMs: z.number().int().min(1).max(60_000).optional(),
    maxOutputBytes: z.number().int().min(1).max(1024 * 1024).optional()
  })
  .strict();

type ShellInput = z.infer<typeof shellInputSchema>;

export function createShellTools(): AgentHostToolDefinition<ShellInput, ShellRunResult, AgentHostMcpContext>[] {
  return [
    {
      name: "shell.run_safe",
      description: "Runs a classified command with shell disabled, timeout, and output limits.",
      riskLevel: "medium",
      inputSchema: shellInputSchema,
      mcpInputSchema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            minLength: 1,
            maxLength: 300
          },
          args: {
            type: "array",
            items: {
              type: "string",
              maxLength: 1000
            },
            maxItems: 100
          },
          cwd: {
            type: "string",
            minLength: 1,
            maxLength: 1000
          },
          timeoutMs: {
            type: "integer",
            minimum: 1,
            maximum: 60000
          },
          maxOutputBytes: {
            type: "integer",
            minimum: 1,
            maximum: 1048576
          }
        },
        required: ["command"],
        additionalProperties: false
      },
      inputSummary: "Run safe shell command",
      safety: {
        actionType: "shell_command",
        getInput: (input) => {
          const commandForSafety = {
            command: input.command
          } as { command: string; args?: string[] };

          if (input.args !== undefined) {
            commandForSafety.args = input.args;
          }

          const safetyInput = {
            shellCommand: formatCommandForSafety(commandForSafety),
            ...(input.cwd === undefined ? {} : { filePath: input.cwd })
          };

          return safetyInput;
        }
      },
      async handler(input, context): Promise<ToolResult<ShellRunResult>> {
        const commandInput: {
          command: string;
          args?: string[];
          cwd?: string;
          timeoutMs?: number;
          maxOutputBytes?: number;
        } = {
          command: input.command
        };

        if (input.args !== undefined) {
          commandInput.args = input.args;
        }

        if (input.cwd !== undefined) {
          commandInput.cwd = input.cwd;
        }

        if (input.timeoutMs !== undefined) {
          commandInput.timeoutMs = input.timeoutMs;
        }

        if (input.maxOutputBytes !== undefined) {
          commandInput.maxOutputBytes = input.maxOutputBytes;
        }

        return toolSuccess({
          tool: "shell.run_safe",
          riskLevel: "medium",
          strategy: "cli_or_script",
          data: await context.linux.runSafeCommand(commandInput),
          observations: ["Ran command with shell disabled after safety classification."]
        });
      }
    }
  ];
}
