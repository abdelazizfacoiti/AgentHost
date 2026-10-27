import {
  AGENTHOST_VERSION,
  buildCapabilitiesJson,
  buildCapabilityMarkdown,
  readActiveTaskApproval,
  readActivityStatus,
  readRunState,
  type AgentHostConfig,
  type AdapterRegistrySnapshot,
  type CapabilityRegistrySnapshot,
  type ToolCapability
} from "@agenthost/core";
import { COMPUTER_ACTION_FAMILIES } from "./activity.js";

const CAPABILITY_MIME = "application/json";
const MARKDOWN_MIME = "text/markdown";

function capabilityInput(registry: CapabilityRegistrySnapshot, config: AgentHostConfig) {
  const tools = registry.listTools();
  const byExecutionClass = tools.reduce<Record<string, number>>((counts, tool) => {
    const name = tool.execution?.executionClass ?? "unclassified";
    counts[name] = (counts[name] ?? 0) + 1;
    return counts;
  }, {});
  const mode = config.overlay?.mode ?? "always";
  return {
    version: AGENTHOST_VERSION,
    toolCount: tools.length,
    byExecutionClass,
    overlay: {
      mode,
      triggers: mode === "off" ? [] : mode === "on_change" ? ["state-changing actions"] : COMPUTER_ACTION_FAMILIES.map((family) => `${family}.*`),
      fallback: "agenthost overlay status"
    }
  };
}

export function listResourceEntries(): Array<{ uri: string; name: string; mimeType: string; description: string }> {
  return [
    { uri: "agenthost://capabilities", name: "AgentHost capabilities (JSON)", mimeType: CAPABILITY_MIME, description: "Live tool inventory, execution classes, and capability families." },
    { uri: "agenthost://capabilities.md", name: "AgentHost capabilities (Markdown)", mimeType: MARKDOWN_MIME, description: "Compact agent-facing capability brief generated from the live tool inventory." },
    { uri: "agenthost://status", name: "AgentHost run status", mimeType: CAPABILITY_MIME, description: "Live stop, takeover, pause, active task approval, and last activity overlay state." }
  ];
}

export async function readResource(
  context: { registry: CapabilityRegistrySnapshot; adapters: AdapterRegistrySnapshot; config: AgentHostConfig },
  uri: string
): Promise<{ mimeType: string; text: string }> {
  const input = capabilityInput(context.registry, context.config);
  if (uri === "agenthost://capabilities") {
    return { mimeType: CAPABILITY_MIME, text: JSON.stringify(buildCapabilitiesJson(input), null, 2) };
  }
  if (uri === "agenthost://capabilities.md") {
    return { mimeType: MARKDOWN_MIME, text: buildCapabilityMarkdown(input) };
  }
  if (uri === "agenthost://status") {
    const [runState, approval, activity] = await Promise.all([
      readRunState(context.config.agentHostDir),
      readActiveTaskApproval(context.config.agentHostDir),
      readActivityStatus(context.config.agentHostDir)
    ]);
    return {
      mimeType: CAPABILITY_MIME,
      text: JSON.stringify({
        version: AGENTHOST_VERSION,
        runState,
        activeTaskApproval: approval ?? null,
        lastActivity: activity ?? null
      }, null, 2)
    };
  }
  throw new Error(`Unknown resource: ${uri}`);
}

export type { ToolCapability };
