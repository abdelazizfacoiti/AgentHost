import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

/*
 * Claude Code attention hooks. Permission prompts happen inside the client
 * before any MCP call reaches AgentHost, so the client itself must tell
 * AgentHost to raise its terminal. Entries are recognised by the
 * "agenthost attention" command text, so add/remove never touch user hooks.
 */

type Json = Record<string, unknown>;
type HookEntry = { matcher?: string; hooks: Array<{ type: "command"; command: string; timeout?: number }> };

const MARKER = "agenthost attention";
const REQUEST = "agenthost attention request --source claude-code --reason permission";
// PostToolUse runs after every tool call; the shell guard keeps it to a stat()
// unless an attention record is actually pending.
const CLEAR = "[ -f \"${AGENTHOST_HOME:-$HOME/.agenthost}/run/attention.json\" ] && agenthost attention clear --restore || true";

export const CLAUDE_ATTENTION_HOOKS: Record<string, HookEntry[]> = {
  PermissionRequest: [{ matcher: "*", hooks: [{ type: "command", command: REQUEST, timeout: 5 }] }],
  Notification: [{ matcher: "permission_prompt", hooks: [{ type: "command", command: REQUEST, timeout: 5 }] }],
  PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: CLEAR, timeout: 5 }] }]
};

export interface HookReport {
  settingsLabel: "[claude-settings]";
  configured: boolean;
  changed: boolean;
  applied: boolean;
  backup: boolean;
  error?: string;
}

export function claudeSettingsPath(home: string): string {
  return path.join(home, ".claude", "settings.json");
}

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOurs(entry: unknown): boolean {
  return isObject(entry) && Array.isArray(entry.hooks) && entry.hooks.some((hook) => isObject(hook) && typeof hook.command === "string" && hook.command.includes(MARKER));
}

function withoutOurs(hooks: Json): Json {
  const next: Json = {};
  for (const [event, entries] of Object.entries(hooks)) {
    const kept = Array.isArray(entries) ? entries.filter((entry) => !isOurs(entry)) : entries;
    if (!Array.isArray(kept) || kept.length > 0) next[event] = kept;
  }
  return next;
}

function hasAll(hooks: Json): boolean {
  return Object.entries(CLAUDE_ATTENTION_HOOKS).every(([event, wanted]) => {
    const entries = hooks[event];
    return Array.isArray(entries) && wanted.every((entry) => entries.some((existing) => JSON.stringify(existing) === JSON.stringify(entry)));
  });
}

async function load(file: string): Promise<{ text: string; root: Json | undefined }> {
  if (!existsSync(file)) return { text: "", root: {} };
  const text = await readFile(file, "utf8");
  if (text.trim() === "") return { text, root: {} };
  try {
    const parsed = JSON.parse(text) as unknown;
    return { text, root: isObject(parsed) ? parsed : undefined };
  } catch {
    return { text, root: undefined };
  }
}

async function writePrivate(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, file);
}

async function save(file: string, text: string, root: Json): Promise<boolean> {
  const backedUp = existsSync(file);
  if (backedUp) await writePrivate(`${file}.agenthost.bak`, text);
  await writePrivate(file, `${JSON.stringify(root, null, 2)}\n`);
  return backedUp;
}

export async function claudeHooksStatus(home: string): Promise<HookReport> {
  const { root } = await load(claudeSettingsPath(home));
  if (root === undefined) return { settingsLabel: "[claude-settings]", configured: false, changed: false, applied: false, backup: false, error: "settings_invalid_json" };
  return { settingsLabel: "[claude-settings]", configured: isObject(root.hooks) && hasAll(root.hooks), changed: false, applied: false, backup: false };
}

export async function claudeHooksAdd(home: string, apply: boolean): Promise<HookReport> {
  const file = claudeSettingsPath(home);
  const { text, root } = await load(file);
  if (root === undefined) return { settingsLabel: "[claude-settings]", configured: false, changed: false, applied: false, backup: false, error: "settings_invalid_json" };
  if (root.hooks !== undefined && !isObject(root.hooks)) return { settingsLabel: "[claude-settings]", configured: false, changed: false, applied: false, backup: false, error: "settings_hooks_unsupported" };
  const current = isObject(root.hooks) ? root.hooks : {};
  if (hasAll(current)) return { settingsLabel: "[claude-settings]", configured: true, changed: false, applied: false, backup: false };
  // Replace any older AgentHost entries so upgrades never leave duplicates.
  const hooks = withoutOurs(current);
  for (const [event, entries] of Object.entries(CLAUDE_ATTENTION_HOOKS)) {
    hooks[event] = [...(Array.isArray(hooks[event]) ? hooks[event] as unknown[] : []), ...entries];
  }
  if (!apply) return { settingsLabel: "[claude-settings]", configured: false, changed: true, applied: false, backup: false };
  const backup = await save(file, text, { ...root, hooks });
  return { settingsLabel: "[claude-settings]", configured: true, changed: true, applied: true, backup };
}

export async function claudeHooksRemove(home: string, apply: boolean): Promise<HookReport> {
  const file = claudeSettingsPath(home);
  const { text, root } = await load(file);
  if (root === undefined) return { settingsLabel: "[claude-settings]", configured: false, changed: false, applied: false, backup: false, error: "settings_invalid_json" };
  if (!isObject(root.hooks) || !Object.values(root.hooks).some((entries) => Array.isArray(entries) && entries.some(isOurs))) {
    return { settingsLabel: "[claude-settings]", configured: false, changed: false, applied: false, backup: false };
  }
  if (!apply) return { settingsLabel: "[claude-settings]", configured: true, changed: true, applied: false, backup: false };
  const hooks = withoutOurs(root.hooks);
  const next: Json = { ...root, hooks };
  if (Object.keys(hooks).length === 0) delete next.hooks;
  const backup = await save(file, text, next);
  return { settingsLabel: "[claude-settings]", configured: false, changed: true, applied: true, backup };
}
