import {
  AGENTHOST_VERSION,
  buildCapabilitiesJson,
  buildCapabilityMarkdown,
  type AdapterRegistrySnapshot,
  type AgentHostConfig,
  type CapabilityRegistrySnapshot,
  type PolicyProfile
} from "@agenthost/core";
import { isStopRequested, isTakeoverActive } from "./stop-flag.js";
import { listAgentSkills } from "./tools/skills.js";

export interface ResourceDeps {
  registry: CapabilityRegistrySnapshot;
  adapters: AdapterRegistrySnapshot;
  policy: PolicyProfile;
  config: AgentHostConfig;
}

export interface ResourceEntry {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export function listResourceEntries(): ResourceEntry[] {
  return [
    { uri: "agenthost://capabilities", name: "AgentHost capabilities", description: "Live capability families, tool counts, and execution classes.", mimeType: "application/json" },
    { uri: "agenthost://capabilities.md", name: "AgentHost capabilities (markdown)", description: "Condensed capability brief for agent system prompts.", mimeType: "text/markdown" },
    { uri: "agenthost://skills", name: "AgentHost skills", description: "Reusable skill catalog with tools, verification, and recovery.", mimeType: "application/json" },
    { uri: "agenthost://status", name: "AgentHost status", description: "Live stop/takeover state and loaded tool count.", mimeType: "application/json" }
  ];
}

function manifestInput(deps: ResourceDeps): { version: string; profile: string; toolCount: number; byExecutionClass: Record<string, number> } {
  const tools = deps.registry.listTools();
  const byExecutionClass: Record<string, number> = {};
  for (const tool of tools) {
    const key = (tool as { execution?: { executionClass?: string } }).execution?.executionClass ?? "unknown";
    byExecutionClass[key] = (byExecutionClass[key] ?? 0) + 1;
  }
  return { version: AGENTHOST_VERSION, profile: deps.policy.name, toolCount: tools.length, byExecutionClass };
}

export async function readResource(deps: ResourceDeps, uri: string): Promise<{ mimeType: string; text: string }> {
  const input = manifestInput(deps);
  switch (uri) {
    case "agenthost://capabilities":
      return { mimeType: "application/json", text: JSON.stringify(buildCapabilitiesJson(input), null, 2) };
    case "agenthost://capabilities.md":
      return { mimeType: "text/markdown", text: buildCapabilityMarkdown(input) };
    case "agenthost://skills":
      return { mimeType: "application/json", text: JSON.stringify({ skills: listAgentSkills() }, null, 2) };
    case "agenthost://status": {
      const [stopped, takeoverActive] = await Promise.all([
        isStopRequested(deps.config.agentHostDir).catch(() => false),
        isTakeoverActive(deps.config.agentHostDir).catch(() => false)
      ]);
      return {
        mimeType: "application/json",
        text: JSON.stringify({ stopped, takeoverActive, toolCount: input.toolCount, profile: input.profile, version: input.version }, null, 2)
      };
    }
    default:
      throw new Error(`unknown_resource:${uri}`);
  }
}
