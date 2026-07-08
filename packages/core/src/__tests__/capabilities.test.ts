import { describe, expect, it } from "vitest";
import { AUTOMATION_STRATEGIES, CapabilityRegistry, createBaseCapabilityRegistry } from "../index.js";

describe("CapabilityRegistry", () => {
  it("lists strategies in the required product order", () => {
    const registry = new CapabilityRegistry();

    expect(registry.listStrategies()).toEqual([...AUTOMATION_STRATEGIES]);
  });

  it("registers base AgentHost tools through Phase 7", () => {
    const registry = createBaseCapabilityRegistry();

    expect(registry.listTools().map((tool) => tool.name)).toEqual([
      "system.get_info",
      "system.list_capabilities",
      "system.check_dependency",
      "app.detect",
      "app.list_installed",
      "app.open",
      "app.get_strategy",
      "shell.run_safe",
      "file.write",
      "file.read",
      "file.exists",
      "file.list",
      "file.ensure_dir",
      "desktop.get_active_window",
      "desktop.screenshot",
      "desktop.hotkey",
      "desktop.type_text",
      "desktop.click",
      "guide.create_steps",
      "guide.explain_strategy",
      "adapter.list",
      "adapter.get_capabilities",
      "adapter.detect_for_app"
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
