import { chmod, mkdir, rename, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SpeechDeviceSummary, SpeechProviderId, SpeechProviderSummary, SpeechRoutingDiagnostics, SpeechVoiceSummary } from "@agenthost/core";
import { findCommandPath } from "./dependencies.js";
import { runSafeLinuxCommand } from "./shell.js";

export interface LinuxSpeechOptions { env?: NodeJS.ProcessEnv; homeDir?: string; }

const SAFE_ENV_KEYS = new Set(["PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "XDG_RUNTIME_DIR", "PIPEWIRE_REMOTE", "PULSE_SERVER"]);
function speechEnv(input?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const source = input ?? process.env;
  return Object.fromEntries(Object.entries(source).filter(([key]) => SAFE_ENV_KEYS.has(key))) as NodeJS.ProcessEnv;
}

function bounded(value: string, max = 500): string { return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max); }
function commandReason(result: { exitCode: number | null; stderr: string; timedOut?: boolean }): string {
  if (result.timedOut) return "command_timeout";
  if (result.exitCode === 0) return "available";
  return bounded(result.stderr || "command_failed", 180);
}
function provider(id: SpeechProviderId, type: SpeechProviderSummary["type"], installed: boolean, reason: string, languages: string[] = [], voiceCount = 0): SpeechProviderSummary {
  return { providerId: id, type, local: true, offline: true, availability: installed ? (reason === "available" ? "available" : "unavailable") : "not_configured", installed, source: id === "espeak-ng" ? "system_command" : id === "piper" ? "explicit_local_installation" : "system_service", licenseSummary: id === "espeak-ng" ? "System dependency; GPLv3-or-later project." : id === "piper" ? "Executable and voice/model licenses require local review." : "System bridge license and configuration are installation-specific.", languages, voiceCount, sampleRates: [8000, 16000, 22050, 44100], formats: ["wav"], maxInputChars: 4000, maxDurationMs: 120000, ready: installed && reason === "available", reason };
}

export async function discoverLinuxSpeechProviders(options: LinuxSpeechOptions = {}): Promise<SpeechProviderSummary[]> {
  const env = speechEnv(options.env);
  const lookup = { env, ...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }) };
  const espeak = await findCommandPath("espeak-ng", lookup);
  const piper = await findCommandPath("piper", lookup);
  const spd = await findCommandPath("spd-say", lookup);
  const result: SpeechProviderSummary[] = [];
  if (espeak === undefined) result.push(provider("espeak-ng", "system_cli", false, "espeak-ng_not_installed"));
  else {
    const version = await runSafeLinuxCommand({ command: espeak, args: ["--version"], timeoutMs: 3000, maxOutputBytes: 4096, env });
    const voices = await listLinuxEspeakVoices({ ...options, env, command: espeak });
    result.push({ ...provider("espeak-ng", "system_cli", true, version.exitCode === 0 ? "available" : commandReason(version), voices.length > 0 ? [...new Set(voices.map((voice) => voice.language))].slice(0, 100) : [], voices.length), ...(version.stdout.trim().length > 0 ? { version: bounded(version.stdout.trim(), 80) } : {}) });
  }
  result.push(provider("piper", "local_neural", piper !== undefined, piper === undefined ? "piper_not_installed_or_not_configured" : "voice_model_configuration_required"));
  result.push(provider("speech-dispatcher", "system_bridge", spd !== undefined, spd === undefined ? "speech_dispatcher_not_installed" : "diagnostic_only"));
  return result;
}

export async function listLinuxEspeakVoices(input: LinuxSpeechOptions & { command?: string } = {}): Promise<SpeechVoiceSummary[]> {
  const env = speechEnv(input.env);
  const command = input.command ?? await findCommandPath("espeak-ng", { env, ...(input.homeDir === undefined ? {} : { homeDir: input.homeDir }) });
  if (command === undefined) return [];
  const result = await runSafeLinuxCommand({ command, args: ["--voices"], timeoutMs: 5000, maxOutputBytes: 128 * 1024, env });
  if (result.exitCode !== 0) return [];
  const voices: SpeechVoiceSummary[] = [];
  for (const line of result.stdout.split(/\r?\n/).slice(1, 300)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 4 || !/^[a-z]{2,3}([-_][A-Za-z0-9]+)?$/.test(columns[1] ?? "")) continue;
    const language = bounded(columns[1] ?? "", 35);
    const voiceId = bounded(columns[3] ?? "", 80);
    if (voiceId.length === 0) continue;
    voices.push({ voiceId, language, label: bounded(columns.slice(3).join(" "), 120), providerId: "espeak-ng", sampleRates: [22050], formats: ["wav"], redacted: true });
  }
  return voices.slice(0, 200);
}

