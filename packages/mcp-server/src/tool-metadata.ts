import type { ToolCapability, ToolExecutionMetadata } from "@agenthost/core";
import type { AnyAgentHostToolDefinition } from "./tool-runner.js";

const readOnly = (source: "base" | "optional_adapter" = "base"): ToolExecutionMetadata => ({ executionClass: "read_only", externalEffect: false, requiresDryRun: false, requiresConfirmationToken: false, requiresExactTarget: false, source, availability: "available", operationFamily: "observe", operation: "inspect", reversibility: "reversible", sensitivity: "normal", requiredBindings: [], confirmationLevel: "none", verificationKind: "none", cleanupKind: "none" });
const diagnostic = (): ToolExecutionMetadata => ({ ...readOnly(), executionClass: "diagnostic" });
const metadataOnly = (): ToolExecutionMetadata => ({ ...readOnly(), executionClass: "metadata_only" });
const visualOnly = (): ToolExecutionMetadata => ({ ...readOnly(), executionClass: "visual_only" });
const stateChanging = (requiresExactTarget = false, source: "base" | "optional_adapter" = "base"): ToolExecutionMetadata => ({ executionClass: "state_changing", externalEffect: false, requiresDryRun: true, requiresConfirmationToken: true, requiresExactTarget, source, availability: "available", operationFamily: "state_change", operation: "governed_action", reversibility: "persistent", sensitivity: "normal", requiredBindings: requiresExactTarget ? ["target"] : [], confirmationLevel: "standard", verificationKind: "tool_result", cleanupKind: "none" });

/*
 * Explicit production declarations. This is an allowlist, not name inference:
 * adding a new tool without adding a declaration fails server startup.
 */
const TOOL_EXECUTION_DECLARATIONS: Record<string, ToolExecutionMetadata> = {};
const declare = (names: string[], metadata: ToolExecutionMetadata): void => { for (const name of names) TOOL_EXECUTION_DECLARATIONS[name] = metadata; };

