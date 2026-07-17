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
