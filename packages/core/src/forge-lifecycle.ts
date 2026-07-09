import { createHash } from "node:crypto";
import type {
  CapabilityGrant,
  PolicyProfileName,
  ToolForgeArtifactRecord,
  ToolForgeArtifactStatus,
  ToolForgeArtifactSummary,
  ToolForgeGrantProposalResult,
  ToolForgeHarnessMode,
  ToolForgeHarnessRunRecord,
  ToolForgeHarnessRunSummary,
  ToolForgeHarnessStatus,
  ToolForgeManifest,
  ToolForgeManifestSummary,
  ToolForgeValidationCheck,
  ToolForgeValidationRecord,
  ToolForgeValidationStatus,
  ToolForgeValidationSummary,
  ToolForgeReviewDecisionStatus,
  ToolForgeReviewRecord,
  ToolForgeReviewResult,
  ToolForgeReviewSummary
} from "./types.js";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
}

export function canonicalizeToolForgeManifest(manifest: ToolForgeManifest): string {
  return stableStringify(manifest);
}

export function hashToolForgeManifest(manifest: ToolForgeManifest): string {
  return createHash("sha256").update(canonicalizeToolForgeManifest(manifest)).digest("hex");
}

export function createToolForgeArtifactId(manifest: ToolForgeManifest, manifestHash: string): string {
  return `artifact.${manifest.id}.${manifest.version}.${manifestHash.slice(0, 12)}`;
}

export function createToolForgeReviewId(manifest: ToolForgeManifest, manifestHash: string): string {
  return `review.${manifest.id}.${manifest.version}.${manifestHash.slice(0, 12)}`;
}

export function createToolForgeValidationId(
  artifact: Pick<ToolForgeArtifactRecord, "manifestId" | "manifestVersion" | "manifestHash">
): string {
  return `validation.${artifact.manifestId}.${artifact.manifestVersion}.${artifact.manifestHash.slice(0, 12)}`;
}

export function createToolForgeHarnessRunId(input: {
  artifact: Pick<ToolForgeArtifactRecord, "manifestId" | "manifestVersion" | "manifestHash">;
  mode: ToolForgeHarnessMode;
  now?: string;
}): string {
  const timestampSegment = (input.now ?? new Date().toISOString()).replace(/[^0-9]/g, "").slice(0, 14);
  return `harness.${input.artifact.manifestId}.${input.artifact.manifestVersion}.${input.mode}.${input.artifact.manifestHash.slice(0, 12)}.${timestampSegment}`;
}

export function createToolForgeArtifactRecord(input: {
  manifest: ToolForgeManifest;
  manifestHash: string;
  storagePath: string;
  status: ToolForgeArtifactStatus;
  existing?: ToolForgeArtifactRecord;
  now?: string;
}): ToolForgeArtifactRecord {
  const now = input.now ?? new Date().toISOString();

  return {
    artifactId: input.existing?.artifactId ?? createToolForgeArtifactId(input.manifest, input.manifestHash),
    manifestId: input.manifest.id,
    manifestVersion: input.manifest.version,
    manifestHash: input.manifestHash,
    kind: input.manifest.kind,
    source: input.manifest.source,
    storagePath: input.storagePath,
    status: input.status,
    executable: false,
    registered: false,
    createdAt: input.existing?.createdAt ?? now,
    updatedAt: now
  };
}

export function createToolForgeReviewRecord(input: {
  manifest: ToolForgeManifest;
  manifestHash: string;
  profile: PolicyProfileName;
  review: ToolForgeReviewResult;
  proposals: ToolForgeGrantProposalResult;
  blockedPermissions: string[];
  explanation?: string;
  decisionStatus?: ToolForgeReviewDecisionStatus;
  now?: string;
}): ToolForgeReviewRecord {
  const now = input.now ?? new Date().toISOString();

  return {
    reviewId: createToolForgeReviewId(input.manifest, input.manifestHash),
    manifestId: input.manifest.id,
    manifestVersion: input.manifest.version,
    manifestHash: input.manifestHash,
    timestamp: now,
    profile: input.profile,
    riskLevel: input.review.riskLevel,
    dataSensitivity: input.review.dataSensitivity,
    dangerousPermissions: [...input.review.dangerousPermissions],
    blockedPermissions: [...input.blockedPermissions],
    missingGrants: [...input.review.missingGrants],
    proposedGrants: input.proposals.proposals.map((proposal) => proposal.grant),
    decisionStatus: input.decisionStatus ?? "pending",
    explanation: input.explanation ?? "Review created from the current manifest and active profile.",
    saferAlternatives: [...input.review.saferAlternatives],
    review: input.review
  };
}

