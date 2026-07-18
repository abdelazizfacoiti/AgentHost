import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { CAPABILITY_ROUTE_FAMILIES, type CapabilityRouteFamily } from "@agenthost/core";

export interface SafeFailureMemoryRecord {
  schemaVersion: 1;
  goalCategoryFingerprint: string;
  appFamilyFingerprint?: string;
  routeFamily: CapabilityRouteFamily;
  failureCode: string;
  compatibilityFingerprint: string;
  outcome: "verified_failure" | "verified_success";
  latencyMs?: number;
  createdAt: string;
  expiresAt: string;
  invalidationVersion: string;
  redacted: true;
}
const MAX = 256;
const TTL = 30 * 86_400_000;
const SAFE_CODE = /^[a-z0-9_:-]{1,100}$/i;
const SAFE_VERSION = /^[a-z0-9_.:-]{1,100}$/i;
function fingerprint(value: string): string { return createHash("sha256").update(value.slice(0, 256)).digest("hex").slice(0, 32); }
function valid(value: unknown): value is SafeFailureMemoryRecord {
  if (value === null || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return item.schemaVersion === 1 && typeof item.goalCategoryFingerprint === "string" && /^[a-f0-9]{32}$/i.test(item.goalCategoryFingerprint)
    && (item.appFamilyFingerprint === undefined || (typeof item.appFamilyFingerprint === "string" && /^[a-f0-9]{32}$/i.test(item.appFamilyFingerprint)))
    && typeof item.routeFamily === "string" && CAPABILITY_ROUTE_FAMILIES.includes(item.routeFamily as CapabilityRouteFamily)
    && typeof item.failureCode === "string" && SAFE_CODE.test(item.failureCode)
    && typeof item.compatibilityFingerprint === "string" && /^[a-f0-9]{32}$/i.test(item.compatibilityFingerprint)
    && (item.outcome === "verified_failure" || item.outcome === "verified_success")
    && typeof item.createdAt === "string" && Number.isFinite(Date.parse(item.createdAt))
    && typeof item.expiresAt === "string" && Number.isFinite(Date.parse(item.expiresAt))
    && typeof item.invalidationVersion === "string" && SAFE_VERSION.test(item.invalidationVersion)
    && item.redacted === true;
}
export class SafeFailureMemoryStore {
  readonly #file: string;
  #records: SafeFailureMemoryRecord[] = [];
  #loaded = false;
  constructor(agentHostDir: string) { this.#file = path.join(agentHostDir, "strategies", "failures", "memory.json"); }
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
  async record(input: { goalCategory: string; appFamily?: string; routeFamily: CapabilityRouteFamily; failureCode: string; compatibilityFingerprint: string; outcome: "verified_failure" | "verified_success"; latencyMs?: number; invalidationVersion: string }): Promise<SafeFailureMemoryRecord | undefined> {
    if (input.outcome !== "verified_failure" && input.outcome !== "verified_success") return undefined;
    if (!CAPABILITY_ROUTE_FAMILIES.includes(input.routeFamily)) return undefined;
    // Policy blocks, cancellations, and user aborts are deliberately not accepted
    // as route-quality evidence by this store.
    if (!SAFE_CODE.test(input.failureCode)
      || !SAFE_VERSION.test(input.invalidationVersion)
      || ["policy_block", "cancelled", "user_cancelled", "protected_context"].includes(input.failureCode)) return undefined;
    await this.ensureStructure();
    const createdAt = new Date().toISOString();
    const record: SafeFailureMemoryRecord = {
      schemaVersion: 1,
      goalCategoryFingerprint: fingerprint(input.goalCategory),
      ...(input.appFamily === undefined ? {} : { appFamilyFingerprint: fingerprint(input.appFamily) }),
      routeFamily: input.routeFamily,
      failureCode: input.failureCode,
      compatibilityFingerprint: fingerprint(input.compatibilityFingerprint),
      outcome: input.outcome,
      ...(input.latencyMs === undefined ? {} : { latencyMs: Math.max(0, Math.min(86_400_000, Math.round(input.latencyMs))) }),
      createdAt,
      expiresAt: new Date(Date.now() + TTL).toISOString(),
      invalidationVersion: input.invalidationVersion,
      redacted: true
    };
    this.#records.push(record);
    this.#records = this.#records.slice(-MAX);
    await this.#save();
    return record;
  }
  async list(options: { goalCategory?: string; appFamily?: string; invalidationVersion?: string } = {}): Promise<SafeFailureMemoryRecord[]> {
    await this.ensureStructure();
    const goal = options.goalCategory === undefined ? undefined : fingerprint(options.goalCategory);
    const app = options.appFamily === undefined ? undefined : fingerprint(options.appFamily);
    this.#records = this.#records.filter((record) => Date.parse(record.expiresAt) > Date.now() && (options.invalidationVersion === undefined || record.invalidationVersion === options.invalidationVersion));
    return this.#records.filter((record) => (goal === undefined || record.goalCategoryFingerprint === goal) && (app === undefined || record.appFamilyFingerprint === app)).slice(-MAX);
  }
  async #save(): Promise<void> { const temp = `${this.#file}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(this.#records.slice(-MAX), null, 2) + "\n", { mode: 0o600 }); await chmod(temp, 0o600); await rename(temp, this.#file); }
}
