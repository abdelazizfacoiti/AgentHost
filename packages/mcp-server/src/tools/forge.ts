import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import {
  canApplySessionGrantsFromReview,
  createToolForgeArtifactRecord,
  createToolForgeHarnessRunRecord,
  createToolForgeRuntimeRunRecord,
  createToolForgeRegistrationRecord,
  createToolForgeReviewRecord,
  createToolForgeValidationRecord,
  evaluateSafety,
  evaluateRuntimeGrantCoverage,
  hashToolForgeManifest,
  proposeToolForgeGrants,
  reviewToolForgeManifest,
  summarizeGrant,
  summarizeToolForgeArtifact,
  summarizeToolForgeArtifactRecord,
  summarizeToolForgeHarnessRun,
  summarizeToolForgeRuntimeRun,
  summarizeToolForgeRegistration,
  summarizeToolForgeReview,
  summarizeToolForgeValidation,
  toolFailure,
  toolSuccess,
  validateToolForgeManifest,
  type ActionPreviewResult,
  type CapabilityGrant,
  type ToolForgeApplySessionGrantsResult,
  type ToolForgeArchiveManifestResult,
  type ToolForgeArtifactRecord,
  type ToolForgeGetArtifactResult,
  type ToolForgeCreateReviewResult,
  type ToolForgeGetHarnessRunResult,
  type ToolForgeGetManifestResult,
  type ToolForgeGetRegistrationResult,
  type ToolForgeGetReviewResult,
  type ToolForgeGetRuntimeRunResult,
  type ToolForgeGetValidationResult,
  type ToolForgeCheckRuntimeEligibilityResult,
  type ToolForgeGrantProposalResult,
  type ToolForgeListArtifactsResult,
  type ToolForgeListHarnessRunsResult,
  type ToolForgeListManifestsResult,
  type ToolForgeListRegistrationsResult,
  type ToolForgeListReviewsResult,
  type ToolForgeListRuntimeRunsResult,
  type ToolForgeListValidationsResult,
  type ToolForgeHarnessMode,
  type ToolForgeHarnessRunRecord,
  type ToolForgeManifest,
  type ToolForgeRuntimeEligibilityResult,
  type ToolForgeRuntimeRunRecord,
  type ToolForgeRegistrationEligibilityResult,
  type ToolForgeRegistrationRecord,
  type ToolForgeProjectFilePlanEntry,
  type ToolForgeRegisterArtifactResult,
  type ToolForgeRevokeRegistrationResult,
  type ToolForgeRunSandboxedToolResult,
  type ToolForgeRunValidationHarnessResult,
  type ToolForgeReviewRecord,
  type ToolForgeReviewResult,
  type ToolForgeSandboxStubOutput,
  type ToolForgeScaffoldProjectResult,
  type ToolForgeSaveManifestResult,
  type ToolForgeValidationResult,
  type ToolForgeValidationRecord,
  type ToolForgeValidateProjectResult,
  type ToolResult
} from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import { createRuntimeRunDirectory, prepareRuntimeRun, runForgeSubprocess, RUNTIME_BLOCKED_ENV, RUNTIME_ENV, RUNTIME_OUTPUT_BYTES_MAX, RUNTIME_STDERR_BYTES_MAX, RUNTIME_STDOUT_BYTES_MAX, RUNTIME_TIMEOUT_MS } from "../runtime/forge-subprocess.js";
import { selectForgeRuntimeSandbox, type ForgeRuntimeSandboxSelection } from "../runtime/forge-os-sandbox.js";
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

async function selectRuntimeSandbox(context: AgentHostMcpContext): Promise<ForgeRuntimeSandboxSelection> {
  const probe = context.linux.checkSandboxSupport === undefined ? undefined : await context.linux.checkSandboxSupport();
  return selectForgeRuntimeSandbox({ mode: context.config.forgeRuntimeSandboxMode, probe });
}

function sandboxSelectionUsable(selection: ForgeRuntimeSandboxSelection): boolean {
  return selection.backend === "none" || (selection.backend === "bubblewrap" && selection.commandPath !== undefined);
}

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

const scaffoldProjectInputSchema = z
  .object({
    artifactId: z.string().trim().min(1).max(300).optional(),
    reviewId: z.string().trim().min(1).max(300).optional(),
    allowOverwrite: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    confirmationToken: optionalConfirmationSchema
  })
  .strict()
  .superRefine((input, refinementContext) => {
    const count = Number(input.artifactId !== undefined) + Number(input.reviewId !== undefined);
    if (count !== 1) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide exactly one of artifactId or reviewId."
      });
    }
  });

const validateProjectInputSchema = z
  .object({
    artifactId: z.string().trim().min(1).max(300).optional(),
    projectPath: z.string().trim().min(1).max(2000).optional()
  })
  .strict()
  .superRefine((input, refinementContext) => {
    const count = Number(input.artifactId !== undefined) + Number(input.projectPath !== undefined);
    if (count !== 1) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide exactly one of artifactId or projectPath."
      });
    }
  });

const getArtifactInputSchema = z
  .object({
    artifactId: z.string().trim().min(1).max(300)
  })
  .strict();

const listArtifactsInputSchema = z
  .object({
    manifestId: z.string().trim().min(1).max(200).optional(),
    status: z
      .enum([
        "draft",
        "validated",
        "scaffolded",
        "validation_pending",
        "reviewed",
        "grant_pending",
        "approved_inert",
        "rejected",
        "archived"
      ])
      .optional(),
    limit: z.number().int().min(1).max(500).optional()
  })
  .strict();

const getValidationInputSchema = z
  .object({
    validationId: z.string().trim().min(1).max(300)
  })
  .strict();

const listValidationsInputSchema = z
  .object({
    artifactId: z.string().trim().min(1).max(300).optional(),
    manifestId: z.string().trim().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(500).optional()
  })
  .strict();

const runHarnessInputSchema = z
  .object({
    artifactId: z.string().trim().min(1).max(300).optional(),
    validationId: z.string().trim().min(1).max(300).optional(),
    projectPath: z.string().trim().min(1).max(2000).optional(),
    mode: z.enum(["static-plus", "contract"]).optional(),
    timeoutMs: z.number().int().min(100).max(30_000).optional(),
    dryRun: z.boolean().optional(),
    confirmationToken: optionalConfirmationSchema
  })
  .strict()
  .superRefine((input, refinementContext) => {
    const count =
      Number(input.artifactId !== undefined) +
      Number(input.validationId !== undefined) +
      Number(input.projectPath !== undefined);
    if (count !== 1) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide exactly one of artifactId, validationId, or projectPath."
      });
    }
  });

const getHarnessRunInputSchema = z
  .object({
    harnessRunId: z.string().trim().min(1).max(300)
  })
  .strict();

const listHarnessRunsInputSchema = z
  .object({
    artifactId: z.string().trim().min(1).max(300).optional(),
    manifestId: z.string().trim().min(1).max(200).optional(),
    mode: z.enum(["static-plus", "contract"]).optional(),
    limit: z.number().int().min(1).max(500).optional()
  })
  .strict();

const registrationArtifactInputSchema = z
  .object({
    artifactId: z.string().trim().min(1).max(300)
  })
  .strict();

const registerArtifactInputSchema = z
  .object({
    artifactId: z.string().trim().min(1).max(300),
    dryRun: z.boolean().optional(),
    confirmationToken: optionalConfirmationSchema
  })
  .strict();

const getRegistrationInputSchema = z
  .object({
    registrationId: z.string().trim().min(1).max(400)
  })
  .strict();

const listRegistrationsInputSchema = z
  .object({
    artifactId: z.string().trim().min(1).max(300).optional(),
    manifestId: z.string().trim().min(1).max(200).optional(),
    status: z.enum(["pending", "registered_inert", "rejected", "revoked", "expired"]).optional(),
    limit: z.number().int().min(1).max(500).optional()
  })
  .strict();

const revokeRegistrationInputSchema = z
  .object({
    registrationId: z.string().trim().min(1).max(400),
    reason: z.string().trim().min(1).max(1000).optional(),
    dryRun: z.boolean().optional(),
    confirmationToken: optionalConfirmationSchema
  })
  .strict();

const runtimeEligibilityInputSchema = z
  .object({
    registrationId: z.string().trim().min(1).max(400),
    toolName: z.string().trim().min(1).max(200).optional()
  })
  .strict();

const runSandboxedToolInputSchema = z
  .object({
    registrationId: z.string().trim().min(1).max(400),
    toolName: z.string().trim().min(1).max(200),
    input: z.unknown().optional(),
    mode: z.enum(["stub", "subprocess"]).optional(),
    dryRun: z.boolean().optional(),
    confirmationToken: optionalConfirmationSchema
  })
  .strict();

const getRuntimeRunInputSchema = z
  .object({
    runtimeRunId: z.string().trim().min(1).max(400)
  })
  .strict();

