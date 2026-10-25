import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export const INTEGRATION_TARGETS = ["opencode", "claude", "codex", "copilot", "copilot-cli", "cursor"] as const;
export type IntegrationTarget = (typeof INTEGRATION_TARGETS)[number];
export type IntegrationAction = "status" | "add" | "remove";

export interface IntegrationPaths {
  home: string;
  project: string;
  xdgConfigHome?: string;
  codexHome?: string;
  copilotHome?: string;
}

export interface IntegrationReport {
  target: IntegrationTarget;
  configPath: string;
  configLabel: string;
  configured: boolean;
  matches: boolean;
  changed: boolean;
  applied: boolean;
  backup: boolean;
  proposed?: unknown;
  error?: string;
}

type Json = Record<string, unknown>;

const LABELS: Record<IntegrationTarget, string> = {
  opencode: "[opencode-config]",
  claude: "[claude-config]",
  codex: "[codex-config]",
  copilot: "[copilot-config]",
  "copilot-cli": "[copilot-cli-config]",
  cursor: "[cursor-config]"
};

const CODEX_HEADER = "[mcp_servers.agenthost]";
const CODEX_ENTRY = `${CODEX_HEADER}\ncommand = "agenthost"\nargs = ["start"]\n`;

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stripJsonComments(text: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  let inLine = false;
  let inBlock = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    const next = text[index + 1];
    if (inLine) {
      if (character === "\n") {
        inLine = false;
        output += character;
      }
      continue;
    }
    if (inBlock) {
      if (character === "*" && next === "/") {
        inBlock = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }
    if (character === "\"") {
      inString = true;
      output += character;
      continue;
    }
    if (character === "/" && next === "/") {
      inLine = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      inBlock = true;
      index += 1;
      continue;
    }
    output += character;
  }
  return output;
}

function stripTrailingCommas(text: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }
    if (character === "\"") {
      inString = true;
      output += character;
      continue;
    }
    if (character === ",") {
      let cursor = index + 1;
      while (cursor < text.length && /\s/.test(text[cursor]!)) cursor += 1;
      if (text[cursor] === "}" || text[cursor] === "]") continue;
    }
    output += character;
  }
  return output;
}

