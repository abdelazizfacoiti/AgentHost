import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RiskLevel } from "./types.js";

export const DEFAULT_CONFIRMATION_TTL_MS = 15 * 60_000;
export const MAX_CONFIRMATION_TTL_MS = 60 * 60_000;
const MAX_PENDING_CONFIRMATIONS = 100;

export type ConfirmationRecordStatus = "pending" | "accepted" | "rejected" | "used";

export interface ConfirmationRecord {
  tokenId: string;
  tool: string;
  profile: string;
  inputFingerprint: string;
  targetFingerprint?: string;
  riskLevel: RiskLevel;
  summary: string;
  taskId?: string;
  sessionId?: string;
  createdAt: string;
  expiresAt: string;
  status: ConfirmationRecordStatus;
  acceptedAt?: string;
  rejectedAt?: string;
  usedAt?: string;
}

export type ConfirmationErrorCode =
  | "confirmation_token_not_found"
  | "confirmation_token_expired"
  | "confirmation_token_rejected"
  | "confirmation_token_used"
  | "confirmation_not_approved"
  | "confirmation_tool_mismatch"
  | "confirmation_profile_mismatch"
  | "confirmation_input_mismatch"
  | "confirmation_target_mismatch"
  | "confirmation_store_failed";

export class ConfirmationError extends Error {
  readonly code: ConfirmationErrorCode;

  constructor(code: ConfirmationErrorCode, message: string) {
    super(message);
    this.name = "ConfirmationError";
    this.code = code;
  }
}

export interface ActiveTaskApproval {
  approvalId: string;
  taskId: string;
  maxRisk: "low" | "medium";
  origin: string;
  createdAt: string;
  expiresAt: string;
}

function confirmationsDir(agentHostDir: string): string {
  return path.join(agentHostDir, "run", "confirmations");
}

export function isValidConfirmationTokenId(tokenId: string): boolean {
  return /^conf_[A-Za-z0-9-]{8,100}$/.test(tokenId);
}

function tokenPath(agentHostDir: string, tokenId: string): string {
  if (!isValidConfirmationTokenId(tokenId)) {
    throw new ConfirmationError("confirmation_token_not_found", "Confirmation token was not found.");
  }
  return path.join(confirmationsDir(agentHostDir), `${tokenId}.json`);
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => normalizeValue(entry));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeValue(entry)])
    );
  }
  return value;
}

export function fingerprintToolInput(tool: string, input: unknown): string {
  const record = input !== null && typeof input === "object" ? { ...(input as Record<string, unknown>) } : input;
  if (record !== null && typeof record === "object") {
    delete (record as Record<string, unknown>).dryRun;
    delete (record as Record<string, unknown>).confirmationToken;
  }
  return createHash("sha256").update(`${tool}\n${JSON.stringify(normalizeValue(record))}`).digest("hex");
}

async function safeDirectory(agentHostDir: string): Promise<string> {
  const directory = confirmationsDir(agentHostDir);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  return directory;
}

async function writeRecord(agentHostDir: string, record: ConfirmationRecord): Promise<void> {
  const directory = await safeDirectory(agentHostDir);
  const target = path.join(directory, `${record.tokenId}.json`);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, target);
  await chmod(target, 0o600);
}

async function removeExpired(agentHostDir: string, now: number): Promise<void> {
  const directory = confirmationsDir(agentHostDir);
  let files: string[] = [];
  try {
    files = (await readdir(directory)).filter((entry) => entry.endsWith(".json"));
  } catch {
    return;
  }
  for (const entry of files) {
    try {
      const record = JSON.parse(await readFile(path.join(directory, entry), "utf8")) as ConfirmationRecord;
      if (Date.parse(record.expiresAt) <= now || (record.status === "used" && Date.parse(record.usedAt ?? record.expiresAt) + 86_400_000 <= now)) {
        await rm(path.join(directory, entry), { force: true });
      }
    } catch {
      await rm(path.join(directory, entry), { force: true }).catch(() => undefined);
    }
  }
}

