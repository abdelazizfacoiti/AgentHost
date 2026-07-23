import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { CAPABILITY_ROUTE_FAMILIES, type CapabilityRouteFamily, type CapabilityRouteMetricRecord } from "@agenthost/core";

const MAX_RECORDS = 256;
const MAX_LATENCY_SAMPLES = 31;
const METRIC_TTL_MS = 30 * 86_400_000;
const SAFE_VERSION = /^[a-z0-9_.:-]{1,100}$/i;
type LatencySamples = NonNullable<CapabilityRouteMetricRecord["latencySamples"]>;
const RECORD_KEYS = new Set([
  "schemaVersion", "routeFamily", "goalCategoryFingerprint", "appFamilyFingerprint",
  "compatibilityFingerprint", "attempts", "verifiedSuccesses", "verifiedFailures",
  "consecutiveVerifiedFailures", "medianProbeMs", "medianExecutionMs",
  "medianVerificationMs", "latencySamples", "lastAttemptedAt", "lastVerifiedAt",
  "expiresAt", "lastFailureCode", "compatibilityVersion", "status", "redacted"
]);

export function routeMetricFingerprint(value: string): string {
  return createHash("sha256").update(value.slice(0, 256), "utf8").digest("hex").slice(0, 32);
}

function normalizeFingerprint(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return /^[a-f0-9]{32}$/i.test(value) ? value.toLowerCase() : routeMetricFingerprint(value);
}

function addSample(values: number[] | undefined, value: number | undefined): number[] | undefined {
  if (value === undefined || !Number.isFinite(value)) return values;
  const bounded = Math.max(0, Math.min(86_400_000, Math.round(value)));
  return [...(values ?? []), bounded].slice(-MAX_LATENCY_SAMPLES);
}

function median(values: number[] | undefined): number | undefined {
  if (values === undefined || values.length === 0) return undefined;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? ordered[middle] : Math.round((ordered[middle - 1]! + ordered[middle]!) / 2);
}

function safeSamples(value: unknown): LatencySamples | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const output: LatencySamples = {};
  for (const key of ["probeMs", "executionMs", "verificationMs"] as const) {
    const values = Array.isArray(input[key]) ? input[key].filter((item): item is number => typeof item === "number" && Number.isFinite(item) && item >= 0 && item <= 86_400_000).map((item) => Math.round(item)).slice(-MAX_LATENCY_SAMPLES) : [];
    if (values.length > 0) output[key] = values;
  }
  return Object.keys(output).length === 0 ? undefined : output;
}

function safeInteger(value: unknown, maximum = 1_000_000): number | undefined {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= maximum
    ? Number(value)
    : undefined;
}

function safeTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function safeMetricRecord(value: unknown): CapabilityRouteMetricRecord | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !RECORD_KEYS.has(key))) return undefined;
  if (raw.schemaVersion !== 1
    || typeof raw.routeFamily !== "string"
    || !CAPABILITY_ROUTE_FAMILIES.includes(raw.routeFamily as CapabilityRouteFamily)
    || raw.redacted !== true) return undefined;
  const goalCategoryFingerprint = normalizeFingerprint(raw.goalCategoryFingerprint);
  const appFamilyFingerprint = raw.appFamilyFingerprint === undefined
    ? undefined
    : normalizeFingerprint(raw.appFamilyFingerprint);
  const compatibilityFingerprint = normalizeFingerprint(raw.compatibilityFingerprint);
  const attempts = safeInteger(raw.attempts);
  const verifiedSuccesses = safeInteger(raw.verifiedSuccesses);
  const verifiedFailures = safeInteger(raw.verifiedFailures);
  const consecutiveVerifiedFailures = safeInteger(raw.consecutiveVerifiedFailures);
  if (goalCategoryFingerprint === undefined
    || compatibilityFingerprint === undefined
    || attempts === undefined
    || verifiedSuccesses === undefined
    || verifiedFailures === undefined
    || consecutiveVerifiedFailures === undefined
    || verifiedSuccesses + verifiedFailures > attempts
    || typeof raw.compatibilityVersion !== "string"
    || !SAFE_VERSION.test(raw.compatibilityVersion)
    || !["active", "degraded", "expired"].includes(String(raw.status))) return undefined;
  const samples = safeSamples(raw.latencySamples);
  const lastAttemptedAt = safeTimestamp(raw.lastAttemptedAt);
  const lastVerifiedAt = safeTimestamp(raw.lastVerifiedAt);
  const storedExpiry = safeTimestamp(raw.expiresAt);
  const derivedExpiry = new Date(
    Math.min(
      Date.now() + METRIC_TTL_MS,
      (lastVerifiedAt === undefined ? Date.now() : Date.parse(lastVerifiedAt)) + METRIC_TTL_MS
    )
  ).toISOString();
  const expiresAt = storedExpiry ?? derivedExpiry;
  const expired = Date.parse(expiresAt) <= Date.now();
  const boundedLatency = (input: unknown): number | undefined => {
    const parsed = safeInteger(input, 86_400_000);
    return parsed;
  };
  return {
    schemaVersion: 1,
    routeFamily: raw.routeFamily as CapabilityRouteFamily,
    goalCategoryFingerprint,
    ...(appFamilyFingerprint === undefined ? {} : { appFamilyFingerprint }),
    compatibilityFingerprint,
    attempts,
    verifiedSuccesses,
    verifiedFailures,
    consecutiveVerifiedFailures,
    ...(boundedLatency(raw.medianProbeMs) === undefined ? {} : { medianProbeMs: boundedLatency(raw.medianProbeMs)! }),
    ...(boundedLatency(raw.medianExecutionMs) === undefined ? {} : { medianExecutionMs: boundedLatency(raw.medianExecutionMs)! }),
    ...(boundedLatency(raw.medianVerificationMs) === undefined ? {} : { medianVerificationMs: boundedLatency(raw.medianVerificationMs)! }),
    ...(samples === undefined ? {} : { latencySamples: samples }),
    ...(lastAttemptedAt === undefined ? {} : { lastAttemptedAt }),
    ...(lastVerifiedAt === undefined ? {} : { lastVerifiedAt }),
    expiresAt,
    ...(typeof raw.lastFailureCode === "string" && /^[a-z0-9_:-]{1,100}$/i.test(raw.lastFailureCode)
      ? { lastFailureCode: raw.lastFailureCode }
      : {}),
    compatibilityVersion: raw.compatibilityVersion,
    status: expired ? "expired" : raw.status as "active" | "degraded" | "expired",
    redacted: true
  };
}

