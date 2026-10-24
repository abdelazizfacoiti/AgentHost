/**
 * Capability-based permissions for the general-purpose computer agent.
 * Capabilities describe WHAT the runtime can do; policy controls HOW.
 */
export const AGENT_CAPABILITIES = [
  "computer",
  "browser",
  "filesystem",
  "shell",
  "applications",
  "mcp",
  "network",
  "vision",
  "ocr",
  "speech",
  "skills"
] as const;
export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];

export type CapabilityPermission = "allow" | "approval_required" | "deny";

export type CapabilityPermissionMap = Record<AgentCapability, CapabilityPermission>;

export const GENERAL_PURPOSE_CAPABILITIES: CapabilityPermissionMap = {
  computer: "allow",
  browser: "allow",
  filesystem: "allow",
  shell: "allow",
  applications: "allow",
  mcp: "allow",
  network: "approval_required",
  vision: "allow",
  ocr: "allow",
  speech: "allow",
  skills: "allow"
};

/** External-content trust boundary: tool results, pages, files, docs are UNTRUSTED data. */
export const TRUSTED_SOURCES = ["user_instruction", "system_policy", "agent_policy"] as const;
export const UNTRUSTED_SOURCES = ["tool_result", "web_page", "file_content", "document", "email", "mcp_response", "app_content"] as const;

export function isUntrustedSource(source: string): boolean {
  return (UNTRUSTED_SOURCES as readonly string[]).includes(source);
}
