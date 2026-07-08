import { describe, expect, it } from "vitest";
import { AUTOMATION_STRATEGIES, CapabilityRegistry, createBaseCapabilityRegistry } from "../index.js";

describe("CapabilityRegistry", () => {
  it("lists strategies in the required product order", () => {
    const registry = new CapabilityRegistry();

    expect(registry.listStrategies()).toEqual([...AUTOMATION_STRATEGIES]);
  });

  it("registers base AgentHost tools through Phase 13", () => {
    const registry = createBaseCapabilityRegistry();

    expect(registry.listTools().map((tool) => tool.name)).toEqual([
      "system.get_info",
      "system.list_capabilities",
      "system.check_dependency",
      "policy.get_profile",
      "policy.list_profiles",
      "policy.list_grants",
      "policy.explain_decision",
      "forge.validate_manifest",
      "forge.review_manifest",
      "forge.propose_grants",
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
      "desktop.get_capabilities",
      "desktop.screenshot",
      "desktop.hotkey",
      "desktop.type_text",
      "desktop.click",
      "window.list",
      "window.focus",
      "accessibility.get_tree",
      "accessibility.find_element",
      "accessibility.inspect_element",
      "accessibility.invoke_action",
      "accessibility.set_value",
      "accessibility.focus_element",
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
