import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { CapabilityRouteFamily, CapabilityRouteMetricRecord } from "@agenthost/core";

const MAX_RECORDS = 256;
export class RouteMetricsStore {
  readonly #file: string;
  #records = new Map<string, CapabilityRouteMetricRecord>();
  #loaded = false;
  constructor(agentHostDir: string) { this.#file = path.join(agentHostDir, "strategies", "routes", "metrics.json"); }
  async ensureStructure(): Promise<void> { await mkdir(path.dirname(this.#file), { recursive: true, mode: 0o700 }); try { const values = JSON.parse(await readFile(this.#file, "utf8")) as unknown; if (Array.isArray(values)) for (const item of values.slice(-MAX_RECORDS)) if (item && typeof item === "object" && (item as CapabilityRouteMetricRecord).schemaVersion === 1) this.#records.set(this.key(item as CapabilityRouteMetricRecord), item as CapabilityRouteMetricRecord); } catch { /* first run/corrupt data stays fail-closed */ } this.#loaded = true; }
  async list(): Promise<CapabilityRouteMetricRecord[]> { if (!this.#loaded) await this.ensureStructure(); return [...this.#records.values()].slice(-MAX_RECORDS); }
  async record(input: { routeFamily: CapabilityRouteFamily; goalCategory: string; appFamily?: string; compatibilityFingerprint: string; outcome: "verified_success" | "verified_failure"; probeMs?: number; executionMs?: number; verificationMs?: number; compatibilityVersion: string }): Promise<CapabilityRouteMetricRecord> {
    if (!this.#loaded) await this.ensureStructure();
    const key = `${input.routeFamily}:${input.goalCategory}:${input.appFamily ?? ""}:${input.compatibilityFingerprint}`;
    const prior = this.#records.get(key);
    const next: CapabilityRouteMetricRecord = { schemaVersion: 1, routeFamily: input.routeFamily, goalCategory: input.goalCategory, ...(input.appFamily === undefined ? {} : { appFamily: input.appFamily }), compatibilityFingerprint: input.compatibilityFingerprint.slice(0, 128), attempts: (prior?.attempts ?? 0) + 1, verifiedSuccesses: (prior?.verifiedSuccesses ?? 0) + (input.outcome === "verified_success" ? 1 : 0), verifiedFailures: (prior?.verifiedFailures ?? 0) + (input.outcome === "verified_failure" ? 1 : 0), consecutiveVerifiedFailures: input.outcome === "verified_success" ? 0 : (prior?.consecutiveVerifiedFailures ?? 0) + 1, ...(input.probeMs === undefined ? {} : { medianProbeMs: input.probeMs }), ...(input.executionMs === undefined ? {} : { medianExecutionMs: input.executionMs }), ...(input.verificationMs === undefined ? {} : { medianVerificationMs: input.verificationMs }), ...(input.outcome === "verified_success" ? { lastVerifiedAt: new Date().toISOString() } : {}), lastAttemptedAt: new Date().toISOString(), compatibilityVersion: input.compatibilityVersion, status: input.outcome === "verified_failure" && (prior?.consecutiveVerifiedFailures ?? 0) >= 2 ? "degraded" : "active", redacted: true };
    this.#records.set(key, next); while (this.#records.size > MAX_RECORDS) this.#records.delete(this.#records.keys().next().value as string); await this.#save(); return next;
  }
  key(record: CapabilityRouteMetricRecord): string { return `${record.routeFamily}:${record.goalCategory}:${record.appFamily ?? ""}:${record.compatibilityFingerprint}`; }
  async #save(): Promise<void> { const temp = `${this.#file}.${randomUUID()}.tmp`; await writeFile(temp, `${JSON.stringify([...this.#records.values()].slice(-MAX_RECORDS), null, 2)}\n`, { mode: 0o600 }); await chmod(temp, 0o600); await rename(temp, this.#file); }
}
