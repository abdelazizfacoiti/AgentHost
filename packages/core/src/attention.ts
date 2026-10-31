import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/*
 * "Attention" means the agent client is blocked on the human: a permission
 * prompt in Claude Code/Codex, or an AgentHost confirmation. Client hooks and
 * the MCP server record it here so every surface (dock alert, edge frame,
 * focus restore) agrees on whether someone is waiting for the user.
 */

export const ATTENTION_SOURCES = ["agenthost", "claude-code", "codex", "opencode", "copilot", "cursor", "other"] as const;
export type AttentionSource = (typeof ATTENTION_SOURCES)[number];
export const ATTENTION_REASONS = ["permission", "confirmation", "idle", "done"] as const;
export type AttentionReason = (typeof ATTENTION_REASONS)[number];

export interface AttentionRecord {
  schemaVersion: 1;
  source: AttentionSource;
  reason: AttentionReason;
  requestedAt: string;
  /** Window raised for the user (the agent's terminal or IDE). */
  hostWindowId?: string;
  /** Window that was active before raising; focus returns here once resolved. */
  returnWindowId?: string;
}

/** Attention older than this is treated as resolved, so a crashed hook cannot pin an alert forever. */
export const ATTENTION_TTL_MS = 30 * 60_000;

export function attentionPath(agentHostDir: string): string {
  return path.join(agentHostDir, "run", "attention.json");
}

const windowIdPattern = /^[0-9]{1,20}$/;

export function isAttentionRecord(value: unknown): value is AttentionRecord {
  if (value === null || typeof value !== "object") return false;
  const record = value as Partial<AttentionRecord>;
  return record.schemaVersion === 1
    && ATTENTION_SOURCES.includes(record.source as AttentionSource)
    && ATTENTION_REASONS.includes(record.reason as AttentionReason)
    && typeof record.requestedAt === "string"
    && Number.isFinite(Date.parse(record.requestedAt))
    && (record.hostWindowId === undefined || windowIdPattern.test(record.hostWindowId))
    && (record.returnWindowId === undefined || windowIdPattern.test(record.returnWindowId));
}

export async function writeAttention(agentHostDir: string, record: AttentionRecord): Promise<void> {
  if (!isAttentionRecord(record)) throw new Error("attention_record_invalid");
  const target = attentionPath(agentHostDir);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(target), 0o700);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

export async function readAttention(agentHostDir: string, now = Date.now()): Promise<AttentionRecord | undefined> {
  try {
    const parsed = JSON.parse(await readFile(attentionPath(agentHostDir), "utf8")) as unknown;
    if (!isAttentionRecord(parsed)) return undefined;
    return now - Date.parse(parsed.requestedAt) > ATTENTION_TTL_MS ? undefined : parsed;
  } catch {
    return undefined;
  }
}

export async function clearAttention(agentHostDir: string): Promise<void> {
  await rm(attentionPath(agentHostDir), { force: true });
}
