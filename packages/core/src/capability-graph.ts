import type {
  AdapterRegistrySnapshot,
  CapabilityRegistrySnapshot,
  RiskLevel,
  ToolExecutionMetadata
} from "./types.js";

export const CAPABILITY_GRAPH_SCHEMA_VERSION = 1 as const;
export const CAPABILITY_GRAPH_NODE_KINDS = [
  "tool",
  "route_family",
  "adapter",
  "prerequisite",
  "verification",
  "grant"
] as const;
export type CapabilityGraphNodeKind = (typeof CAPABILITY_GRAPH_NODE_KINDS)[number];
export type CapabilityGraphHealth = "healthy" | "degraded" | "unavailable" | "unknown";

export interface CapabilityGraphNode {
  nodeId: string;
  kind: CapabilityGraphNodeKind;
  label: string;
  health: CapabilityGraphHealth;
  riskLevel?: RiskLevel;
  execution?: ToolExecutionMetadata;
  expiresAt: string;
  redacted: true;
}

export interface CapabilityGraphEdge {
  from: string;
  to: string;
  relation: "offers" | "fallback" | "requires" | "verifies" | "provided_by";
}

export interface CapabilityGraphSnapshot {
  schemaVersion: typeof CAPABILITY_GRAPH_SCHEMA_VERSION;
  generatedAt: string;
  expiresAt: string;
  versionFingerprint: string;
  nodes: CapabilityGraphNode[];
  edges: CapabilityGraphEdge[];
  redacted: true;
}

const ROUTE_ORDER = [
  "browser_bridge", "structured_browser", "native_adapter", "accessibility",
  "local_ocr", "screenshot_vision", "desktop_input", "guide_only"
] as const;
const ROUTE_VERIFICATION: Record<(typeof ROUTE_ORDER)[number], string> = {
  browser_bridge: "normalized_browser_state",
  structured_browser: "normalized_browser_state",
  native_adapter: "application_state",
  accessibility: "accessibility_state",
  local_ocr: "fresh_ocr_evidence",
  screenshot_vision: "fresh_screenshot_evidence",
  desktop_input: "independent_post_action_observation",
  guide_only: "operator_acknowledgement"
};
const ROUTE_BY_PREFIX: Array<[string, string]> = [
  ["browser.", "browser_bridge"],
  ["adapter.", "native_adapter"],
  ["app.", "native_adapter"],
  ["accessibility.", "accessibility"],
  ["vision.", "local_ocr"],
  ["desktop.", "desktop_input"],
  ["window.", "desktop_input"],
  ["guide.", "guide_only"]
];

