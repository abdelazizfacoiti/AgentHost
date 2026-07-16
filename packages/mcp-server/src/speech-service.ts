import { randomUUID, createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import type { AgentHostConfig, AppSensitivity, SpeechArtifactMetadata, SpeechCapabilities, SpeechDeviceSummary, SpeechLanguageSummary, SpeechProviderId, SpeechProviderSummary, SpeechRoutingDiagnostics, SpeechSynthesisRequest, SpeechTransmissionPreparation } from "@agenthost/core";
import { discoverLinuxSpeechProviders, diagnoseLinuxSpeechRouting, listLinuxEspeakVoices, listLinuxSpeechDevices, playLinuxSpeechFile, synthesizeLinuxEspeakToFile } from "@agenthost/os-linux";
import type { LinuxAutomation } from "./context.js";
import { SpeechStore } from "./speech-store.js";

function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function sentences(text: string): number { return text.split(/[.!?]+/).map((x) => x.trim()).filter(Boolean).length; }
function estimatedDurationMs(text: string, speed: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil((words / Math.max(1, 150 * speed)) * 60_000 * 1.2);
}
function safeText(text: string): boolean { return !/[\u0000-\u001f\u007f]/.test(text) && !/(password|passwd|api[ _-]?key|access[ _-]?token|bearer|cookie|private key|confirmation token|otp|one[- ]time password)/i.test(text); }
function boundedText(text: string, max: number): string { if (text.length > max) throw new Error("speech_input_limit_exceeded"); if (!safeText(text)) throw new Error("speech_secret_blocked"); return text; }

export interface SpeechTransmissionTarget { sensitivity: AppSensitivity; fingerprint: string; routeId: string; durationMs: number; }

export class SpeechService {
  readonly #config: AgentHostConfig;
  readonly #store: SpeechStore;
  readonly #linux: LinuxAutomation;
  #providerCache?: { at: number; providers: SpeechProviderSummary[] };
  constructor(config: AgentHostConfig, store: SpeechStore, linux: LinuxAutomation) { this.#config = config; this.#store = store; this.#linux = linux; }
  store(): SpeechStore { return this.#store; }
  async providers(force = false): Promise<SpeechProviderSummary[]> {
    if (!force && this.#providerCache !== undefined && Date.now() - this.#providerCache.at < 30_000) return this.#providerCache.providers;
    const providers = await discoverLinuxSpeechProviders(); this.#providerCache = { at: Date.now(), providers }; return providers;
  }
  async capabilities(): Promise<SpeechCapabilities> {
    const providers = await this.providers(); const selected = this.selectProvider(providers);
    const routing = await diagnoseLinuxSpeechRouting();
    return { enabled: this.#config.speech?.enabled !== false, providers, ...(selected === undefined ? {} : { selectedProviderId: selected.providerId }), synthesisSupported: selected?.ready === true, playbackSupported: routing.supported, transmissionSupported: routing.existingVirtualRouteReady, limits: this.limits(), evaluatedAt: new Date().toISOString(), redacted: true };
  }
  async voices(providerId?: SpeechProviderId): Promise<ReturnType<typeof listLinuxEspeakVoices>> {
    if (providerId !== undefined && providerId !== "espeak-ng") return [];
    return listLinuxEspeakVoices();
  }
  async languages(providerId?: SpeechProviderId): Promise<SpeechLanguageSummary[]> {
    const voices = await this.voices(providerId);
    const grouped = new Map<string, SpeechLanguageSummary>();
    for (const voice of voices) {
      const current = grouped.get(voice.language) ?? { language: voice.language, providerIds: [], voiceCount: 0, redacted: true };
      if (!current.providerIds.includes(voice.providerId)) current.providerIds.push(voice.providerId);
      current.voiceCount += 1;
      grouped.set(voice.language, current);
    }
    return [...grouped.values()].sort((a, b) => a.language.localeCompare(b.language)).slice(0, 100);
  }
  async devices(): Promise<SpeechDeviceSummary[]> { return listLinuxSpeechDevices(); }
  async routing(): Promise<SpeechRoutingDiagnostics> { return diagnoseLinuxSpeechRouting(); }
  async projection(ownerSessionId: string): Promise<Record<string, unknown>> {
    return {
      capabilities: await this.capabilities(),
      devices: await this.devices(),
      routing: await this.routing(),
      artifacts: await this.#store.listArtifacts(ownerSessionId),
      preparations: await this.#store.listPreparations(ownerSessionId),
      redacted: true
    };
  }
  limits() { const speech = this.#config.speech; return { maxTextChars: speech?.maxTextChars ?? 4000, maxSentences: 50, maxDurationMs: speech?.maxDurationMs ?? 120000, maxArtifactBytes: speech?.maxArtifactBytes ?? 20_000_000, maxConcurrentJobs: 1, synthesisTimeoutMs: speech?.synthesisTimeoutMs ?? 30000, playbackTimeoutMs: speech?.playbackTimeoutMs ?? 300000, artifactTtlMs: speech?.artifactTtlMs ?? 900000 }; }
  async synthesize(input: SpeechSynthesisRequest, ownerSessionId: string): Promise<SpeechArtifactMetadata> {
    if (this.#config.speech?.enabled === false) throw new Error("speech_disabled");
    const limits = this.limits(); const text = boundedText(input.text, limits.maxTextChars); if (sentences(text) > limits.maxSentences) throw new Error("speech_input_limit_exceeded");
    const providers = await this.providers(); const selected = input.providerId === undefined ? this.selectProvider(providers) : providers.find((item) => item.providerId === input.providerId && item.ready);
    if (selected === undefined) throw new Error("speech_provider_unavailable"); if (selected.providerId !== "espeak-ng") throw new Error("speech_provider_not_implemented");
    const voices = await this.voices("espeak-ng"); const voice = input.voiceId === undefined ? voices[0] : voices.find((item) => item.voiceId === input.voiceId); if (voice === undefined) throw new Error("speech_voice_unavailable");
    const speed = Math.min(2, Math.max(0.5, input.speed ?? 1));
    const estimatedMs = estimatedDurationMs(text, speed);
    if (estimatedMs > limits.maxDurationMs) throw new Error("speech_duration_limit_exceeded");
    const artifactId = `speech_artifact_${randomUUID()}`; const target = this.#store.artifactPath(artifactId); const volume = Math.min(100, Math.max(0, Math.round((input.volume ?? 1) * 100)));
    await synthesizeLinuxEspeakToFile({ text, voiceId: voice.voiceId, speed: Math.round(175 * speed), volume, outputPath: target, timeoutMs: limits.synthesisTimeoutMs, maxBytes: limits.maxArtifactBytes });
    const bytes = (await stat(target)).size; const now = new Date(); const metadata: SpeechArtifactMetadata = { artifactId, ownerSessionId, providerId: selected.providerId, voiceId: voice.voiceId, language: input.language ?? voice.language, format: "wav", bytes, durationMs: estimatedMs, textFingerprint: hash(text), textLength: text.length, purpose: input.purpose, state: "ready", playbackState: "idle", createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + limits.artifactTtlMs).toISOString(), redacted: true };
    await this.#store.saveArtifact(metadata, target); return metadata;
  }
  async artifact(id: string, ownerSessionId: string): Promise<SpeechArtifactMetadata> { return (await this.#store.getArtifact(id, ownerSessionId)).metadata; }
  async play(id: string, ownerSessionId: string): Promise<{ artifactId: string; started: boolean }> { const artifact = await this.#store.getArtifact(id, ownerSessionId); const process = await playLinuxSpeechFile({ filePath: artifact.filePath, timeoutMs: this.limits().playbackTimeoutMs }); await this.#store.updatePlayback(id, ownerSessionId, "playing"); this.#store.setPlayback(id, ownerSessionId, process.stop); void process.done.then(async () => { this.#store.stopPlayback(id, ownerSessionId); await this.#store.updatePlayback(id, ownerSessionId, "idle").catch(() => undefined); }); return { artifactId: artifact.metadata.artifactId, started: true }; }
  async playbackState(id: string, ownerSessionId: string): Promise<{ artifactId: string; playbackState: SpeechArtifactMetadata["playbackState"]; state: SpeechArtifactMetadata["state"]; redacted: true }> { const metadata = await this.artifact(id, ownerSessionId); return { artifactId: metadata.artifactId, playbackState: metadata.playbackState, state: metadata.state, redacted: true }; }
  async stop(id: string, ownerSessionId: string): Promise<{ artifactId: string; stopped: boolean }> { const stopped = this.#store.stopPlayback(id, ownerSessionId); if (stopped) await this.#store.updatePlayback(id, ownerSessionId, "stopped").catch(() => undefined); return { artifactId: id, stopped }; }
  async prepareTransmission(input: { artifactId: string; routeId: string; targetSensitivity: AppSensitivity; targetFingerprint: string; durationMs: number }, sessionId: string): Promise<SpeechTransmissionPreparation> {
    if (input.targetSensitivity === "financial" || input.targetSensitivity === "credential_or_security" || input.targetSensitivity === "system_settings" || input.targetSensitivity === "unknown") throw new Error("speech_target_protected");
    if (!/^[-A-Za-z0-9_.]{2,100}$/.test(input.targetFingerprint)) throw new Error("speech_target_invalid");
    if (input.durationMs <= 0 || input.durationMs > this.limits().maxDurationMs) throw new Error("speech_duration_limit_exceeded");
    const route = await this.routing(); if (!route.existingVirtualRouteReady) throw new Error("speech_route_unready");
    const devices = await this.devices();
    if (input.routeId !== "default-output" || !devices.some((device) => device.deviceId === input.routeId && device.direction === "output" && device.ready)) throw new Error("speech_route_unavailable");
    const artifact = await this.#store.getArtifact(input.artifactId, sessionId);
    const routeFingerprint = SpeechStore.fingerprint({ routeId: input.routeId, route: { supported: route.supported, existingVirtualRouteReady: route.existingVirtualRouteReady, pipewire: route.pipewire.available, pulseaudio: route.pulseaudio.available }, devices: devices.filter((device) => device.direction === "output") });
    const artifactFingerprint = SpeechStore.fingerprint({ artifactId: artifact.metadata.artifactId, providerId: artifact.metadata.providerId, voiceId: artifact.metadata.voiceId, language: artifact.metadata.language, format: artifact.metadata.format, bytes: artifact.metadata.bytes, textFingerprint: artifact.metadata.textFingerprint, state: artifact.metadata.state });
    const now = new Date(); const preparation: SpeechTransmissionPreparation = { preparationId: `speech_prep_${randomUUID()}`, sessionId, artifactId: input.artifactId, artifactFingerprint, routeId: input.routeId, routeFingerprint, targetFingerprint: SpeechStore.fingerprint(input.targetFingerprint), targetSensitivity: input.targetSensitivity, durationMs: input.durationMs, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(), status: "prepared", requiredGrantIds: [], redacted: true }; await this.#store.savePreparation(preparation); return preparation;
  }
  async executeTransmission(input: { preparationId: string; artifactId: string; routeId: string; targetFingerprint: string }, sessionId: string): Promise<{ preparationId: string; executed: boolean }> {
    const preparation = await this.#store.reservePreparation(input.preparationId, sessionId);
    let consumed = false;
    try {
      if (preparation.artifactId !== input.artifactId || preparation.routeId !== input.routeId || preparation.targetFingerprint !== SpeechStore.fingerprint(input.targetFingerprint)) throw new Error("speech_preparation_binding_mismatch");
      const artifact = await this.#store.getArtifact(preparation.artifactId, sessionId);
      const artifactFingerprint = SpeechStore.fingerprint({ artifactId: artifact.metadata.artifactId, providerId: artifact.metadata.providerId, voiceId: artifact.metadata.voiceId, language: artifact.metadata.language, format: artifact.metadata.format, bytes: artifact.metadata.bytes, textFingerprint: artifact.metadata.textFingerprint, state: artifact.metadata.state });
      if (artifactFingerprint !== preparation.artifactFingerprint) throw new Error("speech_artifact_changed");
      const route = await this.routing(); const devices = await this.devices();
      const routeFingerprint = SpeechStore.fingerprint({ routeId: preparation.routeId, route: { supported: route.supported, existingVirtualRouteReady: route.existingVirtualRouteReady, pipewire: route.pipewire.available, pulseaudio: route.pulseaudio.available }, devices: devices.filter((device) => device.direction === "output") });
      if (routeFingerprint !== preparation.routeFingerprint || preparation.routeId !== "default-output" || !devices.some((device) => device.deviceId === preparation.routeId && device.direction === "output" && device.ready)) throw new Error("speech_route_changed");
      // Consume before starting playback. If the backend then fails, preparation
      // remains terminal and cannot be replayed into a meeting or call.
      preparation.status = "consumed";
      await this.#store.savePreparation(preparation);
      consumed = true;
      await this.play(preparation.artifactId, sessionId);
      return { preparationId: input.preparationId, executed: true };
    } catch (error) {
      if (!consumed) { preparation.status = "blocked"; await this.#store.savePreparation(preparation).catch(() => undefined); }
      throw error;
    } finally { this.#store.releasePreparation(input.preparationId); }
  }
  async preparation(id: string, sessionId: string): Promise<SpeechTransmissionPreparation> { return this.#store.getPreparationMetadata(id, sessionId); }
  private selectProvider(providers: SpeechProviderSummary[]): SpeechProviderSummary | undefined { const preference = this.#config.speech?.providerPreference ?? ["espeak-ng", "piper", "speech-dispatcher"]; const configured = this.#config.speech?.defaultProvider; const ordered = configured === undefined ? preference : [configured, ...preference.filter((id) => id !== configured)]; return ordered.map((id) => providers.find((item) => item.providerId === id)).find((item) => item?.ready); }
}
