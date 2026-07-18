import { describe, expect, it } from "vitest";
import { buildCapabilityGraph, relevantCapabilitySubgraph } from "../capability-graph.js";
import type { AdapterRegistrySnapshot, CapabilityRegistrySnapshot } from "../types.js";

const registry: CapabilityRegistrySnapshot = {
  listStrategies: () => [],
  listAppCapabilities: () => [],
  listTools: () => [
    { name: "browser.get_page_context", riskLevel: "observe", description: "browser", requiredGrantIds: ["browser.private_read"], execution: { executionClass: "read_only", externalEffect: false, requiresDryRun: false, requiresConfirmationToken: false, requiresExactTarget: false, source: "base", availability: "available" } },
    { name: "accessibility.get_tree", riskLevel: "observe", description: "a11y", execution: { executionClass: "read_only", externalEffect: false, requiresDryRun: false, requiresConfirmationToken: false, requiresExactTarget: false, source: "base", availability: "available" } }
  ]
};
const adapters: AdapterRegistrySnapshot = { get: () => undefined, listAdapters: () => [{ id: "fixture", displayName: "Fixture", appIds: ["fixture"], supportedPlatforms: ["linux"], capabilityCount: 1 }], listCapabilities: () => [], detectForApp: () => ({ appName: "fixture", adapterAvailable: false, adapters: [], capabilities: [], recommendedStrategy: "guide_only", reason: "none" }) };

describe("capability graph", () => {
  it("builds bounded redacted graph with expiry and stable fingerprint", () => {
    const graph = buildCapabilityGraph(registry, adapters, { now: new Date("2026-01-01T00:00:00Z"), ttlMs: 60_000 });
    expect(graph.redacted).toBe(true);
    expect(graph.expiresAt).toBe("2026-01-01T00:01:00.000Z");
    expect(graph.nodes.some((node) => node.nodeId === "tool:browser.get_page_context")).toBe(true);
    expect(graph.edges.some((edge) => edge.to === "route:browser_bridge")).toBe(true);
    expect(graph.edges).toContainEqual({ from: "route:browser_bridge", to: "route:structured_browser", relation: "fallback" });
    expect(graph.edges).toContainEqual({ from: "route:browser_bridge", to: "prerequisite:browser_bridge:health", relation: "requires" });
    expect(graph.edges).toContainEqual({ from: "route:browser_bridge", to: "verification:browser_bridge:state", relation: "verifies" });
    expect(graph.nodes).toContainEqual(expect.objectContaining({ nodeId: "grant:browser.private_read", kind: "grant", redacted: true }));
    expect(graph.edges).toContainEqual({ from: "tool:browser.get_page_context", to: "grant:browser.private_read", relation: "requires" });
  });
  it("returns only relevant bounded subgraph", () => {
    const graph = buildCapabilityGraph(registry, adapters);
    const subgraph = relevantCapabilitySubgraph(graph, "browser_navigation", 8);
    expect(subgraph.nodes.length).toBeLessThanOrEqual(8);
    expect(subgraph.nodes.some((node) => node.kind === "verification")).toBe(true);
    expect(subgraph.nodes.every((node) => node.kind === "route_family" || node.nodeId.includes("browser") || node.nodeId.includes("accessibility"))).toBe(true);
    const expanded = relevantCapabilitySubgraph(graph, "browser_navigation", 32);
    expect(expanded.nodes.some((node) => node.kind === "grant" && node.nodeId === "grant:browser.private_read")).toBe(true);
  });
  it("accepts bounded live health overrides without changing graph structure", () => {
    const graph = buildCapabilityGraph(registry, adapters, {
      healthOverrides: { browser_bridge: "unavailable", accessibility: "healthy" }
    });
    expect(graph.nodes.find((node) => node.nodeId === "route:browser_bridge")?.health).toBe("unavailable");
    expect(graph.nodes.find((node) => node.nodeId === "route:accessibility")?.health).toBe("healthy");
    expect(graph.nodes.find((node) => node.nodeId === "route:guide_only")?.health).toBe("healthy");
    expect(graph.nodes.every((node) => node.redacted)).toBe(true);
  });
});
