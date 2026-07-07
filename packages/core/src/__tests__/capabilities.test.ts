import { describe, expect, it } from "vitest";
import { AUTOMATION_STRATEGIES, CapabilityRegistry, createBaseCapabilityRegistry } from "../index.js";

describe("CapabilityRegistry", () => {
  it("lists strategies in the required product order", () => {
    const registry = new CapabilityRegistry();

    expect(registry.listStrategies()).toEqual([...AUTOMATION_STRATEGIES]);
  });

  it("registers the Phase 0 and Phase 1 system tools", () => {
    const registry = createBaseCapabilityRegistry();

    expect(registry.listTools().map((tool) => tool.name)).toEqual([
      "system.get_info",
      "system.list_capabilities"
    ]);
  });

  it("rejects duplicate tool registrations", () => {
    const registry = new CapabilityRegistry();

    registry.registerTool({
      name: "system.get_info",
      riskLevel: "observe",
      description: "Example"
    });

    expect(() =>
      registry.registerTool({
        name: "system.get_info",
        riskLevel: "observe",
        description: "Duplicate"
      })
    ).toThrow(/already registered/);
  });
});