declare([
  "accessibility.find_element", "accessibility.get_tree", "accessibility.inspect_element", "adapter.detect_for_app", "adapter.get_capabilities", "adapter.list", "app.detect", "app.get_strategy", "app.list_installed", "browser.background_status", "browser.current_url", "browser.detect", "browser.diagnose_bridge", "browser.extract_text", "browser.find_element", "browser.get_active_tab", "browser.get_extension_install_instructions", "browser.get_form_state", "browser.get_page_context", "browser.get_selected_text", "browser.inventory", "browser.list_tabs", "browser.verify_pairing", "browser.wait_for_state",   "checkpoint.evaluate", "checkpoint.wait_for", "computer.observe_state", "computer.wait_for", "agent.status", "agent.discover_capabilities", "skills.get", "skills.list", "task.status", "desktop.get_active_window", "desktop.get_capabilities", "desktop.screenshot", "file.exists", "file.list", "file.read", "overlay.assistance_session_explain", "overlay.assistance_step_preview", "overlay.assistance_template_get", "overlay.assistance_template_list", "overlay.assistance_template_preview", "overlay.assistance_template_validate", "policy.explain_decision", "policy.get_profile", "policy.list_grants", "policy.list_profiles", "speech.artifact_get", "speech.devices_list", "speech.list_languages", "speech.list_providers", "speech.list_voices", "speech.playback_state", "speech.transmission_get", "strategy.capability_graph", "strategy.explain_selection", "strategy.failure_memory", "strategy.get", "strategy.goal_plan_preview", "strategy.list", "strategy.recall_episodes", "strategy.route_preview", "strategy.verify_outcome", "system.get_info", "system.list_capabilities", "vision.analyze_image", "vision.find_target", "vision.find_text", "vision.prepare_pointer_action", "window.list"
], readOnly());
declare(["browser.setup_status", "browser.setup_verify", "forge.check_sandbox_support", "speech.get_capabilities", "speech.routing_diagnose", "strategy.health", "system.check_dependency"], diagnostic());
declare([
  "forge.apply_session_grants_from_review", "forge.archive_manifest", "forge.check_registration_eligibility", "forge.check_runtime_eligibility", "forge.create_review", "forge.get_artifact", "forge.get_dispatchable_tool", "forge.get_harness_run", "forge.get_manifest", "forge.get_registration", "forge.get_review", "forge.get_runtime_run", "forge.get_validation", "forge.list_artifacts", "forge.list_dispatchable_tools", "forge.list_harness_runs", "forge.list_manifests", "forge.list_registrations", "forge.list_reviews", "forge.list_runtime_runs", "forge.list_validations", "forge.propose_grants", "forge.register_artifact", "forge.review_manifest", "forge.revoke_registration", "forge.run_validation_harness", "forge.save_manifest", "forge.scaffold_project", "forge.validate_manifest", "forge.validate_project", "guide.create_steps", "guide.explain_strategy", "agent.stop", "agent.resume", "agent.takeover_begin", "agent.takeover_end", "task.create", "task.update", "task.log_event", "task.pause", "task.resume", "task.complete", "strategy.record_episode", "overlay.assistance_template_archive", "overlay.assistance_template_instantiate", "overlay.assistance_template_save", "scheduler.job_activation_apply_review", "scheduler.job_activation_archive", "scheduler.job_activation_get", "scheduler.job_activation_list", "scheduler.job_activation_preview", "scheduler.job_activation_request", "scheduler.job_activation_review", "scheduler.job_activation_revoke", "scheduler.job_apply_review", "scheduler.job_archive", "scheduler.job_cancel", "scheduler.job_disable", "scheduler.job_get", "scheduler.job_list", "scheduler.job_pause", "scheduler.job_propose", "scheduler.job_readiness", "scheduler.job_remove", "scheduler.job_resume", "scheduler.job_review", "scheduler.manual_run_acknowledge", "scheduler.manual_run_acknowledgement_archive", "scheduler.manual_run_acknowledgement_get", "scheduler.manual_run_acknowledgement_list", "scheduler.manual_run_contract_apply_review", "scheduler.manual_run_contract_archive", "scheduler.manual_run_contract_get", "scheduler.manual_run_contract_list", "scheduler.manual_run_contract_propose", "scheduler.manual_run_contract_review", "scheduler.manual_run_preflight_archive", "scheduler.manual_run_preflight_check", "scheduler.manual_run_preflight_get", "scheduler.manual_run_preflight_list", "scheduler.manual_run_request_apply_review", "scheduler.manual_run_request_approval_explain", "scheduler.manual_run_request_approval_list_stale", "scheduler.manual_run_request_approval_validity", "scheduler.manual_run_request_archive", "scheduler.manual_run_request_create", "scheduler.manual_run_request_get", "scheduler.manual_run_request_list", "scheduler.manual_run_request_review", "scheduler.manual_run_request_review_archive", "scheduler.manual_run_request_review_get", "scheduler.manual_run_request_review_list", "scheduler.manual_run_request_revoke", "speech.transmission_prepare", "strategy.activate", "strategy.archive", "strategy.disable", "strategy.propose", "strategy.record_outcome", "strategy.revalidate", "strategy.review", "strategy.select", "workflow.replay_session_archive", "workflow.replay_session_cancel", "workflow.replay_session_diagnose", "workflow.replay_session_get", "workflow.replay_session_list", "workflow.replay_session_recreate_from_plan", "workflow.replay_session_start", "workflow.replay_step_apply_result", "workflow.replay_step_prepare", "workflow.replay_step_verify", "workflow.skill_archive", "workflow.skill_bind_checkpoints", "workflow.skill_checkpoint_template_apply", "workflow.skill_checkpoint_template_archive", "workflow.skill_checkpoint_template_get_review", "workflow.skill_checkpoint_template_list_reviews", "workflow.skill_checkpoint_template_propose", "workflow.skill_checkpoint_template_review", "workflow.skill_checkpoints_dryrun", "workflow.skill_get", "workflow.skill_list", "workflow.skill_replay_dryrun", "workflow.skill_run_dryrun", "workflow.skill_save_from_trace", "workflow.trace_archive", "workflow.trace_get", "workflow.trace_list", "workflow.trace_start", "workflow.trace_stop"
], metadataOnly());
declare([
  "overlay.assistance_session_cancel", "overlay.assistance_session_complete", "overlay.assistance_session_create", "overlay.guide_advance", "overlay.guide_dismiss", "overlay.guide_present", "overlay.assistance_session_get", "overlay.assistance_session_list", "overlay.assistance_session_pause", "overlay.assistance_session_start", "overlay.assistance_step_advance", "overlay.assistance_step_apply_event", "overlay.assistance_step_show", "overlay.assistance_target_refresh", "overlay.clear", "overlay.control_surface_apply_event", "overlay.control_surface_get", "overlay.control_surface_hide", "overlay.control_surface_show", "overlay.control_surface_update", "overlay.dismiss", "overlay.emergency_hide", "overlay.get_capabilities", "overlay.get_state", "overlay.highlight_target", "overlay.renderer_diagnose", "overlay.renderer_restart", "overlay.renderer_setup_instructions", "overlay.renderer_status", "overlay.show_pointer", "overlay.show_tooltip", "overlay.show_widget", "overlay.update"
], visualOnly());
declare([
  "browser.generate_pairing_token", "browser.reset_pairing", "task.execute_plan"
], stateChanging());
declare([
  "accessibility.focus_element", "accessibility.invoke_action", "accessibility.set_value", "app.open", "browser.background_launch", "browser.click_element", "browser.fill_text", "browser.focus_element", "browser.open_url", "browser.release_session", "desktop.click", "desktop.double_click", "desktop.drag", "desktop.hotkey", "desktop.move_mouse", "desktop.right_click", "desktop.scroll", "desktop.type_text", "file.copy", "file.delete", "file.ensure_dir", "file.move", "file.write", "shell.run_safe", "window.focus"
], stateChanging(true));
declare(["browser.setup_begin", "browser.setup_approve", "browser.setup_cancel"], stateChanging(true));
declare(["speech.play", "speech.stop", "speech.synthesize", "speech.transmission_execute"], stateChanging(true));
declare(["forge.dispatch_generated_tool", "forge.run_sandboxed_tool"], stateChanging(true));
declare(["blender.run_python"], stateChanging(true, "optional_adapter"));
declare(["ssh.run_command"], stateChanging(true, "optional_adapter"));

