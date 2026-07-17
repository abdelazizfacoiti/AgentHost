import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Single public version used by packaged components and diagnostics. */
export const AGENTHOST_VERSION = "0.1.0";
export const AGENTHOST_CONFIG_SCHEMA_VERSION = 1 as const;

export function defaultAgentHostHome(homeDir = os.homedir()): string {
  return path.join(homeDir, ".agenthost");
}

export function defaultPublicConfigPath(homeDir = os.homedir()): string {
  return path.join(homeDir, ".config", "agenthost", "config.json");
}

export function legacyConfigPath(homeDir = os.homedir()): string {
  return path.join(defaultAgentHostHome(homeDir), "config.json");
}

export function redactLocalPath(value: string, homeDir = os.homedir()): string {
  const normalized = path.resolve(value);
  const home = path.resolve(homeDir);
  if (normalized === home) return "[home]";
  if (normalized.startsWith(`${home}${path.sep}`)) return `[home]${normalized.slice(home.length)}`;
  return "[external-path]";
}

export function normalizeSha256(value: string): string {
  const digest = value.trim().split(/\s+/u)[0] ?? "";
  if (!/^[a-f0-9]{64}$/iu.test(digest)) throw new Error("release_checksum_invalid");
  return digest.toLowerCase();
}

export function sha256Buffer(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function sha256File(filePath: string): Promise<string> {
  return sha256Buffer(await readFile(filePath));
}

export async function readSha256Sidecar(filePath: string): Promise<string | undefined> {
  try {
    return normalizeSha256(await readFile(`${filePath}.sha256`, "utf8"));
  } catch (error) {
    if (error instanceof Error && error.message === "release_checksum_invalid") throw error;
    return undefined;
  }
}
