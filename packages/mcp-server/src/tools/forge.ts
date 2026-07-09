import path from "node:path";
import {
  canApplySessionGrantsFromReview,
  createToolForgeArtifactRecord,
  createToolForgeReviewRecord,
  evaluateSafety,
  hashToolForgeManifest,
  proposeToolForgeGrants,
  reviewToolForgeManifest,
  summarizeGrant,
  summarizeToolForgeArtifact,
  summarizeToolForgeReview,
  toolFailure,
  toolSuccess,
  validateToolForgeManifest,
  type ActionPreviewResult,
  type CapabilityGrant,
  type ToolForgeApplySessionGrantsResult,
  type ToolForgeArchiveManifestResult,
  type ToolForgeArtifactRecord,
  type ToolForgeCreateReviewResult,
  type ToolForgeGetManifestResult,
  type ToolForgeGetReviewResult,
  type ToolForgeGrantProposalResult,
  type ToolForgeListManifestsResult,
  type ToolForgeListReviewsResult,
  type ToolForgeManifest,
  type ToolForgeReviewRecord,
  type ToolForgeReviewResult,
  type ToolForgeSaveManifestResult,
  type ToolForgeValidationResult,
  type ToolResult
} from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import { createSafetyEvaluationContext } from "../grants.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";
import {
  acceptedConfirmation,
  buildPreviewResult,
  confirmationRequired,
  missingConfirmationReason,
  rejectedConfirmation,
  toFilePreviewTarget
} from "./preview.js";

const forgeManifestInputSchema = z.union([z.string().max(200_000), z.record(z.unknown())]);
const optionalVersionSchema = z.string().trim().min(1).max(64).optional();
const optionalHashSchema = z.string().trim().regex(/^[a-f0-9]{64}$/).optional();
const optionalConfirmationSchema = z.string().trim().min(1).max(500).optional();

const validateReviewProposeInputSchema = z
  .object({
    manifest: forgeManifestInputSchema.optional(),
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

const saveManifestInputSchema = z
  .object({
    manifest: forgeManifestInputSchema,
    dryRun: z.boolean().optional(),
    confirmationToken: optionalConfirmationSchema
  })
  .strict();

const listManifestsInputSchema = z
  .object({
    manifestId: z.string().trim().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(500).optional()
  })
  .strict();

const getManifestInputSchema = z
  .object({
    manifestId: z.string().trim().min(1).max(200),
    version: optionalVersionSchema,
    manifestHash: optionalHashSchema
  })
  .strict();

const createReviewInputSchema = z
  .object({
    manifest: forgeManifestInputSchema.optional(),
    manifestId: z.string().trim().min(1).max(200).optional(),
    version: optionalVersionSchema,
    manifestHash: optionalHashSchema,
    explanation: z.string().trim().min(1).max(2000).optional(),
    dryRun: z.boolean().optional(),
    confirmationToken: optionalConfirmationSchema
  })
  .strict()
  .superRefine((input, refinementContext) => {
    const hasInlineManifest = input.manifest !== undefined;
    const hasStoredManifest = input.manifestId !== undefined;

    if (!hasInlineManifest && !hasStoredManifest) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either manifest or manifestId."
      });
    }

    if (hasInlineManifest && hasStoredManifest) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either manifest or manifestId, not both."
      });
    }
  });

const getReviewInputSchema = z
  .object({
    reviewId: z.string().trim().min(1).max(300)
  })
  .strict();

const listReviewsInputSchema = z
  .object({
    manifestId: z.string().trim().min(1).max(200).optional(),
    decisionStatus: z.enum(["pending", "approved_for_session", "approved_persistent", "denied", "expired"]).optional(),
    limit: z.number().int().min(1).max(500).optional()
  })
  .strict();

const archiveManifestInputSchema = z
  .object({
    manifestId: z.string().trim().min(1).max(200),
    version: optionalVersionSchema,
    manifestHash: optionalHashSchema,
    dryRun: z.boolean().optional(),
    confirmationToken: optionalConfirmationSchema
  })
  .strict();

const applySessionGrantsInputSchema = z
  .object({
    reviewId: z.string().trim().min(1).max(300),
    dryRun: z.boolean().optional(),
    confirmationToken: optionalConfirmationSchema
  })
  .strict();

type ValidateReviewProposeInput = z.infer<typeof validateReviewProposeInputSchema>;
type SaveManifestInput = z.infer<typeof saveManifestInputSchema>;
type ListManifestsInput = z.infer<typeof listManifestsInputSchema>;
type GetManifestInput = z.infer<typeof getManifestInputSchema>;
type CreateReviewInput = z.infer<typeof createReviewInputSchema>;
type GetReviewInput = z.infer<typeof getReviewInputSchema>;
type ListReviewsInput = z.infer<typeof listReviewsInputSchema>;
type ArchiveManifestInput = z.infer<typeof archiveManifestInputSchema>;
type ApplySessionGrantsInput = z.infer<typeof applySessionGrantsInputSchema>;

