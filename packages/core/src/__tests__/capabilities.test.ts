import { describe, expect, it } from "vitest";
import { AUTOMATION_STRATEGIES, CapabilityRegistry, createBaseCapabilityRegistry } from "../index.js";

describe("CapabilityRegistry", () => {
  it("lists strategies in the required product order", () => {
    const registry = new CapabilityRegistry();

    expect(registry.listStrategies()).toEqual([...AUTOMATION_STRATEGIES]);
  });

  it("registers base AgentHost tools through Phase 18", () => {
    const registry = createBaseCapabilityRegistry();

    expect(registry.listTools().map((tool) => tool.name)).toEqual([
      "checkpoint.evaluate",
      "checkpoint.wait_for",
      "vision.prepare_pointer_action",
      "vision.analyze_image",
      "vision.find_text",
      "vision.find_target",
      "workflow.trace_start",
      "workflow.trace_stop",
      "workflow.trace_get",
      "workflow.trace_list",
      "workflow.trace_archive",
      "workflow.skill_save_from_trace",
      "workflow.skill_list",
      "workflow.skill_get",
      "workflow.skill_archive",
      "workflow.skill_run_dryrun",
      "browser.find_element",
      "browser.click_element",
      "browser.fill_text",
      "browser.focus_element",
      "browser.wait_for_state",
      "browser.get_form_state",
      "browser.get_selected_text",
      "browser.detect",
      "browser.list_tabs",
      "browser.get_active_tab",
      "browser.current_url",
      "browser.open_url",
      "browser.get_page_context",
      "browser.extract_text",
      "forge.list_dispatchable_tools",
      "forge.get_dispatchable_tool",
      "forge.dispatch_generated_tool",
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
      "forge.save_manifest",
      "forge.list_manifests",
      "forge.get_manifest",
      "forge.create_review",
      "forge.get_review",
      "forge.list_reviews",
      "forge.archive_manifest",
      "forge.apply_session_grants_from_review",
      "forge.scaffold_project",
      "forge.validate_project",
      "forge.get_artifact",
      "forge.list_artifacts",
      "forge.get_validation",
      "forge.list_validations",
      "forge.run_validation_harness",
      "forge.get_harness_run",
      "forge.list_harness_runs",
      "forge.check_registration_eligibility",
      "forge.register_artifact",
      "forge.get_registration",
      "forge.list_registrations",
      "forge.revoke_registration",
      "forge.check_runtime_eligibility",
      "forge.check_sandbox_support",
      "forge.run_sandboxed_tool",
      "forge.get_runtime_run",
      "forge.list_runtime_runs",
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
      "desktop.move_mouse",
      "desktop.scroll",
      "desktop.double_click",
      "desktop.right_click",
      "desktop.drag",
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
