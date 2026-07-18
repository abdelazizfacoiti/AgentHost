import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { CapabilityRouteFamily, CapabilityRouteMetricRecord } from "@agenthost/core";

const MAX_RECORDS = 256;
const MAX_LATENCY_SAMPLES = 31;
type LatencySamples = NonNullable<CapabilityRouteMetricRecord["latencySamples"]>;

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

export class RouteMetricsStore {
  readonly #file: string;
  #records = new Map<string, CapabilityRouteMetricRecord>();
  #loaded = false;
  constructor(agentHostDir: string) { this.#file = path.join(agentHostDir, "strategies", "routes", "metrics.json"); }
  async ensureStructure(): Promise<void> {
    await mkdir(path.dirname(this.#file), { recursive: true, mode: 0o700 });
    let migrated = false;
    try {
      const values = JSON.parse(await readFile(this.#file, "utf8")) as unknown;
      if (Array.isArray(values)) for (const item of values.slice(-MAX_RECORDS)) if (item && typeof item === "object" && (item as CapabilityRouteMetricRecord).schemaVersion === 1) {
        const raw = item as CapabilityRouteMetricRecord & { goalCategory?: string; appFamily?: string };
        const goalCategoryFingerprint = normalizeFingerprint(raw.goalCategoryFingerprint ?? raw.goalCategory);
        const compatibilityFingerprint = normalizeFingerprint(raw.compatibilityFingerprint);
        if (goalCategoryFingerprint === undefined || compatibilityFingerprint === undefined) continue;
        const appFamilyFingerprint = normalizeFingerprint(raw.appFamilyFingerprint ?? raw.appFamily);
        const samples = safeSamples(raw.latencySamples);
        const record: CapabilityRouteMetricRecord = { ...raw, goalCategoryFingerprint, compatibilityFingerprint, ...(appFamilyFingerprint === undefined ? {} : { appFamilyFingerprint }), ...(samples === undefined ? {} : { latencySamples: samples }) };
        delete (record as CapabilityRouteMetricRecord & { goalCategory?: string }).goalCategory;
        delete (record as CapabilityRouteMetricRecord & { appFamily?: string }).appFamily;
        this.#records.set(this.key(record), record);
        migrated ||= raw.goalCategoryFingerprint === undefined || raw.goalCategory !== undefined || raw.appFamily !== undefined || raw.appFamilyFingerprint === undefined && appFamilyFingerprint !== undefined || raw.compatibilityFingerprint !== compatibilityFingerprint;
      }
    } catch { /* first run/corrupt data stays fail-closed */ }
    this.#loaded = true;
    if (migrated) await this.#save();
  }
  async list(): Promise<CapabilityRouteMetricRecord[]> { if (!this.#loaded) await this.ensureStructure(); return [...this.#records.values()].slice(-MAX_RECORDS); }
  async record(input: { routeFamily: CapabilityRouteFamily; goalCategory: string; appFamily?: string; compatibilityFingerprint: string; outcome: "verified_success" | "verified_failure"; probeMs?: number; executionMs?: number; verificationMs?: number; compatibilityVersion: string }): Promise<CapabilityRouteMetricRecord> {
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
      compatibilityVersion: input.compatibilityVersion,
      status: input.outcome === "verified_failure" && (prior?.consecutiveVerifiedFailures ?? 0) >= 2 ? "degraded" : "active",
      redacted: true
    };
    this.#records.set(key, next); while (this.#records.size > MAX_RECORDS) this.#records.delete(this.#records.keys().next().value as string); await this.#save(); return next;
  }
  key(record: CapabilityRouteMetricRecord): string { return `${record.routeFamily}:${record.goalCategoryFingerprint}:${record.appFamilyFingerprint ?? ""}:${record.compatibilityFingerprint}`; }
  async #save(): Promise<void> { const temp = `${this.#file}.${randomUUID()}.tmp`; await writeFile(temp, `${JSON.stringify([...this.#records.values()].slice(-MAX_RECORDS), null, 2)}\n`, { mode: 0o600 }); await chmod(temp, 0o600); await rename(temp, this.#file); }
}