export async function diagnoseLinuxSpeechRouting(options: LinuxSpeechOptions = {}): Promise<SpeechRoutingDiagnostics> {
  const env = speechEnv(options.env);
  const lookup = { env, ...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }) };
  const [wpctl, pactl, aplay] = await Promise.all([findCommandPath("wpctl", lookup), findCommandPath("pactl", lookup), findCommandPath("aplay", lookup)]);
  const pipewire = wpctl === undefined ? { available: false, reason: "wpctl_not_installed" } : await runSafeLinuxCommand({ command: wpctl, args: ["status"], timeoutMs: 4000, maxOutputBytes: 16 * 1024, env }).then((r) => ({ available: r.exitCode === 0, reason: commandReason(r) }));
  const pulseaudio = pactl === undefined ? { available: false, reason: "pactl_not_installed" } : await runSafeLinuxCommand({ command: pactl, args: ["info"], timeoutMs: 4000, maxOutputBytes: 16 * 1024, env }).then((r) => ({ available: r.exitCode === 0, reason: commandReason(r) }));
  const alsa = aplay === undefined ? { available: false, reason: "aplay_not_installed" } : await runSafeLinuxCommand({ command: aplay, args: ["-l"], timeoutMs: 4000, maxOutputBytes: 16 * 1024, env }).then((r) => ({ available: r.exitCode === 0, reason: commandReason(r) }));
  return { supported: pipewire.available || pulseaudio.available || alsa.available, pipewire, pulseaudio, alsa, existingVirtualRouteReady: pipewire.available || pulseaudio.available, limitations: ["Diagnostics are read-only.", "AgentHost does not create sinks, loopbacks, routes, or virtual microphones."], redacted: true };
}

export async function listLinuxSpeechDevices(options: LinuxSpeechOptions = {}): Promise<SpeechDeviceSummary[]> {
  const route = await diagnoseLinuxSpeechRouting(options);
  const devices: SpeechDeviceSummary[] = [];
  if (route.pipewire.available || route.pulseaudio.available) devices.push({ deviceId: "default-output", direction: "output", backend: route.pipewire.available ? "pipewire" : "pulseaudio", isDefault: true, isVirtual: false, ready: true, label: "Default output", redacted: true });
  if (route.pipewire.available || route.pulseaudio.available) devices.push({ deviceId: "default-input", direction: "input", backend: route.pipewire.available ? "pipewire" : "pulseaudio", isDefault: true, isVirtual: false, ready: true, label: "Default input", redacted: true });
  if (route.alsa.available) devices.push({ deviceId: "alsa-output", direction: "output", backend: "alsa", isDefault: false, isVirtual: false, ready: true, label: "ALSA output", redacted: true });
  return devices;
}

export interface SpeechProcessResult { exitCode: number | null; signal: NodeJS.Signals | null; timedOut: boolean; bytes: number; durationMs: number; stderr: string; }

export async function synthesizeLinuxEspeakToFile(input: { text: string; voiceId: string; speed: number; volume: number; outputPath: string; timeoutMs: number; maxBytes: number; env?: NodeJS.ProcessEnv }): Promise<SpeechProcessResult> {
  const env = speechEnv(input.env);
  const command = await findCommandPath("espeak-ng", { env });
  if (command === undefined) throw new Error("speech_provider_unavailable");
  await mkdir(path.dirname(input.outputPath), { recursive: true, mode: 0o700 });
  const temporary = `${input.outputPath}.tmp-${randomUUID()}`;
  const started = Date.now();
  const child = spawn(command, ["--stdout", "-v", input.voiceId, "-s", String(Math.round(input.speed)), "-a", String(Math.round(input.volume))], { shell: false, env, stdio: ["pipe", "pipe", "pipe"] });
  const output = createWriteStream(temporary, { mode: 0o600 });
  let bytes = 0;
  let timedOut = false;
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr = bounded(stderr + chunk.toString("utf8"), 2000); });
  child.stdout.on("data", (chunk: Buffer) => { bytes += chunk.byteLength; if (bytes <= input.maxBytes) output.write(chunk); else { child.kill("SIGTERM"); } });
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, input.timeoutMs);
  child.stdin.end(input.text);
  const result = await new Promise<SpeechProcessResult>((resolve) => child.on("close", (exitCode, signal) => { clearTimeout(timer); output.end(async () => { if (exitCode === 0 && !timedOut && bytes <= input.maxBytes) await rename(temporary, input.outputPath).catch(() => undefined); else await import("node:fs/promises").then(({ rm }) => rm(temporary, { force: true })).catch(() => undefined); resolve({ exitCode, signal, timedOut, bytes, durationMs: Date.now() - started, stderr }); }); }));
  if (result.exitCode !== 0 || result.timedOut || result.bytes > input.maxBytes) throw new Error(result.timedOut ? "speech_command_timeout" : result.bytes > input.maxBytes ? "speech_output_cap_exceeded" : "speech_process_failed");
  return result;
}

export async function playLinuxSpeechFile(input: { filePath: string; timeoutMs: number; env?: NodeJS.ProcessEnv }): Promise<{ stop(): void; done: Promise<SpeechProcessResult> }> {
  await stat(input.filePath);
  const candidates: Array<[string, string[]]> = [["pw-cat", ["--playback", input.filePath]], ["paplay", [input.filePath]], ["aplay", [input.filePath]]];
  let selected: [string, string[]] | undefined;
  const env = speechEnv(input.env);
  for (const [name, args] of candidates) { const command = await findCommandPath(name, { env }); if (command !== undefined) { selected = [command, args]; break; } }
  if (selected === undefined) throw new Error("speech_playback_backend_unavailable");
  const child = spawn(selected[0], selected[1], { shell: false, env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = ""; child.stderr.on("data", (chunk: Buffer) => { stderr = bounded(stderr + chunk.toString("utf8"), 1000); });
  let timedOut = false; const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, input.timeoutMs);
  const done = new Promise<SpeechProcessResult>((resolve) => child.on("close", (exitCode, signal) => { clearTimeout(timer); resolve({ exitCode, signal, timedOut, bytes: 0, durationMs: 0, stderr }); }));
  return { stop: () => { child.kill("SIGTERM"); }, done };
}