export class RouteMetricsStore {
  readonly #file: string;
  #records = new Map<string, CapabilityRouteMetricRecord>();
  #loaded = false;
  // Memoised list snapshot — rebuilt only when the map is mutated so that
  // frequent list() calls (once per route preview) pay zero allocation cost.
  #snapshot: CapabilityRouteMetricRecord[] | undefined;
  constructor(agentHostDir: string) { this.#file = path.join(agentHostDir, "strategies", "routes", "metrics.json"); }
  async ensureStructure(): Promise<void> {
    await mkdir(path.dirname(this.#file), { recursive: true, mode: 0o700 });
    let migrated = false;
    try {
      const values = JSON.parse(await readFile(this.#file, "utf8")) as unknown;
      if (Array.isArray(values)) for (const item of values.slice(-MAX_RECORDS)) {
        const record = safeMetricRecord(item);
        if (record === undefined) {
          migrated = true;
          continue;
        }
        this.#records.set(this.key(record), record);
        migrated ||= JSON.stringify(record) !== JSON.stringify(item);
      }
    } catch { /* first run/corrupt data stays fail-closed */ }
    this.#loaded = true;
    this.#snapshot = undefined; // rebuild on next list()
    if (migrated) await this.#save();
  }
  async list(options: { includeExpired?: boolean } = {}): Promise<CapabilityRouteMetricRecord[]> {
    if (!this.#loaded) await this.ensureStructure();
    // Rebuild snapshot only when the map has been mutated (snapshot === undefined).
    if (this.#snapshot === undefined) {
      this.#snapshot = [...this.#records.values()].map((record) =>
        Date.parse(record.expiresAt ?? "") <= Date.now() ? { ...record, status: "expired" as const } : record
      );
    }
    return options.includeExpired === true
      ? this.#snapshot.slice(-MAX_RECORDS)
      : this.#snapshot.filter((record) => record.status !== "expired").slice(-MAX_RECORDS);
  }
  async record(input: { routeFamily: CapabilityRouteFamily; goalCategory: string; appFamily?: string; compatibilityFingerprint: string; outcome: "verified_success" | "verified_failure"; failureCode?: string; probeMs?: number; executionMs?: number; verificationMs?: number; compatibilityVersion: string }): Promise<CapabilityRouteMetricRecord> {
    if (!CAPABILITY_ROUTE_FAMILIES.includes(input.routeFamily)) throw new Error("route_family_invalid");
    if (!SAFE_VERSION.test(input.compatibilityVersion)) throw new Error("compatibility_version_invalid");
    if (!this.#loaded) await this.ensureStructure();
    const goalCategoryFingerprint = routeMetricFingerprint(input.goalCategory);
    const appFamilyFingerprint = input.appFamily === undefined ? undefined : routeMetricFingerprint(input.appFamily);
    const compatibilityFingerprint = routeMetricFingerprint(input.compatibilityFingerprint);
    const key = `${input.routeFamily}:${goalCategoryFingerprint}:${appFamilyFingerprint ?? ""}:${compatibilityFingerprint}`;
    const prior = this.#records.get(key);
    const previousSamples = safeSamples(prior?.latencySamples);
    const probeSamples = addSample(previousSamples?.probeMs, input.probeMs);
    const executionSamples = addSample(previousSamples?.executionMs, input.executionMs);
    const verificationSamples = addSample(previousSamples?.verificationMs, input.verificationMs);
    const latencySamples: LatencySamples = {};
    if (probeSamples !== undefined) latencySamples.probeMs = probeSamples;
    if (executionSamples !== undefined) latencySamples.executionMs = executionSamples;
    if (verificationSamples !== undefined) latencySamples.verificationMs = verificationSamples;
    const medianProbeMs = median(probeSamples);
    const medianExecutionMs = median(executionSamples);
    const medianVerificationMs = median(verificationSamples);
    const next: CapabilityRouteMetricRecord = {
      schemaVersion: 1,
      routeFamily: input.routeFamily,
      goalCategoryFingerprint,
      ...(appFamilyFingerprint === undefined ? {} : { appFamilyFingerprint }),
      compatibilityFingerprint,
      attempts: (prior?.attempts ?? 0) + 1,
      verifiedSuccesses: (prior?.verifiedSuccesses ?? 0) + (input.outcome === "verified_success" ? 1 : 0),
      verifiedFailures: (prior?.verifiedFailures ?? 0) + (input.outcome === "verified_failure" ? 1 : 0),
      consecutiveVerifiedFailures: input.outcome === "verified_success" ? 0 : (prior?.consecutiveVerifiedFailures ?? 0) + 1,
      ...(medianProbeMs === undefined ? {} : { medianProbeMs }),
      ...(medianExecutionMs === undefined ? {} : { medianExecutionMs }),
      ...(medianVerificationMs === undefined ? {} : { medianVerificationMs }),
      ...(Object.keys(latencySamples).length === 0 ? {} : { latencySamples }),
      lastVerifiedAt: new Date().toISOString(),
      lastAttemptedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + METRIC_TTL_MS).toISOString(),
      ...(input.outcome === "verified_failure"
        && typeof input.failureCode === "string"
        && /^[a-z0-9_:-]{1,100}$/i.test(input.failureCode)
        ? { lastFailureCode: input.failureCode }
        : {}),
      compatibilityVersion: input.compatibilityVersion,
      status: input.outcome === "verified_failure" && (prior?.consecutiveVerifiedFailures ?? 0) >= 2 ? "degraded" : "active",
      redacted: true
    };
    this.#records.set(key, next); while (this.#records.size > MAX_RECORDS) this.#records.delete(this.#records.keys().next().value as string); this.#snapshot = undefined; await this.#save(); return next;
  }
  key(record: CapabilityRouteMetricRecord): string { return `${record.routeFamily}:${record.goalCategoryFingerprint}:${record.appFamilyFingerprint ?? ""}:${record.compatibilityFingerprint}`; }
  async #save(): Promise<void> { const temp = `${this.#file}.${randomUUID()}.tmp`; await writeFile(temp, `${JSON.stringify([...this.#records.values()].slice(-MAX_RECORDS), null, 2)}\n`, { mode: 0o600 }); await chmod(temp, 0o600); await rename(temp, this.#file); }
}
