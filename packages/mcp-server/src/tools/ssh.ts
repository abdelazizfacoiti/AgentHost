import { evaluateSafety, toolFailure, type ToolExecutionMetadata, type ToolResult } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition } from "../tool-runner.js";
import { createSafetyEvaluationContext } from "../grants.js";
import { acceptedConfirmation, buildPreviewResult, confirmationRequired, rejectedConfirmation } from "./preview.js";

const sshInputSchema = z
  .object({
    host: z.string().trim().min(1).max(253),
    user: z.string().trim().min(1).max(32).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    command: z.string().min(1).max(4000),
    timeoutMs: z.number().int().min(1_000).max(60_000).optional(),
    dryRun: z.boolean().optional(),
    confirmationToken: z.string().trim().min(1).max(2000).optional()
  })
  .strict();

type SshToolInput = z.infer<typeof sshInputSchema>;

const sshExecution: ToolExecutionMetadata = {
  executionClass: "state_changing",
  externalEffect: false,
  requiresDryRun: true,
  requiresConfirmationToken: true,
  requiresExactTarget: true,
  source: "optional_adapter",
  availability: "available"
};

export const SSH_RUN_COMMAND_TOOL = {
  name: "ssh.run_command",
  riskLevel: "medium" as const,
  strategy: "app_adapter" as const,
  description: "Runs one reviewed shell command on a remote device over OpenSSH through the optional SSH device adapter."
};

export function createSshTools(): Array<AgentHostToolDefinition<SshToolInput, unknown, AgentHostMcpContext>> {
  return [
    {
      name: SSH_RUN_COMMAND_TOOL.name,
      description: SSH_RUN_COMMAND_TOOL.description,
      riskLevel: SSH_RUN_COMMAND_TOOL.riskLevel,
      inputSchema: sshInputSchema,
      mcpInputSchema: {
        type: "object",
        properties: {
          host: { type: "string", minLength: 1, maxLength: 253 },
          user: { type: "string", minLength: 1, maxLength: 32 },
          port: { type: "integer", minimum: 1, maximum: 65535 },
          command: { type: "string", minLength: 1, maxLength: 4000 },
          timeoutMs: { type: "integer", minimum: 1000, maximum: 60000 },
          dryRun: { type: "boolean" },
          confirmationToken: { type: "string", minLength: 1, maxLength: 2000 }
        },
        required: ["host", "command"],
        additionalProperties: false
      },
      inputSummary: "Run remote SSH command",
      auditInputSummary: (input) => `Run remote command on ${input.user === undefined ? "" : `${input.user}@`}${input.host}`,
      auditOutputSummary: (result) => result.ok ? "Remote command completed; output omitted." : result.error?.code ?? "Remote command failed.",
      execution: sshExecution,
      safety: { actionType: "shell_command" },
      preview: { isDryRun: (input) => input.dryRun === true },
      async handler(input, context, runtime): Promise<ToolResult<unknown>> {
        const adapter = context.adapters.get("ssh");

        if (adapter === undefined) {
          return toolFailure({
            tool: SSH_RUN_COMMAND_TOOL.name,
            riskLevel: "medium",
            strategy: "app_adapter",
            error: {
              code: "ssh_adapter_unavailable",
              message: "The optional SSH device adapter is not registered in this runtime."
            },
            observations: ["SSH tooling is unavailable because the optional adapter is not loaded."]
          });
        }

        // No appId/appName here: no local app is automated. The remote device
        // is identified in the confirmation target and adapter bindings, and
        // the local SSH client never handles credentials (key auth only).
        const postResolutionSafety = evaluateSafety(
          {
            tool: SSH_RUN_COMMAND_TOOL.name,
            actionType: "shell_command",
            strategy: "app_adapter"
          },
          context.policy,
          createSafetyEvaluationContext(context)
        );

        const confirmationTarget = {
          adapterId: "ssh",
          capabilityId: "ssh.run_command",
          host: input.host,
          ...(input.user === undefined ? {} : { user: input.user }),
          ...(input.port === undefined ? {} : { port: input.port })
        };

        if (runtime?.isDryRun) {
          return buildPreviewResult({
            tool: SSH_RUN_COMMAND_TOOL.name,
            riskLevel: postResolutionSafety.riskLevel,
            strategy: "app_adapter",
            safety: postResolutionSafety,
            targetSummary: `Reviewed remote command on ${confirmationTarget.host}`,
            target: { kind: "app", summary: "SSH reviewed-command execution", appName: "SSH device" },
            wouldExecute: postResolutionSafety.allowed,
            confirmation: postResolutionSafety.allowed
              ? {
                  manager: context.confirmations,
                  sessionId: context.sessionId,
                  input,
                  target: confirmationTarget,
                  explanation: "Use this token only for the exact reviewed remote command and target.",
                  riskLevel: "medium"
                }
              : undefined
          });
        }

        if (!postResolutionSafety.allowed) {
          return toolFailure({
            tool: SSH_RUN_COMMAND_TOOL.name,
            riskLevel: postResolutionSafety.riskLevel,
            strategy: "app_adapter",
            approval: postResolutionSafety.approval,
            error: {
              code: postResolutionSafety.blocked ? "safety_blocked" : "approval_required",
              message: postResolutionSafety.blocked
                ? "SSH execution was blocked by the safety engine."
                : "SSH execution requires approval before it can run.",
              details: postResolutionSafety
            },
            observations: postResolutionSafety.reasons
          });
        }

        if (input.confirmationToken === undefined) {
          return toolFailure({
            tool: SSH_RUN_COMMAND_TOOL.name,
            riskLevel: "medium",
            strategy: "app_adapter",
            confirmation: confirmationRequired("SSH execution requires a fresh dry-run confirmation token."),
            error: {
              code: "confirmation_required",
              message: "SSH execution requires a fresh dry-run confirmation token."
            }
          });
        }

        const verified = context.confirmations.verifyAndConsume(input.confirmationToken, {
          sessionId: context.sessionId,
          tool: SSH_RUN_COMMAND_TOOL.name,
          input,
          target: confirmationTarget,
          riskLevel: "medium"
        });

        if (!verified.ok) {
          return toolFailure({
            tool: SSH_RUN_COMMAND_TOOL.name,
            riskLevel: "medium",
            strategy: "app_adapter",
            confirmation: rejectedConfirmation(verified.tokenId, verified.reason),
            error: {
              code: "confirmation_rejected",
              message: verified.reason
            }
          });
        }

        const result = await adapter.execute(
          {
            adapterId: "ssh",
            capabilityId: "ssh.run_command",
            appId: "ssh",
            input: {
              host: input.host,
              ...(input.user === undefined ? {} : { user: input.user }),
              ...(input.port === undefined ? {} : { port: input.port }),
              command: input.command,
              ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
            }
          },
          {
            sessionId: context.sessionId,
            config: context.config,
            policy: context.policy,
            registry: context.registry
          }
        );
        return { ...result, confirmation: acceptedConfirmation(verified.tokenId, result.ok, "SSH confirmation accepted.") };
      }
    }
  ];
}
