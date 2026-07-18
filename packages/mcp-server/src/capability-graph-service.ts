import { buildCapabilityGraph, relevantCapabilitySubgraph, type AdapterRegistrySnapshot, type CapabilityGraphHealth, type CapabilityGraphSnapshot, type CapabilityRegistrySnapshot } from "@agenthost/core";

const CACHE_MS = 5 * 60_000;
export class CapabilityGraphService {
  readonly #registry: CapabilityRegistrySnapshot;
  readonly #adapters: AdapterRegistrySnapshot;
  #snapshot: CapabilityGraphSnapshot | undefined;
  constructor(registry: CapabilityRegistrySnapshot, adapters: AdapterRegistrySnapshot) {
    this.#registry = registry;
    this.#adapters = adapters;
  }
  snapshot(goalCategory?: string, healthOverrides?: Record<string, CapabilityGraphHealth>): CapabilityGraphSnapshot {
    if (this.#snapshot === undefined || Date.parse(this.#snapshot.expiresAt) <= Date.now()) {
      this.#snapshot = buildCapabilityGraph(this.#registry, this.#adapters, { ttlMs: CACHE_MS });
    }
    const snapshot = healthOverrides === undefined
      ? this.#snapshot
      : {
          ...this.#snapshot,
          nodes: this.#snapshot.nodes.map((node) => {
            const override = node.kind === "route_family" ? healthOverrides[node.label] : undefined;
            return override === undefined ? node : { ...node, health: override };
          })
        };
    return goalCategory === undefined ? snapshot : relevantCapabilitySubgraph(snapshot, goalCategory);
  }
  invalidate(): void { this.#snapshot = undefined; }
  summary(): Record<string, unknown> {
    const snapshot = this.snapshot();
    return { generatedAt: snapshot.generatedAt, expiresAt: snapshot.expiresAt, versionFingerprint: snapshot.versionFingerprint, nodeCount: snapshot.nodes.length, edgeCount: snapshot.edges.length, redacted: true };
  }
}