export async function prepareConfirmation(input: {
  agentHostDir: string;
  tool: string;
  profile: string;
  riskLevel: RiskLevel;
  args: unknown;
  summary: string;
  targetFingerprint?: string;
  taskId?: string;
  sessionId?: string;
  ttlMs?: number;
}): Promise<ConfirmationRecord> {
  const now = Date.now();
  await removeExpired(input.agentHostDir, now);
  const directory = await safeDirectory(input.agentHostDir);
  const existing = await readdir(directory).catch(() => [] as string[]);
  if (existing.filter((entry) => entry.endsWith(".json")).length >= MAX_PENDING_CONFIRMATIONS) {
    throw new ConfirmationError("confirmation_store_failed", "Too many pending confirmations; resolve or deny older tokens first.");
  }

  const ttlMs = Math.max(30_000, Math.min(input.ttlMs ?? DEFAULT_CONFIRMATION_TTL_MS, MAX_CONFIRMATION_TTL_MS));
  const createdAt = new Date(now).toISOString();
  const record: ConfirmationRecord = {
    tokenId: `conf_${randomUUID()}`,
    tool: input.tool,
    profile: input.profile,
    inputFingerprint: fingerprintToolInput(input.tool, input.args),
    riskLevel: input.riskLevel,
    summary: input.summary.slice(0, 500),
    createdAt,
    expiresAt: new Date(now + ttlMs).toISOString(),
    status: "pending",
    ...(input.targetFingerprint === undefined ? {} : { targetFingerprint: input.targetFingerprint }),
    ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId })
  };
  await writeRecord(input.agentHostDir, record);
  return record;
}

export async function readConfirmation(agentHostDir: string, tokenId: string): Promise<ConfirmationRecord | undefined> {
  try {
    return JSON.parse(await readFile(tokenPath(agentHostDir, tokenId), "utf8")) as ConfirmationRecord;
  } catch {
    return undefined;
  }
}

