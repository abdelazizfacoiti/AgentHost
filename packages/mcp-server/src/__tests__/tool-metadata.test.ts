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
    expect(() => validateToolExecutionMetadata({ executionClass: "read_only", externalEffect: false, requiresDryRun: false, requiresConfirmationToken: false, requiresExactTarget: false, source: "base", availability: "available", requiredGrantIds: ["bad id"] }, "bad.grant")).toThrow();
    expect(() => materializeToolDefinitions([{ name: "system.bad.grants", description: "bad", riskLevel: "observe", inputSchema: {} as never, mcpInputSchema: {}, inputSummary: "bad", requiredGrantIds: ["duplicate", "duplicate"], handler: async () => ({}) as never }])).toThrow(/required grant/);
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
    expect(capabilities.some((tool) => tool.name === "speech.list_providers" && tool.execution?.executionClass === "read_only")).toBe(true);
    expect(capabilities.find((tool) => tool.name === "speech.synthesize")?.execution).toMatchObject({ executionClass: "state_changing", requiresDryRun: true, requiresConfirmationToken: true });
    expect(capabilities.filter((tool) => tool.name.startsWith("overlay.control_surface_")).map((tool) => tool.name)).toEqual([
      "overlay.control_surface_show",
      "overlay.control_surface_get",
      "overlay.control_surface_update",
      "overlay.control_surface_hide",
      "overlay.control_surface_apply_event"
    ]);
    expect(capabilities.filter((tool) => tool.name.startsWith("overlay.control_surface_")).every((tool) => tool.execution?.executionClass === "visual_only" && tool.execution.externalEffect === false)).toBe(true);
    expect(capabilities.some((tool) => tool.name === "overlay.assistance_step_preview" && tool.execution?.executionClass === "read_only")).toBe(true);
    expect(capabilities.some((tool) => tool.name === "overlay.assistance_template_instantiate" && tool.execution?.executionClass === "metadata_only")).toBe(true);
    expect(capabilities.find((tool) => tool.name === "strategy.goal_plan_preview")?.execution).toMatchObject({ executionClass: "read_only", externalEffect: false });
    expect(capabilities.find((tool) => tool.name === "strategy.capability_graph")?.execution).toMatchObject({ executionClass: "read_only", externalEffect: false });
    expect(capabilities.find((tool) => tool.name === "strategy.failure_memory")?.execution).toMatchObject({ executionClass: "read_only", externalEffect: false });
  });
});
