import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { redactSensitiveText, CAPABILITY_ROUTE_FAMILIES, type CapabilityRouteFamily } from "@agenthost/core";

/**
 * Episodic memory: bounded, redacted, expiring records of what worked and
 * what did not, per goal category and strategy. The strategy planner reads
 * these when scoring candidates; raw task content never enters the store.
 */
export interface EpisodicMemoryRecord {
  schemaVersion: 1;
  episodeId: string;
  taskId?: string;
  goalCategory: string;
  strategyId?: string;
  routeFamily?: CapabilityRouteFamily;
  outcome: "verified_success" | "verified_failure";
  failureCode?: string;
  /** Short redacted lesson, free of secrets and private content. */
  lesson?: string;
  createdAt: string;
  expiresAt: string;
  redacted: true;
}

export interface EpisodicMemoryInput {
  taskId?: string;
  goalCategory: string;
  strategyId?: string;
  routeFamily?: CapabilityRouteFamily;
  outcome: "verified_success" | "verified_failure";
  failureCode?: string;
  lesson?: string;
}

const MAX = 256;
const TTL = 30 * 86_400_000;
const SAFE_CODE = /^[a-z0-9_:-]{1,100}$/i;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,200}$/;
const SAFE_CATEGORY = /^[a-z0-9_:-]{1,100}$/i;

function cleanLesson(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const redacted = redactSensitiveText(value).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500);
  return redacted.length > 0 ? redacted : undefined;
}

function valid(value: unknown): value is EpisodicMemoryRecord {
  if (value === null || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return item.schemaVersion === 1
    && typeof item.episodeId === "string" && SAFE_ID.test(item.episodeId)
    && (item.taskId === undefined || (typeof item.taskId === "string" && SAFE_ID.test(item.taskId)))
    && typeof item.goalCategory === "string" && SAFE_CATEGORY.test(item.goalCategory)
    && (item.strategyId === undefined || (typeof item.strategyId === "string" && SAFE_ID.test(item.strategyId)))
    && (item.routeFamily === undefined || (typeof item.routeFamily === "string" && CAPABILITY_ROUTE_FAMILIES.includes(item.routeFamily as CapabilityRouteFamily)))
    && (item.outcome === "verified_success" || item.outcome === "verified_failure")
    && (item.failureCode === undefined || (typeof item.failureCode === "string" && SAFE_CODE.test(item.failureCode)))
    && (item.lesson === undefined || (typeof item.lesson === "string" && item.lesson.length <= 500))
    && typeof item.createdAt === "string" && Number.isFinite(Date.parse(item.createdAt))
    && typeof item.expiresAt === "string" && Number.isFinite(Date.parse(item.expiresAt))
    && item.redacted === true;
}

export class EpisodicMemoryStore {
  readonly #file: string;
  #records: EpisodicMemoryRecord[] = [];
  #loaded = false;
  constructor(agentHostDir: string) { this.#file = path.join(agentHostDir, "memory", "episodes.json"); }

  async ensureStructure(): Promise<void> {
    if (this.#loaded) return;
    await mkdir(path.dirname(this.#file), { recursive: true, mode: 0o700 });
    try {
      const values = JSON.parse(await readFile(this.#file, "utf8")) as unknown;
      if (Array.isArray(values)) this.#records = values.filter(valid).slice(-MAX);
    } catch { /* fail closed on first run/corruption */ }
    this.#loaded = true;
    this.#records = this.#records.filter((record) => Date.parse(record.expiresAt) > Date.now());
  }

  async record(input: EpisodicMemoryInput): Promise<EpisodicMemoryRecord | undefined> {
    if (input.outcome !== "verified_success" && input.outcome !== "verified_failure") return undefined;
    if (!SAFE_CATEGORY.test(input.goalCategory)) return undefined;
    if (input.strategyId !== undefined && !SAFE_ID.test(input.strategyId)) return undefined;
    if (input.routeFamily !== undefined && !CAPABILITY_ROUTE_FAMILIES.includes(input.routeFamily)) return undefined;
    if (input.failureCode !== undefined && !SAFE_CODE.test(input.failureCode)) return undefined;
    // Policy blocks, cancellations, and user aborts are not learning evidence.
    if (input.failureCode !== undefined && ["policy_block", "cancelled", "user_cancelled", "protected_context"].includes(input.failureCode)) return undefined;
    await this.ensureStructure();
    const createdAt = new Date().toISOString();
    const lesson = cleanLesson(input.lesson);
    const record: EpisodicMemoryRecord = {
      schemaVersion: 1,
      episodeId: `episode_${randomUUID()}`,
      ...(input.taskId !== undefined && SAFE_ID.test(input.taskId) ? { taskId: input.taskId } : {}),
      goalCategory: input.goalCategory,
      ...(input.strategyId === undefined ? {} : { strategyId: input.strategyId }),
      ...(input.routeFamily === undefined ? {} : { routeFamily: input.routeFamily }),
      outcome: input.outcome,
      ...(input.failureCode === undefined ? {} : { failureCode: input.failureCode }),
      ...(lesson === undefined ? {} : { lesson }),
      createdAt,
      expiresAt: new Date(Date.now() + TTL).toISOString(),
      redacted: true
    };
    this.#records.push(record);
    this.#records = this.#records.slice(-MAX);
    await this.#save();
    return record;
  }

  async list(options: { goalCategory?: string; strategyId?: string } = {}): Promise<EpisodicMemoryRecord[]> {
    await this.ensureStructure();
    this.#records = this.#records.filter((record) => Date.parse(record.expiresAt) > Date.now());
    return this.#records
      .filter((record) => (options.goalCategory === undefined || record.goalCategory === options.goalCategory)
        && (options.strategyId === undefined || record.strategyId === options.strategyId))
      .slice(-MAX);
  }

  async #save(): Promise<void> {
    const temp = `${this.#file}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(this.#records.slice(-MAX), null, 2) + "\n", { mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, this.#file);
  }
}
