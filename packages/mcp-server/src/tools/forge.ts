import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  proposeToolForgeGrants,
  reviewToolForgeManifest,
  toolFailure,
  toolSuccess,
  validateToolForgeManifest,
  type ToolForgeGrantProposalResult,
  type ToolForgeReviewResult,
  type ToolForgeValidationResult,
  type ToolResult
} from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";

const forgeInputSchema = z
  .object({
    manifest: z.union([z.string().max(200_000), z.record(z.unknown())]).optional(),
    manifestPath: z.string().trim().min(1).max(1000).optional(),
    scope: z.enum(["session", "persistent"]).optional(),
    expiresAt: z.string().datetime().optional()
  })
  .strict()
  .superRefine((input, refinementContext) => {
    if (input.manifest === undefined && input.manifestPath === undefined) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either manifest or manifestPath."
      });
    }

    if (input.manifest !== undefined && input.manifestPath !== undefined) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either manifest or manifestPath, not both."
      });
    }
  });

type ForgeToolInput = z.infer<typeof forgeInputSchema>;

const baseMcpInputSchema = {
  type: "object",
  properties: {
    manifest: {
      anyOf: [{ type: "string", maxLength: 200000 }, { type: "object" }]
    },
    manifestPath: { type: "string", minLength: 1, maxLength: 1000 },
    scope: { type: "string", enum: ["session", "persistent"] },
    expiresAt: { type: "string", format: "date-time" }
  },
  additionalProperties: false
};

function getManifestFolder(context: AgentHostMcpContext): string {
  return path.resolve(context.config.agentHostDir, "forge", "manifests");
}

function isInsideOrEqual(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function resolveManifestInput(input: ForgeToolInput, context: AgentHostMcpContext): Promise<unknown> {
  if (input.manifest !== undefined) {
    return input.manifest;
  }

  const manifestFolder = getManifestFolder(context);
  const requestedPath = path.resolve(manifestFolder, input.manifestPath!);

  if (!isInsideOrEqual(requestedPath, manifestFolder)) {
    throw new Error("Manifest paths must stay inside the approved AgentHost forge/manifests folder.");
  }

  const raw = await readFile(requestedPath, "utf8");
  return raw;
}

export function createForgeTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const validateManifest: AgentHostToolDefinition<ForgeToolInput, ToolForgeValidationResult, AgentHostMcpContext> = {
    name: "forge.validate_manifest",
    description: "Validates a Tool Forge manifest for future generated tools, adapters, skills, or workflows.",
    riskLevel: "low",
    inputSchema: forgeInputSchema,
    mcpInputSchema: baseMcpInputSchema,
    inputSummary: "Validate Tool Forge manifest",
    safety: {
      actionType: "inspect"
    },
    async handler(input, context): Promise<ToolResult<ToolForgeValidationResult>> {
      const manifestInput = await resolveManifestInput(input, context);
      const validation = validateToolForgeManifest(manifestInput);

      return toolSuccess({
        tool: "forge.validate_manifest",
        riskLevel: "low",
        data: validation,
        observations: [
          validation.valid
            ? "Validated the manifest without executing, saving, or registering any generated tool."
            : "Rejected the manifest before any generated capability could be used."
        ]
      });
    }
  };

  const reviewManifest: AgentHostToolDefinition<ForgeToolInput, ToolForgeReviewResult, AgentHostMcpContext> = {
    name: "forge.review_manifest",
    description: "Reviews a Tool Forge manifest against the active profile and grants without applying anything.",
    riskLevel: "low",
    inputSchema: forgeInputSchema,
    mcpInputSchema: baseMcpInputSchema,
    inputSummary: "Review Tool Forge manifest",
    safety: {
      actionType: "inspect"
    },
    async handler(input, context): Promise<ToolResult<ToolForgeReviewResult>> {
      const manifestInput = await resolveManifestInput(input, context);
      const review = reviewToolForgeManifest(manifestInput, {
        policy: context.policy,
        grants: context.grants.listActiveGrants(),
        ...(input.scope === undefined ? {} : { scope: input.scope }),
        ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt })
      });

      return toolSuccess({
        tool: "forge.review_manifest",
        riskLevel: "low",
        data: review,
        observations: [
          review.valid
            ? "Reviewed the manifest against the active profile and grants without applying permissions."
            : "Returned validation and review blockers before any generated capability could be enabled."
        ]
      });
    }
  };

  const proposeGrants: AgentHostToolDefinition<ForgeToolInput, ToolForgeGrantProposalResult, AgentHostMcpContext> = {
    name: "forge.propose_grants",
    description: "Maps a Tool Forge manifest to proposed grants without saving or applying them.",
    riskLevel: "low",
    inputSchema: forgeInputSchema,
    mcpInputSchema: baseMcpInputSchema,
    inputSummary: "Propose grants for Tool Forge manifest",
    safety: {
      actionType: "inspect"
    },
    async handler(input, context): Promise<ToolResult<ToolForgeGrantProposalResult>> {
      const manifestInput = await resolveManifestInput(input, context);
      const validation = validateToolForgeManifest(manifestInput);

      if (!validation.valid) {
        return toolFailure({
          tool: "forge.propose_grants",
          riskLevel: "low",
          error: {
            code: "invalid_manifest",
            message: "Grant proposals require a valid Tool Forge manifest.",
            details: validation
          },
          observations: ["Rejected grant proposal generation because the manifest is invalid."]
        });
      }

      const proposals = proposeToolForgeGrants(manifestInput, {
        ...(input.scope === undefined ? {} : { scope: input.scope }),
        ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt })
      });

      return toolSuccess({
        tool: "forge.propose_grants",
        riskLevel: "low",
        data: proposals,
        observations: ["Proposed grants only. Nothing was saved, applied, or registered."]
      });
    }
  };

  return [validateManifest, reviewManifest, proposeGrants];
}
