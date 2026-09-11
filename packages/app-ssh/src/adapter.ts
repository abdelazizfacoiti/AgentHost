import type { AppAdapter, AppCapability, AdapterActionRequest, ToolContext, ToolResult } from "@agenthost/core";
import { runSshCommand, type SshRunCommandInput, type SshRunnerDependencies } from "./runner.js";

export function createSshAdapter(dependencies: SshRunnerDependencies = {}): AppAdapter {
  const capabilities: AppCapability[] = [
    {
      id: "ssh.run_command",
      adapterId: "ssh",
      appId: "ssh",
      strategy: "app_adapter",
      riskLevel: "medium",
      description: "Runs one reviewed shell command on a remote device over OpenSSH (key authentication only, no password prompts).",
      inputSchema: {
        type: "object",
        properties: {
          host: { type: "string" },
          user: { type: "string" },
          port: { type: "integer" },
          command: { type: "string" },
          timeoutMs: { type: "integer" }
        },
        required: ["host", "command"],
        additionalProperties: false
      },
      safety: {
        actionType: "shell_command"
      }
    }
  ];

  return {
    id: "ssh",
    displayName: "SSH device",
    appIds: ["ssh"],
    supportedPlatforms: ["linux"],
    optionalExecutionPolicy: {
      enabledByDefault: false,
      stability: "experimental",
      execution: {
        executionClass: "state_changing",
        externalEffect: true,
        requiresDryRun: true,
        requiresConfirmationToken: true,
        requiresExactTarget: true,
        source: "optional_adapter",
        availability: "available"
      },
      fingerprinting: "required",
      subprocess: { required: true, shell: false, commandAllowlist: ["ssh"] },
      environment: { allowlist: ["PATH", "LANG", "LC_ALL", "TMPDIR"], inherit: false },
      limits: { maxRuntimeMs: 60_000, maxOutputBytes: 64 * 1024 },
      filesystem: { allowedOutputRoots: ["$AGENTHOST_HOME/outputs/ssh"], broadFilesystem: false },
      audit: { redacted: true, rawInput: false, rawOutput: false }
    },
    matchesApp: (input) => input.appId === "ssh" || input.appId === "ssh-device" || input.appName?.trim().toLowerCase() === "ssh",
    getCapabilities(): AppCapability[] {
      return capabilities.map((capability) => ({ ...capability, safety: { ...capability.safety } }));
    },
    async execute(action: AdapterActionRequest, context: ToolContext): Promise<ToolResult> {
      if (action.capabilityId !== "ssh.run_command") {
        return {
          ok: false,
          tool: action.capabilityId,
          riskLevel: "medium",
          strategy: "app_adapter",
          approval: {
            required: false,
            status: "not_required"
          },
          data: null,
          observations: ["The SSH device adapter does not implement the requested capability."],
          error: {
            code: "unknown_ssh_capability",
            message: `Unknown SSH capability: ${action.capabilityId}`
          }
        };
      }

      return runSshCommand(action.input as SshRunCommandInput, context.config, context.policy, dependencies);
    }
  };
}
