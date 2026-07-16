import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { SpeechArtifactMetadata, SpeechTransmissionPreparation } from "@agenthost/core";

function safeId(value: string): string { if (!/^[A-Za-z0-9_-]{8,160}$/.test(value)) throw new Error("speech_id_invalid"); return value; }
function json(value: unknown): string { return JSON.stringify(value) + "\n"; }
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export class SpeechStore {
  readonly #root: string;
  readonly #artifacts: string;
  readonly #preparations: string;
  readonly #playback = new Map<string, { ownerSessionId: string; stop(): void }>();
  readonly #reservedPreparations = new Set<string>();
  constructor(agentHostDir: string) { this.#root = path.join(agentHostDir, "speech"); this.#artifacts = path.join(this.#root, "artifacts"); this.#preparations = path.join(this.#root, "preparations"); }
  async ensureStructure(): Promise<void> { await Promise.all([this.#root, this.#artifacts, this.#preparations].map((item) => mkdir(item, { recursive: true, mode: 0o700 }))); await this.cleanupExpired(); }
  artifactPath(artifactId: string): string { return path.join(this.#artifacts, `${safeId(artifactId)}.wav`); }
  metadataPath(artifactId: string): string { return path.join(this.#artifacts, `${safeId(artifactId)}.json`); }
  preparationPath(id: string): string { return path.join(this.#preparations, `${safeId(id)}.json`); }
  async saveArtifact(metadata: SpeechArtifactMetadata, sourcePath: string): Promise<void> {
    await this.ensureStructure();
    const target = this.artifactPath(metadata.artifactId);
    if (path.resolve(sourcePath) !== path.resolve(target)) throw new Error("speech_artifact_path_invalid");
    const metadataFile = this.metadataPath(metadata.artifactId);
    const temporary = `${metadataFile}.tmp`;
    await writeFile(temporary, json(metadata), { mode: 0o600 }); await rename(temporary, metadataFile); await chmod(metadataFile, 0o600); await chmod(target, 0o600);
  }
  async getArtifact(artifactId: string, ownerSessionId: string): Promise<{ metadata: SpeechArtifactMetadata; filePath: string }> {
    const raw = await readFile(this.metadataPath(artifactId), "utf8"); const metadata = JSON.parse(raw) as SpeechArtifactMetadata;
    if (metadata.ownerSessionId !== ownerSessionId) throw new Error("speech_artifact_owner_mismatch");
    if (Date.parse(metadata.expiresAt) <= Date.now() || metadata.state === "expired") throw new Error("speech_artifact_expired");
    await stat(this.artifactPath(metadata.artifactId));
    return { metadata, filePath: this.artifactPath(metadata.artifactId) };
  }
  async updatePlayback(artifactId: string, ownerSessionId: string, playbackState: SpeechArtifactMetadata["playbackState"]): Promise<SpeechArtifactMetadata> {
    const metadata = JSON.parse(await readFile(this.metadataPath(artifactId), "utf8")) as SpeechArtifactMetadata;
    if (metadata.ownerSessionId !== ownerSessionId) throw new Error("speech_artifact_owner_mismatch");
    metadata.playbackState = playbackState;
    metadata.state = playbackState === "playing" ? "playing" : metadata.state === "playing" ? "ready" : metadata.state;
    const target = this.metadataPath(artifactId);
    const temporary = `${target}.tmp`;
    await writeFile(temporary, json(metadata), { mode: 0o600 });
    await rename(temporary, target);
    await chmod(target, 0o600);
    return metadata;
  }
  async listArtifacts(ownerSessionId: string): Promise<SpeechArtifactMetadata[]> {
    const entries = await readdir(this.#artifacts).catch(() => []);
    const values: SpeechArtifactMetadata[] = [];
    for (const entry of entries.filter((item) => item.endsWith(".json")).slice(0, 100)) {
      try {
        const metadata = JSON.parse(await readFile(path.join(this.#artifacts, entry), "utf8")) as SpeechArtifactMetadata;
        if (metadata.ownerSessionId === ownerSessionId && Date.parse(metadata.expiresAt) > Date.now()) values.push(metadata);
      } catch { /* malformed records stay unavailable */ }
    }
    return values.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
  }
  async savePreparation(preparation: SpeechTransmissionPreparation): Promise<void> { await this.ensureStructure(); const target = this.preparationPath(preparation.preparationId); const temporary = `${target}.tmp`; await writeFile(temporary, json(preparation), { mode: 0o600 }); await rename(temporary, target); await chmod(target, 0o600); }
  async getPreparation(id: string, sessionId: string): Promise<SpeechTransmissionPreparation> { const prep = JSON.parse(await readFile(this.preparationPath(id), "utf8")) as SpeechTransmissionPreparation; if (prep.sessionId !== sessionId) throw new Error("speech_preparation_owner_mismatch"); if (Date.parse(prep.expiresAt) <= Date.now() || prep.status !== "prepared") throw new Error("speech_preparation_expired"); return prep; }
  async getPreparationMetadata(id: string, sessionId: string): Promise<SpeechTransmissionPreparation> { const prep = JSON.parse(await readFile(this.preparationPath(id), "utf8")) as SpeechTransmissionPreparation; if (prep.sessionId !== sessionId) throw new Error("speech_preparation_owner_mismatch"); return prep; }
  async listPreparations(sessionId: string): Promise<SpeechTransmissionPreparation[]> {
    const entries = await readdir(this.#preparations).catch(() => []);
    const values: SpeechTransmissionPreparation[] = [];
    for (const entry of entries.filter((item) => item.endsWith(".json")).slice(0, 100)) {
      try {
        const preparation = JSON.parse(await readFile(path.join(this.#preparations, entry), "utf8")) as SpeechTransmissionPreparation;
        if (preparation.sessionId === sessionId) values.push(preparation);
      } catch { /* malformed records stay unavailable */ }
    }
    return values.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
  }
  async reservePreparation(id: string, sessionId: string): Promise<SpeechTransmissionPreparation> {
    if (this.#reservedPreparations.has(id)) throw new Error("speech_preparation_consumed");
    const preparation = await this.getPreparation(id, sessionId);
    this.#reservedPreparations.add(id);
    return preparation;
  }
  releasePreparation(id: string): void { this.#reservedPreparations.delete(id); }
  setPlayback(artifactId: string, ownerSessionId: string, stop: () => void): void { this.#playback.set(artifactId, { ownerSessionId, stop }); }
  stopPlayback(artifactId: string, ownerSessionId: string): boolean { const value = this.#playback.get(artifactId); if (value === undefined || value.ownerSessionId !== ownerSessionId) return false; value.stop(); this.#playback.delete(artifactId); return true; }
  async cleanupExpired(): Promise<void> {
    await mkdir(this.#artifacts, { recursive: true, mode: 0o700 });
    for (const entry of await readdir(this.#artifacts).catch(() => [])) {
      if (!entry.endsWith(".json")) continue;
      const file = path.join(this.#artifacts, entry);
      try { const metadata = JSON.parse(await readFile(file, "utf8")) as SpeechArtifactMetadata; if (Date.parse(metadata.expiresAt) <= Date.now()) { const playback = this.#playback.get(metadata.artifactId); playback?.stop(); this.#playback.delete(metadata.artifactId); await rm(file, { force: true }); await rm(path.join(this.#artifacts, `${metadata.artifactId}.wav`), { force: true }); } } catch { /* corrupt metadata is left unavailable */ }
    }
  }
  static fingerprint(value: unknown): string { return hash(value); }
}
