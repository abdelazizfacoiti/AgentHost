import { describe, expect, it } from "vitest";
import { getDefaultPolicy, proposeToolForgeGrants, reviewToolForgeManifest, validateToolForgeManifest } from "../index.js";

const validManifest = {
  schemaVersion: "agenthost.forge.v1",
  id: "example.generated-tool",
  displayName: "Example Generated Tool",
  version: "1.2.3",
  description: "A generated tool manifest used for validation tests.",
  kind: "tool",
  source: "generated",
  tools: [
    {
      name: "example.generated.preview",
      description: "Preview-only generated tool declaration.",
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
      canWriteFiles: true,
      requiresDryRun: true,
      requiresConfirmationToken: true
    }
  ],
  riskDeclaration: "medium",
  dataSensitivityDeclaration: "low",
  requirements: {
    requiresDryRun: true,
    requiresConfirmationToken: true
  }
} as const;

describe("Tool Forge core helpers", () => {
  it("accepts a valid manifest", () => {
    const result = validateToolForgeManifest(validManifest);

    expect(result.valid).toBe(true);
    expect(result.manifest?.id).toBe("example.generated-tool");
  });

  it("rejects an invalid manifest id", () => {
    const result = validateToolForgeManifest({
      ...validManifest,
      id: "Invalid Id"
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((entry) => entry.code === "manifest.id.invalid")).toBe(true);
  });

  it("rejects an invalid version", () => {
    const result = validateToolForgeManifest({
      ...validManifest,
      version: "1.2"
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((entry) => entry.code === "manifest.version.invalid")).toBe(true);
  });

  it("rejects an unknown kind through schema validation", () => {
    const result = validateToolForgeManifest({
      ...validManifest,
      kind: "plugin"
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((entry) => entry.code === "manifest.schema")).toBe(true);
  });

  it("rejects broad filesystem roots", () => {
    const result = validateToolForgeManifest({
      ...validManifest,
      requestedPermissions: [
        {
          id: "write-anywhere",
          tools: ["file.write"],
          fileRoots: ["/"]
        }
      ]
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((entry) => entry.code === "manifest.permission.file_root_rejected")).toBe(true);
  });

  it("rejects credential access", () => {
    const result = validateToolForgeManifest({
      ...validManifest,
      requestedPermissions: [
        {
          id: "touch-secrets",
          appSensitivities: ["credential_or_security"]
        }
      ]
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((entry) => entry.code === "manifest.permission.credential_rejected")).toBe(true);
  });

  it("marks send/delete/upload requests as high-risk or blocked", () => {
    const result = validateToolForgeManifest({
      ...validManifest,
      requestedPermissions: [
        {
          id: "send-message",
          canSendMessages: true
        }
      ],
      riskDeclaration: "low"
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((entry) => entry.code === "manifest.permission.risk_underdeclared")).toBe(true);
  });

  it("reviews risk and missing grants", () => {
    const review = reviewToolForgeManifest(validManifest, {
      policy: getDefaultPolicy(),
      grants: []
    });

    expect(review.valid).toBe(true);
    expect(review.missingGrants).toEqual(["write-output"]);
    expect(review.requestedCapabilities[0]?.proposedGrant?.match.generatedToolIds).toEqual(["example.generated-tool"]);
  });

  it("proposes grants without applying them", () => {
    const proposals = proposeToolForgeGrants(validManifest);

    expect(proposals.manifestId).toBe("example.generated-tool");
    expect(proposals.proposals).toHaveLength(1);
    expect(proposals.proposals[0]?.grant.id).toBe("forge.example.generated-tool.write-output");
    expect(proposals.proposals[0]?.grant.match.tools).toEqual(expect.arrayContaining(["file.write", "file.ensure_dir"]));
  });
});