function routeForTool(name: string): string {
  return ROUTE_BY_PREFIX.find(([prefix]) => name.startsWith(prefix))?.[1] ?? "guide_only";
}
function safeId(value: string): string { return value.replace(/[^a-zA-Z0-9._:-]/g, "_").slice(0, 160); }
function stableFingerprint(value: string): string {
  let hash = 2166136261;
  for (const char of value.slice(0, 10_000)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildCapabilityGraph(
  registry: CapabilityRegistrySnapshot,
  adapters: AdapterRegistrySnapshot,
  options: { now?: Date; ttlMs?: number; healthOverrides?: Record<string, CapabilityGraphHealth> } = {}
): CapabilityGraphSnapshot {
  const now = options.now ?? new Date();
  const ttlMs = Math.max(1_000, Math.min(3_600_000, Math.floor(options.ttlMs ?? 300_000)));
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const nodes: CapabilityGraphNode[] = [];
  const edges: CapabilityGraphEdge[] = [];
  const addRoute = (route: string): void => {
    const nodeId = `route:${route}`;
    if (!nodes.some((node) => node.nodeId === nodeId)) {
      nodes.push({ nodeId, kind: "route_family", label: route, health: options.healthOverrides?.[route] ?? (route === "guide_only" ? "healthy" : "unknown"), expiresAt, redacted: true });
      const prerequisiteId = `prerequisite:${route}:health`;
      nodes.push({ nodeId: prerequisiteId, kind: "prerequisite", label: `${route}_health`, health: "unknown", expiresAt, redacted: true });
      edges.push({ from: nodeId, to: prerequisiteId, relation: "requires" });
      const verificationId = `verification:${route}:state`;
      nodes.push({ nodeId: verificationId, kind: "verification", label: ROUTE_VERIFICATION[route as (typeof ROUTE_ORDER)[number]], health: "unknown", expiresAt, redacted: true });
      edges.push({ from: nodeId, to: verificationId, relation: "verifies" });
    }
  };
  for (const route of ROUTE_ORDER) addRoute(route);
  for (let index = 0; index < ROUTE_ORDER.length - 1; index += 1) {
    const from = ROUTE_ORDER[index];
    const to = ROUTE_ORDER[index + 1];
    if (from !== undefined && to !== undefined) edges.push({ from: `route:${from}`, to: `route:${to}`, relation: "fallback" });
  }
  let confirmationNodeAdded = false;
  let targetBindingNodeAdded = false;
  for (const tool of registry.listTools().slice(0, 512)) {
    const nodeId = `tool:${safeId(tool.name)}`;
    const route = routeForTool(tool.name);
    nodes.push({ nodeId, kind: "tool", label: tool.name, health: tool.execution?.availability === "available" ? "healthy" : "unavailable", riskLevel: tool.riskLevel, ...(tool.execution === undefined ? {} : { execution: tool.execution }), expiresAt, redacted: true });
    edges.push({ from: nodeId, to: `route:${route}`, relation: "offers" });
    if (tool.execution?.requiresConfirmationToken === true) {
      const prerequisiteId = "prerequisite:confirmation";
      if (!confirmationNodeAdded) {
        nodes.push({ nodeId: prerequisiteId, kind: "prerequisite", label: "confirmation_required", health: "unknown", expiresAt, redacted: true });
        confirmationNodeAdded = true;
      }
      edges.push({ from: nodeId, to: prerequisiteId, relation: "requires" });
    }
    if (tool.execution?.requiresExactTarget === true) {
      const prerequisiteId = "prerequisite:target_binding";
      if (!targetBindingNodeAdded) {
        nodes.push({ nodeId: prerequisiteId, kind: "prerequisite", label: "fresh_target_binding", health: "unknown", expiresAt, redacted: true });
        targetBindingNodeAdded = true;
      }
      edges.push({ from: nodeId, to: prerequisiteId, relation: "requires" });
    }
    // These are declarations for planning/inspection only. A graph grant
    // node never means that a matching grant is active.
    const declaredGrants = [...(tool.requiredGrantIds ?? []), ...(tool.execution?.requiredGrantIds ?? [])];
    for (const grantId of new Set(declaredGrants)) {
      const safeGrant = safeId(grantId);
      if (safeGrant.length === 0) continue;
      const grantNodeId = `grant:${safeGrant}`;
      if (!nodes.some((node) => node.nodeId === grantNodeId)) {
        nodes.push({ nodeId: grantNodeId, kind: "grant", label: safeGrant, health: "unknown", expiresAt, redacted: true });
      }
      edges.push({ from: nodeId, to: grantNodeId, relation: "requires" });
    }
  }
  for (const adapter of adapters.listAdapters().slice(0, 64)) {
    const nodeId = `adapter:${safeId(adapter.id)}`;
    nodes.push({ nodeId, kind: "adapter", label: adapter.id, health: "healthy", expiresAt, redacted: true });
    edges.push({ from: nodeId, to: "route:native_adapter", relation: "provided_by" });
  }
  const serialized = nodes.map((node) => `${node.nodeId}:${node.health}`).sort().join("|");
  return { schemaVersion: CAPABILITY_GRAPH_SCHEMA_VERSION, generatedAt: now.toISOString(), expiresAt, versionFingerprint: stableFingerprint(serialized), nodes, edges, redacted: true };
}

export function relevantCapabilitySubgraph(snapshot: CapabilityGraphSnapshot, goalCategory: string, maxNodes = 64): CapabilityGraphSnapshot {
  const safeGoal = goalCategory.trim().slice(0, 80).toLowerCase();
  const preferred = safeGoal.includes("browser") ? new Set(["browser_bridge", "structured_browser", "accessibility", "local_ocr", "screenshot_vision", "guide_only"]) : safeGoal.includes("file") ? new Set(["native_adapter", "accessibility", "desktop_input", "guide_only"]) : new Set(ROUTE_ORDER);
  const routeIds = new Set(snapshot.nodes.filter((node) => node.kind === "route_family" && preferred.has(node.label)).map((node) => node.nodeId));
  const boundedMax = Math.max(1, Math.min(128, Math.floor(maxNodes)));
  // Keep the route families first so small projections still expose the
  // deterministic routing choices, then add their directly-bound
  // prerequisites/verifiers. This avoids a large unrelated node prefix
  // crowding out the safety context for the selected routes.
  const routeNodes = snapshot.nodes.filter((node) => node.kind === "route_family" && routeIds.has(node.nodeId));
  const directlyRelated = snapshot.nodes.filter((node) => node.kind !== "route_family" && snapshot.edges.some((edge) =>
    (edge.from === node.nodeId && routeIds.has(edge.to))
    || (edge.to === node.nodeId && routeIds.has(edge.from))
  ));
  // Include one bounded dependency hop beyond the route family. This keeps
  // declared grant prerequisites visible without returning the whole graph.
  const firstHopIds = new Set([...routeIds, ...directlyRelated.map((node) => node.nodeId)]);
  const secondHop = snapshot.nodes.filter((node) => !firstHopIds.has(node.nodeId) && snapshot.edges.some((edge) =>
    (edge.from === node.nodeId && firstHopIds.has(edge.to))
    || (edge.to === node.nodeId && firstHopIds.has(edge.from))
  ));
  const selected = [...routeNodes, ...directlyRelated, ...secondHop].slice(0, boundedMax);
  const ids = new Set(selected.map((node) => node.nodeId));
  return { ...snapshot, nodes: selected, edges: snapshot.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)) };
}