export function applyProductionExecutionMetadata(tools: AnyAgentHostToolDefinition[]): AnyAgentHostToolDefinition[] {
  return tools.map((definition) => {
    const declared = TOOL_EXECUTION_DECLARATIONS[definition.name];
    if (declared === undefined) throw new Error(`Missing execution classification metadata for ${definition.name}`);
    if (definition.execution !== undefined && JSON.stringify(normalizeEffectMetadata(definition.execution, definition.name)) !== JSON.stringify(normalizeEffectMetadata(declared, definition.name))) {
      throw new Error(`Contradictory execution metadata for ${definition.name}`);
    }
    return { ...definition, execution: normalizeEffectMetadata(declared, definition.name) };
  });
}

export function validateToolExecutionMetadata(metadata: ToolExecutionMetadata, toolName: string): void {
  const allowedKeys = new Set(["executionClass", "externalEffect", "requiresDryRun", "requiresConfirmationToken", "requiresExactTarget", "source", "availability", "operationFamily", "operation", "reversibility", "sensitivity", "requiredBindings", "confirmationLevel", "verificationKind", "cleanupKind", "requiredGrantIds"]);
  if (typeof metadata !== "object" || metadata === null || Object.keys(metadata).some((key) => !allowedKeys.has(key))) {
    throw new Error(`Unknown execution metadata field for ${toolName}`);
  }
  if (!["read_only", "diagnostic", "metadata_only", "visual_only", "state_changing", "inert"].includes(metadata.executionClass)) {
    throw new Error(`Unknown execution class for ${toolName}`);
  }
  if (typeof metadata.externalEffect !== "boolean" || typeof metadata.requiresDryRun !== "boolean" || typeof metadata.requiresConfirmationToken !== "boolean" || typeof metadata.requiresExactTarget !== "boolean") {
    throw new Error(`Invalid execution metadata flags for ${toolName}`);
  }
  if (metadata.availability !== "available") throw new Error(`Unavailable tool cannot be registered: ${toolName}`);
  const inertClass = metadata.executionClass === "read_only" || metadata.executionClass === "diagnostic" || metadata.executionClass === "metadata_only" || metadata.executionClass === "inert" || metadata.executionClass === "visual_only";
  if (inertClass && (metadata.externalEffect || metadata.requiresDryRun || metadata.requiresConfirmationToken || metadata.requiresExactTarget)) {
    throw new Error(`Contradictory execution metadata for ${toolName}`);
  }
  if (metadata.executionClass === "state_changing" && !metadata.requiresDryRun) {
    throw new Error(`State-changing tool must declare requiresDryRun for ${toolName}`);
  }
  if (metadata.executionClass === "state_changing" && !metadata.requiresConfirmationToken) {
    throw new Error(`State-changing tool must declare confirmation requirements for ${toolName}`);
  }
  if (metadata.operationFamily !== undefined && (typeof metadata.operationFamily !== "string" || metadata.operationFamily.length === 0 || metadata.operationFamily.length > 100)) throw new Error(`Invalid operation family metadata for ${toolName}`);
  if (metadata.operation !== undefined && (typeof metadata.operation !== "string" || metadata.operation.length === 0 || metadata.operation.length > 160)) throw new Error(`Invalid operation metadata for ${toolName}`);
  if (metadata.reversibility !== undefined && !["reversible", "persistent", "external", "destructive", "prohibited"].includes(metadata.reversibility)) throw new Error(`Invalid reversibility metadata for ${toolName}`);
  if (metadata.confirmationLevel !== undefined && !["none", "standard", "strong"].includes(metadata.confirmationLevel)) throw new Error(`Invalid confirmation metadata for ${toolName}`);
  if (metadata.requiredBindings !== undefined && (!Array.isArray(metadata.requiredBindings) || metadata.requiredBindings.some((binding) => !["target", "recipient", "content", "artifact", "channel", "route"].includes(binding)))) throw new Error(`Invalid binding metadata for ${toolName}`);
  if (metadata.source !== "base" && metadata.source !== "optional_adapter") {
    throw new Error(`Unknown tool source for ${toolName}`);
  }
  validateRequiredGrantIds(metadata.requiredGrantIds, toolName);
}