export async function listConfirmations(agentHostDir: string): Promise<ConfirmationRecord[]> {
  const directory = confirmationsDir(agentHostDir);
  let files: string[] = [];
  try {
    files = (await readdir(directory)).filter((entry) => entry.endsWith(".json"));
  } catch {
    return [];
  }
  await removeExpired(agentHostDir, Date.now());
  const records: ConfirmationRecord[] = [];
  for (const entry of files) {
    try {
      const record = JSON.parse(await readFile(path.join(directory, entry), "utf8")) as ConfirmationRecord;
      records.push(record);
    } catch {
      continue;
    }
  }
  return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function mutateRecord(
  agentHostDir: string,
  tokenId: string,
  status: "accepted" | "rejected"
): Promise<ConfirmationRecord> {
  const original = tokenPath(agentHostDir, tokenId);
  const claimed = `${original}.${process.pid}.${randomUUID()}.${status}`;
  try {
    await rename(original, claimed);
  } catch {
    throw new ConfirmationError("confirmation_token_not_found", "Confirmation token was not found or is being resolved.");
  }

  let record: ConfirmationRecord;
  try {
    record = JSON.parse(await readFile(claimed, "utf8")) as ConfirmationRecord;
  } catch {
    await rm(claimed, { force: true }).catch(() => undefined);
    throw new ConfirmationError("confirmation_store_failed", "Confirmation token could not be read.");
  }

  const restoreAndFail = async (code: ConfirmationErrorCode, message: string, restore: boolean): Promise<never> => {
    if (restore) await rename(claimed, original).catch(() => rm(claimed, { force: true }));
    else await rm(claimed, { force: true }).catch(() => undefined);
    throw new ConfirmationError(code, message);
  };

  if (Date.parse(record.expiresAt) <= Date.now()) return await restoreAndFail("confirmation_token_expired", "Confirmation token has expired.", false);
  if (record.status === "used") return await restoreAndFail("confirmation_token_used", "Confirmation token has already been used.", false);
  if (record.status === "rejected") return await restoreAndFail("confirmation_token_rejected", "Confirmation token was rejected.", false);

  const now = new Date().toISOString();
  const next: ConfirmationRecord = status === "accepted"
    ? { ...record, status, acceptedAt: now }
    : { ...record, status, rejectedAt: now };
  try {
    await writeRecord(agentHostDir, next);
  } catch (error) {
    await rename(claimed, original).catch(() => undefined);
    throw error;
  }
  await rm(claimed, { force: true });
  return next;
}

export function acceptConfirmation(agentHostDir: string, tokenId: string): Promise<ConfirmationRecord> {
  return mutateRecord(agentHostDir, tokenId, "accepted");
}

export function rejectConfirmation(agentHostDir: string, tokenId: string): Promise<ConfirmationRecord> {
  return mutateRecord(agentHostDir, tokenId, "rejected");
}

export async function consumeConfirmation(input: {
  agentHostDir: string;
  tokenId: string;
  tool: string;
  profile: string;
  args: unknown;
  targetFingerprint?: string;
  allowPending: boolean;
}): Promise<ConfirmationRecord> {
  const original = tokenPath(input.agentHostDir, input.tokenId);
  const claimed = `${original}.${process.pid}.${randomUUID()}.claimed`;
  try {
    await rename(original, claimed);
  } catch {
    throw new ConfirmationError("confirmation_token_not_found", "Confirmation token was not found or was already consumed.");
  }

  let record: ConfirmationRecord;
  try {
    record = JSON.parse(await readFile(claimed, "utf8")) as ConfirmationRecord;
  } catch {
    await rm(claimed, { force: true }).catch(() => undefined);
    throw new ConfirmationError("confirmation_store_failed", "Confirmation token could not be read.");
  }

  const fail = async (code: ConfirmationErrorCode, message: string, restore: boolean): Promise<never> => {
    if (restore) await rename(claimed, original).catch(() => rm(claimed, { force: true }));
    else await rm(claimed, { force: true }).catch(() => undefined);
    throw new ConfirmationError(code, message);
  };

  if (Date.parse(record.expiresAt) <= Date.now()) return await fail("confirmation_token_expired", "Confirmation token has expired.", false);
  if (record.status === "rejected") return await fail("confirmation_token_rejected", "Confirmation token was rejected.", false);
  if (record.status === "used") return await fail("confirmation_token_used", "Confirmation token has already been used.", false);
  if (record.status === "pending" && !input.allowPending) {
    return await fail("confirmation_not_approved", `Confirmation token is pending operator approval. Run: agenthost confirm ${record.tokenId}`, true);
  }
  if (record.tool !== input.tool) return await fail("confirmation_tool_mismatch", "Confirmation token belongs to a different tool.", true);
  if (record.profile !== input.profile) return await fail("confirmation_profile_mismatch", "Confirmation token was issued for a different policy profile.", true);
  if (record.inputFingerprint !== fingerprintToolInput(input.tool, input.args)) {
    return await fail("confirmation_input_mismatch", "Confirmation token does not match the attempted arguments.", true);
  }
  if (record.targetFingerprint !== undefined && record.targetFingerprint !== input.targetFingerprint) {
    return await fail("confirmation_target_mismatch", "Confirmation token does not match the current target.", true);
  }

  const now = new Date().toISOString();
  const consumed: ConfirmationRecord = {
    ...record,
    status: "used",
    usedAt: now,
    ...(record.acceptedAt === undefined ? { acceptedAt: now } : {})
  };
  await rm(claimed, { force: true });
  return consumed;
}

export function activeTaskApprovalPath(agentHostDir: string): string {
  return path.join(agentHostDir, "tasks", "approvals", "active.json");
}

export async function readActiveTaskApproval(agentHostDir: string): Promise<ActiveTaskApproval | undefined> {
  try {
    const parsed = JSON.parse(await readFile(activeTaskApprovalPath(agentHostDir), "utf8")) as Partial<ActiveTaskApproval>;
    if (typeof parsed.approvalId !== "string" || typeof parsed.taskId !== "string" || typeof parsed.expiresAt !== "string") return undefined;
    if (parsed.maxRisk !== "low" && parsed.maxRisk !== "medium") return undefined;
    if (Date.parse(parsed.expiresAt) <= Date.now()) return undefined;
    return {
      approvalId: parsed.approvalId,
      taskId: parsed.taskId,
      maxRisk: parsed.maxRisk,
      origin: typeof parsed.origin === "string" ? parsed.origin : "cli",
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date(0).toISOString(),
      expiresAt: parsed.expiresAt
    };
  } catch {
    return undefined;
  }
}

export async function clearActiveTaskApproval(agentHostDir: string): Promise<void> {
  await rm(activeTaskApprovalPath(agentHostDir), { force: true });
}

const RISK_ORDER: RiskLevel[] = ["observe", "low", "medium", "high", "blocked"];

export function activeApprovalCoversRisk(approval: ActiveTaskApproval | undefined, riskLevel: RiskLevel): boolean {
  if (approval === undefined) return false;
  const maximum = approval.maxRisk === "low" ? "low" : "medium";
  return RISK_ORDER.indexOf(riskLevel) <= RISK_ORDER.indexOf(maximum);
}
