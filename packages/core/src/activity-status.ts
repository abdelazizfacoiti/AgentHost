import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OverlayActivityMode } from "./overlay.js";

export type ActivityStatusPhase = "started" | "finished";
export type ActivityStatusOutcome = "ok" | "error" | "halted" | "approval_required";

export interface ActivityStatusOverlay {
  started: boolean;
  visible: boolean;
  error?: string;
  timedOut?: boolean;
}

export interface ActivityStatusRecord {
  schemaVersion: 1;
  sessionId: string;
  mode: OverlayActivityMode;
  tool: string;
  phase: ActivityStatusPhase;
  outcome?: ActivityStatusOutcome;
  overlay: ActivityStatusOverlay;
  updatedAt: string;
}

const STATUS_FILE = "activity.json";
const MAX_FIELD = 200;
const writeQueues = new Map<string, Promise<void>>();

export function activityStatusPath(agentHostDir: string): string {
  return path.join(agentHostDir, "run", STATUS_FILE);
}

function safeField(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_FIELD;
}

function isMode(value: unknown): value is OverlayActivityMode {
  return value === "always" || value === "on_change" || value === "off";
}

function isOverlay(value: unknown): value is ActivityStatusOverlay {
  if (value === null || typeof value !== "object") return false;
  const overlay = value as Partial<ActivityStatusOverlay>;
  return typeof overlay.started === "boolean"
    && typeof overlay.visible === "boolean"
    && (overlay.error === undefined || (typeof overlay.error === "string" && overlay.error.length <= MAX_FIELD))
    && (overlay.timedOut === undefined || typeof overlay.timedOut === "boolean");
}

export function isActivityStatusRecord(value: unknown): value is ActivityStatusRecord {
  if (value === null || typeof value !== "object") return false;
  const record = value as Partial<ActivityStatusRecord>;
  return record.schemaVersion === 1
    && safeField(record.sessionId)
    && isMode(record.mode)
    && safeField(record.tool)
    && (record.phase === "started" || record.phase === "finished")
    && (record.outcome === undefined || ["ok", "error", "halted", "approval_required"].includes(record.outcome))
    && isOverlay(record.overlay)
    && typeof record.updatedAt === "string"
    && Number.isFinite(Date.parse(record.updatedAt));
}

export async function writeActivityStatus(agentHostDir: string, record: ActivityStatusRecord): Promise<void> {
  if (!isActivityStatusRecord(record)) throw new Error("activity_status_invalid");
  const target = activityStatusPath(agentHostDir);
  const previous = writeQueues.get(target) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const directory = path.dirname(target);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, target);
    await chmod(target, 0o600);
  });
  writeQueues.set(target, next);
  try {
    await next;
  } finally {
    if (writeQueues.get(target) === next) writeQueues.delete(target);
  }
}

export async function readActivityStatus(agentHostDir: string): Promise<ActivityStatusRecord | undefined> {
  try {
    const parsed = JSON.parse(await readFile(activityStatusPath(agentHostDir), "utf8")) as unknown;
    return isActivityStatusRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
