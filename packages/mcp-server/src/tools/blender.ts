import path from "node:path";
import { evaluateSafety, toolFailure, type ToolResult } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition } from "../tool-runner.js";
import { createSafetyEvaluationContext } from "../grants.js";
import { acceptedConfirmation, buildPreviewResult, confirmationRequired, rejectedConfirmation } from "./preview.js";

const blenderInputSchema = z
  .object({
    script: z.string().min(1).max(50_000).optional(),
    demo: z.enum(["coffee_cup"]).optional(),
    outputDir: z.string().trim().min(1).max(1000).optional(),
    expectedOutputs: z.array(z.string().trim().min(1).max(200)).min(1).max(5).optional(),
    timeoutMs: z.number().int().min(1_000).max(60_000).optional(),
    dryRun: z.boolean().optional(),
    confirmationToken: z.string().trim().min(1).max(2000).optional()
  })
  .strict()
  .superRefine((input, ctx) => {
    const hasScript = input.script !== undefined;
    const hasDemo = input.demo !== undefined;

    if (hasScript === hasDemo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Exactly one of script or demo must be provided."
      });
    }
  });

type BlenderToolInput = z.infer<typeof blenderInputSchema>;

export const BLENDER_RUN_PYTHON_TOOL = {
  name: "blender.run_python",
  riskLevel: "medium" as const,
  strategy: "app_adapter" as const,
  description: "Runs a reviewed Blender Python script in background mode through the optional Blender adapter."
};

function defaultOutputDir(context: AgentHostMcpContext): string {
  return path.join(context.config.agentHostDir, "outputs", "blender", `run-${context.sessionId}`);
}

function toAdapterActionInput(input: BlenderToolInput, outputDir: string): BlenderToolInput {
  const actionInput: BlenderToolInput = {
    outputDir
  };

  if (input.script !== undefined) {
    actionInput.script = input.script;
  }

  if (input.demo !== undefined) {
    actionInput.demo = input.demo;
  }

  if (input.expectedOutputs !== undefined) {
    actionInput.expectedOutputs = input.expectedOutputs;
  }

  if (input.timeoutMs !== undefined) {
    actionInput.timeoutMs = input.timeoutMs;
  }

  return actionInput;
}

export function createBlenderTools(): AgentHostToolDefinition<BlenderToolInput, unknown, AgentHostMcpContext>[] {
  return [
    {
      name: BLENDER_RUN_PYTHON_TOOL.name,
      description: BLENDER_RUN_PYTHON_TOOL.description,
      riskLevel: BLENDER_RUN_PYTHON_TOOL.riskLevel,
      inputSchema: blenderInputSchema,
      mcpInputSchema: {
        type: "object",
        properties: {
          script: {
            type: "string",
            minLength: 1,
            maxLength: 50000
          },
          demo: {
            type: "string",
            enum: ["coffee_cup"]
          },
          outputDir: {
            type: "string",
            minLength: 1,
            maxLength: 1000
          },
          expectedOutputs: {
            type: "array",
            items: {
              type: "string",
              minLength: 1,
              maxLength: 200
            },
            minItems: 1,
            maxItems: 5
          },
          timeoutMs: {
            type: "integer",
            minimum: 1000,
            maximum: 60000
          },
          dryRun: {
            type: "boolean"
          },
          confirmationToken: {
            type: "string",
            minLength: 1,
            maxLength: 2000
          }
        },
        additionalProperties: false
      },
      inputSummary: "Run Blender Python",
      preview: { isDryRun: (input) => input.dryRun === true },
      safety: {
        actionType: "file_write",
        getInput: (input) => {
          const safetyInput: {
            appId: string;
            appName: string;
            filePath?: string;
          } = {
            appId: "blender",
            appName: "Blender"
          };

          if (input.outputDir !== undefined) {
            safetyInput.filePath = input.outputDir;
          }

          return safetyInput;
        }
      },
      async handler(input, context, runtime): Promise<ToolResult<unknown>> {
        const adapter = context.adapters.get("blender");

        if (adapter === undefined) {
          return toolFailure({
            tool: BLENDER_RUN_PYTHON_TOOL.name,
            riskLevel: "medium",
            strategy: "app_adapter",
            error: {
              code: "blender_adapter_unavailable",
              message: "The optional Blender adapter is not registered in this runtime."
            },
            observations: ["Blender tooling is unavailable because the optional adapter is not loaded."]
          });
        }

        const outputDir = input.outputDir ?? defaultOutputDir(context);
        const postResolutionSafety = evaluateSafety(
          {
            tool: BLENDER_RUN_PYTHON_TOOL.name,
            actionType: "file_write",
            strategy: "app_adapter",
            appId: "blender",
            appName: "Blender",
            filePath: outputDir
          },
          context.policy,
          createSafetyEvaluationContext(context)
        );

        const confirmationTarget = {
          adapterId: "blender",
          capabilityId: "blender.run_python",
          outputDir
        };

        if (runtime?.isDryRun) {
          return buildPreviewResult({
            tool: BLENDER_RUN_PYTHON_TOOL.name,
            riskLevel: postResolutionSafety.riskLevel,
            strategy: "app_adapter",
            safety: postResolutionSafety,
            targetSummary: "Reviewed Blender script and approved output directory",
            target: { kind: "app", summary: "Blender reviewed-script execution", appName: "Blender" },
            wouldExecute: postResolutionSafety.allowed,
            confirmation: postResolutionSafety.allowed
              ? {
                  manager: context.confirmations,
                  sessionId: context.sessionId,
                  input,
                  target: confirmationTarget,
                  explanation: "Use this token only for the exact reviewed Blender script and output target.",
                  riskLevel: "medium"
                }
              : undefined
          });
        }

        if (!postResolutionSafety.allowed) {
          return toolFailure({
            tool: BLENDER_RUN_PYTHON_TOOL.name,
            riskLevel: postResolutionSafety.riskLevel,
            strategy: "app_adapter",
            approval: postResolutionSafety.approval,
            error: {
              code: postResolutionSafety.blocked ? "safety_blocked" : "approval_required",
              message: postResolutionSafety.blocked
                ? "Blender execution was blocked by the safety engine."
                : "Blender execution requires approval before it can run.",
              details: postResolutionSafety
            },
            observations: postResolutionSafety.reasons
          });
        }

        if (input.confirmationToken === undefined) {
          return toolFailure({
            tool: BLENDER_RUN_PYTHON_TOOL.name,
            riskLevel: "medium",
            strategy: "app_adapter",
            confirmation: confirmationRequired("Blender execution requires a fresh dry-run confirmation token."),
            error: {
              code: "confirmation_required",
              message: "Blender execution requires a fresh dry-run confirmation token."
            }
          });
        }

        const verified = context.confirmations.verifyAndConsume(input.confirmationToken, {
          sessionId: context.sessionId,
          tool: BLENDER_RUN_PYTHON_TOOL.name,
          input,
          target: confirmationTarget,
          riskLevel: "medium"
        });

        if (!verified.ok) {
          return toolFailure({
            tool: BLENDER_RUN_PYTHON_TOOL.name,
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
            adapterId: "blender",
            capabilityId: "blender.run_python",
            appId: "blender",
            input: toAdapterActionInput(input, outputDir)
          },
          {
            sessionId: context.sessionId,
            config: context.config,
            policy: context.policy,
            registry: context.registry
          }
        );
        return { ...result, confirmation: acceptedConfirmation(verified.tokenId, result.ok, "Blender confirmation accepted.") };
      }
    }
  ];
}
