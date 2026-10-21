import type { AgentHostConfig, CapabilityRegistrySnapshot, AdapterRegistrySnapshot, PolicyProfile } from "@agenthost/core";

export function listResourceEntries(): Array<{ uri: string; name: string; mimeType: string }> {
  return [];
}

export async function readResource(
  _context: { registry: CapabilityRegistrySnapshot; adapters: AdapterRegistrySnapshot; policy: PolicyProfile; config: AgentHostConfig },
  uri: string
): Promise<{ mimeType: string; text: string }> {
  throw new Error(`Unknown resource: ${uri}`);
}