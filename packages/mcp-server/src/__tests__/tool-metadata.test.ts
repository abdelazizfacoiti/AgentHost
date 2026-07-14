import { describe, expect, it } from "vitest";
import { createBaseCapabilityRegistry, getPolicyProfile, type AgentHostConfig } from "@agenthost/core";
import { materializeToolDefinitions, toolCapabilities, validateToolExecutionMetadata } from "../tool-metadata.js";
import { createSystemTools } from "../tools/system.js";
import { createOverlayTools } from "../tools/overlay.js";
import { createForgeTools } from "../tools/forge.js";
import { createAgentHostMcpServer } from "../server.js";

describe("registered tool execution metadata", () => {
  it("materializes explicit metadata and rejects contradictory metadata", () => {
    const tools = materializeToolDefinitions([...createSystemTools(), ...createOverlayTools(), ...createForgeTools()]);
    expect(tools.every((tool) => tool.execution !== undefined)).toBe(true);
    expect(tools.find((tool) => tool.name === "system.get_info")?.execution).toMatchObject({ executionClass: "read_only", externalEffect: false });
    expect(tools.find((tool) => tool.name === "overlay.show_pointer")?.execution).toMatchObject({ executionClass: "visual_only", externalEffect: false });
    expect(tools.find((tool) => tool.name === "forge.run_sandboxed_tool")?.execution).toMatchObject({ executionClass: "state_changing", requiresDryRun: true });
    expect(() => validateToolExecutionMetadata({ executionClass: "read_only", externalEffect: true, requiresDryRun: false, requiresConfirmationToken: false, requiresExactTarget: false, source: "base", availability: "available" }, "bad.tool")).toThrow();
    expect(() => materializeToolDefinitions([{ name: "unknown.tool", description: "unknown", riskLevel: "low", inputSchema: {} as never, mcpInputSchema: {}, inputSummary: "unknown", handler: async () => ({}) as never }])).toThrow(/classification/);
  });

  it("projects the same metadata shape into capabilities", () => {
    const tools = materializeToolDefinitions(createSystemTools());
    const capabilities = toolCapabilities(tools);
    expect(capabilities).toHaveLength(tools.length);
    expect(capabilities[0]?.execution).toEqual(tools[0]?.execution);
  });

  it("synchronizes live capabilities from loaded tools and omits disabled Blender", async () => {
    const root = "/tmp/agenthost-metadata-parity";
    const config: AgentHostConfig = { agentHostDir: root, configPath: `${root}/config.json`, logFile: `${root}/logs/test.jsonl`, profile: "dev", policy: getPolicyProfile("dev") };
    const { context } = await createAgentHostMcpServer({ config, registry: createBaseCapabilityRegistry() });
    const capabilities = context.registry.listTools();
    expect(capabilities.some((tool) => tool.name === "system.get_info")).toBe(true);
    expect(capabilities.every((tool) => tool.execution !== undefined)).toBe(true);
    expect(capabilities.some((tool) => tool.name === "blender.run_python")).toBe(false);
  });
});