const validateReviewProposeMcpInputSchema = {
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

const saveManifestMcpInputSchema = {
  type: "object",
  properties: {
    manifest: {
      anyOf: [{ type: "string", maxLength: 200000 }, { type: "object" }]
    },
    dryRun: { type: "boolean" },
    confirmationToken: { type: "string", minLength: 1, maxLength: 500 }
  },
  required: ["manifest"],
  additionalProperties: false
};

const getManifestMcpInputSchema = {
  type: "object",
  properties: {
    manifestId: { type: "string", minLength: 1, maxLength: 200 },
    version: { type: "string", minLength: 1, maxLength: 64 },
    manifestHash: { type: "string", pattern: "^[a-f0-9]{64}$" }
  },
  required: ["manifestId"],
  additionalProperties: false
};

const createReviewMcpInputSchema = {
  type: "object",
  properties: {
    manifest: {
      anyOf: [{ type: "string", maxLength: 200000 }, { type: "object" }]
    },
    manifestId: { type: "string", minLength: 1, maxLength: 200 },
    version: { type: "string", minLength: 1, maxLength: 64 },
    manifestHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    explanation: { type: "string", minLength: 1, maxLength: 2000 },
    dryRun: { type: "boolean" },
    confirmationToken: { type: "string", minLength: 1, maxLength: 500 }
  },
  additionalProperties: false
};

const getReviewMcpInputSchema = {
  type: "object",
  properties: {
    reviewId: { type: "string", minLength: 1, maxLength: 300 }
  },
  required: ["reviewId"],
  additionalProperties: false
};

const listReviewsMcpInputSchema = {
  type: "object",
  properties: {
    manifestId: { type: "string", minLength: 1, maxLength: 200 },
    decisionStatus: {
      type: "string",
      enum: ["pending", "approved_for_session", "approved_persistent", "denied", "expired"]
    },
    limit: { type: "integer", minimum: 1, maximum: 500 }
  },
  additionalProperties: false
};

const archiveManifestMcpInputSchema = {
  type: "object",
  properties: {
    manifestId: { type: "string", minLength: 1, maxLength: 200 },
    version: { type: "string", minLength: 1, maxLength: 64 },
    manifestHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    dryRun: { type: "boolean" },
    confirmationToken: { type: "string", minLength: 1, maxLength: 500 }
  },
  required: ["manifestId"],
  additionalProperties: false
};

const applySessionGrantsMcpInputSchema = {
  type: "object",
  properties: {
    reviewId: { type: "string", minLength: 1, maxLength: 300 },
    dryRun: { type: "boolean" },
    confirmationToken: { type: "string", minLength: 1, maxLength: 500 }
  },
  required: ["reviewId"],
  additionalProperties: false
};

function isInsideOrEqual(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function previewReasons(primaryReason: string, safetyReasons: string[]): string[] {
  return safetyReasons.includes(primaryReason) ? safetyReasons : [primaryReason, ...safetyReasons];
}

async function resolveManifestInput(input: ValidateReviewProposeInput, context: AgentHostMcpContext): Promise<unknown> {
  if (input.manifest !== undefined) {
    return input.manifest;
  }

  const manifestFolder = path.resolve(context.forge.rootDir(), "manifests");
  const requestedPath = path.resolve(manifestFolder, input.manifestPath!);

  if (!isInsideOrEqual(requestedPath, manifestFolder)) {
    throw new Error("Manifest paths must stay inside the approved AgentHost forge/manifests folder.");
  }

  return context.forge.loadManifestByPath(requestedPath);
}

async function resolveStoredManifest(
  context: AgentHostMcpContext,
  input: { manifestId: string; version?: string; manifestHash?: string }
): Promise<{ artifact: ToolForgeArtifactRecord; manifest: ToolForgeManifest }> {
  const artifact = await context.forge.findArtifact(input);

  if (artifact === undefined) {
    throw new Error("Stored manifest artifact was not found.");
  }

  const manifest = await context.forge.loadManifestByPath(artifact.storagePath);
  return { artifact, manifest };
}

function saveManifestPreviewTarget(manifest: ToolForgeManifest, manifestHash: string, context: AgentHostMcpContext) {
  const manifestPath = context.forge.manifestPath(manifest, manifestHash);
  return {
    path: manifestPath,
    summary: `Save inert manifest ${manifest.id}@${manifest.version} (${manifestHash.slice(0, 12)})`
  };
}

function createArtifactStatus(review: ToolForgeReviewResult): ToolForgeArtifactRecord["status"] {
  if (!review.valid || review.blockedReasons.length > 0) {
    return "rejected";
  }

  if (review.missingGrants.length > 0) {
    return "grant_pending";
  }

  return "reviewed";
}

function cloneReviewWithStatus(review: ToolForgeReviewRecord, decisionStatus: ToolForgeReviewRecord["decisionStatus"]): ToolForgeReviewRecord {
  return {
    ...review,
    decisionStatus,
    proposedGrants: review.proposedGrants.map((grant) => ({
      ...grant,
      match: { ...grant.match },
      ...(grant.requirements === undefined ? {} : { requirements: { ...grant.requirements } })
    })),
    review: {
      ...review.review,
      requestedCapabilities: review.review.requestedCapabilities.map((capability) => ({
        ...capability,
        reasons: [...capability.reasons],
        matchedGrantIds: [...capability.matchedGrantIds],
        ...(capability.proposedGrant === undefined
          ? {}
          : {
              proposedGrant: {
                ...capability.proposedGrant,
                match: { ...capability.proposedGrant.match },
                ...(capability.proposedGrant.requirements === undefined
                  ? {}
                  : { requirements: { ...capability.proposedGrant.requirements } })
              }
            })
      })),
      dangerousPermissions: [...review.review.dangerousPermissions],
      missingGrants: [...review.review.missingGrants],
      matchedGrantIds: [...review.review.matchedGrantIds],
      blockedReasons: [...review.review.blockedReasons],
      warnings: [...review.review.warnings],
      saferAlternatives: [...review.review.saferAlternatives]
    }
  };
}

function summarizeAppliedGrants(grants: CapabilityGrant[]) {
  return grants.map((grant) => summarizeGrant(grant));
}

function toGrantApplicationTarget(review: ToolForgeReviewRecord): { reviewId: string; manifestHash: string; grantIds: string[] } {
  return {
    reviewId: review.reviewId,
    manifestHash: review.manifestHash,
    grantIds: review.proposedGrants.map((grant) => grant.id).sort()
  };
}

export function createForgeTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const validateManifest: AgentHostToolDefinition<
    ValidateReviewProposeInput,
    ToolForgeValidationResult,
    AgentHostMcpContext
  > = {
    name: "forge.validate_manifest",
    description: "Validates a Tool Forge manifest for future generated tools, adapters, skills, or workflows.",
    riskLevel: "low",
    inputSchema: validateReviewProposeInputSchema,
    mcpInputSchema: validateReviewProposeMcpInputSchema,
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

  const reviewManifest: AgentHostToolDefinition<
    ValidateReviewProposeInput,
    ToolForgeReviewResult,
    AgentHostMcpContext
  > = {
    name: "forge.review_manifest",
    description: "Reviews a Tool Forge manifest against the active profile and grants without applying anything.",
    riskLevel: "low",
    inputSchema: validateReviewProposeInputSchema,
    mcpInputSchema: validateReviewProposeMcpInputSchema,
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

  const proposeGrants: AgentHostToolDefinition<
    ValidateReviewProposeInput,
    ToolForgeGrantProposalResult,
    AgentHostMcpContext
  > = {
    name: "forge.propose_grants",
    description: "Maps a Tool Forge manifest to proposed grants without saving or applying them.",
    riskLevel: "low",
    inputSchema: validateReviewProposeInputSchema,
    mcpInputSchema: validateReviewProposeMcpInputSchema,
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

  const saveManifest: AgentHostToolDefinition<
    SaveManifestInput,
    ToolForgeSaveManifestResult | ActionPreviewResult,
    AgentHostMcpContext
  > = {
    name: "forge.save_manifest",
    description: "Validates and stores an inert Tool Forge manifest plus artifact record under AgentHost home.",
    riskLevel: "medium",
    inputSchema: saveManifestInputSchema,
    mcpInputSchema: saveManifestMcpInputSchema,
    inputSummary: "Save Forge manifest",
    safety: {
      actionType: "file_write"
    },
    preview: {
      isDryRun: (input) => input.dryRun === true
    },
    async handler(input, context, runtime): Promise<ToolResult<ToolForgeSaveManifestResult | ActionPreviewResult>> {
      const validation = validateToolForgeManifest(input.manifest);

      if (!validation.valid || validation.manifest === undefined) {
        return toolFailure({
          tool: "forge.save_manifest",
          riskLevel: "medium",
          error: {
            code: "invalid_manifest",
            message: "Manifest must validate before it can be saved.",
            details: validation
          },
          observations: ["Rejected the save because the manifest is invalid."]
        });
      }

      const manifest = validation.manifest;
      const manifestHash = hashToolForgeManifest(manifest);
      const previewTarget = saveManifestPreviewTarget(manifest, manifestHash, context);
      const safetyDecision =
        runtime?.safetyDecision ??
        evaluateSafety(
          {
            tool: "forge.save_manifest",
            actionType: "file_write",
            filePath: previewTarget.path
          },
          context.policy,
          createSafetyEvaluationContext(context)
        );

      if (runtime?.isDryRun) {
        return buildPreviewResult({
          tool: "forge.save_manifest",
          riskLevel: "medium",
          safety: safetyDecision,
          targetSummary: previewTarget.summary,
          target: toFilePreviewTarget(previewTarget.path, previewTarget.summary),
          confirmation: {
            manager: context.confirmations,
            sessionId: context.sessionId,
            input,
            target: { manifestId: manifest.id, manifestHash, path: previewTarget.path },
            explanation: "Use this token to save the exact previewed inert manifest before it expires.",
            riskLevel: safetyDecision.riskLevel,
            appSensitivity: safetyDecision.appSensitivity
          },
          reasons: previewReasons("Validated the manifest and storage path without writing files.", safetyDecision.reasons),
          observations: ["Previewed manifest save without writing the manifest or artifact record."]
        });
      }

      if (input.confirmationToken === undefined) {
        const { code, reason } = missingConfirmationReason(safetyDecision);
        return toolFailure({
          tool: "forge.save_manifest",
          riskLevel: safetyDecision.riskLevel,
          confirmation: confirmationRequired(reason),
          error: {
            code,
            message: reason
          },
          observations: [reason]
        });
      }

      const verification = context.confirmations.verifyAndConsume(input.confirmationToken, {
        sessionId: context.sessionId,
        tool: "forge.save_manifest",
        input,
        target: { manifestId: manifest.id, manifestHash, path: previewTarget.path },
        riskLevel: safetyDecision.riskLevel
      });

      if (!verification.ok) {
        return toolFailure({
          tool: "forge.save_manifest",
          riskLevel: safetyDecision.riskLevel,
          confirmation: rejectedConfirmation(verification.tokenId, verification.reason),
          error: {
            code: "confirmation_rejected",
            message: verification.reason
          },
          observations: [verification.reason]
        });
      }

      const storagePath = await context.forge.saveManifest(manifest, manifestHash);
      const existingArtifact = await context.forge.findArtifact({
        manifestId: manifest.id,
        version: manifest.version,
        manifestHash
      });
      const artifact = createToolForgeArtifactRecord({
        manifest,
        manifestHash,
        storagePath,
        status: "validated",
        ...(existingArtifact === undefined ? {} : { existing: existingArtifact })
      });
      await context.forge.saveArtifact(artifact);

      return toolSuccess({
        tool: "forge.save_manifest",
        riskLevel: "medium",
        confirmation: acceptedConfirmation(
          verification.tokenId,
          true,
          "Confirmation token accepted and inert manifest storage executed."
        ),
        data: {
          manifest,
          manifestHash,
          storagePath,
          artifact
        },
        observations: ["Saved an inert manifest and artifact record without executing or registering anything."]
      });
    }
  };

  const listManifests: AgentHostToolDefinition<ListManifestsInput, ToolForgeListManifestsResult, AgentHostMcpContext> = {
    name: "forge.list_manifests",
    description: "Lists stored Tool Forge manifests and inert artifact summaries.",
    riskLevel: "low",
    inputSchema: listManifestsInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        manifestId: { type: "string", minLength: 1, maxLength: 200 },
        limit: { type: "integer", minimum: 1, maximum: 500 }
      },
      additionalProperties: false
    },
    inputSummary: "List Forge manifests",
    safety: {
      actionType: "observe"
    },
    async handler(input, context): Promise<ToolResult<ToolForgeListManifestsResult>> {
      const artifacts = await context.forge.listArtifacts();
      const filtered = artifacts
        .filter((artifact) => input.manifestId === undefined || artifact.manifestId === input.manifestId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, input.limit ?? 100)
        .map((artifact) => summarizeToolForgeArtifact(artifact));

      return toolSuccess({
        tool: "forge.list_manifests",
        riskLevel: "low",
        data: {
          manifests: filtered
        },
        observations: ["Listed stored inert Forge manifests."]
      });
    }
  };

  const getManifest: AgentHostToolDefinition<GetManifestInput, ToolForgeGetManifestResult, AgentHostMcpContext> = {
    name: "forge.get_manifest",
    description: "Returns a stored Tool Forge manifest and its inert artifact record.",
    riskLevel: "low",
    inputSchema: getManifestInputSchema,
    mcpInputSchema: getManifestMcpInputSchema,
    inputSummary: "Get Forge manifest",
    safety: {
      actionType: "observe"
    },
    async handler(input, context): Promise<ToolResult<ToolForgeGetManifestResult>> {
      try {
        const { artifact, manifest } = await resolveStoredManifest(context, {
          manifestId: input.manifestId,
          ...(input.version === undefined ? {} : { version: input.version }),
          ...(input.manifestHash === undefined ? {} : { manifestHash: input.manifestHash })
        });
        return toolSuccess({
          tool: "forge.get_manifest",
          riskLevel: "low",
          data: {
            manifest,
            manifestHash: artifact.manifestHash,
            storagePath: artifact.storagePath,
            artifact
          },
          observations: ["Returned one stored inert Forge manifest."]
        });
      } catch (error) {
        return toolFailure({
          tool: "forge.get_manifest",
          riskLevel: "low",
          error: {
            code: "manifest_not_found",
            message: error instanceof Error ? error.message : "Stored manifest was not found."
          },
          observations: ["No stored manifest matched the requested identity."]
        });
      }
    }
  };

  const createReview: AgentHostToolDefinition<
    CreateReviewInput,
    ToolForgeCreateReviewResult | ActionPreviewResult,
    AgentHostMcpContext
  > = {
    name: "forge.create_review",
    description: "Creates and stores a Tool Forge review record bound to an exact manifest hash.",
    riskLevel: "medium",
    inputSchema: createReviewInputSchema,
    mcpInputSchema: createReviewMcpInputSchema,
    inputSummary: "Create Forge review",
    safety: {
      actionType: "file_write"
    },
    preview: {
      isDryRun: (input) => input.dryRun === true
    },
    async handler(input, context, runtime): Promise<ToolResult<ToolForgeCreateReviewResult | ActionPreviewResult>> {
      let artifact: ToolForgeArtifactRecord | undefined;
      let manifest: ToolForgeManifest;

      if (input.manifest !== undefined) {
        const validation = validateToolForgeManifest(input.manifest);
        if (!validation.valid || validation.manifest === undefined) {
          return toolFailure({
            tool: "forge.create_review",
            riskLevel: "medium",
            error: {
              code: "invalid_manifest",
              message: "Manifest must validate before a review can be created.",
              details: validation
            },
            observations: ["Rejected review creation because the manifest is invalid."]
          });
        }
        manifest = validation.manifest;
      } else {
        try {
          const resolved = await resolveStoredManifest(context, {
            manifestId: input.manifestId!,
            ...(input.version === undefined ? {} : { version: input.version }),
            ...(input.manifestHash === undefined ? {} : { manifestHash: input.manifestHash })
          });
          artifact = resolved.artifact;
          manifest = resolved.manifest;
        } catch (error) {
          return toolFailure({
            tool: "forge.create_review",
            riskLevel: "medium",
            error: {
              code: "manifest_not_found",
              message: error instanceof Error ? error.message : "Stored manifest was not found."
            },
            observations: ["No stored manifest matched the requested identity for review creation."]
          });
        }
      }

      const manifestHash = hashToolForgeManifest(manifest);
      const reviewPath = context.forge.reviewPath(`review.${manifest.id}.${manifest.version}.${manifestHash.slice(0, 12)}`);
      const safetyDecision =
        runtime?.safetyDecision ??
        evaluateSafety(
          {
            tool: "forge.create_review",
            actionType: "file_write",
            filePath: reviewPath
          },
          context.policy,
          createSafetyEvaluationContext(context)
        );
      const review = reviewToolForgeManifest(manifest, {
        policy: context.policy,
        grants: context.grants.listActiveGrants(),
        scope: "session"
      });
      const validation = validateToolForgeManifest(manifest);
      const proposals = proposeToolForgeGrants(manifest, { scope: "session" });
      const reviewRecord = createToolForgeReviewRecord({
        manifest,
        manifestHash,
        profile: context.policy.name,
        review,
        proposals,
        blockedPermissions: validation.blockedPermissions,
        ...(input.explanation === undefined ? {} : { explanation: input.explanation })
      });

      if (runtime?.isDryRun) {
        return buildPreviewResult({
          tool: "forge.create_review",
          riskLevel: "medium",
          safety: safetyDecision,
          targetSummary: `Create review ${reviewRecord.reviewId} for ${manifest.id}@${manifest.version}`,
          target: toFilePreviewTarget(reviewPath, `Store review ${reviewRecord.reviewId}`),
          confirmation: {
            manager: context.confirmations,
            sessionId: context.sessionId,
            input,
            target: { reviewId: reviewRecord.reviewId, manifestHash },
            explanation: "Use this token to store the exact previewed review record before it expires.",
            riskLevel: safetyDecision.riskLevel,
            appSensitivity: safetyDecision.appSensitivity
          },
          reasons: previewReasons("Prepared a review record without writing it to disk.", safetyDecision.reasons),
          observations: ["Previewed review creation without storing any review or proposal record."]
        });
      }

      if (input.confirmationToken === undefined) {
        const { code, reason } = missingConfirmationReason(safetyDecision);
        return toolFailure({
          tool: "forge.create_review",
          riskLevel: safetyDecision.riskLevel,
          confirmation: confirmationRequired(reason),
          error: {
            code,
            message: reason
          },
          observations: [reason]
        });
      }

      const verification = context.confirmations.verifyAndConsume(input.confirmationToken, {
        sessionId: context.sessionId,
        tool: "forge.create_review",
        input,
        target: { reviewId: reviewRecord.reviewId, manifestHash },
        riskLevel: safetyDecision.riskLevel
      });

      if (!verification.ok) {
        return toolFailure({
          tool: "forge.create_review",
          riskLevel: safetyDecision.riskLevel,
          confirmation: rejectedConfirmation(verification.tokenId, verification.reason),
          error: {
            code: "confirmation_rejected",
            message: verification.reason
          },
          observations: [verification.reason]
        });
      }

      await context.forge.saveReview(reviewRecord);
      await context.forge.saveProposalRecord({
        reviewId: reviewRecord.reviewId,
        manifestId: reviewRecord.manifestId,
        manifestVersion: reviewRecord.manifestVersion,
        manifestHash: reviewRecord.manifestHash,
        createdAt: reviewRecord.timestamp,
        grants: reviewRecord.proposedGrants
      });

      if (artifact !== undefined) {
        const updatedArtifact = createToolForgeArtifactRecord({
          manifest,
          manifestHash,
          storagePath: artifact.storagePath,
          status: createArtifactStatus(review),
          existing: artifact
        });
        await context.forge.saveArtifact(updatedArtifact);
      }

      return toolSuccess({
        tool: "forge.create_review",
        riskLevel: "medium",
        confirmation: acceptedConfirmation(
          verification.tokenId,
          true,
          "Confirmation token accepted and review storage executed."
        ),
        data: {
          review: reviewRecord
        },
        observations: ["Stored a review record bound to the exact manifest hash without applying grants."]
      });
    }
  };

  const getReview: AgentHostToolDefinition<GetReviewInput, ToolForgeGetReviewResult, AgentHostMcpContext> = {
    name: "forge.get_review",
    description: "Returns one stored Tool Forge review record.",
    riskLevel: "low",
    inputSchema: getReviewInputSchema,
    mcpInputSchema: getReviewMcpInputSchema,
    inputSummary: "Get Forge review",
    safety: {
      actionType: "observe"
    },
    async handler(input, context): Promise<ToolResult<ToolForgeGetReviewResult>> {
      try {
        const review = await context.forge.loadReview(input.reviewId);
        return toolSuccess({
          tool: "forge.get_review",
          riskLevel: "low",
          data: { review },
          observations: ["Returned one stored Forge review record."]
        });
      } catch (error) {
        return toolFailure({
          tool: "forge.get_review",
          riskLevel: "low",
          error: {
            code: "review_not_found",
            message: error instanceof Error ? error.message : "Stored review was not found."
          },
          observations: ["No stored review matched the requested review id."]
        });
      }
    }
  };

  const listReviews: AgentHostToolDefinition<ListReviewsInput, ToolForgeListReviewsResult, AgentHostMcpContext> = {
    name: "forge.list_reviews",
    description: "Lists stored Tool Forge review summaries.",
    riskLevel: "low",
    inputSchema: listReviewsInputSchema,
    mcpInputSchema: listReviewsMcpInputSchema,
    inputSummary: "List Forge reviews",
    safety: {
      actionType: "observe"
    },
    async handler(input, context): Promise<ToolResult<ToolForgeListReviewsResult>> {
      const summaries = (await context.forge.listReviews())
        .filter((review) => input.manifestId === undefined || review.manifestId === input.manifestId)
        .filter((review) => input.decisionStatus === undefined || review.decisionStatus === input.decisionStatus)
        .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
        .slice(0, input.limit ?? 100)
        .map((review) => summarizeToolForgeReview(review));

      return toolSuccess({
        tool: "forge.list_reviews",
        riskLevel: "low",
        data: { reviews: summaries },
        observations: ["Listed stored Forge review summaries."]
      });
    }
  };

  const archiveManifest: AgentHostToolDefinition<
    ArchiveManifestInput,
    ToolForgeArchiveManifestResult | ActionPreviewResult,
    AgentHostMcpContext
  > = {
    name: "forge.archive_manifest",
    description: "Marks an inert Tool Forge artifact as archived without deleting stored files.",
    riskLevel: "medium",
    inputSchema: archiveManifestInputSchema,
    mcpInputSchema: archiveManifestMcpInputSchema,
    inputSummary: "Archive Forge manifest",
    safety: {
      actionType: "file_write"
    },
    preview: {
      isDryRun: (input) => input.dryRun === true
    },
    async handler(input, context, runtime): Promise<ToolResult<ToolForgeArchiveManifestResult | ActionPreviewResult>> {
      let artifact: ToolForgeArtifactRecord;

      try {
        const resolved = await resolveStoredManifest(context, {
          manifestId: input.manifestId,
          ...(input.version === undefined ? {} : { version: input.version }),
          ...(input.manifestHash === undefined ? {} : { manifestHash: input.manifestHash })
        });
        artifact = resolved.artifact;
      } catch (error) {
        return toolFailure({
          tool: "forge.archive_manifest",
          riskLevel: "medium",
          error: {
            code: "manifest_not_found",
            message: error instanceof Error ? error.message : "Stored manifest artifact was not found."
          },
          observations: ["No stored manifest artifact matched the requested identity."]
        });
      }

      const safetyDecision =
        runtime?.safetyDecision ??
        evaluateSafety(
          {
            tool: "forge.archive_manifest",
            actionType: "file_write",
            filePath: context.forge.artifactPath(artifact.artifactId)
          },
          context.policy,
          createSafetyEvaluationContext(context)
        );

      if (runtime?.isDryRun) {
        return buildPreviewResult({
          tool: "forge.archive_manifest",
          riskLevel: "medium",
          safety: safetyDecision,
          targetSummary: `Archive inert manifest ${artifact.manifestId}@${artifact.manifestVersion}`,
          target: toFilePreviewTarget(
            context.forge.artifactPath(artifact.artifactId),
            `Archive artifact ${artifact.artifactId}`
          ),
          confirmation: {
            manager: context.confirmations,
            sessionId: context.sessionId,
            input,
            target: { artifactId: artifact.artifactId, manifestHash: artifact.manifestHash },
            explanation: "Use this token to archive the exact previewed inert artifact before it expires.",
            riskLevel: safetyDecision.riskLevel,
            appSensitivity: safetyDecision.appSensitivity
          },
          reasons: previewReasons("Would mark the artifact archived without deleting files.", safetyDecision.reasons),
          observations: ["Previewed artifact archival without updating stored records."]
        });
      }

      if (input.confirmationToken === undefined) {
        const { code, reason } = missingConfirmationReason(safetyDecision);
        return toolFailure({
          tool: "forge.archive_manifest",
          riskLevel: safetyDecision.riskLevel,
          confirmation: confirmationRequired(reason),
          error: {
            code,
            message: reason
          },
          observations: [reason]
        });
      }

      const verification = context.confirmations.verifyAndConsume(input.confirmationToken, {
        sessionId: context.sessionId,
        tool: "forge.archive_manifest",
        input,
        target: { artifactId: artifact.artifactId, manifestHash: artifact.manifestHash },
        riskLevel: safetyDecision.riskLevel
      });

      if (!verification.ok) {
        return toolFailure({
          tool: "forge.archive_manifest",
          riskLevel: safetyDecision.riskLevel,
          confirmation: rejectedConfirmation(verification.tokenId, verification.reason),
          error: {
            code: "confirmation_rejected",
            message: verification.reason
          },
          observations: [verification.reason]
        });
      }

      const archivedArtifact: ToolForgeArtifactRecord = {
        ...artifact,
        status: "archived",
        updatedAt: new Date().toISOString()
      };
      await context.forge.saveArtifact(archivedArtifact);

      return toolSuccess({
        tool: "forge.archive_manifest",
        riskLevel: "medium",
        confirmation: acceptedConfirmation(
          verification.tokenId,
          true,
          "Confirmation token accepted and artifact archival executed."
        ),
        data: {
          artifact: archivedArtifact
        },
        observations: ["Archived the inert artifact without deleting stored files."]
      });
    }
  };

  const applySessionGrants: AgentHostToolDefinition<
    ApplySessionGrantsInput,
    ToolForgeApplySessionGrantsResult | ActionPreviewResult,
    AgentHostMcpContext
  > = {
    name: "forge.apply_session_grants_from_review",
    description: "Applies eligible session-only grants from a reviewed inert Tool Forge artifact.",
    riskLevel: "medium",
    inputSchema: applySessionGrantsInputSchema,
    mcpInputSchema: applySessionGrantsMcpInputSchema,
    inputSummary: "Apply session grants from Forge review",
    safety: {
      actionType: "file_write"
    },
    preview: {
      isDryRun: (input) => input.dryRun === true
    },
    async handler(input, context, runtime): Promise<ToolResult<ToolForgeApplySessionGrantsResult | ActionPreviewResult>> {
      let reviewRecord: ToolForgeReviewRecord;

      try {
        reviewRecord = await context.forge.loadReview(input.reviewId);
      } catch (error) {
        return toolFailure({
          tool: "forge.apply_session_grants_from_review",
          riskLevel: "medium",
          error: {
            code: "review_not_found",
            message: error instanceof Error ? error.message : "Stored review was not found."
          },
          observations: ["No stored review matched the requested review id."]
        });
      }

      let artifact: ToolForgeArtifactRecord;
      let manifest: ToolForgeManifest;
      try {
        const resolved = await resolveStoredManifest(context, {
          manifestId: reviewRecord.manifestId,
          version: reviewRecord.manifestVersion,
          manifestHash: reviewRecord.manifestHash
        });
        artifact = resolved.artifact;
        manifest = resolved.manifest;
      } catch (error) {
        return toolFailure({
          tool: "forge.apply_session_grants_from_review",
          riskLevel: "medium",
          error: {
            code: "artifact_not_found",
            message: error instanceof Error ? error.message : "Stored artifact for the review was not found."
          },
          observations: ["The review does not point to a stored inert artifact that still exists."]
        });
      }

      const manifestHash = hashToolForgeManifest(manifest);
      if (manifestHash !== reviewRecord.manifestHash) {
        return toolFailure({
          tool: "forge.apply_session_grants_from_review",
          riskLevel: "medium",
          error: {
            code: "manifest_hash_mismatch",
            message: "Stored manifest content changed, so the review can no longer apply."
          },
          observations: ["The stored manifest hash no longer matches the review."]
        });
      }

      const eligibility = canApplySessionGrantsFromReview(reviewRecord);
      if (!eligibility.ok) {
        return toolFailure({
          tool: "forge.apply_session_grants_from_review",
          riskLevel: "medium",
          error: {
            code: "review_not_applicable",
            message: eligibility.reasons.join(" ")
          },
          observations: eligibility.reasons
        });
      }

      const safetyDecision =
        runtime?.safetyDecision ??
        evaluateSafety(
          {
            tool: "forge.apply_session_grants_from_review",
            actionType: "file_write",
            filePath: context.forge.proposalPath(reviewRecord.reviewId),
            generatedTool: true,
            generatedToolId: reviewRecord.manifestId
          },
          context.policy,
          createSafetyEvaluationContext(context)
        );
      const eligibleGrants = reviewRecord.proposedGrants.filter((grant) => eligibility.safeGrantIds.includes(grant.id));
      const target = toGrantApplicationTarget(reviewRecord);
      const targetSummary = `Apply ${eligibleGrants.length} session grant${eligibleGrants.length === 1 ? "" : "s"} from ${reviewRecord.reviewId}`;

      if (runtime?.isDryRun) {
        return buildPreviewResult({
          tool: "forge.apply_session_grants_from_review",
          riskLevel: "medium",
          safety: safetyDecision,
          targetSummary,
          target: toFilePreviewTarget(context.forge.reviewPath(reviewRecord.reviewId), targetSummary),
          confirmation: {
            manager: context.confirmations,
            sessionId: context.sessionId,
            input,
            target,
            explanation: "Use this token to apply the exact previewed session grants before it expires.",
            riskLevel: safetyDecision.riskLevel,
            appSensitivity: safetyDecision.appSensitivity
          },
          reasons: previewReasons("Would apply eligible session grants without touching persistent config.", safetyDecision.reasons),
          observations: ["Previewed session grant application without mutating the active grant store."]
        });
      }

      if (input.confirmationToken === undefined) {
        const { code, reason } = missingConfirmationReason(safetyDecision);
        return toolFailure({
          tool: "forge.apply_session_grants_from_review",
          riskLevel: safetyDecision.riskLevel,
          confirmation: confirmationRequired(reason),
          error: {
            code,
            message: reason
          },
          observations: [reason]
        });
      }

      const verification = context.confirmations.verifyAndConsume(input.confirmationToken, {
        sessionId: context.sessionId,
        tool: "forge.apply_session_grants_from_review",
        input,
        target,
        riskLevel: safetyDecision.riskLevel
      });

      if (!verification.ok) {
        return toolFailure({
          tool: "forge.apply_session_grants_from_review",
          riskLevel: safetyDecision.riskLevel,
          confirmation: rejectedConfirmation(verification.tokenId, verification.reason),
          error: {
            code: "confirmation_rejected",
            message: verification.reason
          },
          observations: [verification.reason]
        });
      }

      context.grants.addSessionGrants(eligibleGrants);
      const updatedReview = cloneReviewWithStatus(reviewRecord, "approved_for_session");
      const updatedArtifact: ToolForgeArtifactRecord = {
        ...artifact,
        status: "approved_inert",
        updatedAt: new Date().toISOString()
      };
      await context.forge.saveReview(updatedReview);
      await context.forge.saveArtifact(updatedArtifact);
      await context.forge.saveProposalRecord({
        reviewId: updatedReview.reviewId,
        manifestId: updatedReview.manifestId,
        manifestVersion: updatedReview.manifestVersion,
        manifestHash: updatedReview.manifestHash,
        createdAt: new Date().toISOString(),
        grants: eligibleGrants
      });

      return toolSuccess({
        tool: "forge.apply_session_grants_from_review",
        riskLevel: "medium",
        confirmation: acceptedConfirmation(
          verification.tokenId,
          true,
          "Confirmation token accepted and session grant application executed."
        ),
        data: {
          reviewId: updatedReview.reviewId,
          manifestId: updatedReview.manifestId,
          manifestHash: updatedReview.manifestHash,
          appliedGrantIds: eligibleGrants.map((grant) => grant.id),
          grants: summarizeAppliedGrants(eligibleGrants)
        },
        observations: ["Applied eligible session-only grants from the reviewed inert artifact."]
      });
    }
  };

  return [
    validateManifest,
    reviewManifest,
    proposeGrants,
    saveManifest,
    listManifests,
    getManifest,
    createReview,
    getReview,
    listReviews,
    archiveManifest,
    applySessionGrants
  ];
}
