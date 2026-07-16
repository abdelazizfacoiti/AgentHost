import type { AppSensitivity, DataSensitivity, RiskLevel, ToolExecutionClass } from "./types.js";

export const SPEECH_PROVIDER_IDS = ["espeak-ng", "piper", "speech-dispatcher"] as const;
export type SpeechProviderId = (typeof SPEECH_PROVIDER_IDS)[number];
export type SpeechProviderType = "system_cli" | "local_neural" | "system_bridge";
export type SpeechProviderAvailability = "available" | "unavailable" | "not_configured";
export type SpeechArtifactState = "ready" | "playing" | "expired" | "failed" | "deleted";
export type SpeechPlaybackState = "idle" | "starting" | "playing" | "stopped" | "failed" | "expired";
export type SpeechActivityKind = "provider_checking" | "voice_checking" | "synthesizing" | "artifact_ready" | "playback_preparing" | "playing" | "waiting_approval" | "transmission_preparing" | "transmitting" | "stopping" | "cleanup" | "blocked" | "failed" | "completed";

export interface SpeechVoiceSummary {
  voiceId: string;
  language: string;
  label: string;
  providerId: SpeechProviderId;
  sampleRates: number[];
  formats: ["wav"];
  redacted: true;
}

export interface SpeechLanguageSummary {
  language: string;
  providerIds: SpeechProviderId[];
  voiceCount: number;
  redacted: true;
}

export interface SpeechProviderSummary {
  providerId: SpeechProviderId;
  version?: string;
  type: SpeechProviderType;
  local: true;
  offline: true;
  availability: SpeechProviderAvailability;
  installed: boolean;
  source: string;
  licenseSummary: string;
  languages: string[];
  voiceCount: number;
  sampleRates: number[];
  formats: ["wav"];
  maxInputChars: number;
  maxDurationMs: number;
  ready: boolean;
  reason: string;
}

export interface SpeechCapabilities {
  enabled: boolean;
  providers: SpeechProviderSummary[];
  selectedProviderId?: SpeechProviderId;
  synthesisSupported: boolean;
  playbackSupported: boolean;
  transmissionSupported: boolean;
  limits: SpeechLimits;
  evaluatedAt: string;
  redacted: true;
}

export interface SpeechLimits {
  maxTextChars: number;
  maxSentences: number;
  maxDurationMs: number;
  maxArtifactBytes: number;
  maxConcurrentJobs: number;
  synthesisTimeoutMs: number;
  playbackTimeoutMs: number;
  artifactTtlMs: number;
}

export interface SpeechSynthesisRequest {
  text: string;
  providerId?: SpeechProviderId;
  voiceId?: string;
  language?: string;
  speed?: number;
  volume?: number;
  format?: "wav";
  purpose: "local_assistance" | "operator_guidance" | "meeting_draft" | "meeting_transmission" | "test";
  dataSensitivity?: DataSensitivity;
  dryRun?: boolean;
  confirmationToken?: string;
}

export interface SpeechArtifactMetadata {
  artifactId: string;
  ownerSessionId: string;
  providerId: SpeechProviderId;
  voiceId: string;
  language: string;
  format: "wav";
  sampleRate?: number;
  durationMs?: number;
  bytes: number;
  textFingerprint: string;
  textLength: number;
  purpose: SpeechSynthesisRequest["purpose"];
  state: SpeechArtifactState;
  playbackState: SpeechPlaybackState;
  createdAt: string;
  expiresAt: string;
  redacted: true;
}

export interface SpeechDeviceSummary {
  deviceId: string;
  direction: "input" | "output";
  backend: "pipewire" | "pulseaudio" | "alsa" | "unknown";
  isDefault: boolean;
  isVirtual: boolean;
  ready: boolean;
  label: string;
  redacted: true;
}

export interface SpeechRoutingDiagnostics {
  supported: boolean;
  pipewire: { available: boolean; reason: string };
  pulseaudio: { available: boolean; reason: string };
  alsa: { available: boolean; reason: string };
  defaultOutput?: string;
  defaultInput?: string;
  existingVirtualRouteReady: boolean;
  limitations: string[];
  redacted: true;
}

export interface SpeechTransmissionPreparation {
  preparationId: string;
  sessionId: string;
  artifactId: string;
  artifactFingerprint: string;
  routeId: string;
  routeFingerprint: string;
  targetFingerprint: string;
  targetSensitivity: AppSensitivity;
  durationMs: number;
  createdAt: string;
  expiresAt: string;
  status: "prepared" | "expired" | "consumed" | "blocked";
  requiredGrantIds: string[];
  redacted: true;
}

export interface SpeechToolExecutionSummary {
  executionClass: ToolExecutionClass;
  riskLevel: RiskLevel;
  externalEffect: boolean;
}
