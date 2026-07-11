import { describe, expect, it } from "vitest";
import type { SandboxSupportProbeResult } from "@agenthost/core";
import type { AgentHostMcpContext } from "../context.js";
import { createForgeSandboxTools } from "../tools/forge-sandbox.js";

const probe: SandboxSupportProbeResult = {
  platform: "linux",
  supported: true,
  availableBackends: [
    {
      id: "bubblewrap",
      commandName: "bwrap",
      commandPath: "/usr/bin/bwrap",
      detected: true,
      usability: "candidate",
      reason: "test",
      limitations: ["test"]
    }
  ],
  unavailableBackends: [],
  recommendedBackend: "bubblewrap",
  kernelFeatures: {
    userNamespaces: { status: "available", reason: "test" },
    seccomp: { status: "available", reason: "test" },
    appArmor: { status: "unknown", reason: "test" },
    flatpakContainer: { status: "unavailable", reason: "test" }
  },
  limitations: ["test"],
  requiresInstall: false,
  requiresSudo: false,
  safeForAgentHostUse: false,
  notes: ["test"]
};

describe("forge.check_sandbox_support", () => {
  it("returns the stable read-only ToolResult shape", async () => {
    const tool = createForgeSandboxTools().find((candidate) => candidate.name === "forge.check_sandbox_support");
    const context = {
      linux: {
        checkSandboxSupport: async () => probe
      }
    } as AgentHostMcpContext;

    const result = await tool!.handler({}, context);

    expect(result.ok).toBe(true);
    expect(result.tool).toBe("forge.check_sandbox_support");
    expect(result.riskLevel).toBe("observe");
    expect(result.data).toEqual(probe);
    expect(result.confirmation).toBeUndefined();
    expect(result.observations.join(" ")).not.toMatch(/token|secret/i);
  });

  it("uses a safe unavailable fallback when Linux automation lacks the optional probe", async () => {
    const tool = createForgeSandboxTools()[0]!;
    const result = await tool.handler({}, { linux: {} } as AgentHostMcpContext);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      supported: false,
      availableBackends: [],
      recommendedBackend: null,
      requiresSudo: false,
      safeForAgentHostUse: false
    });
  });
});