export function summarizeToolForgeArtifact(record: ToolForgeArtifactRecord): ToolForgeManifestSummary {
  return {
    manifestId: record.manifestId,
    manifestVersion: record.manifestVersion,
    manifestHash: record.manifestHash,
    kind: record.kind,
    source: record.source,
    status: record.status,
    executable: false,
    registered: false,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

export function summarizeToolForgeArtifactRecord(record: ToolForgeArtifactRecord): ToolForgeArtifactSummary {
  return {
    artifactId: record.artifactId,
    manifestId: record.manifestId,
    manifestVersion: record.manifestVersion,
    manifestHash: record.manifestHash,
    kind: record.kind,
    source: record.source,
    storagePath: record.storagePath,
    ...(record.projectPath === undefined ? {} : { projectPath: record.projectPath }),
    status: record.status,
    executable: false,
    registered: false,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

export function summarizeToolForgeReview(record: ToolForgeReviewRecord): ToolForgeReviewSummary {
  return {
    reviewId: record.reviewId,
    manifestId: record.manifestId,
    manifestVersion: record.manifestVersion,
    manifestHash: record.manifestHash,
    timestamp: record.timestamp,
    profile: record.profile,
    riskLevel: record.riskLevel,
    decisionStatus: record.decisionStatus
  };
}

export function createToolForgeValidationRecord(input: {
  artifact: ToolForgeArtifactRecord;
  projectPath: string;
  checks: ToolForgeValidationCheck[];
  status: ToolForgeValidationStatus;
  safeToConsiderRegistration: boolean;
  summary: string;
  now?: string;
}): ToolForgeValidationRecord {
  const now = input.now ?? new Date().toISOString();

  return {
    validationId: createToolForgeValidationId(input.artifact),
    artifactId: input.artifact.artifactId,
    manifestId: input.artifact.manifestId,
    manifestHash: input.artifact.manifestHash,
    projectPath: input.projectPath,
    status: input.status,
    checks: input.checks.map((check) => ({ ...check })),
    createdAt: now,
    summary: input.summary,
    safeToConsiderRegistration: input.safeToConsiderRegistration
  };
}

export function summarizeToolForgeValidation(
  record: ToolForgeValidationRecord
): ToolForgeValidationSummary {
  return {
    validationId: record.validationId,
    artifactId: record.artifactId,
    manifestId: record.manifestId,
    manifestHash: record.manifestHash,
    projectPath: record.projectPath,
    status: record.status,
    createdAt: record.createdAt,
    summary: record.summary,
    safeToConsiderRegistration: record.safeToConsiderRegistration
  };
}

export function createToolForgeHarnessRunRecord(input: {
  artifact: ToolForgeArtifactRecord;
  projectPath: string;
  mode: ToolForgeHarnessMode;
  status: ToolForgeHarnessStatus;
  checks: ToolForgeValidationCheck[];
  stdoutSummary?: string;
  stderrSummary?: string;
  durationMs: number;
  safeToConsiderRegistration: boolean;
  now?: string;
}): ToolForgeHarnessRunRecord {
  const now = input.now ?? new Date().toISOString();

  return {
    harnessRunId: createToolForgeHarnessRunId({
      artifact: input.artifact,
      mode: input.mode,
      now
    }),
    artifactId: input.artifact.artifactId,
    manifestId: input.artifact.manifestId,
    manifestHash: input.artifact.manifestHash,
    projectPath: input.projectPath,
    mode: input.mode,
    status: input.status,
    checks: input.checks.map((check) => ({ ...check })),
    stdoutSummary: input.stdoutSummary ?? "",
    stderrSummary: input.stderrSummary ?? "",
    durationMs: input.durationMs,
    safeToConsiderRegistration: input.safeToConsiderRegistration,
    createdAt: now
  };
}

export function summarizeToolForgeHarnessRun(
  record: ToolForgeHarnessRunRecord
): ToolForgeHarnessRunSummary {
  return {
    harnessRunId: record.harnessRunId,
    artifactId: record.artifactId,
    manifestId: record.manifestId,
    manifestHash: record.manifestHash,
    projectPath: record.projectPath,
    mode: record.mode,
    status: record.status,
    durationMs: record.durationMs,
    safeToConsiderRegistration: record.safeToConsiderRegistration,
    createdAt: record.createdAt
  };
}

export function canApplySessionGrantsFromReview(record: ToolForgeReviewRecord): {
  ok: boolean;
  reasons: string[];
  safeGrantIds: string[];
} {
  const reasons: string[] = [];

  if (record.blockedPermissions.length > 0) {
    reasons.push("Review contains blocked permissions.");
  }

  if (record.decisionStatus === "denied" || record.decisionStatus === "expired") {
    reasons.push(`Review status ${record.decisionStatus} cannot apply session grants.`);
  }

  const unsafeGrants = record.proposedGrants.filter((grant) => {
    const appSensitivities = grant.match.appSensitivities ?? [];
    const hasDangerousAction =
      (grant.match.actionTypes ?? []).some((actionType) =>
        actionType === "communication_send" || actionType === "upload" || actionType === "file_delete"
      ) ||
      appSensitivities.includes("credential_or_security");

    return hasDangerousAction;
  });

  if (unsafeGrants.length > 0) {
    reasons.push("Review includes dangerous grant proposals that are not eligible for automatic session application.");
  }

  return {
    ok: reasons.length === 0,
    reasons,
    safeGrantIds: record.proposedGrants.filter((grant) => !unsafeGrants.includes(grant)).map((grant) => grant.id)
  };
}