const listRuntimeRunsInputSchema = z
  .object({
    registrationId: z.string().trim().min(1).max(400).optional(),
    artifactId: z.string().trim().min(1).max(300).optional(),
    manifestId: z.string().trim().min(1).max(200).optional(),
    toolName: z.string().trim().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(500).optional()
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
type ScaffoldProjectInput = z.infer<typeof scaffoldProjectInputSchema>;
type ValidateProjectInput = z.infer<typeof validateProjectInputSchema>;
type GetArtifactInput = z.infer<typeof getArtifactInputSchema>;
type ListArtifactsInput = z.infer<typeof listArtifactsInputSchema>;
type GetValidationInput = z.infer<typeof getValidationInputSchema>;
type ListValidationsInput = z.infer<typeof listValidationsInputSchema>;
type RunHarnessInput = z.infer<typeof runHarnessInputSchema>;
type GetHarnessRunInput = z.infer<typeof getHarnessRunInputSchema>;
type ListHarnessRunsInput = z.infer<typeof listHarnessRunsInputSchema>;
type RegistrationArtifactInput = z.infer<typeof registrationArtifactInputSchema>;
type RegisterArtifactInput = z.infer<typeof registerArtifactInputSchema>;
type GetRegistrationInput = z.infer<typeof getRegistrationInputSchema>;
type ListRegistrationsInput = z.infer<typeof listRegistrationsInputSchema>;
type RevokeRegistrationInput = z.infer<typeof revokeRegistrationInputSchema>;
type RuntimeEligibilityInput = z.infer<typeof runtimeEligibilityInputSchema>;
type RunSandboxedToolInput = z.infer<typeof runSandboxedToolInputSchema>;
type GetRuntimeRunInput = z.infer<typeof getRuntimeRunInputSchema>;
type ListRuntimeRunsInput = z.infer<typeof listRuntimeRunsInputSchema>;

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

const scaffoldProjectMcpInputSchema = {
  type: "object",
  properties: {
    artifactId: { type: "string", minLength: 1, maxLength: 300 },
    reviewId: { type: "string", minLength: 1, maxLength: 300 },
    allowOverwrite: { type: "boolean" },
    dryRun: { type: "boolean" },
    confirmationToken: { type: "string", minLength: 1, maxLength: 500 }
  },
  additionalProperties: false
};

const validateProjectMcpInputSchema = {
  type: "object",
  properties: {
    artifactId: { type: "string", minLength: 1, maxLength: 300 },
    projectPath: { type: "string", minLength: 1, maxLength: 2000 }
  },
  additionalProperties: false
};

const getArtifactMcpInputSchema = {
  type: "object",
  properties: {
    artifactId: { type: "string", minLength: 1, maxLength: 300 }
  },
  required: ["artifactId"],
  additionalProperties: false
};

const listArtifactsMcpInputSchema = {
  type: "object",
  properties: {
    manifestId: { type: "string", minLength: 1, maxLength: 200 },
    status: {
      type: "string",
      enum: [
        "draft",
        "validated",
        "scaffolded",
        "validation_pending",
        "reviewed",
        "grant_pending",
        "approved_inert",
        "rejected",
        "archived"
      ]
    },
    limit: { type: "integer", minimum: 1, maximum: 500 }
  },
  additionalProperties: false
};

const getValidationMcpInputSchema = {
  type: "object",
  properties: {
    validationId: { type: "string", minLength: 1, maxLength: 300 }
  },
  required: ["validationId"],
  additionalProperties: false
};

const listValidationsMcpInputSchema = {
  type: "object",
  properties: {
    artifactId: { type: "string", minLength: 1, maxLength: 300 },
    manifestId: { type: "string", minLength: 1, maxLength: 200 },
    limit: { type: "integer", minimum: 1, maximum: 500 }
  },
  additionalProperties: false
};

const runHarnessMcpInputSchema = {
  type: "object",
  properties: {
    artifactId: { type: "string", minLength: 1, maxLength: 300 },
    validationId: { type: "string", minLength: 1, maxLength: 300 },
    projectPath: { type: "string", minLength: 1, maxLength: 2000 },
    mode: { type: "string", enum: ["static-plus", "contract"] },
    timeoutMs: { type: "integer", minimum: 100, maximum: 30000 },
    dryRun: { type: "boolean" },
    confirmationToken: { type: "string", minLength: 1, maxLength: 500 }
  },
  additionalProperties: false
};

const getHarnessRunMcpInputSchema = {
  type: "object",
  properties: {
    harnessRunId: { type: "string", minLength: 1, maxLength: 300 }
  },
  required: ["harnessRunId"],
  additionalProperties: false
};

const listHarnessRunsMcpInputSchema = {
  type: "object",
  properties: {
    artifactId: { type: "string", minLength: 1, maxLength: 300 },
    manifestId: { type: "string", minLength: 1, maxLength: 200 },
    mode: { type: "string", enum: ["static-plus", "contract"] },
    limit: { type: "integer", minimum: 1, maximum: 500 }
  },
  additionalProperties: false
};

const registrationArtifactMcpInputSchema = {
  type: "object",
  properties: {
    artifactId: { type: "string", minLength: 1, maxLength: 300 }
  },
  required: ["artifactId"],
  additionalProperties: false
};

const registerArtifactMcpInputSchema = {
  type: "object",
  properties: {
    artifactId: { type: "string", minLength: 1, maxLength: 300 },
    dryRun: { type: "boolean" },
    confirmationToken: { type: "string", minLength: 1, maxLength: 500 }
  },
  required: ["artifactId"],
  additionalProperties: false
};

const getRegistrationMcpInputSchema = {
  type: "object",
  properties: {
    registrationId: { type: "string", minLength: 1, maxLength: 400 }
  },
  required: ["registrationId"],
  additionalProperties: false
};

const listRegistrationsMcpInputSchema = {
  type: "object",
  properties: {
    artifactId: { type: "string", minLength: 1, maxLength: 300 },
    manifestId: { type: "string", minLength: 1, maxLength: 200 },
    status: { type: "string", enum: ["pending", "registered_inert", "rejected", "revoked", "expired"] },
    limit: { type: "integer", minimum: 1, maximum: 500 }
  },
  additionalProperties: false
};

const revokeRegistrationMcpInputSchema = {
  type: "object",
  properties: {
    registrationId: { type: "string", minLength: 1, maxLength: 400 },
    reason: { type: "string", minLength: 1, maxLength: 1000 },
    dryRun: { type: "boolean" },
    confirmationToken: { type: "string", minLength: 1, maxLength: 500 }
  },
  required: ["registrationId"],
  additionalProperties: false
};

const runtimeEligibilityMcpInputSchema = {
  type: "object",
  properties: {
    registrationId: { type: "string", minLength: 1, maxLength: 400 },
    toolName: { type: "string", minLength: 1, maxLength: 200 }
  },
  required: ["registrationId"],
  additionalProperties: false
};

const runSandboxedToolMcpInputSchema = {
  type: "object",
  properties: {
    registrationId: { type: "string", minLength: 1, maxLength: 400 },
    toolName: { type: "string", minLength: 1, maxLength: 200 },
    input: {},
    mode: { type: "string", enum: ["stub", "subprocess"] },
    dryRun: { type: "boolean" },
    confirmationToken: { type: "string", minLength: 1, maxLength: 500 }
  },
  required: ["registrationId", "toolName"],
  additionalProperties: false
};

const getRuntimeRunMcpInputSchema = {
  type: "object",
  properties: {
    runtimeRunId: { type: "string", minLength: 1, maxLength: 400 }
  },
  required: ["runtimeRunId"],
  additionalProperties: false
};

const listRuntimeRunsMcpInputSchema = {
  type: "object",
  properties: {
    registrationId: { type: "string", minLength: 1, maxLength: 400 },
    artifactId: { type: "string", minLength: 1, maxLength: 300 },
    manifestId: { type: "string", minLength: 1, maxLength: 200 },
    toolName: { type: "string", minLength: 1, maxLength: 200 },
    limit: { type: "integer", minimum: 1, maximum: 500 }
  },
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

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await stat(candidatePath);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function directoryHasEntries(candidatePath: string): Promise<boolean> {
  try {
    const entries = await readdir(candidatePath);
    return entries.length > 0;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function buildScaffoldFiles(
  manifest: ToolForgeManifest,
  projectPath: string
): Array<ToolForgeProjectFilePlanEntry & { content: string }> {
  const packageJson = {
    name: manifest.id,
    version: manifest.version,
    private: true,
    description: manifest.description,
    type: "module",
    scripts: {
      build: "tsc --noEmit",
      test: "node --test"
    }
  };

  const srcIndex = [
    `export const manifestId = ${JSON.stringify(manifest.id)};`,
    `export const manifestVersion = ${JSON.stringify(manifest.version)};`,
    "",
    "export function describeGeneratedArtifact(): string {",
    `  return ${JSON.stringify(`${manifest.displayName} is scaffolded and inert in Phase 15.`)};`,
    "}"
  ].join("\n");

  const handler = {
    schemaVersion: "agenthost.forge.handler.v1",
    tools: Object.fromEntries(manifest.tools.map((tool) => [tool.name, {
      op: "object",
      entries: { tool: { op: "const", value: tool.name }, input: { op: "input" } }
    }]))
  };

  const testFile = [
    "import test from \"node:test\";",
    "import assert from \"node:assert/strict\";",
    "import { describeGeneratedArtifact } from \"../src/index.js\";",
    "",
    "test(\"generated scaffold remains inert\", () => {",
    "  assert.match(describeGeneratedArtifact(), /inert/);",
    "});"
  ].join("\n");

  const contractText = [
    `Manifest: ${manifest.id}@${manifest.version}`,
    `Tools: ${manifest.tools.map((tool) => tool.name).join(", ") || "none"}`,
    `Requirements: dryRun=${manifest.requirements.requiresDryRun === true}, confirmation=${manifest.requirements.requiresConfirmationToken === true}, approval=${manifest.requirements.requiresApproval === true}`,
    `Permissions: ${manifest.requestedPermissions.map((permission) => permission.id).join(", ") || "none"}`,
    "",
    "This scaffold is inert except Phase 19 bounded runtime/handler.json evaluation.",
    "It must not be executed, registered, or dynamically imported in AgentHost.",
    "Validation may inspect these files statically only."
  ].join("\n");

  const readme = [
    `# ${manifest.displayName}`,
    "",
    manifest.description,
    "",
    "This project scaffold was generated by AgentHost Tool Forge Phase 15.",
    "It is intentionally inert and non-executable until later reviewed phases."
  ].join("\n");

  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      noEmit: true,
      skipLibCheck: true
    },
    include: ["src/**/*.ts", "tests/**/*.ts"]
  };

  const plan: Array<ToolForgeProjectFilePlanEntry & { content: string }> = [
    { path: projectPath, kind: "directory", description: "Generated project root", content: "" },
    { path: path.join(projectPath, "src"), kind: "directory", description: "Source directory", content: "" },
    { path: path.join(projectPath, "runtime"), kind: "directory", description: "Bounded JSON handler directory", content: "" },
    { path: path.join(projectPath, "tests"), kind: "directory", description: "Test directory", content: "" },
    {
      path: path.join(projectPath, "agenthost.manifest.json"),
      kind: "file",
      description: "Canonical manifest copy",
      content: `${JSON.stringify(manifest, null, 2)}\n`
    },
    { path: path.join(projectPath, "README.md"), kind: "file", description: "Project overview", content: `${readme}\n` },
    {
      path: path.join(projectPath, "package.json"),
      kind: "file",
      description: "Inert package metadata",
      content: `${JSON.stringify(packageJson, null, 2)}\n`
    },
    {
      path: path.join(projectPath, "tsconfig.json"),
      kind: "file",
      description: "Static TypeScript config",
      content: `${JSON.stringify(tsconfig, null, 2)}\n`
    },
    { path: path.join(projectPath, "src", "index.ts"), kind: "file", description: "Inert source placeholder", content: `${srcIndex}\n` },
    { path: path.join(projectPath, "runtime", "handler.json"), kind: "file", description: "Bounded Phase 19 JSON handler", content: `${JSON.stringify(handler, null, 2)}\n` },
    {
      path: path.join(projectPath, "tests", "generated.test.ts"),
      kind: "file",
      description: "Static placeholder test",
      content: `${testFile}\n`
    },
    { path: path.join(projectPath, "CONTRACT.md"), kind: "file", description: "Artifact safety contract", content: `${contractText}\n` }
  ];

  return plan.map((entry) => ({
    ...entry,
    ...(entry.kind === "file" ? { bytes: Buffer.byteLength(entry.content, "utf8") } : {})
  }));
}

function summarizeFilePlan(plan: Array<ToolForgeProjectFilePlanEntry & { content?: string }>): ToolForgeProjectFilePlanEntry[] {
  return plan.map(({ content: _content, ...entry }) => ({ ...entry }));
}

async function writeScaffoldFiles(plan: Array<ToolForgeProjectFilePlanEntry & { content: string }>): Promise<void> {
  for (const entry of plan) {
    if (entry.kind === "directory") {
      await mkdir(entry.path, { recursive: true });
      continue;
    }

    await mkdir(path.dirname(entry.path), { recursive: true });
    await writeFile(entry.path, entry.content, "utf8");
  }
}

async function resolveArtifactById(
  context: AgentHostMcpContext,
  artifactId: string
): Promise<{ artifact: ToolForgeArtifactRecord; manifest: ToolForgeManifest }> {
  const artifact = await context.forge.loadArtifact(artifactId);
  const manifest = await context.forge.loadManifestByPath(artifact.storagePath);
  return { artifact, manifest };
}

async function resolveArtifactForProjectInput(
  context: AgentHostMcpContext,
  input: { artifactId?: string; reviewId?: string }
): Promise<{
  artifact: ToolForgeArtifactRecord;
  manifest: ToolForgeManifest;
  review?: ToolForgeReviewRecord;
}> {
  if (input.reviewId !== undefined) {
    const review = await context.forge.loadReview(input.reviewId);
    const { artifact, manifest } = await resolveStoredManifest(context, {
      manifestId: review.manifestId,
      version: review.manifestVersion,
      manifestHash: review.manifestHash
    });
    const manifestHash = hashToolForgeManifest(manifest);
    if (manifestHash !== review.manifestHash) {
      throw new Error("Stored manifest content changed, so the review no longer matches the current artifact.");
    }

    return { artifact, manifest, review };
  }

  const { artifact, manifest } = await resolveArtifactById(context, input.artifactId!);
  return { artifact, manifest };
}

function buildScaffoldPreviewTarget(projectPath: string, manifest: ToolForgeManifest): {
  path: string;
  summary: string;
} {
  return {
    path: projectPath,
    summary: `Scaffold inert project ${manifest.id}@${manifest.version}`
  };
}

function sanitizeAbsoluteForMessage(candidatePath: string, root: string): string {
  const relative = path.relative(root, candidatePath);
  return relative === "" || relative.startsWith("..") ? candidatePath : path.join("forge/generated", relative);
}

function createValidationCheck(
  id: string,
  level: "info" | "warning" | "error",
  message: string,
  pathValue?: string
) {
  return pathValue === undefined ? { id, level, message } : { id, level, message, path: pathValue };
}

function requestedPermissionsAllowShell(manifest: ToolForgeManifest): boolean {
  return manifest.requestedPermissions.some(
    (permission) => permission.canRunShell === true || (permission.actionTypes ?? []).includes("shell_command")
  );
}

function requestedPermissionsAllowNetwork(manifest: ToolForgeManifest): boolean {
  return manifest.requestedPermissions.some((permission) => (permission.networkDomains?.length ?? 0) > 0);
}

function collectStaticValidationChecks(
  manifest: ToolForgeManifest,
  projectPath: string,
  files: Record<string, string>
): { checks: ReturnType<typeof createValidationCheck>[]; safeToConsiderRegistration: boolean } {
  const checks: ReturnType<typeof createValidationCheck>[] = [];

  for (const requiredPath of [
    "agenthost.manifest.json",
    "README.md",
    "package.json",
    "tsconfig.json",
    "src/index.ts",
    "runtime/handler.json",
    "tests/generated.test.ts",
    "CONTRACT.md"
  ]) {
    if (!(requiredPath in files)) {
      checks.push(createValidationCheck("missing_file", "error", `Missing required scaffold file ${requiredPath}.`, requiredPath));
    }
  }

  let packageJson: Record<string, unknown> | undefined;
  if (files["package.json"] !== undefined) {
    try {
      packageJson = JSON.parse(files["package.json"]) as Record<string, unknown>;
      checks.push(createValidationCheck("package_json", "info", "package.json parsed successfully.", "package.json"));
    } catch {
      checks.push(createValidationCheck("package_json_invalid", "error", "package.json is not valid JSON.", "package.json"));
    }
  }

  const scripts =
    packageJson !== undefined &&
    typeof packageJson.scripts === "object" &&
    packageJson.scripts !== null &&
    !Array.isArray(packageJson.scripts)
      ? (packageJson.scripts as Record<string, unknown>)
      : {};

  for (const scriptName of ["preinstall", "install", "postinstall"]) {
    if (typeof scripts[scriptName] === "string" && scripts[scriptName]!.trim() !== "") {
      checks.push(
        createValidationCheck(
          "dangerous_package_script",
          "error",
          `Package script ${scriptName} is not allowed in an inert generated project.`,
          "package.json"
        )
      );
    }
  }

  const combinedEntries = Object.entries(files);
  const shellAllowed = requestedPermissionsAllowShell(manifest);
  const networkAllowed = requestedPermissionsAllowNetwork(manifest);
  const broadFsPattern = /(~\/\.ssh|~\/\.gnupg|~\/\.config|~\/\.local\/share\/keyrings|\/etc\/|\/usr\/|\/var\/|\/root\/|process\.env\.HOME|process\.cwd\(\))/i;
  const secretPattern = /\b(password|api[_-]?key|secret|private[_-]?key|session[_-]?token|access[_-]?token|cookie)\b/i;
  const childProcessPattern = /\b(child_process|execSync|execFile|spawn|fork)\b/;
  const networkPattern = /\b(node:)?(http|https|net|tls|dgram)\b|\bfetch\s*\(|\baxios\b|\bWebSocket\b/;
  const internalsPattern = /@agenthost\/(mcp-server|os-linux)|packages\/mcp-server|packages\/os-linux/;
  const dynamicExecutionPattern = /\beval\s*\(|\bnew Function\s*\(|\bimport\s*\(/;
  const shellEscapePattern = /\b(curl|wget)\b.*\|\s*(bash|sh)\b|\b(?:\/bin\/sh|\/bin\/bash)\b/;

  for (const [relativePath, content] of combinedEntries) {
    if (broadFsPattern.test(content)) {
      checks.push(
        createValidationCheck(
          "broad_filesystem_reference",
          "error",
          "Generated project references filesystem locations outside approved Forge storage.",
          relativePath
        )
      );
    }

    if (secretPattern.test(content)) {
      checks.push(
        createValidationCheck(
          "secret_reference",
          "warning",
          "Generated project contains credential or secret-related identifiers that need review.",
          relativePath
        )
      );
    }

    if (childProcessPattern.test(content) && !shellAllowed) {
      checks.push(
        createValidationCheck(
          "child_process_without_permission",
          "error",
          "Generated project references child_process-style execution without requesting shell permission.",
          relativePath
        )
      );
    }

    if (networkPattern.test(content) && !networkAllowed) {
      checks.push(
        createValidationCheck(
          "network_without_permission",
          "error",
          "Generated project references network access without requesting network domains.",
          relativePath
        )
      );
    }

    if (internalsPattern.test(content)) {
      checks.push(
        createValidationCheck(
          "agenthost_internal_reference",
          "error",
          "Generated project references AgentHost internals directly.",
          relativePath
        )
      );
    }

    if (dynamicExecutionPattern.test(content)) {
      checks.push(
        createValidationCheck(
          "dynamic_execution_reference",
          "error",
          "Generated project references eval, dynamic import, or Function constructor behavior.",
          relativePath
        )
      );
    }

    if (shellEscapePattern.test(content)) {
      checks.push(
        createValidationCheck(
          "shell_escape_pattern",
          "error",
          "Generated project contains shell escape or remote-pipe execution patterns.",
          relativePath
        )
      );
    }
  }

  if (checks.every((check) => check.level !== "error")) {
    checks.push(
      createValidationCheck(
        "static_scan_complete",
        "info",
        `Static validation inspected ${combinedEntries.length} project files without executing generated code.`,
        sanitizeAbsoluteForMessage(projectPath, projectPath)
      )
    );
  }

  const hasErrors = checks.some((check) => check.level === "error");
  return {
    checks,
    safeToConsiderRegistration: !hasErrors
  };
}

async function readProjectFiles(projectPath: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  async function walk(currentPath: string): Promise<void> {
    const currentStat = await stat(currentPath);
    if (currentStat.isDirectory()) {
      const entries = await readdir(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        await walk(path.join(currentPath, entry.name));
      }
      return;
    }

    const relative = path.relative(projectPath, currentPath);
    result[relative] = await readFile(currentPath, "utf8");
  }

  await walk(projectPath);
  return result;
}

function determineValidationStatus(checks: Array<{ level: "info" | "warning" | "error" }>) {
  if (checks.some((check) => check.level === "error")) {
    return "failed" as const;
  }

  if (checks.some((check) => check.level === "warning")) {
    return "warnings" as const;
  }

  return "passed" as const;
}

function determineHarnessStatus(checks: Array<{ level: "info" | "warning" | "error" }>) {
  if (checks.some((check) => check.level === "error")) {
    return "failed" as const;
  }

  return "passed" as const;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
}

function grantSemanticsEqual(left: CapabilityGrant, right: CapabilityGrant): boolean {
  return (
    left.effect === right.effect &&
    stableStringify(left.match) === stableStringify(right.match) &&
    stableStringify(left.requirements ?? {}) === stableStringify(right.requirements ?? {})
  );
}

function resolveEffectiveRegistrationStatus(
  registration: ToolForgeRegistrationRecord
): ToolForgeRegistrationRecord {
  if (
    registration.status === "registered_inert" &&
    registration.expiresAt !== undefined &&
    Date.now() > Date.parse(registration.expiresAt)
  ) {
    return {
      ...registration,
      status: "expired"
    };
  }

  return registration;
}

async function resolveValidationByProject(
  context: AgentHostMcpContext,
  artifact: ToolForgeArtifactRecord
): Promise<ToolForgeValidationRecord | undefined> {
  const validations = await context.forge.listValidations();
  return validations
    .filter((validation) => validation.artifactId === artifact.artifactId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

async function resolveHarnessRunsByArtifact(
  context: AgentHostMcpContext,
  artifact: ToolForgeArtifactRecord
): Promise<ToolForgeHarnessRunRecord[]> {
  return (await context.forge.listHarnessRuns())
    .filter((harnessRun) => harnessRun.artifactId === artifact.artifactId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function resolveReviewByArtifact(
  context: AgentHostMcpContext,
  artifact: ToolForgeArtifactRecord
): Promise<ToolForgeReviewRecord | undefined> {
  return (await context.forge.listReviews())
    .filter(
      (review) =>
        review.manifestId === artifact.manifestId &&
        review.manifestVersion === artifact.manifestVersion &&
        review.manifestHash === artifact.manifestHash
    )
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))[0];
}

async function resolveRegistrationsByArtifact(
  context: AgentHostMcpContext,
  artifact: ToolForgeArtifactRecord
): Promise<ToolForgeRegistrationRecord[]> {
  return (await context.forge.listRegistrations())
    .map((registration) => resolveEffectiveRegistrationStatus(registration))
    .filter(
      (registration) =>
        registration.artifactId === artifact.artifactId &&
        registration.manifestHash === artifact.manifestHash
    )
    .sort((left, right) => right.registeredAt.localeCompare(left.registeredAt));
}

function activeGrantForProposal(
  proposal: CapabilityGrant,
  activeGrants: CapabilityGrant[]
): CapabilityGrant | undefined {
  return activeGrants.find((grant) => grant.id === proposal.id && grantSemanticsEqual(grant, proposal));
}

async function evaluateRegistrationEligibility(
  context: AgentHostMcpContext,
  artifact: ToolForgeArtifactRecord
): Promise<ToolForgeRegistrationEligibilityResult> {
  const missingRequirements: string[] = [];
  const reasons: string[] = [];

  const manifest = await context.forge.loadManifestByPath(artifact.storagePath);
  const validation = validateToolForgeManifest(manifest);
  const currentHash = hashToolForgeManifest(manifest);
  const review = await resolveReviewByArtifact(context, artifact);
  const projectPath = artifact.projectPath;
  const activeGrants = context.grants.listActiveGrants();
  const latestValidation = await resolveValidationByProject(context, artifact);
  const harnessRuns = await resolveHarnessRunsByArtifact(context, artifact);
  const latestHarnessRun = harnessRuns[0];
  const existingRegistrations = await resolveRegistrationsByArtifact(context, artifact);
  const activeRegistration = existingRegistrations.find(
    (registration) => registration.status === "registered_inert"
  );
  const requiredGrantIds = review?.proposedGrants.map((grant) => grant.id) ?? [];
  const matchedGrants = review?.proposedGrants
    .map((proposal) => activeGrantForProposal(proposal, activeGrants))
    .filter((grant): grant is CapabilityGrant => grant !== undefined) ?? [];

  if (currentHash !== artifact.manifestHash) {
    missingRequirements.push("Manifest hash changed.");
    reasons.push("Saved manifest content no longer matches the artifact hash.");
  }

  if (!validation.valid || validation.manifest === undefined) {
    missingRequirements.push("Manifest validation must pass.");
    reasons.push("Saved manifest is no longer valid for Forge registration.");
  }

  if (review === undefined) {
    missingRequirements.push("Review record is required.");
    reasons.push("No matching Forge review exists for this artifact hash.");
  } else {
    if (review.manifestHash !== artifact.manifestHash) {
      missingRequirements.push("Review hash must match artifact hash.");
      reasons.push("Review record no longer matches the current artifact hash.");
    }

    if (review.blockedPermissions.length > 0) {
      missingRequirements.push("Blocked permissions must be absent.");
      reasons.push("Review contains blocked permissions.");
    }

    if (review.decisionStatus === "denied" || review.decisionStatus === "expired") {
      missingRequirements.push("Review must not be denied or expired.");
      reasons.push(`Review status ${review.decisionStatus} is not eligible for registration.`);
    }
  }

  if (projectPath === undefined || !(await pathExists(projectPath))) {
    missingRequirements.push("Scaffolded project is required.");
    reasons.push("Artifact does not have a current scaffolded project path.");
  }

  if (projectPath !== undefined && !isInsideOrEqual(projectPath, context.forge.generatedRootDir())) {
    missingRequirements.push("Project path must remain inside Forge generated storage.");
    reasons.push("Scaffolded project path is outside the approved Forge generated folder.");
  }

  if (latestValidation === undefined) {
    missingRequirements.push("Static validation must exist.");
    reasons.push("No static validation record exists for this artifact.");
  } else {
    if (latestValidation.manifestHash !== artifact.manifestHash) {
      missingRequirements.push("Static validation hash must match artifact hash.");
      reasons.push("Latest static validation no longer matches the artifact hash.");
    }

    if (latestValidation.status !== "passed" || !latestValidation.safeToConsiderRegistration) {
      missingRequirements.push("Static validation must pass.");
      reasons.push("Latest static validation is not in a passing registration-ready state.");
    }
  }

  if (latestHarnessRun === undefined) {
    missingRequirements.push("Harness validation must exist.");
    reasons.push("No harness run exists for this artifact.");
  } else {
    if (latestHarnessRun.manifestHash !== artifact.manifestHash) {
      missingRequirements.push("Harness validation hash must match artifact hash.");
      reasons.push("Latest harness run no longer matches the artifact hash.");
    }

    if (latestHarnessRun.status !== "passed" || !latestHarnessRun.safeToConsiderRegistration) {
      missingRequirements.push("Harness validation must pass.");
      reasons.push("Latest harness run is not in a passing registration-ready state.");
    }
  }

  if (artifact.executable !== false) {
    missingRequirements.push("Artifact must remain non-executable.");
    reasons.push("Artifact executable flag is no longer inert.");
  }

  if (artifact.registered !== false) {
    missingRequirements.push("Artifact must remain non-registered.");
    reasons.push("Artifact registered flag is unexpectedly set.");
  }

  if (requiredGrantIds.length > matchedGrants.length) {
    missingRequirements.push("Required grants must be active for the current session/profile.");
    reasons.push("One or more proposed grants are missing or broader than the approved active grants.");
  }

  if (activeRegistration !== undefined) {
    missingRequirements.push("Artifact already has an active inert registration.");
    reasons.push("A registered_inert record already exists for this artifact hash.");
  }

  return {
    eligible: missingRequirements.length === 0,
    active: matchedGrants.length === requiredGrantIds.length,
    artifactId: artifact.artifactId,
    manifestId: artifact.manifestId,
    manifestVersion: artifact.manifestVersion,
    manifestHash: artifact.manifestHash,
    registeredTools: manifest.tools.map((tool) => ({ ...tool })),
    requiredGrantIds,
    activeGrantIds: matchedGrants.map((grant) => grant.id),
    missingRequirements,
    reasons,
    ...(review === undefined ? {} : { reviewId: review.reviewId }),
    validationIds: latestValidation === undefined ? [] : [latestValidation.validationId],
    harnessRunIds: latestHarnessRun === undefined ? [] : [latestHarnessRun.harnessRunId]
  };
}

const RUNTIME_ENV_ALLOWLIST = Object.keys(RUNTIME_ENV);
const RUNTIME_ENV_BLOCKLIST = RUNTIME_BLOCKED_ENV;

function createRuntimeOutputRoot(context: AgentHostMcpContext, artifact: ToolForgeArtifactRecord): string {
  return path.join(context.forge.rootDir(), "runtime-runs");
}

function createRuntimeSandboxPolicy(
  context: AgentHostMcpContext,
  artifact: ToolForgeArtifactRecord,
  mode: "stub" | "subprocess" = "stub"
): ToolForgeRuntimeEligibilityResult["sandbox"] {
  return {
    mode,
    childProcess: mode === "subprocess",
    networkAllowed: false,
    filesystemRoots: artifact.projectPath === undefined
      ? [createRuntimeOutputRoot(context, artifact)]
      : [artifact.projectPath, createRuntimeOutputRoot(context, artifact)],
    outputRoot: createRuntimeOutputRoot(context, artifact),
    shellAllowed: false,
    guiAllowed: false,
    envAllowlist: [...RUNTIME_ENV_ALLOWLIST],
    envBlocked: [...RUNTIME_ENV_BLOCKLIST],
    timeoutMs: RUNTIME_TIMEOUT_MS,
    stdoutBytesMax: RUNTIME_STDOUT_BYTES_MAX,
    stderrBytesMax: RUNTIME_STDERR_BYTES_MAX
  };
}

function isLowRiskRuntimeTool(tool: ToolForgeManifest["tools"][number]): boolean {
  return (
    (tool.riskLevel === "observe" || tool.riskLevel === "low") &&
    tool.actionType === "inspect"
  );
}

function permissionExceedsPhase18Runtime(permission: ToolForgeManifest["requestedPermissions"][number]): boolean {
  return (
    (permission.tools?.length ?? 0) > 0 ||
    (permission.strategies?.length ?? 0) > 0 ||
    (permission.actionTypes?.length ?? 0) > 0 ||
    (permission.appNames?.length ?? 0) > 0 ||
    (permission.appSensitivities?.length ?? 0) > 0 ||
    (permission.fileRoots?.length ?? 0) > 0 ||
    (permission.commandAllowlist?.length ?? 0) > 0 ||
    (permission.networkDomains?.length ?? 0) > 0 ||
    (permission.oauthScopes?.length ?? 0) > 0 ||
    permission.canReadPrivateData === true ||
    permission.canWriteFiles === true ||
    permission.canRunShell === true ||
    permission.canUseGui === true ||
    permission.canSendMessages === true ||
    permission.canDeleteData === true ||
    permission.canUploadFiles === true ||
    permission.dataSensitivity === "sensitive" ||
    permission.dataSensitivity === "secret"
  );
}

async function evaluateRuntimeEligibility(input: {
  context: AgentHostMcpContext;
  registration: ToolForgeRegistrationRecord;
  requestedToolName?: string;
  mode?: "stub" | "subprocess";
}): Promise<{
  eligibility: ToolForgeRuntimeEligibilityResult;
  registration: ToolForgeRegistrationRecord;
  artifact: ToolForgeArtifactRecord;
  manifest: ToolForgeManifest;
  tool?: ToolForgeManifest["tools"][number];
}> {
  const registration = resolveEffectiveRegistrationStatus(input.registration);
  const artifact = await input.context.forge.loadArtifact(registration.artifactId);
  const manifest = await input.context.forge.loadManifestByPath(artifact.storagePath);
  const manifestValidation = validateToolForgeManifest(manifest);
  const currentHash = hashToolForgeManifest(manifest);
  const review =
    registration.reviewId === undefined
      ? await resolveReviewByArtifact(input.context, artifact)
      : await input.context.forge.loadReview(registration.reviewId).catch(() => undefined);
  const activeGrants = input.context.grants.listActiveGrants();
  const requestedToolName =
    input.requestedToolName ??
    (registration.registeredTools.length === 1 ? registration.registeredTools[0]!.name : undefined);
  const tool = requestedToolName === undefined ? undefined : manifest.tools.find((entry) => entry.name === requestedToolName);
  const missingRequirements: string[] = [];
  const reasons: string[] = [];
  const blockedPermissionIds = manifest.requestedPermissions
    .filter((permission) => permissionExceedsPhase18Runtime(permission))
    .map((permission) => permission.id);
  const sandbox = createRuntimeSandboxPolicy(input.context, artifact, input.mode);

  if (registration.status !== "registered_inert") {
    missingRequirements.push("Registration must be active registered_inert.");
    reasons.push(`Registration status ${registration.status} is not eligible for Phase 18 runtime.`);
  }

  if (registration.manifestHash !== artifact.manifestHash) {
    missingRequirements.push("Registration hash must match artifact hash.");
    reasons.push("Registration metadata no longer matches the current artifact hash.");
  }

  if (currentHash !== artifact.manifestHash || currentHash !== registration.manifestHash) {
    missingRequirements.push("Manifest hash must remain unchanged.");
    reasons.push("Saved manifest content no longer matches the registered inert hash.");
  }

  if (!manifestValidation.valid || manifestValidation.manifest === undefined) {
    missingRequirements.push("Manifest validation must still pass.");
    reasons.push("Saved manifest is no longer valid for runtime consideration.");
  }

  if (manifest.kind !== "tool") {
    missingRequirements.push("Manifest kind must be tool.");
    reasons.push("Only generated tool manifests can be considered for Phase 18 runtime.");
  }

  if (review === undefined) {
    missingRequirements.push("Review record is required.");
    reasons.push("No matching review record exists for the registered inert artifact.");
  } else {
    if (review.manifestHash !== registration.manifestHash) {
      missingRequirements.push("Review hash must match registration hash.");
      reasons.push("Review record no longer matches the current inert registration hash.");
    }

    if (review.blockedPermissions.length > 0) {
      missingRequirements.push("Blocked permissions must be absent.");
      reasons.push("Review contains blocked permissions that cannot be considered for runtime.");
    }

    if (review.decisionStatus === "denied" || review.decisionStatus === "expired") {
      missingRequirements.push("Review must stay approved or pending.");
      reasons.push(`Review status ${review.decisionStatus} is not eligible for runtime consideration.`);
    }
  }

  if (artifact.projectPath === undefined || !(await pathExists(artifact.projectPath))) {
    missingRequirements.push("Scaffolded project must still exist.");
    reasons.push("The generated project path is missing for this registered inert artifact.");
  } else if (!isInsideOrEqual(artifact.projectPath, input.context.forge.generatedRootDir())) {
    missingRequirements.push("Project path must stay inside Forge generated storage.");
    reasons.push("The generated project path is outside the approved Forge generated folder.");
  }

  const validationRecords = await Promise.all(
    registration.validationIds.map(async (validationId) =>
      input.context.forge.loadValidation(validationId).catch(() => undefined)
    )
  );
  const presentValidationRecords = validationRecords.filter(
    (record): record is ToolForgeValidationRecord => record !== undefined
  );

  if (presentValidationRecords.length === 0) {
    missingRequirements.push("Static validation must exist.");
    reasons.push("The registered inert artifact no longer has a stored static validation record.");
  } else if (presentValidationRecords.length !== registration.validationIds.length) {
    missingRequirements.push("Static validation ids must still resolve.");
    reasons.push("One or more stored static validation records referenced by the inert registration are missing.");
  } else if (
    presentValidationRecords.some(
      (record) => record.manifestHash !== registration.manifestHash || record.status !== "passed" || !record.safeToConsiderRegistration
    )
  ) {
    missingRequirements.push("Static validation must remain passed and hash-matched.");
    reasons.push("Stored static validation is missing, stale, or no longer passing.");
  }

  const harnessRunRecords = await Promise.all(
    registration.harnessRunIds.map(async (harnessRunId) =>
      input.context.forge.loadHarnessRun(harnessRunId).catch(() => undefined)
    )
  );
  const presentHarnessRunRecords = harnessRunRecords.filter(
    (record): record is ToolForgeHarnessRunRecord => record !== undefined
  );

  if (presentHarnessRunRecords.length === 0) {
    missingRequirements.push("Harness validation must exist.");
    reasons.push("The registered inert artifact no longer has a stored harness run.");
  } else if (presentHarnessRunRecords.length !== registration.harnessRunIds.length) {
    missingRequirements.push("Harness validation ids must still resolve.");
    reasons.push("One or more stored harness runs referenced by the inert registration are missing.");
  } else if (
    presentHarnessRunRecords.some(
      (record) => record.manifestHash !== registration.manifestHash || record.status !== "passed" || !record.safeToConsiderRegistration
    )
  ) {
    missingRequirements.push("Harness validation must remain passed and hash-matched.");
    reasons.push("Stored harness validation is missing, stale, or no longer passing.");
  }

  if (requestedToolName === undefined) {
    missingRequirements.push("Tool name must be specified when multiple generated tools are declared.");
    reasons.push("Runtime dispatch could not resolve a single generated tool declaration.");
  } else if (tool === undefined) {
    missingRequirements.push("Requested tool must exist in the saved manifest.");
    reasons.push("Runtime dispatch could not find the requested tool in the current manifest.");
  } else {
    const registrationTool = registration.registeredTools.find((entry) => entry.name === requestedToolName);
    if (registrationTool === undefined) {
      missingRequirements.push("Requested tool must exist in the registration record.");
      reasons.push("Runtime dispatch could not find the requested tool in the inert registration metadata.");
    }

    if (!isLowRiskRuntimeTool(tool)) {
      missingRequirements.push("Requested tool must be observe/inspect with low risk.");
      reasons.push("Phase 18 runtime only supports low-risk read-only generated tool declarations.");
    }
  }

  if (blockedPermissionIds.length > 0) {
    missingRequirements.push("Requested permissions must stay within the Phase 18 stub boundary.");
    reasons.push("Phase 18 runtime stub does not allow generated shell, file, GUI, network, or delegated tool permissions.");
  }

  if (input.mode === "subprocess") {
    if (tool?.inputSchema === undefined || tool.outputSchema === undefined) {
      missingRequirements.push("Subprocess tools must declare input and output schemas.");
      reasons.push("Phase 19 runner only accepts schema-declared JSON input and output.");
    }
    if (artifact.projectPath !== undefined && !(await pathExists(path.join(artifact.projectPath, "runtime", "handler.json")))) {
      missingRequirements.push("Subprocess handler must exist.");
      reasons.push("Generated project lacks approved runtime/handler.json contract.");
    }
  }

  if (manifest.riskDeclaration === "high" || manifest.riskDeclaration === "blocked") {
    missingRequirements.push("Manifest risk declaration must not be high or blocked.");
    reasons.push("High-risk or blocked generated manifests cannot enter the Phase 18 runtime boundary.");
  }

  if (manifest.dataSensitivityDeclaration === "sensitive" || manifest.dataSensitivityDeclaration === "secret") {
    missingRequirements.push("Manifest data sensitivity must stay at none or low.");
    reasons.push("Phase 18 runtime does not handle sensitive or secret generated tool data.");
  }

  if (artifact.executable !== false || artifact.registered !== false) {
    missingRequirements.push("Artifact must remain executable:false and registered:false.");
    reasons.push("Artifact flags are no longer inert.");
  }

  const requiredGrantIds = review?.proposedGrants.map((grant) => grant.id) ?? [];
  const matchedGrants = review?.proposedGrants
    .map((proposal) => activeGrantForProposal(proposal, activeGrants))
    .filter((grant): grant is CapabilityGrant => grant !== undefined) ?? [];

  if (requiredGrantIds.length > matchedGrants.length) {
    missingRequirements.push("Required grants must stay active.");
    reasons.push("One or more grants required by the inert registration are missing or expired.");
  }

  const runtimePermission = tool === undefined ? undefined : (manifest.runtimePermissions ?? []).find((permission) => permission.toolNames.includes(tool.name));
  const requestedRuntimeCapabilities = runtimePermission?.capabilities ?? [];
  const requestedOperations = runtimePermission?.allowedOperations ?? [];
  const coverage = evaluateRuntimeGrantCoverage({ generatedToolId: manifest.id, registrationId: registration.registrationId, toolName: requestedToolName ?? "", capabilities: requestedRuntimeCapabilities, operations: requestedOperations }, activeGrants);
  const unsupportedRuntimeCapabilities = requestedRuntimeCapabilities.filter((capability) => !["pure_compute", "read_runtime_input", "write_runtime_output", "use_manifest_metadata", "use_registration_metadata"].includes(capability));
  const blockedOperations = requestedOperations.filter((operation) => !coverage.allowedOperations.includes(operation));
  if (input.mode === "subprocess") {
    if (runtimePermission === undefined) { missingRequirements.push("Subprocess tools must declare runtime permissions."); reasons.push("Phase 20 requires explicit runtime capability declaration."); }
    if (coverage.grantedCapabilities.length !== requestedRuntimeCapabilities.length || coverage.deniedCapabilities.length > 0) { missingRequirements.push("Runtime capabilities must have active allow grants."); reasons.push("One or more requested runtime capabilities lack grant coverage or are denied."); }
    if (unsupportedRuntimeCapabilities.length > 0 || blockedOperations.length > 0) { missingRequirements.push("Runtime capabilities and operations must be supported and granted."); reasons.push("Requested runtime capability or operation is unsupported or not allowlisted."); }
  }

  return {
    eligibility: {
      eligible: missingRequirements.length === 0,
      active:
        registration.status === "registered_inert" &&
        requiredGrantIds.length === matchedGrants.length,
      registrationId: registration.registrationId,
      artifactId: artifact.artifactId,
      manifestId: artifact.manifestId,
      manifestVersion: artifact.manifestVersion,
      manifestHash: artifact.manifestHash,
      registrationStatus: registration.status,
      toolName: requestedToolName ?? "",
      ...(tool === undefined ? {} : { tool: { ...tool } }),
      ...(review === undefined ? {} : { reviewId: review.reviewId }),
      validationIds: presentValidationRecords.map((record) => record.validationId),
      harnessRunIds: presentHarnessRunRecords.map((record) => record.harnessRunId),
      requiredGrantIds,
      activeGrantIds: [...new Set([...matchedGrants.map((grant) => grant.id), ...coverage.activeGrantIds])],
      requestedPermissionIds: manifest.requestedPermissions.map((permission) => permission.id),
      blockedPermissionIds,
      requestedRuntimeCapabilities,
      grantedRuntimeCapabilities: coverage.grantedCapabilities,
      deniedRuntimeCapabilities: coverage.deniedCapabilities,
      unsupportedRuntimeCapabilities,
      runtimeGrantIds: coverage.activeGrantIds,
      requestedOperations,
      allowedOperations: coverage.allowedOperations,
      blockedOperations,
      enforcedLimits: coverage.limits,
      runtimeRequirements: { requiresDryRun: coverage.requiresDryRun, requiresConfirmationToken: coverage.requiresConfirmationToken, requiresApproval: coverage.requiresApproval },
      missingRequirements,
      reasons,
      sandbox
    },
    registration,
    artifact,
    manifest,
    ...(tool === undefined ? {} : { tool })
  };
}

function buildRuntimeStubOutput(input: {
  registration: ToolForgeRegistrationRecord;
  manifest: ToolForgeManifest;
  tool: ToolForgeManifest["tools"][number];
  sandbox: ToolForgeRuntimeEligibilityResult["sandbox"];
}): ToolForgeSandboxStubOutput {
  return {
    mode: "stub",
    generatedCodeExecuted: false,
    metadataOnly: true,
    tool: {
      name: input.tool.name,
      description: input.tool.description,
      riskLevel: input.tool.riskLevel,
      actionType: input.tool.actionType,
      ...(input.tool.strategy === undefined ? {} : { strategy: input.tool.strategy })
    },
    registration: {
      registrationId: input.registration.registrationId,
      status: input.registration.status,
      manifestHash: input.registration.manifestHash
    },
    manifest: {
      manifestId: input.manifest.id,
      manifestVersion: input.manifest.version,
      displayName: input.manifest.displayName,
      description: input.manifest.description
    },
    sandbox: {
      ...input.sandbox,
      filesystemRoots: [...input.sandbox.filesystemRoots],
      envAllowlist: [...input.sandbox.envAllowlist],
      envBlocked: [...input.sandbox.envBlocked]
    }
  };
}

async function resolveHarnessInput(
  context: AgentHostMcpContext,
  input: { artifactId?: string; validationId?: string; projectPath?: string }
): Promise<{
  artifact: ToolForgeArtifactRecord;
  manifest: ToolForgeManifest;
  validation: ToolForgeValidationRecord | undefined;
  projectPath: string;
}> {
  if (input.validationId !== undefined) {
    const validation = await context.forge.loadValidation(input.validationId);
    const artifact = await context.forge.loadArtifact(validation.artifactId);
    const manifest = await context.forge.loadManifestByPath(artifact.storagePath);
    return {
      artifact,
      manifest,
      validation,
      projectPath: validation.projectPath
    };
  }

  if (input.artifactId !== undefined) {
    const artifact = await context.forge.loadArtifact(input.artifactId);
    const manifest = await context.forge.loadManifestByPath(artifact.storagePath);
    return {
      artifact,
      manifest,
      validation: await resolveValidationByProject(context, artifact),
      projectPath: artifact.projectPath ?? ""
    };
  }

  const resolvedProjectPath = path.resolve(input.projectPath!);
  const artifacts = await context.forge.listArtifacts();
  const artifact = artifacts.find(
    (candidate) => candidate.projectPath !== undefined && path.resolve(candidate.projectPath) === resolvedProjectPath
  );

  if (artifact === undefined) {
    throw new Error("Stored artifact for the requested project path was not found.");
  }

  const manifest = await context.forge.loadManifestByPath(artifact.storagePath);
  return {
    artifact,
    manifest,
    validation: await resolveValidationByProject(context, artifact),
    projectPath: resolvedProjectPath
  };
}

function collectContractHarnessChecks(
  manifest: ToolForgeManifest,
  files: Record<string, string>
): ReturnType<typeof createValidationCheck>[] {
  const checks: ReturnType<typeof createValidationCheck>[] = [];
  const contractText = files["CONTRACT.md"] ?? "";

  if (contractText.trim() === "") {
    checks.push(createValidationCheck("missing_contract", "error", "Generated project is missing CONTRACT.md.", "CONTRACT.md"));
  } else {
    if (!contractText.includes(`Manifest: ${manifest.id}@${manifest.version}`)) {
      checks.push(
        createValidationCheck(
          "contract_manifest_mismatch",
          "error",
          "CONTRACT.md does not describe the current manifest id and version.",
          "CONTRACT.md"
        )
      );
    }

    for (const tool of manifest.tools) {
      if (!contractText.includes(tool.name)) {
        checks.push(
          createValidationCheck(
            "contract_tool_missing",
            "error",
            `CONTRACT.md does not mention tool ${tool.name}.`,
            "CONTRACT.md"
          )
        );
      }

      if (tool.inputSchema === undefined || tool.outputSchema === undefined) {
        checks.push(
          createValidationCheck(
            "tool_schema_missing",
            "error",
            `Manifest tool ${tool.name} must declare both input and output schemas for harness validation.`,
            "agenthost.manifest.json"
          )
        );
      }
    }

    if (!contractText.includes(`dryRun=${manifest.requirements.requiresDryRun === true}`)) {
      checks.push(
        createValidationCheck(
          "contract_requirements_mismatch",
          "error",
          "CONTRACT.md does not reflect the manifest dry-run requirement.",
          "CONTRACT.md"
        )
      );
    }

    if (!contractText.includes(`confirmation=${manifest.requirements.requiresConfirmationToken === true}`)) {
      checks.push(
        createValidationCheck(
          "contract_requirements_mismatch",
          "error",
          "CONTRACT.md does not reflect the manifest confirmation requirement.",
          "CONTRACT.md"
        )
      );
    }

    for (const permission of manifest.requestedPermissions) {
      if (!contractText.includes(permission.id)) {
        checks.push(
          createValidationCheck(
            "contract_permission_missing",
            "error",
            `CONTRACT.md does not mention requested permission ${permission.id}.`,
            "CONTRACT.md"
          )
        );
      }
    }
  }

  const packageJsonText = files["package.json"] ?? "";
  if (/"agenthost:register"|registered"\s*:\s*true|"live"\s*:\s*true/.test(packageJsonText)) {
    checks.push(
      createValidationCheck(
        "live_registration_metadata",
        "error",
        "Generated project contains live registration metadata, which is not allowed in Forge scaffolds.",
        "package.json"
      )
    );
  }

  if (checks.length === 0) {
    checks.push(
      createValidationCheck(
        "contract_consistent",
        "info",
        "Manifest declarations and scaffolded contract metadata are consistent.",
        "CONTRACT.md"
      )
    );
  }

  return checks;
}

function buildHarnessChecks(
  mode: ToolForgeHarnessMode,
  manifest: ToolForgeManifest,
  projectPath: string,
  files: Record<string, string>
): ReturnType<typeof createValidationCheck>[] {
  if (mode === "contract") {
    return collectContractHarnessChecks(manifest, files);
  }

  const staticChecks = collectStaticValidationChecks(manifest, projectPath, files).checks;
  const contractChecks = collectContractHarnessChecks(manifest, files);
  return [...staticChecks, ...contractChecks];
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

  const scaffoldProject: AgentHostToolDefinition<
    ScaffoldProjectInput,
    ToolForgeScaffoldProjectResult | (ActionPreviewResult & { filePlan: ToolForgeProjectFilePlanEntry[] }),
    AgentHostMcpContext
  > = {
    name: "forge.scaffold_project",
    description: "Creates an inert generated project scaffold under AgentHost Forge storage without registering or executing it.",
    riskLevel: "medium",
    inputSchema: scaffoldProjectInputSchema,
    mcpInputSchema: scaffoldProjectMcpInputSchema,
    inputSummary: "Scaffold Forge generated project",
    safety: {
      actionType: "file_write"
    },
    preview: {
      isDryRun: (input) => input.dryRun === true
    },
    async handler(
      input,
      context,
      runtime
    ): Promise<ToolResult<ToolForgeScaffoldProjectResult | (ActionPreviewResult & { filePlan: ToolForgeProjectFilePlanEntry[] })>> {
      let artifact: ToolForgeArtifactRecord;
      let manifest: ToolForgeManifest;
      let review: ToolForgeReviewRecord | undefined;

      try {
        ({ artifact, manifest, review } = await resolveArtifactForProjectInput(context, {
          ...(input.artifactId === undefined ? {} : { artifactId: input.artifactId }),
          ...(input.reviewId === undefined ? {} : { reviewId: input.reviewId })
        }));
      } catch (error) {
        return toolFailure({
          tool: "forge.scaffold_project",
          riskLevel: "medium",
          error: {
            code: "artifact_not_found",
            message: error instanceof Error ? error.message : "Forge artifact or review could not be resolved."
          },
          observations: ["Could not resolve the stored inert artifact for scaffolding."]
        });
      }

      const manifestHash = hashToolForgeManifest(manifest);
      if (manifestHash !== artifact.manifestHash) {
        return toolFailure({
          tool: "forge.scaffold_project",
          riskLevel: "medium",
          error: {
            code: "manifest_hash_mismatch",
            message: "Stored manifest content changed, so this scaffold request no longer matches the artifact."
          },
          observations: ["Refused to scaffold because the saved manifest no longer matches the artifact hash."]
        });
      }

      const projectPath = context.forge.generatedProjectPath(manifest.id, manifest.version);
      const filePlan = summarizeFilePlan(buildScaffoldFiles(manifest, projectPath));
      const overwriteBlocked = (await directoryHasEntries(projectPath)) && input.allowOverwrite !== true;
      const previewTarget = buildScaffoldPreviewTarget(projectPath, manifest);
      const safetyDecision =
        runtime?.safetyDecision ??
        evaluateSafety(
          {
            tool: "forge.scaffold_project",
            actionType: "file_write",
            filePath: projectPath,
            generatedTool: true,
            generatedToolId: manifest.id
          },
          context.policy,
          createSafetyEvaluationContext(context)
        );
      const target = {
        artifactId: artifact.artifactId,
        manifestHash,
        projectPath,
        allowOverwrite: input.allowOverwrite === true,
        filePlan: filePlan.map((entry) => `${entry.kind}:${entry.path}`)
      };

      if (runtime?.isDryRun) {
        const preview = buildPreviewResult({
          tool: "forge.scaffold_project",
          riskLevel: "medium",
          safety: safetyDecision,
          targetSummary: previewTarget.summary,
          target: toFilePreviewTarget(projectPath, previewTarget.summary),
          wouldExecute: !overwriteBlocked && safetyDecision.allowed,
          ...(overwriteBlocked
            ? {}
            : {
                confirmation: {
                  manager: context.confirmations,
                  sessionId: context.sessionId,
                  input,
                  target,
                  explanation:
                    "Use this token to scaffold the exact previewed inert generated project before it expires.",
                  riskLevel: safetyDecision.riskLevel,
                  appSensitivity: safetyDecision.appSensitivity
                }
              }),
          reasons: previewReasons(
            overwriteBlocked
              ? "Project scaffold already exists. Set allowOverwrite:true in the preview and execute flow to replace it."
              : "Prepared an inert project file plan without writing generated files.",
            safetyDecision.reasons
          ),
          observations: ["Previewed inert project scaffolding without writing any files."]
        });

        return {
          ...preview,
          data: {
            ...(preview.data as ActionPreviewResult),
            filePlan
          }
        };
      }

      if (overwriteBlocked) {
        return toolFailure({
          tool: "forge.scaffold_project",
          riskLevel: safetyDecision.riskLevel,
          error: {
            code: "overwrite_requires_preview",
            message: "Existing scaffold would be overwritten. Preview again with allowOverwrite:true before execution."
          },
          observations: ["Refused to overwrite an existing generated project scaffold without explicit previewed consent."]
        });
      }

      if (input.confirmationToken === undefined) {
        const { code, reason } = missingConfirmationReason(safetyDecision);
        return toolFailure({
          tool: "forge.scaffold_project",
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
        tool: "forge.scaffold_project",
        input,
        target,
        riskLevel: safetyDecision.riskLevel
      });

      if (!verification.ok) {
        return toolFailure({
          tool: "forge.scaffold_project",
          riskLevel: safetyDecision.riskLevel,
          confirmation: rejectedConfirmation(verification.tokenId, verification.reason),
          error: {
            code: "confirmation_rejected",
            message: verification.reason
          },
          observations: [verification.reason]
        });
      }

      await writeScaffoldFiles(buildScaffoldFiles(manifest, projectPath));
      const updatedArtifact: ToolForgeArtifactRecord = {
        ...artifact,
        projectPath,
        status: "scaffolded",
        updatedAt: new Date().toISOString()
      };
      await context.forge.saveArtifact(updatedArtifact);

      return toolSuccess({
        tool: "forge.scaffold_project",
        riskLevel: safetyDecision.riskLevel,
        confirmation: acceptedConfirmation(
          verification.tokenId,
          true,
          "Confirmation token accepted and inert project scaffolding executed."
        ),
        data: {
          artifact: updatedArtifact,
          manifestHash,
          projectPath,
          ...(review === undefined ? {} : { reviewId: review.reviewId }),
          files: filePlan,
          overwritten: input.allowOverwrite === true
        },
        observations: ["Wrote an inert generated project scaffold without registering or executing any generated tool."]
      });
    }
  };

  const validateProject: AgentHostToolDefinition<
    ValidateProjectInput,
    ToolForgeValidateProjectResult,
    AgentHostMcpContext
  > = {
    name: "forge.validate_project",
    description: "Validates an inert generated project scaffold and stores a non-executable validation record.",
    riskLevel: "medium",
    inputSchema: validateProjectInputSchema,
    mcpInputSchema: validateProjectMcpInputSchema,
    inputSummary: "Validate Forge generated project",
    safety: {
      actionType: "file_write"
    },
    async handler(input, context, runtime): Promise<ToolResult<ToolForgeValidateProjectResult>> {
      const generatedRoot = context.forge.generatedRootDir();
      let artifact: ToolForgeArtifactRecord | undefined;
      let manifest: ToolForgeManifest | undefined;
      let projectPath: string;

      if (input.artifactId !== undefined) {
        try {
          const resolved = await resolveArtifactById(context, input.artifactId);
          artifact = resolved.artifact;
          manifest = resolved.manifest;
        } catch (error) {
          return toolFailure({
            tool: "forge.validate_project",
            riskLevel: "medium",
            error: {
              code: "artifact_not_found",
              message: error instanceof Error ? error.message : "Stored artifact was not found."
            },
            observations: ["Could not resolve the stored artifact for project validation."]
          });
        }

        if (artifact.projectPath === undefined) {
          return toolFailure({
            tool: "forge.validate_project",
            riskLevel: "medium",
            error: {
              code: "project_not_scaffolded",
              message: "Artifact does not have a generated project scaffold yet."
            },
            observations: ["Scaffold the project before validating it."]
          });
        }

        projectPath = artifact.projectPath;
      } else {
        projectPath = path.resolve(input.projectPath!);
        const artifacts = await context.forge.listArtifacts();
        artifact = artifacts.find((candidate) => candidate.projectPath !== undefined && path.resolve(candidate.projectPath) === projectPath);
        if (artifact !== undefined) {
          manifest = await context.forge.loadManifestByPath(artifact.storagePath);
        }
      }

      if (!isInsideOrEqual(projectPath, generatedRoot)) {
        return toolFailure({
          tool: "forge.validate_project",
          riskLevel: "medium",
          error: {
            code: "path_not_allowed",
            message: "Project paths must stay inside the approved AgentHost forge/generated folder."
          },
          observations: ["Rejected validation for a path outside approved Forge generated storage."]
        });
      }

      if (!(await pathExists(projectPath))) {
        return toolFailure({
          tool: "forge.validate_project",
          riskLevel: "medium",
          error: {
            code: "project_not_found",
            message: "Generated project path was not found."
          },
          observations: ["The generated project path does not exist."]
        });
      }

      const manifestPath = path.join(projectPath, "agenthost.manifest.json");
      if (!(await pathExists(manifestPath))) {
        return toolFailure({
          tool: "forge.validate_project",
          riskLevel: "medium",
          error: {
            code: "manifest_copy_missing",
            message: "Generated project is missing agenthost.manifest.json."
          },
          observations: ["Generated project did not contain the required manifest copy."]
        });
      }

      const manifestFromProject = validateToolForgeManifest(await readFile(manifestPath, "utf8"));
      if (!manifestFromProject.valid || manifestFromProject.manifest === undefined) {
        return toolFailure({
          tool: "forge.validate_project",
          riskLevel: "medium",
          error: {
            code: "manifest_copy_invalid",
            message: "Generated project manifest copy is invalid.",
            details: manifestFromProject
          },
          observations: ["Generated project manifest copy failed validation."]
        });
      }

      manifest ??= manifestFromProject.manifest;
      const manifestHash = hashToolForgeManifest(manifestFromProject.manifest);
      if (artifact !== undefined && manifestHash !== artifact.manifestHash) {
        return toolFailure({
          tool: "forge.validate_project",
          riskLevel: "medium",
          error: {
            code: "manifest_hash_mismatch",
            message: "Generated project manifest hash no longer matches the saved artifact."
          },
          observations: ["Refused validation because the generated project does not match the saved artifact."]
        });
      }

      const safetyDecision =
        runtime?.safetyDecision ??
        evaluateSafety(
          {
            tool: "forge.validate_project",
            actionType: "file_write",
            filePath: context.forge.validationPath(
              artifact === undefined
                ? `validation.${manifestFromProject.manifest.id}.${manifestFromProject.manifest.version}.${manifestHash.slice(0, 12)}`
                : `validation.${artifact.manifestId}.${artifact.manifestVersion}.${artifact.manifestHash.slice(0, 12)}`
            ),
            generatedTool: true,
            generatedToolId: manifestFromProject.manifest.id
          },
          context.policy,
          createSafetyEvaluationContext(context)
        );

      const files = await readProjectFiles(projectPath);
      const staticChecks = collectStaticValidationChecks(manifestFromProject.manifest, projectPath, files);
      const validationRecord = createToolForgeValidationRecord({
        artifact:
          artifact ??
          createToolForgeArtifactRecord({
            manifest: manifestFromProject.manifest,
            manifestHash,
            storagePath: manifestPath,
            status: "validation_pending"
          }),
        projectPath,
        checks: staticChecks.checks,
        status: determineValidationStatus(staticChecks.checks),
        safeToConsiderRegistration: staticChecks.safeToConsiderRegistration,
        summary: staticChecks.safeToConsiderRegistration
          ? "Static validation completed without executable behavior or blocked findings."
          : "Static validation found issues that keep the generated project inert and not ready for later consideration."
      });

      await context.forge.saveValidation(validationRecord);

      if (artifact !== undefined) {
        const updatedArtifact: ToolForgeArtifactRecord = {
          ...artifact,
          status: "validation_pending",
          updatedAt: new Date().toISOString()
        };
        await context.forge.saveArtifact(updatedArtifact);
        artifact = updatedArtifact;
      }

      return toolSuccess({
        tool: "forge.validate_project",
        riskLevel: safetyDecision.riskLevel,
        data: {
          ...(artifact === undefined ? {} : { artifact }),
          validation: validationRecord
        },
        observations: ["Validated scaffolded project files statically without executing generated code or package scripts."]
      });
    }
  };

  const getArtifact: AgentHostToolDefinition<GetArtifactInput, ToolForgeGetArtifactResult, AgentHostMcpContext> = {
    name: "forge.get_artifact",
    description: "Returns one stored Forge artifact record.",
    riskLevel: "low",
    inputSchema: getArtifactInputSchema,
    mcpInputSchema: getArtifactMcpInputSchema,
    inputSummary: "Get Forge artifact",
    safety: {
      actionType: "observe"
    },
    async handler(input, context): Promise<ToolResult<ToolForgeGetArtifactResult>> {
      try {
        const artifact = await context.forge.loadArtifact(input.artifactId);
        return toolSuccess({
          tool: "forge.get_artifact",
          riskLevel: "low",
          data: { artifact },
          observations: ["Returned one stored Forge artifact record."]
        });
      } catch (error) {
        return toolFailure({
          tool: "forge.get_artifact",
          riskLevel: "low",
          error: {
            code: "artifact_not_found",
            message: error instanceof Error ? error.message : "Stored artifact was not found."
          },
          observations: ["No stored artifact matched the requested artifact id."]
        });
      }
    }
  };

  const listArtifacts: AgentHostToolDefinition<ListArtifactsInput, ToolForgeListArtifactsResult, AgentHostMcpContext> = {
    name: "forge.list_artifacts",
    description: "Lists stored Forge artifact summaries.",
    riskLevel: "low",
    inputSchema: listArtifactsInputSchema,
    mcpInputSchema: listArtifactsMcpInputSchema,
    inputSummary: "List Forge artifacts",
    safety: {
      actionType: "observe"
    },
    async handler(input, context): Promise<ToolResult<ToolForgeListArtifactsResult>> {
      const artifacts = (await context.forge.listArtifacts())
        .filter((artifact) => input.manifestId === undefined || artifact.manifestId === input.manifestId)
        .filter((artifact) => input.status === undefined || artifact.status === input.status)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, input.limit ?? 100)
        .map((artifact) => summarizeToolForgeArtifactRecord(artifact));

      return toolSuccess({
        tool: "forge.list_artifacts",
        riskLevel: "low",
        data: { artifacts },
        observations: ["Listed stored Forge artifact summaries."]
      });
    }
  };

  const getValidation: AgentHostToolDefinition<GetValidationInput, ToolForgeGetValidationResult, AgentHostMcpContext> = {
    name: "forge.get_validation",
    description: "Returns one stored Forge validation record.",
    riskLevel: "low",
    inputSchema: getValidationInputSchema,
    mcpInputSchema: getValidationMcpInputSchema,
    inputSummary: "Get Forge validation",
    safety: {
      actionType: "observe"
    },
    async handler(input, context): Promise<ToolResult<ToolForgeGetValidationResult>> {
      try {
        const validation = await context.forge.loadValidation(input.validationId);
        return toolSuccess({
          tool: "forge.get_validation",
          riskLevel: "low",
          data: { validation },
          observations: ["Returned one stored Forge validation record."]
        });
      } catch (error) {
        return toolFailure({
          tool: "forge.get_validation",
          riskLevel: "low",
          error: {
            code: "validation_not_found",
            message: error instanceof Error ? error.message : "Stored validation was not found."
          },
          observations: ["No stored validation matched the requested validation id."]
        });
      }
    }
  };

  const listValidations: AgentHostToolDefinition<
    ListValidationsInput,
    ToolForgeListValidationsResult,
    AgentHostMcpContext
  > = {
    name: "forge.list_validations",
    description: "Lists stored Forge validation summaries.",
    riskLevel: "low",
    inputSchema: listValidationsInputSchema,
    mcpInputSchema: listValidationsMcpInputSchema,
    inputSummary: "List Forge validations",
    safety: {
      actionType: "observe"
    },
    async handler(input, context): Promise<ToolResult<ToolForgeListValidationsResult>> {
      const validations = (await context.forge.listValidations())
        .filter((validation) => input.artifactId === undefined || validation.artifactId === input.artifactId)
        .filter((validation) => input.manifestId === undefined || validation.manifestId === input.manifestId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, input.limit ?? 100)
        .map((validation) => summarizeToolForgeValidation(validation));

      return toolSuccess({
        tool: "forge.list_validations",
        riskLevel: "low",
        data: { validations },
        observations: ["Listed stored Forge validation summaries."]
      });
    }
  };

  const runValidationHarness: AgentHostToolDefinition<
    RunHarnessInput,
    ToolForgeRunValidationHarnessResult | (ActionPreviewResult & { mode: ToolForgeHarnessMode; plannedChecks: string[] }),
    AgentHostMcpContext
  > = {
    name: "forge.run_validation_harness",
    description: "Runs a controlled inert validation harness for a generated Forge project and stores a harness record.",
    riskLevel: "medium",
    inputSchema: runHarnessInputSchema,
    mcpInputSchema: runHarnessMcpInputSchema,
    inputSummary: "Run Forge validation harness",
    safety: {
      actionType: "file_write"
    },
    preview: {
      isDryRun: (input) => input.dryRun === true
    },
    async handler(
      input,
      context,
      runtime
    ): Promise<ToolResult<ToolForgeRunValidationHarnessResult | (ActionPreviewResult & { mode: ToolForgeHarnessMode; plannedChecks: string[] })>> {
      const mode: ToolForgeHarnessMode = input.mode ?? "static-plus";
      let artifact: ToolForgeArtifactRecord;
      let manifest: ToolForgeManifest;
      let validation: ToolForgeValidationRecord | undefined;
      let projectPath: string;

      try {
        ({ artifact, manifest, validation, projectPath } = await resolveHarnessInput(context, {
          ...(input.artifactId === undefined ? {} : { artifactId: input.artifactId }),
          ...(input.validationId === undefined ? {} : { validationId: input.validationId }),
          ...(input.projectPath === undefined ? {} : { projectPath: input.projectPath })
        }));
      } catch (error) {
        return toolFailure({
          tool: "forge.run_validation_harness",
          riskLevel: "medium",
          error: {
            code: "harness_target_not_found",
            message: error instanceof Error ? error.message : "Harness target could not be resolved."
          },
          observations: ["Could not resolve the requested Forge harness target."]
        });
      }

      if (artifact.projectPath === undefined || projectPath === "") {
        return toolFailure({
          tool: "forge.run_validation_harness",
          riskLevel: "medium",
          error: {
            code: "project_not_scaffolded",
            message: "Artifact does not have a generated project scaffold yet."
          },
          observations: ["Scaffold the project before running the validation harness."]
        });
      }

      const generatedRoot = context.forge.generatedRootDir();
      if (!isInsideOrEqual(projectPath, generatedRoot)) {
        return toolFailure({
          tool: "forge.run_validation_harness",
          riskLevel: "medium",
          error: {
            code: "path_not_allowed",
            message: "Harness runs must stay inside the approved AgentHost forge/generated folder."
          },
          observations: ["Rejected harness execution for a path outside approved Forge generated storage."]
        });
      }

      const manifestPath = path.join(projectPath, "agenthost.manifest.json");
      if (!(await pathExists(manifestPath))) {
        return toolFailure({
          tool: "forge.run_validation_harness",
          riskLevel: "medium",
          error: {
            code: "manifest_copy_missing",
            message: "Generated project is missing agenthost.manifest.json."
          },
          observations: ["The harness could not verify the project because the manifest copy is missing."]
        });
      }

      const manifestValidation = validateToolForgeManifest(await readFile(manifestPath, "utf8"));
      if (!manifestValidation.valid || manifestValidation.manifest === undefined) {
        return toolFailure({
          tool: "forge.run_validation_harness",
          riskLevel: "medium",
          error: {
            code: "manifest_copy_invalid",
            message: "Generated project manifest copy is invalid.",
            details: manifestValidation
          },
          observations: ["The harness could not start because the project manifest copy is invalid."]
        });
      }

      const manifestHash = hashToolForgeManifest(manifestValidation.manifest);
      if (manifestHash !== artifact.manifestHash) {
        return toolFailure({
          tool: "forge.run_validation_harness",
          riskLevel: "medium",
          error: {
            code: "manifest_hash_mismatch",
            message: "Generated project manifest hash no longer matches the saved artifact."
          },
          observations: ["Refused harness execution because the scaffold no longer matches the saved artifact."]
        });
      }

      if (validation === undefined) {
        validation = await resolveValidationByProject(context, artifact);
      }

      const hasUsableValidation = validation !== undefined;
      const validationFailed = validation?.status === "failed";
      const files = await readProjectFiles(projectPath);
      const plannedChecks = buildHarnessChecks(mode, manifestValidation.manifest, projectPath, files).map((check) => check.id);
      const safetyDecision =
        runtime?.safetyDecision ??
        evaluateSafety(
          {
            tool: "forge.run_validation_harness",
            actionType: "file_write",
            filePath: context.forge.harnessRunPath(`preview.${artifact.artifactId}.${mode}`),
            generatedTool: true,
            generatedToolId: artifact.manifestId
          },
          context.policy,
          createSafetyEvaluationContext(context)
        );
      const targetSummary = `Run ${mode} harness for ${artifact.manifestId}@${artifact.manifestVersion}`;
      const target = {
        artifactId: artifact.artifactId,
        validationId: validation?.validationId,
        manifestHash,
        projectPath,
        mode,
        plannedChecks
      };
      const prerequisiteReasons: string[] = [];

      if (!hasUsableValidation) {
        prerequisiteReasons.push("Run forge.validate_project successfully before the harness.");
      } else if (validationFailed) {
        prerequisiteReasons.push("Static validation failed, so the harness cannot execute until the project is fixed.");
      }

      if (runtime?.isDryRun) {
        const preview = buildPreviewResult({
          tool: "forge.run_validation_harness",
          riskLevel: "medium",
          safety: safetyDecision,
          targetSummary,
          target: toFilePreviewTarget(projectPath, targetSummary),
          wouldExecute: prerequisiteReasons.length === 0 && safetyDecision.allowed,
          ...(prerequisiteReasons.length > 0
            ? {}
            : {
                confirmation: {
                  manager: context.confirmations,
                  sessionId: context.sessionId,
                  input,
                  target,
                  explanation: "Use this token to store the exact previewed harness run before it expires.",
                  riskLevel: safetyDecision.riskLevel,
                  appSensitivity: safetyDecision.appSensitivity
                }
              }),
          reasons: previewReasons(
            prerequisiteReasons[0] ?? "Prepared the inert validation harness plan without writing a harness record.",
            safetyDecision.reasons
          ),
          observations: ["Previewed the Forge validation harness without executing generated code or writing a harness record."]
        });

        return {
          ...preview,
          data: {
            ...(preview.data as ActionPreviewResult),
            mode,
            plannedChecks
          }
        };
      }

      if (prerequisiteReasons.length > 0) {
        return toolFailure({
          tool: "forge.run_validation_harness",
          riskLevel: safetyDecision.riskLevel,
          error: {
            code: hasUsableValidation ? "static_validation_failed" : "validation_required",
            message: prerequisiteReasons.join(" ")
          },
          observations: prerequisiteReasons
        });
      }

      const validatedProject = validation!;

      if (input.confirmationToken === undefined) {
        const { code, reason } = missingConfirmationReason(safetyDecision);
        return toolFailure({
          tool: "forge.run_validation_harness",
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
        tool: "forge.run_validation_harness",
        input,
        target,
        riskLevel: safetyDecision.riskLevel
      });

      if (!verification.ok) {
        return toolFailure({
          tool: "forge.run_validation_harness",
          riskLevel: safetyDecision.riskLevel,
          confirmation: rejectedConfirmation(verification.tokenId, verification.reason),
          error: {
            code: "confirmation_rejected",
            message: verification.reason
          },
          observations: [verification.reason]
        });
      }

      const start = performance.now();
      const checks = buildHarnessChecks(mode, manifestValidation.manifest, projectPath, files);
      const durationMs = Math.max(1, Math.round(performance.now() - start));
      const harnessRun = createToolForgeHarnessRunRecord({
        artifact,
        projectPath,
        mode,
        status: determineHarnessStatus(checks),
        checks,
        stdoutSummary: "",
        stderrSummary: "No subprocess commands were run in Phase 16.",
        durationMs,
        safeToConsiderRegistration: checks.every((check) => check.level !== "error")
      });
      await context.forge.saveHarnessRun(harnessRun);

      return toolSuccess({
        tool: "forge.run_validation_harness",
        riskLevel: safetyDecision.riskLevel,
        confirmation: acceptedConfirmation(
          verification.tokenId,
          true,
          "Confirmation token accepted and inert harness validation executed."
        ),
        data: {
          artifact,
          validation: validatedProject,
          harnessRun
        },
        observations: ["Ran the inert Forge harness checks without registering or executing any generated tool handler."]
      });
    }
  };

  const getHarnessRun: AgentHostToolDefinition<GetHarnessRunInput, ToolForgeGetHarnessRunResult, AgentHostMcpContext> = {
    name: "forge.get_harness_run",
    description: "Returns one stored Forge harness run record.",
    riskLevel: "low",
    inputSchema: getHarnessRunInputSchema,
    mcpInputSchema: getHarnessRunMcpInputSchema,
    inputSummary: "Get Forge harness run",
    safety: {
      actionType: "observe"
    },
    async handler(input, context): Promise<ToolResult<ToolForgeGetHarnessRunResult>> {
      try {
        const harnessRun = await context.forge.loadHarnessRun(input.harnessRunId);
        return toolSuccess({
          tool: "forge.get_harness_run",
          riskLevel: "low",
          data: { harnessRun },
          observations: ["Returned one stored Forge harness run record."]
        });
      } catch (error) {
        return toolFailure({
          tool: "forge.get_harness_run",
          riskLevel: "low",
          error: {
            code: "harness_run_not_found",
            message: error instanceof Error ? error.message : "Stored harness run was not found."
          },
          observations: ["No stored harness run matched the requested id."]
        });
      }
    }
  };

  const listHarnessRuns: AgentHostToolDefinition<
    ListHarnessRunsInput,
    ToolForgeListHarnessRunsResult,
    AgentHostMcpContext
  > = {
    name: "forge.list_harness_runs",
    description: "Lists stored Forge harness run summaries.",
    riskLevel: "low",
    inputSchema: listHarnessRunsInputSchema,
    mcpInputSchema: listHarnessRunsMcpInputSchema,
    inputSummary: "List Forge harness runs",
    safety: {
      actionType: "observe"
    },
    async handler(input, context): Promise<ToolResult<ToolForgeListHarnessRunsResult>> {
      const harnessRuns = (await context.forge.listHarnessRuns())
        .filter((record) => input.artifactId === undefined || record.artifactId === input.artifactId)
        .filter((record) => input.manifestId === undefined || record.manifestId === input.manifestId)
        .filter((record) => input.mode === undefined || record.mode === input.mode)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, input.limit ?? 100)
        .map((record) => summarizeToolForgeHarnessRun(record));

      return toolSuccess({
        tool: "forge.list_harness_runs",
        riskLevel: "low",
        data: { harnessRuns },
        observations: ["Listed stored Forge harness run summaries."]
      });
    }
  };

  const checkRegistrationEligibility: AgentHostToolDefinition<
    RegistrationArtifactInput,
    ToolForgeRegistrationEligibilityResult,
    AgentHostMcpContext
  > = {
    name: "forge.check_registration_eligibility",
    description: "Checks whether a generated Forge artifact is eligible for inert registration.",
    riskLevel: "low",
    inputSchema: registrationArtifactInputSchema,
    mcpInputSchema: registrationArtifactMcpInputSchema,
    inputSummary: "Check Forge registration eligibility",
    safety: {
      actionType: "observe"
    },
    async handler(input, context): Promise<ToolResult<ToolForgeRegistrationEligibilityResult>> {
      try {
        const artifact = await context.forge.loadArtifact(input.artifactId);
        const eligibility = await evaluateRegistrationEligibility(context, artifact);
        return toolSuccess({
          tool: "forge.check_registration_eligibility",
          riskLevel: "low",
          data: eligibility,
          observations: [
            eligibility.eligible
              ? "Registration eligibility passed without exposing or executing generated tools."
              : "Registration eligibility reported missing prerequisites without mutating any Forge records."
          ]
        });
      } catch (error) {
        return toolFailure({
          tool: "forge.check_registration_eligibility",
          riskLevel: "low",
          error: {
            code: "artifact_not_found",
            message: error instanceof Error ? error.message : "Stored artifact was not found."
          },
          observations: ["No stored artifact matched the requested artifact id."]
        });
      }
    }
  };

  const registerArtifact: AgentHostToolDefinition<
    RegisterArtifactInput,
    ToolForgeRegisterArtifactResult | (ActionPreviewResult & { eligibility: ToolForgeRegistrationEligibilityResult }),
    AgentHostMcpContext
  > = {
    name: "forge.register_artifact",
    description: "Creates a registered_inert Forge registration record without making generated tools callable.",
    riskLevel: "medium",
    inputSchema: registerArtifactInputSchema,
    mcpInputSchema: registerArtifactMcpInputSchema,
    inputSummary: "Register Forge artifact inertly",
    safety: {
      actionType: "file_write"
    },
    preview: {
      isDryRun: (input) => input.dryRun === true
    },
    async handler(
      input,
      context,
      runtime
    ): Promise<ToolResult<ToolForgeRegisterArtifactResult | (ActionPreviewResult & { eligibility: ToolForgeRegistrationEligibilityResult })>> {
      let artifact: ToolForgeArtifactRecord;

      try {
        artifact = await context.forge.loadArtifact(input.artifactId);
      } catch (error) {
        return toolFailure({
          tool: "forge.register_artifact",
          riskLevel: "medium",
          error: {
            code: "artifact_not_found",
            message: error instanceof Error ? error.message : "Stored artifact was not found."
          },
          observations: ["No stored artifact matched the requested artifact id."]
        });
      }

      const eligibility = await evaluateRegistrationEligibility(context, artifact);
      const safetyDecision =
        runtime?.safetyDecision ??
        evaluateSafety(
          {
            tool: "forge.register_artifact",
            actionType: "file_write",
            filePath: context.forge.registrationPath(`preview.${artifact.artifactId}`),
            generatedTool: true,
            generatedToolId: artifact.manifestId
          },
          context.policy,
          createSafetyEvaluationContext(context)
        );
      const targetSummary = `Register inert artifact ${artifact.manifestId}@${artifact.manifestVersion}`;
      const target = {
        artifactId: artifact.artifactId,
        manifestHash: artifact.manifestHash,
        reviewId: eligibility.reviewId,
        validationIds: eligibility.validationIds,
        harnessRunIds: eligibility.harnessRunIds,
        requiredGrantIds: eligibility.requiredGrantIds,
        registeredToolNames: eligibility.registeredTools.map((tool) => tool.name).sort()
      };

      if (runtime?.isDryRun) {
        const preview = buildPreviewResult({
          tool: "forge.register_artifact",
          riskLevel: "medium",
          safety: safetyDecision,
          targetSummary,
          target: toFilePreviewTarget(context.forge.registrationPath(`preview.${artifact.artifactId}`), targetSummary),
          wouldExecute: eligibility.eligible && safetyDecision.allowed,
          ...(eligibility.eligible
            ? {
                confirmation: {
                  manager: context.confirmations,
                  sessionId: context.sessionId,
                  input,
                  target,
                  explanation: "Use this token to write the exact previewed inert registration record before it expires.",
                  riskLevel: safetyDecision.riskLevel,
                  appSensitivity: safetyDecision.appSensitivity
                }
              }
            : {}),
          reasons: previewReasons(
            eligibility.eligible
              ? "Prepared an inert registration record preview without exposing generated tools."
              : eligibility.reasons[0] ?? "Registration eligibility is not satisfied.",
            safetyDecision.reasons
          ),
          observations: ["Previewed inert registration without mutating Forge records or exposing callable tools."]
        });

        return {
          ...preview,
          data: {
            ...(preview.data as ActionPreviewResult),
            eligibility
          }
        };
      }

      if (!eligibility.eligible) {
        return toolFailure({
          tool: "forge.register_artifact",
          riskLevel: safetyDecision.riskLevel,
          error: {
            code: "registration_ineligible",
            message: eligibility.reasons.join(" ")
          },
          observations: eligibility.reasons
        });
      }

      if (input.confirmationToken === undefined) {
        const { code, reason } = missingConfirmationReason(safetyDecision);
        return toolFailure({
          tool: "forge.register_artifact",
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
        tool: "forge.register_artifact",
        input,
        target,
        riskLevel: safetyDecision.riskLevel
      });

      if (!verification.ok) {
        return toolFailure({
          tool: "forge.register_artifact",
          riskLevel: safetyDecision.riskLevel,
          confirmation: rejectedConfirmation(verification.tokenId, verification.reason),
          error: {
            code: "confirmation_rejected",
            message: verification.reason
          },
          observations: [verification.reason]
        });
      }

      const manifest = await context.forge.loadManifestByPath(artifact.storagePath);
      const activeGrants = context.grants.listActiveGrants().filter((grant) =>
        eligibility.requiredGrantIds.includes(grant.id)
      );
      const registration = createToolForgeRegistrationRecord({
        artifact,
        eligibility,
        registeredTools: manifest.tools,
        permissionsSnapshot: manifest.requestedPermissions,
        grantsSnapshot: activeGrants,
        explanation: "Registered as inert Forge metadata after review, grants, scaffold, validation, and harness prerequisites passed.",
        status: "registered_inert"
      });
      await context.forge.saveRegistration(registration);

      return toolSuccess({
        tool: "forge.register_artifact",
        riskLevel: safetyDecision.riskLevel,
        confirmation: acceptedConfirmation(
          verification.tokenId,
          true,
          "Confirmation token accepted and inert registration executed."
        ),
        data: {
          eligibility,
          registration
        },
        observations: ["Stored a registered_inert record without loading, executing, or exposing generated tool handlers."]
      });
    }
  };

  const getRegistration: AgentHostToolDefinition<GetRegistrationInput, ToolForgeGetRegistrationResult, AgentHostMcpContext> = {
    name: "forge.get_registration",
    description: "Returns one stored Forge registration record.",
    riskLevel: "low",
    inputSchema: getRegistrationInputSchema,
    mcpInputSchema: getRegistrationMcpInputSchema,
    inputSummary: "Get Forge registration",
    safety: {
      actionType: "observe"
    },
    async handler(input, context): Promise<ToolResult<ToolForgeGetRegistrationResult>> {
      try {
        const registration = resolveEffectiveRegistrationStatus(
          await context.forge.loadRegistration(input.registrationId)
        );
        return toolSuccess({
          tool: "forge.get_registration",
          riskLevel: "low",
          data: { registration },
          observations: ["Returned one stored Forge registration record."]
        });
      } catch (error) {
        return toolFailure({
          tool: "forge.get_registration",
          riskLevel: "low",
          error: {
            code: "registration_not_found",
            message: error instanceof Error ? error.message : "Stored registration was not found."
          },
          observations: ["No stored registration matched the requested registration id."]
        });
      }
    }
  };

  const listRegistrations: AgentHostToolDefinition<
    ListRegistrationsInput,
    ToolForgeListRegistrationsResult,
    AgentHostMcpContext
  > = {
    name: "forge.list_registrations",
    description: "Lists stored Forge registration summaries.",
    riskLevel: "low",
    inputSchema: listRegistrationsInputSchema,
    mcpInputSchema: listRegistrationsMcpInputSchema,
    inputSummary: "List Forge registrations",
    safety: {
      actionType: "observe"
    },
    async handler(input, context): Promise<ToolResult<ToolForgeListRegistrationsResult>> {
      const registrations = (await context.forge.listRegistrations())
        .map((registration) => resolveEffectiveRegistrationStatus(registration))
        .filter((registration) => input.artifactId === undefined || registration.artifactId === input.artifactId)
        .filter((registration) => input.manifestId === undefined || registration.manifestId === input.manifestId)
        .filter((registration) => input.status === undefined || registration.status === input.status)
        .sort((left, right) => right.registeredAt.localeCompare(left.registeredAt))
        .slice(0, input.limit ?? 100)
        .map((registration) => summarizeToolForgeRegistration(registration));

      return toolSuccess({
        tool: "forge.list_registrations",
        riskLevel: "low",
        data: { registrations },
        observations: ["Listed stored Forge registration summaries."]
      });
    }
  };

  const revokeRegistration: AgentHostToolDefinition<
    RevokeRegistrationInput,
    ToolForgeRevokeRegistrationResult | ActionPreviewResult,
    AgentHostMcpContext
  > = {
    name: "forge.revoke_registration",
    description: "Marks a Forge registration record revoked without deleting it or exposing generated tools.",
    riskLevel: "medium",
    inputSchema: revokeRegistrationInputSchema,
    mcpInputSchema: revokeRegistrationMcpInputSchema,
    inputSummary: "Revoke Forge registration",
    safety: {
      actionType: "file_write"
    },
    preview: {
      isDryRun: (input) => input.dryRun === true
    },
    async handler(
      input,
      context,
      runtime
    ): Promise<ToolResult<ToolForgeRevokeRegistrationResult | ActionPreviewResult>> {
      let registration: ToolForgeRegistrationRecord;
      try {
        registration = resolveEffectiveRegistrationStatus(await context.forge.loadRegistration(input.registrationId));
      } catch (error) {
        return toolFailure({
          tool: "forge.revoke_registration",
          riskLevel: "medium",
          error: {
            code: "registration_not_found",
            message: error instanceof Error ? error.message : "Stored registration was not found."
          },
          observations: ["No stored registration matched the requested registration id."]
        });
      }

      const safetyDecision =
        runtime?.safetyDecision ??
        evaluateSafety(
          {
            tool: "forge.revoke_registration",
            actionType: "file_write",
            filePath: context.forge.registrationPath(registration.registrationId),
            generatedTool: true,
            generatedToolId: registration.manifestId
          },
          context.policy,
          createSafetyEvaluationContext(context)
        );
      const targetSummary = `Revoke inert registration ${registration.registrationId}`;
      const target = {
        registrationId: registration.registrationId,
        manifestHash: registration.manifestHash,
        status: registration.status
      };

      if (runtime?.isDryRun) {
        return buildPreviewResult({
          tool: "forge.revoke_registration",
          riskLevel: "medium",
          safety: safetyDecision,
          targetSummary,
          target: toFilePreviewTarget(context.forge.registrationPath(registration.registrationId), targetSummary),
          wouldExecute: registration.status !== "revoked" && safetyDecision.allowed,
          ...(registration.status === "revoked"
            ? {}
            : {
                confirmation: {
                  manager: context.confirmations,
                  sessionId: context.sessionId,
                  input,
                  target,
                  explanation: "Use this token to revoke the exact previewed inert registration before it expires.",
                  riskLevel: safetyDecision.riskLevel,
                  appSensitivity: safetyDecision.appSensitivity
                }
              }),
          reasons: previewReasons(
            registration.status === "revoked"
              ? "Registration is already revoked."
              : "Prepared a revocation preview without mutating registration metadata.",
            safetyDecision.reasons
          ),
          observations: ["Previewed registration revocation without changing Forge records."]
        });
      }

      if (registration.status === "revoked") {
        return toolFailure({
          tool: "forge.revoke_registration",
          riskLevel: safetyDecision.riskLevel,
          error: {
            code: "registration_already_revoked",
            message: "Registration is already revoked."
          },
          observations: ["The requested registration was already revoked."]
        });
      }

      if (input.confirmationToken === undefined) {
        const { code, reason } = missingConfirmationReason(safetyDecision);
        return toolFailure({
          tool: "forge.revoke_registration",
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
        tool: "forge.revoke_registration",
        input,
        target,
        riskLevel: safetyDecision.riskLevel
      });

      if (!verification.ok) {
        return toolFailure({
          tool: "forge.revoke_registration",
          riskLevel: safetyDecision.riskLevel,
          confirmation: rejectedConfirmation(verification.tokenId, verification.reason),
          error: {
            code: "confirmation_rejected",
            message: verification.reason
          },
          observations: [verification.reason]
        });
      }

      const revokedRegistration: ToolForgeRegistrationRecord = {
        ...registration,
        status: "revoked",
        explanation: input.reason ?? "Registration revoked explicitly."
      };
      await context.forge.saveRegistration(revokedRegistration);

      return toolSuccess({
        tool: "forge.revoke_registration",
        riskLevel: safetyDecision.riskLevel,
        confirmation: acceptedConfirmation(
          verification.tokenId,
          true,
          "Confirmation token accepted and inert registration revocation executed."
        ),
        data: {
          registration: revokedRegistration
        },
        observations: ["Revoked the inert registration record without exposing or executing generated tools."]
      });
    }
  };

  const checkRuntimeEligibility: AgentHostToolDefinition<
    RuntimeEligibilityInput,
    ToolForgeCheckRuntimeEligibilityResult,
    AgentHostMcpContext
  > = {
    name: "forge.check_runtime_eligibility",
    description: "Checks whether a registered inert Forge artifact is eligible for limited sandbox runtime handling.",
    riskLevel: "low",
    inputSchema: runtimeEligibilityInputSchema,
    mcpInputSchema: runtimeEligibilityMcpInputSchema,
    inputSummary: "Check Forge runtime eligibility",
    safety: {
      actionType: "observe"
    },
    async handler(input, context): Promise<ToolResult<ToolForgeCheckRuntimeEligibilityResult>> {
      let registration: ToolForgeRegistrationRecord;

      try {
        registration = resolveEffectiveRegistrationStatus(await context.forge.loadRegistration(input.registrationId));
      } catch (error) {
        return toolFailure({
          tool: "forge.check_runtime_eligibility",
          riskLevel: "low",
          error: {
            code: "registration_not_found",
            message: error instanceof Error ? error.message : "Stored registration was not found."
          },
          observations: ["No stored registration matched the requested runtime eligibility id."]
        });
      }

      try {
        const resolution = await evaluateRuntimeEligibility({
          context,
          registration,
          ...(input.toolName === undefined ? {} : { requestedToolName: input.toolName })
        });

        return toolSuccess({
          tool: "forge.check_runtime_eligibility",
          riskLevel: "low",
          data: {
            eligibility: resolution.eligibility
          },
          observations: [
            resolution.eligibility.eligible
              ? "Runtime eligibility passed for the limited Phase 18 metadata stub."
              : "Runtime eligibility reported why the inert registration cannot enter the Phase 18 runtime boundary."
          ]
        });
      } catch (error) {
        return toolFailure({
          tool: "forge.check_runtime_eligibility",
          riskLevel: "low",
          error: {
            code: "runtime_eligibility_failed",
            message: error instanceof Error ? error.message : "Runtime eligibility could not be evaluated."
          },
          observations: ["Runtime eligibility failed before any execution or registration change."]
        });
      }
    }
  };

  const runSandboxedTool: AgentHostToolDefinition<
    RunSandboxedToolInput,
    ToolForgeRunSandboxedToolResult | (ActionPreviewResult & { eligibility: ToolForgeRuntimeEligibilityResult }),
    AgentHostMcpContext
  > = {
    name: "forge.run_sandboxed_tool",
    description: "Runs a confirmation-gated fixed JSON handler for one registered inert Forge tool; generated source is never loaded or registered.",
    riskLevel: "medium",
    inputSchema: runSandboxedToolInputSchema,
    mcpInputSchema: runSandboxedToolMcpInputSchema,
    inputSummary: "Run Forge sandboxed metadata stub",
    safety: {
      actionType: "file_write",
      getInput: () => ({})
    },
    preview: {
      isDryRun: (input) => input.dryRun === true
    },
    async handler(
      input,
      context,
      runtime
    ): Promise<ToolResult<ToolForgeRunSandboxedToolResult | (ActionPreviewResult & { eligibility: ToolForgeRuntimeEligibilityResult })>> {
      let registration: ToolForgeRegistrationRecord;

      try {
        registration = resolveEffectiveRegistrationStatus(await context.forge.loadRegistration(input.registrationId));
      } catch (error) {
        return toolFailure({
          tool: "forge.run_sandboxed_tool",
          riskLevel: "medium",
          error: {
            code: "registration_not_found",
            message: error instanceof Error ? error.message : "Stored registration was not found."
          },
          observations: ["No stored registration matched the requested sandbox runtime id."]
        });
      }

      let resolution: Awaited<ReturnType<typeof evaluateRuntimeEligibility>>;
      try {
        resolution = await evaluateRuntimeEligibility({
          context,
          registration,
          mode: input.mode ?? "stub",
          ...(input.toolName === undefined ? {} : { requestedToolName: input.toolName })
        });
      } catch (error) {
        return toolFailure({
          tool: "forge.run_sandboxed_tool",
          riskLevel: "medium",
          error: {
            code: "runtime_eligibility_failed",
            message: error instanceof Error ? error.message : "Runtime eligibility could not be evaluated."
          },
          observations: ["Runtime execution stopped before preview or execution because eligibility resolution failed."]
        });
      }
      const runnerMode = input.mode ?? "stub";
      let sandboxSelection: ForgeRuntimeSandboxSelection | undefined;
      if (runnerMode === "subprocess") {
        try {
          sandboxSelection = await selectRuntimeSandbox(context);
        } catch (error) {
          return toolFailure({ tool: "forge.run_sandboxed_tool", riskLevel: "medium", error: { code: "sandbox_probe_failed", message: error instanceof Error ? error.message : "Sandbox support could not be checked." }, observations: ["No generated code was executed."] });
        }
      }
      const targetSummary = resolution.tool === undefined ? `Preview Forge runtime ${runnerMode} ${input.toolName}` : `Run Forge runtime ${runnerMode} ${resolution.tool.name}`;
      const target = {
        registrationId: resolution.registration.registrationId,
        manifestHash: resolution.registration.manifestHash,
        toolName: resolution.eligibility.toolName,
        mode: input.mode ?? "stub",
        projectPath: resolution.artifact.projectPath,
        outputRoot: resolution.eligibility.sandbox.outputRoot,
        ...(sandboxSelection === undefined ? {} : { sandboxBackend: sandboxSelection.backend, sandboxFallbackUsed: sandboxSelection.fallbackUsed, sandboxCommandPath: sandboxSelection.commandPath ?? null })
      };
      const runtimeRunPath = context.forge.runtimeRunPath(
        `preview.${resolution.registration.registrationId}.${resolution.eligibility.toolName || input.toolName}`
      );
      const safetyDecision = evaluateSafety(
        {
          tool: "forge.run_sandboxed_tool",
          actionType: "file_write",
          filePath: runtimeRunPath,
          generatedTool: true,
          generatedToolId: resolution.manifest.id
        },
        context.policy,
        createSafetyEvaluationContext(context)
      );

      if (runtime?.isDryRun) {
        const preview = buildPreviewResult({
          tool: "forge.run_sandboxed_tool",
          riskLevel: "medium",
          safety: safetyDecision,
          targetSummary,
          target: toFilePreviewTarget(runtimeRunPath, targetSummary),
          wouldExecute: resolution.eligibility.eligible && safetyDecision.allowed && (sandboxSelection === undefined || sandboxSelectionUsable(sandboxSelection)),
          ...(resolution.eligibility.eligible
            ? {
                confirmation: {
                  manager: context.confirmations,
                  sessionId: context.sessionId,
                  input,
                  target,
                  explanation:
                    `Use this token to run exact previewed Forge ${runnerMode} runtime before it expires.`,
                  riskLevel: safetyDecision.riskLevel,
                  appSensitivity: safetyDecision.appSensitivity
                }
              }
            : {}),
          reasons: previewReasons(
            resolution.eligibility.eligible
              ? `Prepared Forge ${runnerMode} runtime preview without exposing generated tools.`
              : resolution.eligibility.reasons[0] ?? "Runtime eligibility is not satisfied.",
            safetyDecision.reasons
          ),
          observations: ["Previewed Forge runtime boundary without executing generated code."]
        });

        return {
          ...preview,
          grantDecision: safetyDecision.grantDecision,
          data: {
            ...(preview.data as ActionPreviewResult),
            eligibility: resolution.eligibility,
            ...(sandboxSelection === undefined ? {} : { sandbox: sandboxSelection })
          }
        };
      }

      if (!resolution.eligibility.eligible || resolution.tool === undefined || resolution.artifact.projectPath === undefined) {
        return toolFailure({
          tool: "forge.run_sandboxed_tool",
          riskLevel: safetyDecision.riskLevel,
          grantDecision: safetyDecision.grantDecision,
          approval: safetyDecision.approval,
          error: {
            code: "runtime_ineligible",
            message: resolution.eligibility.reasons.join(" ") || "The requested Forge runtime action is not eligible."
          },
          observations: resolution.eligibility.reasons
        });
      }

      if (sandboxSelection !== undefined && !sandboxSelectionUsable(sandboxSelection)) {
        return toolFailure({ tool: "forge.run_sandboxed_tool", riskLevel: safetyDecision.riskLevel, grantDecision: safetyDecision.grantDecision, approval: safetyDecision.approval, error: { code: "sandbox_backend_unavailable", message: sandboxSelection.limitations[0] ?? "Requested sandbox backend is unavailable." }, observations: sandboxSelection.limitations });
      }

      if (input.confirmationToken === undefined) {
        const { code, reason } = missingConfirmationReason(safetyDecision);
        return toolFailure({
          tool: "forge.run_sandboxed_tool",
          riskLevel: safetyDecision.riskLevel,
          confirmation: confirmationRequired(reason),
          grantDecision: safetyDecision.grantDecision,
          approval: safetyDecision.approval,
          error: {
            code,
            message: reason
          },
          observations: [reason]
        });
      }

      const verification = context.confirmations.verifyAndConsume(input.confirmationToken, {
        sessionId: context.sessionId,
        tool: "forge.run_sandboxed_tool",
        input,
        target,
        riskLevel: safetyDecision.riskLevel
      });

      if (!verification.ok) {
        return toolFailure({
          tool: "forge.run_sandboxed_tool",
          riskLevel: safetyDecision.riskLevel,
          confirmation: rejectedConfirmation(verification.tokenId, verification.reason),
          grantDecision: safetyDecision.grantDecision,
          approval: safetyDecision.approval,
          error: {
            code: "confirmation_rejected",
            message: verification.reason
          },
          observations: [verification.reason]
        });
      }

      if (runnerMode === "subprocess") {
        const rechecked = await evaluateRuntimeEligibility({ context, registration: resolution.registration, requestedToolName: resolution.tool.name, mode: "subprocess" });
        if (!rechecked.eligibility.eligible || rechecked.artifact.projectPath === undefined) {
          return toolFailure({ tool: "forge.run_sandboxed_tool", riskLevel: safetyDecision.riskLevel, confirmation: rejectedConfirmation(verification.tokenId, "Runtime eligibility changed before spawn."), grantDecision: safetyDecision.grantDecision, approval: safetyDecision.approval, error: { code: "runtime_ineligible", message: rechecked.eligibility.reasons.join(" ") || "Runtime eligibility changed before spawn." }, observations: rechecked.eligibility.reasons });
        }
        const recheckedSandbox = await selectRuntimeSandbox(context);
        if (!sandboxSelectionUsable(recheckedSandbox) || recheckedSandbox.backend !== sandboxSelection!.backend || recheckedSandbox.commandPath !== sandboxSelection!.commandPath) {
          return toolFailure({ tool: "forge.run_sandboxed_tool", riskLevel: safetyDecision.riskLevel, confirmation: rejectedConfirmation(verification.tokenId, "Sandbox backend changed after preview; request a new preview."), grantDecision: safetyDecision.grantDecision, approval: safetyDecision.approval, error: { code: "sandbox_backend_changed", message: "Sandbox backend changed after preview; request a new preview." }, observations: recheckedSandbox.limitations });
        }
        const { runId, runDirectory } = createRuntimeRunDirectory(path.join(context.forge.rootDir(), "runtime-runs"));
        const manifestPath = path.join(rechecked.artifact.projectPath, "agenthost.manifest.json");
        const handlerPath = path.join(rechecked.artifact.projectPath, "runtime", "handler.json");
        try {
          await mkdir(runDirectory, { recursive: true, mode: 0o700 });
          const paths = await prepareRuntimeRun({ runDirectory, payload: input.input ?? null });
          const processResult = await runForgeSubprocess({ projectPath: rechecked.artifact.projectPath, manifestPath, handlerPath, toolName: rechecked.tool!.name, inputPath: paths.inputPath, outputPath: paths.outputPath, tempDirectory: paths.tempDirectory, timeoutMs: rechecked.eligibility.enforcedLimits.maxRuntimeMs, allowedOperations: rechecked.eligibility.allowedOperations, sandbox: recheckedSandbox });
          await rm(paths.inputPath, { force: true });
          await rm(paths.tempDirectory, { recursive: true, force: true });
          const runtimeRun: ToolForgeRuntimeRunRecord = { runtimeRunId: runId, registrationId: rechecked.registration.registrationId, artifactId: rechecked.artifact.artifactId, manifestId: rechecked.artifact.manifestId, manifestVersion: rechecked.artifact.manifestVersion, manifestHash: rechecked.artifact.manifestHash, toolName: rechecked.tool!.name, mode: "subprocess", status: processResult.status, executedGeneratedCode: false, metadataOnly: false, runnerMode: "subprocess", sandboxBackend: processResult.sandboxBackend, sandboxLimitations: processResult.sandboxLimitations, projectPath: rechecked.artifact.projectPath, outputRoot: runDirectory, inputFingerprint: context.confirmations.fingerprintInput(input), summary: processResult.status === "passed" ? "Fixed runner evaluated bounded JSON handler." : "Fixed runner did not complete successfully.", sandbox: rechecked.eligibility.sandbox, durationMs: processResult.durationMs, commandSummary: processResult.commandSummary, cwd: processResult.cwd, envKeys: processResult.envKeys, timeoutMs: rechecked.eligibility.enforcedLimits.maxRuntimeMs, outputSizeBytes: processResult.outputSizeBytes, runtimeCapabilitiesUsed: rechecked.eligibility.grantedRuntimeCapabilities, enforcedLimits: rechecked.eligibility.enforcedLimits, ...(processResult.status === "passed" ? { resultSummary: "JSON result returned." } : {}), ...(processResult.errorSummary === undefined ? {} : { errorSummary: processResult.errorSummary }), executableStillFalse: true, liveStillFalse: true, createdAt: new Date().toISOString() };
          await context.forge.saveRuntimeRun(runtimeRun);
          if (processResult.status !== "passed") return toolFailure({ tool: "forge.run_sandboxed_tool", riskLevel: safetyDecision.riskLevel, confirmation: acceptedConfirmation(verification.tokenId, true, "Confirmation token accepted; subprocess failed safely."), grantDecision: safetyDecision.grantDecision, approval: safetyDecision.approval, error: { code: processResult.status === "timeout" ? "runtime_timeout" : "runtime_failed", message: processResult.errorSummary ?? "Runner failed." }, observations: [processResult.errorSummary ?? "Runner failed."] });
          return toolSuccess({ tool: "forge.run_sandboxed_tool", riskLevel: safetyDecision.riskLevel, confirmation: acceptedConfirmation(verification.tokenId, true, "Confirmation token accepted and fixed subprocess runner completed."), grantDecision: safetyDecision.grantDecision, approval: safetyDecision.approval, data: { eligibility: rechecked.eligibility, runtimeRun, output: { mode: "subprocess", generatedCodeExecuted: false, metadataOnly: false, result: processResult.result ?? null, sandbox: rechecked.eligibility.sandbox } }, observations: ["Fixed runner evaluated bounded JSON handler; no live tool registered."] });
        } catch (error) {
          return toolFailure({ tool: "forge.run_sandboxed_tool", riskLevel: safetyDecision.riskLevel, confirmation: acceptedConfirmation(verification.tokenId, true, "Confirmation token accepted; sandbox setup failed safely."), grantDecision: safetyDecision.grantDecision, approval: safetyDecision.approval, error: { code: "sandbox_failed", message: error instanceof Error ? error.message : "Sandbox setup failed." }, observations: ["No generated JavaScript executed."] });
        }
      }

      const startedAt = performance.now();
      const output = buildRuntimeStubOutput({
        registration: resolution.registration,
        manifest: resolution.manifest,
        tool: resolution.tool,
        sandbox: resolution.eligibility.sandbox
      });
      const runtimeRun = createToolForgeRuntimeRunRecord({
        registration: resolution.registration,
        artifact: resolution.artifact,
        toolName: resolution.tool.name,
        projectPath: resolution.artifact.projectPath,
        outputRoot: resolution.eligibility.sandbox.outputRoot ?? createRuntimeOutputRoot(context, resolution.artifact),
        inputFingerprint: context.confirmations.fingerprintInput(input),
        summary: "Executed the built-in Phase 18 metadata stub without loading any generated code.",
        sandbox: resolution.eligibility.sandbox,
        durationMs: Math.round(performance.now() - startedAt)
      });
      await context.forge.saveRuntimeRun(runtimeRun);

      return toolSuccess({
        tool: "forge.run_sandboxed_tool",
        riskLevel: safetyDecision.riskLevel,
        confirmation: acceptedConfirmation(
          verification.tokenId,
          true,
          "Confirmation token accepted and the Phase 18 metadata stub executed."
        ),
        grantDecision: safetyDecision.grantDecision,
        approval: safetyDecision.approval,
        data: {
          eligibility: resolution.eligibility,
          runtimeRun,
          output
        },
        observations: ["Ran the built-in Forge metadata stub without executing or importing generated code."]
      });
    }
  };

  const getRuntimeRun: AgentHostToolDefinition<
    GetRuntimeRunInput,
    ToolForgeGetRuntimeRunResult,
    AgentHostMcpContext
  > = {
    name: "forge.get_runtime_run",
    description: "Returns one stored Forge runtime run record.",
    riskLevel: "low",
    inputSchema: getRuntimeRunInputSchema,
    mcpInputSchema: getRuntimeRunMcpInputSchema,
    inputSummary: "Get Forge runtime run",
    safety: {
      actionType: "observe"
    },
    async handler(input, context): Promise<ToolResult<ToolForgeGetRuntimeRunResult>> {
      try {
        const runtimeRun = await context.forge.loadRuntimeRun(input.runtimeRunId);
        return toolSuccess({
          tool: "forge.get_runtime_run",
          riskLevel: "low",
          data: { runtimeRun },
          observations: ["Returned one stored Forge runtime run record."]
        });
      } catch (error) {
        return toolFailure({
          tool: "forge.get_runtime_run",
          riskLevel: "low",
          error: {
            code: "runtime_run_not_found",
            message: error instanceof Error ? error.message : "Stored runtime run was not found."
          },
          observations: ["No stored runtime run matched the requested id."]
        });
      }
    }
  };

  const listRuntimeRuns: AgentHostToolDefinition<
    ListRuntimeRunsInput,
    ToolForgeListRuntimeRunsResult,
    AgentHostMcpContext
  > = {
    name: "forge.list_runtime_runs",
    description: "Lists stored Forge runtime run summaries.",
    riskLevel: "low",
    inputSchema: listRuntimeRunsInputSchema,
    mcpInputSchema: listRuntimeRunsMcpInputSchema,
    inputSummary: "List Forge runtime runs",
    safety: {
      actionType: "observe"
    },
    async handler(input, context): Promise<ToolResult<ToolForgeListRuntimeRunsResult>> {
      const runtimeRuns = (await context.forge.listRuntimeRuns())
        .filter((record) => input.registrationId === undefined || record.registrationId === input.registrationId)
        .filter((record) => input.artifactId === undefined || record.artifactId === input.artifactId)
        .filter((record) => input.manifestId === undefined || record.manifestId === input.manifestId)
        .filter((record) => input.toolName === undefined || record.toolName === input.toolName)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, input.limit ?? 100)
        .map((record) => summarizeToolForgeRuntimeRun(record));

      return toolSuccess({
        tool: "forge.list_runtime_runs",
        riskLevel: "low",
        data: { runtimeRuns },
        observations: ["Listed stored Forge runtime run summaries."]
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
    applySessionGrants,
    scaffoldProject,
    validateProject,
    getArtifact,
    listArtifacts,
    getValidation,
    listValidations,
    runValidationHarness,
    getHarnessRun,
    listHarnessRuns,
    checkRegistrationEligibility,
    registerArtifact,
    getRegistration,
    listRegistrations,
    revokeRegistration,
    checkRuntimeEligibility,
    runSandboxedTool,
    getRuntimeRun,
    listRuntimeRuns
  ];
}
