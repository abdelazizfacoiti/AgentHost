import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SpeechArtifactMetadata, SpeechTransmissionPreparation } from "@agenthost/core";
import { SpeechStore } from "../speech-store.js";

function artifact(id: string, ownerSessionId: string, expiresAt = new Date(Date.now() + 60_000).toISOString()): SpeechArtifactMetadata {
  return { artifactId: id, ownerSessionId, providerId: "espeak-ng", voiceId: "en", language: "en", format: "wav", bytes: 4, durationMs: 1000, textFingerprint: "sha256:test", textLength: 4, purpose: "test", state: "ready", playbackState: "idle", createdAt: new Date().toISOString(), expiresAt, redacted: true };
}

function preparation(id: string, sessionId: string): SpeechTransmissionPreparation {
  return { preparationId: id, sessionId, artifactId: "speech_artifact_test", artifactFingerprint: "artifact_fp", routeId: "default-output", routeFingerprint: "route_fp", targetFingerprint: "target_fp", targetSensitivity: "normal", durationMs: 1000, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), status: "prepared", requiredGrantIds: [], redacted: true };
}

describe("SpeechStore", () => {
  it("keeps artifacts opaque, owner-scoped, and lists only current metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-speech-store-"));
    const store = new SpeechStore(root);
    await store.ensureStructure();
    const metadata = artifact("speech_artifact_test", "session_a");
    await writeFile(store.artifactPath(metadata.artifactId), Buffer.from("RIFF"));
    await store.saveArtifact(metadata, store.artifactPath(metadata.artifactId));
    expect((await store.getArtifact(metadata.artifactId, "session_a")).metadata).toMatchObject({ artifactId: metadata.artifactId, redacted: true });
    await expect(store.getArtifact(metadata.artifactId, "session_b")).rejects.toThrow("speech_artifact_owner_mismatch");
    expect(await store.listArtifacts("session_a")).toHaveLength(1);
  });

  it("reserves preparation once and rejects consumed or concurrent reuse", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-speech-prep-"));
    const store = new SpeechStore(root);
    await store.ensureStructure();
    const value = preparation("speech_prep_test", "session_a");
    await store.savePreparation(value);
    await expect(store.reservePreparation(value.preparationId, "session_b")).rejects.toThrow("speech_preparation_owner_mismatch");
    await store.reservePreparation(value.preparationId, "session_a");
    await expect(store.reservePreparation(value.preparationId, "session_a")).rejects.toThrow("speech_preparation_consumed");
    store.releasePreparation(value.preparationId);
    value.status = "consumed";
    await store.savePreparation(value);
    await expect(store.getPreparation(value.preparationId, "session_a")).rejects.toThrow("speech_preparation_expired");
  });

  it("does not return expired artifacts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-speech-expiry-"));
    const store = new SpeechStore(root);
    await store.ensureStructure();
    const metadata = artifact("speech_artifact_expired", "session_a", new Date(Date.now() - 1).toISOString());
    await writeFile(store.artifactPath(metadata.artifactId), Buffer.from("RIFF"));
    await store.saveArtifact(metadata, store.artifactPath(metadata.artifactId));
    await expect(store.getArtifact(metadata.artifactId, "session_a")).rejects.toThrow("speech_artifact_expired");
    expect(await store.listArtifacts("session_a")).toEqual([]);
  });
});
