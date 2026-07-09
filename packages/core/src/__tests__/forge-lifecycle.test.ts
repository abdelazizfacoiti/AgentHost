import { describe, expect, it } from "vitest";
import {
  canApplySessionGrantsFromReview,
  createToolForgeArtifactRecord,
  createToolForgeReviewRecord,
  getPolicyProfile,
  hashToolForgeManifest,
  proposeToolForgeGrants,
  reviewToolForgeManifest,
  summarizeToolForgeArtifact,
  summarizeToolForgeReview,
  validateToolForgeManifest,
  type ToolForgeManifest
} from "../index.js";

const manifest: ToolForgeManifest = {
  schemaVersion: "agenthost.forge.v1",
  id: "example.generated-tool",
  displayName: "Example Generated Tool",
  version: "1.2.3",
  description: "Lifecycle manifest.",
  kind: "tool",
  source: "generated",
  tools: [
    {
      name: "example.generated.preview",
      description: "Preview-only declaration.",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      riskLevel: "low",
      actionType: "inspect",
      strategy: "guide_only"
    }
  ],
  requestedPermissions: [
    {
      id: "write-output",
      tools: ["file.write"],
      fileRoots: ["~/.agenthost/outputs"],
      canWriteFiles: true
    }
  ],
  riskDeclaration: "medium",
  dataSensitivityDeclaration: "low",
  requirements: {
    requiresDryRun: true,
    requiresConfirmationToken: true
  }
};

describe("Tool Forge lifecycle helpers", () => {
  it("hashes equivalent manifests stably", () => {
    const hashA = hashToolForgeManifest(manifest);
    const hashB = hashToolForgeManifest(JSON.parse(JSON.stringify(manifest)));

    expect(hashA).toBe(hashB);
  });

  it("changes the hash when the manifest content changes", () => {
    const changed = {
      ...manifest,
      description: "Changed lifecycle manifest."
    };

    expect(hashToolForgeManifest(changed)).not.toBe(hashToolForgeManifest(manifest));
  });

  it("creates inert artifact and review records", () => {
    const validation = validateToolForgeManifest(manifest);
    expect(validation.valid).toBe(true);
    const reviewed = reviewToolForgeManifest(manifest, { policy: getPolicyProfile("strict"), grants: [] });
    const proposals = proposeToolForgeGrants(manifest);
    const manifestHash = hashToolForgeManifest(manifest);

    const artifact = createToolForgeArtifactRecord({
      manifest,
      manifestHash,
      storagePath: "/tmp/example/manifest.json",
      status: "validated",
      now: "2026-01-01T00:00:00.000Z"
    });
    const review = createToolForgeReviewRecord({
      manifest,
      manifestHash,
      profile: "strict",
      review: reviewed,
      proposals,
      blockedPermissions: [],
      now: "2026-01-01T00:00:01.000Z"
    });

    expect(artifact.executable).toBe(false);
    expect(artifact.registered).toBe(false);
    expect(review.manifestHash).toBe(manifestHash);
    expect(summarizeToolForgeArtifact(artifact).status).toBe("validated");
    expect(summarizeToolForgeReview(review).decisionStatus).toBe("pending");
  });

  it("rejects session grant application when blocked permissions exist", () => {
    const reviewed = reviewToolForgeManifest(manifest, { policy: getPolicyProfile("strict"), grants: [] });
    const proposals = proposeToolForgeGrants(manifest);
    const review = createToolForgeReviewRecord({
      manifest,
      manifestHash: hashToolForgeManifest(manifest),
      profile: "strict",
      review: reviewed,
      proposals,
      blockedPermissions: ["write-output"]
    });

    const eligibility = canApplySessionGrantsFromReview(review);
    expect(eligibility.ok).toBe(false);
  });
});
