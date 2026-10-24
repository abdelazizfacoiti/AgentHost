import type { AgentHostConfig, CapabilityRegistrySnapshot, SystemInfo } from "@agenthost/core";

export function getLinuxSystemInfo(
  config: AgentHostConfig,
  registry: CapabilityRegistrySnapshot
): SystemInfo {
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    agentHostDir: config.agentHostDir,
    strategies: registry.listStrategies(),
    tools: registry.listTools().map((tool) => tool.name)
  };
}