function parseJsonConfig(text: string): Json | undefined {
  try {
    const parsed = JSON.parse(stripTrailingCommas(stripJsonComments(text))) as unknown;
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isAgentHostEntry(entry: unknown): boolean {
  if (!isObject(entry) || entry.enabled === false) return false;
  if (typeof entry.command === "string") {
    const base = path.basename(entry.command);
    const args = Array.isArray(entry.args) ? entry.args : [];
    return (base === "agenthost" || base === "agenthost.mjs") && args.includes("start");
  }
  if (Array.isArray(entry.command)) {
    const [command, ...args] = entry.command;
    if (typeof command !== "string") return false;
    const base = path.basename(command);
    return (base === "agenthost" || base === "agenthost.mjs") && args.includes("start");
  }
  return false;
}

export function integrationConfigPath(target: IntegrationTarget, paths: IntegrationPaths): string {
  switch (target) {
    case "opencode": {
      const directory = path.join(paths.xdgConfigHome ?? path.join(paths.home, ".config"), "opencode");
      const jsonc = path.join(directory, "opencode.jsonc");
      return existsSync(jsonc) ? jsonc : path.join(directory, "opencode.json");
    }
    case "claude": return path.join(paths.home, ".claude.json");
    case "codex": return path.join(paths.codexHome ?? path.join(paths.home, ".codex"), "config.toml");
    case "copilot": return path.join(paths.project, ".vscode", "mcp.json");
    case "copilot-cli": return path.join(paths.copilotHome ?? path.join(paths.home, ".copilot"), "mcp-config.json");
    case "cursor": return path.join(paths.project, ".cursor", "mcp.json");
  }
}

async function writePrivate(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, file);
  await chmod(file, 0o600);
}

async function backup(file: string, content: string): Promise<boolean> {
  if (!existsSync(file)) return false;
  await writePrivate(`${file}.agenthost.bak`, content);
  return true;
}

function jsonContainer(root: Json, target: IntegrationTarget): { container: Json; entry: Json } | undefined {
  if (target === "opencode") {
    if (root.mcp !== undefined && !isObject(root.mcp)) return undefined;
    const mcp = isObject(root.mcp) ? root.mcp : {};
    root.mcp = mcp;
    return { container: mcp, entry: { type: "local", command: ["agenthost", "start"] } };
  }
  const key = target === "copilot" ? "servers" : "mcpServers";
  if (root[key] !== undefined && !isObject(root[key])) return undefined;
  const container = isObject(root[key]) ? root[key] as Json : {};
  root[key] = container;
  const entry = target === "copilot"
    ? { type: "stdio", command: "agenthost", args: ["start"] }
    : target === "copilot-cli"
      ? { type: "local", command: "agenthost", args: ["start"], tools: ["*"] }
      : { command: "agenthost", args: ["start"] };
  return { container, entry };
}

function codexBlock(text: string): { start: number; end: number } | undefined {
  const match = /^\[mcp_servers\.agenthost\][ \t]*$/m.exec(text);
  if (match === null) return undefined;
  const start = match.index;
  const next = text.indexOf("\n[", start + match[0].length);
  return { start, end: next < 0 ? text.length : next };
}

function codexUnsupported(text: string): boolean {
  return text.length > 2_000_000
    || text.includes("\u0000")
    || text.split("\n").some((line) => line.trimStart().startsWith("[") && !line.trim().endsWith("]"));
}

function codexMatches(text: string): boolean {
  const block = codexBlock(text);
  if (block === undefined) return false;
  const section = text.slice(block.start, block.end);
  return /^command\s*=\s*"agenthost"\s*$/m.test(section) && /^args\s*=\s*\["start"\]\s*$/m.test(section);
}

function report(target: IntegrationTarget, configPath: string, values: Omit<IntegrationReport, "target" | "configPath" | "configLabel">): IntegrationReport {
  return {
    target,
    configPath,
    configLabel: LABELS[target],
    ...values,
    ...(values.proposed === undefined ? {} : { proposed: values.proposed })
  };
}

async function readConfig(file: string): Promise<{ text: string; existed: boolean }> {
  if (!existsSync(file)) return { text: "", existed: false };
  return { text: await readFile(file, "utf8"), existed: true };
}

async function jsonStatus(target: IntegrationTarget, paths: IntegrationPaths): Promise<IntegrationReport> {
  const file = integrationConfigPath(target, paths);
  const { text } = await readConfig(file);
  const root = text.trim() === "" ? {} : parseJsonConfig(text);
  if (root === undefined) return report(target, file, { configured: false, matches: false, changed: false, applied: false, backup: false, error: "config_invalid_json" });
  const container = jsonContainer(root, target);
  if (container === undefined) return report(target, file, { configured: false, matches: false, changed: false, applied: false, backup: false, error: "config_unsupported" });
  const existing = container.container.agenthost;
  return report(target, file, { configured: existing !== undefined, matches: isAgentHostEntry(existing), changed: false, applied: false, backup: false });
}

async function jsonAdd(target: IntegrationTarget, paths: IntegrationPaths, apply: boolean): Promise<IntegrationReport> {
  const file = integrationConfigPath(target, paths);
  const { text } = await readConfig(file);
  const root = text.trim() === "" ? {} : parseJsonConfig(text);
  if (root === undefined) return report(target, file, { configured: false, matches: false, changed: false, applied: false, backup: false, error: "config_invalid_json" });
  const container = jsonContainer(root, target);
  if (container === undefined) return report(target, file, { configured: false, matches: false, changed: false, applied: false, backup: false, error: "config_unsupported" });
  const existing = container.container.agenthost;
  if (isAgentHostEntry(existing)) return report(target, file, { configured: true, matches: true, changed: false, applied: false, backup: false });
  const wasConfigured = existing !== undefined;
  container.container.agenthost = container.entry;
  const updated = `${JSON.stringify(root, null, 2)}\n`;
  const changed = updated !== text;
  if (!apply || !changed) return report(target, file, { configured: wasConfigured, matches: false, changed, applied: false, backup: false, proposed: container.entry });
  const backedUp = await backup(file, text);
  await writePrivate(file, updated);
  return report(target, file, { configured: true, matches: true, changed: true, applied: true, backup: backedUp, proposed: container.entry });
}

async function jsonRemove(target: IntegrationTarget, paths: IntegrationPaths, apply: boolean): Promise<IntegrationReport> {
  const file = integrationConfigPath(target, paths);
  const { text } = await readConfig(file);
  const root = text.trim() === "" ? {} : parseJsonConfig(text);
  if (root === undefined) return report(target, file, { configured: false, matches: false, changed: false, applied: false, backup: false, error: "config_invalid_json" });
  const container = jsonContainer(root, target);
  if (container === undefined) return report(target, file, { configured: false, matches: false, changed: false, applied: false, backup: false, error: "config_unsupported" });
  const existing = container.container.agenthost;
  if (existing === undefined) return report(target, file, { configured: false, matches: false, changed: false, applied: false, backup: false });
  delete container.container.agenthost;
  const updated = `${JSON.stringify(root, null, 2)}\n`;
  if (!apply) return report(target, file, { configured: true, matches: isAgentHostEntry(existing), changed: true, applied: false, backup: false });
  const backedUp = await backup(file, text);
  await writePrivate(file, updated);
  return report(target, file, { configured: false, matches: false, changed: true, applied: true, backup: backedUp });
}

async function codexStatus(paths: IntegrationPaths): Promise<IntegrationReport> {
  const file = integrationConfigPath("codex", paths);
  const { text } = await readConfig(file);
  if (text !== "" && codexUnsupported(text)) return report("codex", file, { configured: false, matches: false, changed: false, applied: false, backup: false, error: "config_unsupported_or_invalid" });
  return report("codex", file, { configured: codexBlock(text) !== undefined, matches: codexMatches(text), changed: false, applied: false, backup: false });
}

async function codexAdd(paths: IntegrationPaths, apply: boolean): Promise<IntegrationReport> {
  const file = integrationConfigPath("codex", paths);
  const { text } = await readConfig(file);
  if (text !== "" && codexUnsupported(text)) return report("codex", file, { configured: false, matches: false, changed: false, applied: false, backup: false, error: "config_unsupported_or_invalid" });
  if (codexMatches(text)) return report("codex", file, { configured: true, matches: true, changed: false, applied: false, backup: false });
  const block = codexBlock(text);
  const updated = block === undefined
    ? `${text.trimEnd()}${text.trim().length > 0 ? "\n\n" : ""}${CODEX_ENTRY}`
    : `${text.slice(0, block.start)}${CODEX_ENTRY}${text.slice(block.end).replace(/^\n+/, "\n")}`;
  if (!apply) return report("codex", file, { configured: block !== undefined, matches: false, changed: true, applied: false, backup: false, proposed: { command: "agenthost", args: ["start"] } });
  const backedUp = await backup(file, text);
  await writePrivate(file, updated);
  return report("codex", file, { configured: true, matches: true, changed: true, applied: true, backup: backedUp, proposed: { command: "agenthost", args: ["start"] } });
}

async function codexRemove(paths: IntegrationPaths, apply: boolean): Promise<IntegrationReport> {
  const file = integrationConfigPath("codex", paths);
  const { text } = await readConfig(file);
  if (text !== "" && codexUnsupported(text)) return report("codex", file, { configured: false, matches: false, changed: false, applied: false, backup: false, error: "config_unsupported_or_invalid" });
  const block = codexBlock(text);
  if (block === undefined) return report("codex", file, { configured: false, matches: false, changed: false, applied: false, backup: false });
  if (!apply) return report("codex", file, { configured: true, matches: codexMatches(text), changed: true, applied: false, backup: false });
  const updated = `${text.slice(0, block.start)}${text.slice(block.end).replace(/^\n+/, "\n")}`.trimEnd() + "\n";
  const backedUp = await backup(file, text);
  await writePrivate(file, updated);
  return report("codex", file, { configured: false, matches: false, changed: true, applied: true, backup: backedUp });
}

export async function integrationStatus(target: IntegrationTarget, paths: IntegrationPaths): Promise<IntegrationReport> {
  if (target === "codex") return await codexStatus(paths);
  return await jsonStatus(target, paths);
}

export async function integrationAdd(target: IntegrationTarget, paths: IntegrationPaths, apply: boolean): Promise<IntegrationReport> {
  if (target === "codex") return await codexAdd(paths, apply);
  return await jsonAdd(target, paths, apply);
}

export async function integrationRemove(target: IntegrationTarget, paths: IntegrationPaths, apply: boolean): Promise<IntegrationReport> {
  if (target === "codex") return await codexRemove(paths, apply);
  return await jsonRemove(target, paths, apply);
}

export function publicIntegrationReport(value: IntegrationReport): Omit<IntegrationReport, "configPath"> {
  const { configPath: _configPath, ...rest } = value;
  return rest;
}
