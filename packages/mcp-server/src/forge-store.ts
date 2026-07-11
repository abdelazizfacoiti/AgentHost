import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  CapabilityGrant,
  ToolForgeArtifactRecord,
  ToolForgeHarnessRunRecord,
  ToolForgeManifest,
  ToolForgeRegistrationRecord,
  ToolForgeReviewRecord,
  ToolForgeValidationRecord
} from "@agenthost/core";

interface ForgeProposalRecord {
  reviewId: string;
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  createdAt: string;
  grants: CapabilityGrant[];
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export class ForgeStore {
  readonly #rootDir: string;
  readonly #manifestsDir: string;
  readonly #reviewsDir: string;
  readonly #artifactsDir: string;
  readonly #proposalsDir: string;
  readonly #generatedDir: string;
  readonly #validationsDir: string;
  readonly #harnessRunsDir: string;
  readonly #registrationsDir: string;

  constructor(agentHostDir: string) {
    this.#rootDir = path.resolve(agentHostDir, "forge");
    this.#manifestsDir = path.join(this.#rootDir, "manifests");
    this.#reviewsDir = path.join(this.#rootDir, "reviews");
    this.#artifactsDir = path.join(this.#rootDir, "artifacts");
    this.#proposalsDir = path.join(this.#rootDir, "proposals");
    this.#generatedDir = path.join(this.#rootDir, "generated");
    this.#validationsDir = path.join(this.#rootDir, "validations");
    this.#harnessRunsDir = path.join(this.#rootDir, "harness-runs");
    this.#registrationsDir = path.join(this.#rootDir, "registrations");
  }

  rootDir(): string {
    return this.#rootDir;
  }

  manifestPath(manifest: ToolForgeManifest, manifestHash: string): string {
    return path.join(
      this.#manifestsDir,
      sanitizeSegment(manifest.id),
      sanitizeSegment(manifest.version),
      sanitizeSegment(manifestHash),
      "manifest.json"
    );
  }

  artifactPath(artifactId: string): string {
    return path.join(this.#artifactsDir, `${sanitizeSegment(artifactId)}.json`);
  }

  generatedRootDir(): string {
    return this.#generatedDir;
  }

  generatedProjectPath(manifestId: string, version: string): string {
    return path.join(this.#generatedDir, sanitizeSegment(manifestId), sanitizeSegment(version));
  }

  reviewPath(reviewId: string): string {
    return path.join(this.#reviewsDir, `${sanitizeSegment(reviewId)}.json`);
  }

  proposalPath(reviewId: string): string {
    return path.join(this.#proposalsDir, `${sanitizeSegment(reviewId)}.json`);
  }

  validationPath(validationId: string): string {
    return path.join(this.#validationsDir, `${sanitizeSegment(validationId)}.json`);
  }

  harnessRunPath(harnessRunId: string): string {
    return path.join(this.#harnessRunsDir, `${sanitizeSegment(harnessRunId)}.json`);
  }

  registrationPath(registrationId: string): string {
    return path.join(this.#registrationsDir, `${sanitizeSegment(registrationId)}.json`);
  }

  async saveManifest(manifest: ToolForgeManifest, manifestHash: string): Promise<string> {
    const filePath = this.manifestPath(manifest, manifestHash);
    await writeJson(filePath, manifest);
    return filePath;
  }

  async loadManifestByPath(filePath: string): Promise<ToolForgeManifest> {
    return readJson<ToolForgeManifest>(filePath);
  }

  async saveArtifact(record: ToolForgeArtifactRecord): Promise<void> {
    await writeJson(this.artifactPath(record.artifactId), record);
  }

  async loadArtifact(artifactId: string): Promise<ToolForgeArtifactRecord> {
    return readJson<ToolForgeArtifactRecord>(this.artifactPath(artifactId));
  }

  async listArtifacts(): Promise<ToolForgeArtifactRecord[]> {
    return this.#readJsonDirectory<ToolForgeArtifactRecord>(this.#artifactsDir);
  }

  async findArtifact(input: {
    manifestId: string;
    version?: string;
    manifestHash?: string;
  }): Promise<ToolForgeArtifactRecord | undefined> {
    const artifacts = await this.listArtifacts();
    return artifacts.find((artifact) => {
      if (artifact.manifestId !== input.manifestId) {
        return false;
      }

      if (input.version !== undefined && artifact.manifestVersion !== input.version) {
        return false;
      }

      if (input.manifestHash !== undefined && artifact.manifestHash !== input.manifestHash) {
        return false;
      }

      return true;
    });
  }

  async saveReview(record: ToolForgeReviewRecord): Promise<void> {
    await writeJson(this.reviewPath(record.reviewId), record);
  }

  async loadReview(reviewId: string): Promise<ToolForgeReviewRecord> {
    return readJson<ToolForgeReviewRecord>(this.reviewPath(reviewId));
  }

  async listReviews(): Promise<ToolForgeReviewRecord[]> {
    return this.#readJsonDirectory<ToolForgeReviewRecord>(this.#reviewsDir);
  }

  async saveValidation(record: ToolForgeValidationRecord): Promise<void> {
    await writeJson(this.validationPath(record.validationId), record);
  }

  async loadValidation(validationId: string): Promise<ToolForgeValidationRecord> {
    return readJson<ToolForgeValidationRecord>(this.validationPath(validationId));
  }

  async listValidations(): Promise<ToolForgeValidationRecord[]> {
    return this.#readJsonDirectory<ToolForgeValidationRecord>(this.#validationsDir);
  }

  async saveHarnessRun(record: ToolForgeHarnessRunRecord): Promise<void> {
    await writeJson(this.harnessRunPath(record.harnessRunId), record);
  }

  async loadHarnessRun(harnessRunId: string): Promise<ToolForgeHarnessRunRecord> {
    return readJson<ToolForgeHarnessRunRecord>(this.harnessRunPath(harnessRunId));
  }

  async listHarnessRuns(): Promise<ToolForgeHarnessRunRecord[]> {
    return this.#readJsonDirectory<ToolForgeHarnessRunRecord>(this.#harnessRunsDir);
  }

  async saveRegistration(record: ToolForgeRegistrationRecord): Promise<void> {
    await writeJson(this.registrationPath(record.registrationId), record);
  }

  async loadRegistration(registrationId: string): Promise<ToolForgeRegistrationRecord> {
    return readJson<ToolForgeRegistrationRecord>(this.registrationPath(registrationId));
  }

  async listRegistrations(): Promise<ToolForgeRegistrationRecord[]> {
    return this.#readJsonDirectory<ToolForgeRegistrationRecord>(this.#registrationsDir);
  }

  async saveProposalRecord(record: ForgeProposalRecord): Promise<void> {
    await writeJson(this.proposalPath(record.reviewId), record);
  }

  async ensureStructure(): Promise<void> {
    await Promise.all([
      mkdir(this.#manifestsDir, { recursive: true }),
      mkdir(this.#reviewsDir, { recursive: true }),
      mkdir(this.#artifactsDir, { recursive: true }),
      mkdir(this.#proposalsDir, { recursive: true }),
      mkdir(this.#generatedDir, { recursive: true }),
      mkdir(this.#validationsDir, { recursive: true }),
      mkdir(this.#harnessRunsDir, { recursive: true }),
      mkdir(this.#registrationsDir, { recursive: true })
    ]);
  }

  async #readJsonDirectory<T>(directory: string): Promise<T[]> {
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      const jsonFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
      return Promise.all(jsonFiles.map((entry) => readJson<T>(path.join(directory, entry.name))));
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }
}