function validateRequiredGrantIds(ids: string[] | undefined, toolName: string): void {
  if (ids === undefined) return;
  if (!Array.isArray(ids) || ids.length > 20) throw new Error(`Invalid required grant metadata for ${toolName}`);
  const unique = new Set<string>();
  for (const grantId of ids) {
    if (typeof grantId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(grantId) || unique.has(grantId)) {
      throw new Error(`Invalid required grant metadata for ${toolName}`);
    }
    unique.add(grantId);
  }
}

function normalizeEffectMetadata(metadata: ToolExecutionMetadata, toolName = ""): ToolExecutionMetadata {
  const stateChanging = metadata.executionClass === "state_changing";
  const parts = toolName.split(/\.(.*)/s, 2);
  const familyHint = parts[0] ?? "state_change";
  const operationHint = parts[1] ?? "governed_action";
  const speechTransmission = toolName === "speech.transmission_execute";
  return {
    ...metadata,
    operationFamily: metadata.operationFamily === "state_change" || metadata.operationFamily === "observe" || metadata.operationFamily === undefined
      ? (stateChanging ? familyHint : metadata.operationFamily ?? "observe")
      : metadata.operationFamily,
    operation: metadata.operation === "governed_action" || metadata.operation === "inspect" || metadata.operation === undefined
      ? (stateChanging ? operationHint : metadata.operation ?? "inspect")
      : metadata.operation,
    externalEffect: speechTransmission ? true : metadata.externalEffect,
    reversibility: speechTransmission ? "external" : metadata.reversibility ?? (stateChanging ? "persistent" : "reversible"),
    sensitivity: speechTransmission ? "communication" : metadata.sensitivity ?? "normal",
    requiredBindings: speechTransmission ? ["target", "artifact", "route"] : metadata.requiredBindings ?? (metadata.requiresExactTarget ? ["target"] : []),
    confirmationLevel: speechTransmission ? "standard" : metadata.confirmationLevel ?? (stateChanging ? "standard" : "none"),
    verificationKind: speechTransmission ? "speech_receipt" : metadata.verificationKind ?? (stateChanging ? "tool_result" : "none"),
    cleanupKind: metadata.cleanupKind ?? "none"
  };
}

export function materializeToolDefinitions(tools: AnyAgentHostToolDefinition[]): AnyAgentHostToolDefinition[] {
  const names = new Set<string>();
  return tools.map((definition) => {
    if (names.has(definition.name)) throw new Error(`Duplicate loaded tool: ${definition.name}`);
    names.add(definition.name);
    const execution = definition.execution;
    if (execution === undefined) throw new Error(`Missing execution classification metadata for ${definition.name}`);
    validateToolExecutionMetadata(execution, definition.name);
    validateRequiredGrantIds(definition.requiredGrantIds, definition.name);
    return { ...definition, execution: normalizeEffectMetadata(execution, definition.name) };
  });
}

export function toolCapabilities(tools: AnyAgentHostToolDefinition[]): ToolCapability[] {
  return tools.map((tool) => ({
    name: tool.name,
    riskLevel: tool.riskLevel,
    description: tool.description,
    inputSchema: tool.mcpInputSchema,
    ...(tool.requiredGrantIds === undefined ? {} : { requiredGrantIds: [...tool.requiredGrantIds] }),
    ...(tool.execution === undefined ? {} : { execution: normalizeEffectMetadata(tool.execution, tool.name) })
  }));
}
