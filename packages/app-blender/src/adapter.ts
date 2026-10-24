import { runBlenderPython, type BlenderRunPythonInput, type BlenderRunnerDependencies } from "./runner.js";
import type { AppAdapter, AppCapability, AdapterActionRequest, ToolContext, ToolResult } from "@agenthost/core";

export function createBlenderAdapter(dependencies: BlenderRunnerDependencies = {}): AppAdapter {
  const capabilities: AppCapability[] = [
    {
      id: "blender.run_python",
      adapterId: "blender",
      appId: "blender",
      strategy: "app_adapter",
      riskLevel: "medium",
      description: "Runs a reviewed Blender Python script in background mode and validates .blend outputs.",
      inputSchema: {
        type: "object",
        properties: {
          script: { type: "string" },
          outputDir: { type: "string" },
          expectedOutputs: {
            type: "array",
            items: { type: "string" }
          },
          timeoutMs: { type: "integer" }
        },
        additionalProperties: false
      },
      safety: {
        actionType: "file_write"
      }
    }
  ];

  return {
    id: "blender",
    displayName: "Blender",
    appIds: ["blender"],
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
      subprocess: { required: true, shell: false, commandAllowlist: ["blender"] },
      environment: { allowlist: ["PATH", "LANG", "LC_ALL", "TMPDIR"], inherit: false },
      limits: { maxRuntimeMs: 60_000, maxOutputBytes: 64 * 1024 },
      filesystem: { allowedOutputRoots: ["$AGENTHOST_HOME/outputs/blender"], broadFilesystem: false },
      audit: { redacted: true, rawInput: false, rawOutput: false }
    },
    matchesApp: (input) => input.appId === "blender" || input.appName?.trim().toLowerCase() === "blender",
    getCapabilities(): AppCapability[] {
      return capabilities.map((capability) => ({ ...capability, safety: { ...capability.safety } }));
    },
    async execute(action: AdapterActionRequest, context: ToolContext): Promise<ToolResult> {
      if (action.capabilityId !== "blender.run_python") {
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
          observations: ["The Blender adapter does not implement the requested capability."],
          error: {
            code: "unknown_blender_capability",
            message: `Unknown Blender capability: ${action.capabilityId}`
          }
        };
      }

      return runBlenderPython(action.input as BlenderRunPythonInput, context.config, context.policy, dependencies);
    }
  };
}
