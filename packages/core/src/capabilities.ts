import {
  AUTOMATION_STRATEGIES,
  type AppCapability,
  type AutomationStrategy,
  type CapabilityRegistrySnapshot,
  type ToolCapability,
  type ToolExecutionMetadata
} from "./types.js";

function bootstrapExecutionMetadata(name: string): ToolExecutionMetadata {
  if (name === "overlay.assistance_step_preview" || name === "overlay.assistance_session_explain" || name === "overlay.assistance_template_validate" || name === "overlay.assistance_template_preview" || name === "overlay.assistance_template_get" || name === "overlay.assistance_template_list") return { executionClass: "read_only", externalEffect: false, requiresDryRun: false, requiresConfirmationToken: false, requiresExactTarget: false, source: "base", availability: "available" };
  if (name === "overlay.assistance_template_save" || name === "overlay.assistance_template_archive" || name === "overlay.assistance_template_instantiate") return { executionClass: "metadata_only", externalEffect: false, requiresDryRun: false, requiresConfirmationToken: false, requiresExactTarget: false, source: "base", availability: "available" };
  const visual = name.startsWith("overlay.");
  let metadata: ToolExecutionMetadata["executionClass"] = "read_only";
  if (name === "forge.check_sandbox_support" || name === "system.check_dependency") metadata = "diagnostic";
  else if (/^forge\.(run_sandboxed_tool|dispatch_generated_tool)$/.test(name)) metadata = "state_changing";
  else if (name.startsWith("workflow.") || name.startsWith("scheduler.") || name.startsWith("forge.")) metadata = "metadata_only";
  else if (visual) metadata = "visual_only";
  else if (/(^|\.)(open|write|delete|click|type|focus|hotkey|scroll|drag|mouse|invoke|set_value|run_|send|upload)/.test(name)) metadata = "state_changing";
  const stateChanging = metadata === "state_changing";
  return {
    executionClass: metadata,
    externalEffect: stateChanging,
    requiresDryRun: stateChanging,
    requiresConfirmationToken: stateChanging,
    requiresExactTarget: stateChanging && /browser|desktop|window|accessibility|click|type|focus|scroll|drag|mouse/.test(name),
    source: "base",
    availability: "available"
  };
}

export class CapabilityRegistry implements CapabilityRegistrySnapshot {
  readonly #tools = new Map<string, ToolCapability>();
  readonly #appCapabilities = new Map<string, AppCapability>();

  registerTool(capability: ToolCapability): void {
    if (this.#tools.has(capability.name)) {
      throw new Error(`Tool capability is already registered: ${capability.name}`);
    }

    this.#tools.set(capability.name, { ...capability, execution: capability.execution ?? bootstrapExecutionMetadata(capability.name) });
  }

  syncTools(capabilities: ToolCapability[]): void {
    const names = new Set<string>();
    for (const capability of capabilities) {
      if (names.has(capability.name)) {
        throw new Error(`Tool capability is duplicated in loaded tool set: ${capability.name}`);
      }
      names.add(capability.name);
    }
    this.#tools.clear();
    for (const capability of capabilities) {
      this.#tools.set(capability.name, { ...capability });
    }
  }

  registerAppCapability(capability: AppCapability): void {
    if (this.#appCapabilities.has(capability.id)) {
      throw new Error(`App capability is already registered: ${capability.id}`);
    }

    this.#appCapabilities.set(capability.id, { ...capability });
  }

  listStrategies(): AutomationStrategy[] {
    return [...AUTOMATION_STRATEGIES];
  }

  listTools(): ToolCapability[] {
    return [...this.#tools.values()].map((capability) => ({ ...capability }));
  }

  listAppCapabilities(): AppCapability[] {
    return [...this.#appCapabilities.values()].map((capability) => ({ ...capability }));
  }
}

export function createBaseCapabilityRegistry(): CapabilityRegistry {
  const registry = new CapabilityRegistry();

  for (const capability of [
    { name: "scheduler.job_propose", riskLevel: "low" as const, description: "Creates inert scheduled-job proposal." },
    { name: "scheduler.job_review", riskLevel: "low" as const, description: "Reviews inert scheduled-job safety." },
    { name: "scheduler.job_apply_review", riskLevel: "low" as const, description: "Applies approved inert scheduled-job review." },
    { name: "scheduler.job_get", riskLevel: "observe" as const, description: "Gets redacted scheduled-job metadata." },
    { name: "scheduler.job_list", riskLevel: "observe" as const, description: "Lists redacted scheduled-job metadata." },
    { name: "scheduler.job_archive", riskLevel: "low" as const, description: "Archives inert scheduled-job metadata." },
    { name: "scheduler.job_disable", riskLevel: "low" as const, description: "Disables inert scheduled-job metadata." },
    { name: "scheduler.job_readiness", riskLevel: "observe" as const, description: "Checks inert scheduled-job readiness." },
    { name: "scheduler.job_activation_preview", riskLevel: "low" as const, description: "Previews future job activation controls." },
    { name: "scheduler.job_activation_request", riskLevel: "low" as const, description: "Requests review-only job activation metadata." },
    { name: "scheduler.job_activation_review", riskLevel: "low" as const, description: "Reviews job activation metadata." },
    { name: "scheduler.job_activation_apply_review", riskLevel: "low" as const, description: "Applies approved job activation metadata." },
    { name: "scheduler.job_activation_get", riskLevel: "observe" as const, description: "Gets redacted job activation metadata." },
    { name: "scheduler.job_activation_list", riskLevel: "observe" as const, description: "Lists redacted job activation metadata." },
    { name: "scheduler.job_activation_revoke", riskLevel: "low" as const, description: "Revokes job activation metadata." },
    { name: "scheduler.job_activation_archive", riskLevel: "low" as const, description: "Archives terminal job activation metadata." },
    { name: "scheduler.manual_run_contract_propose", riskLevel: "low" as const, description: "Creates review-only manual-run contract." },
    { name: "scheduler.manual_run_contract_review", riskLevel: "low" as const, description: "Reviews manual-run contract metadata." },
    { name: "scheduler.manual_run_contract_apply_review", riskLevel: "low" as const, description: "Applies approved manual-run contract metadata." },
    { name: "scheduler.manual_run_contract_get", riskLevel: "observe" as const, description: "Gets redacted manual-run contract." },
    { name: "scheduler.manual_run_contract_list", riskLevel: "observe" as const, description: "Lists redacted manual-run contracts." },
    { name: "scheduler.manual_run_contract_archive", riskLevel: "low" as const, description: "Archives terminal manual-run contract." },
    { name: "scheduler.manual_run_preflight_check", riskLevel: "observe" as const, description: "Checks redacted operator preflight for future manual-run contract." },
    { name: "scheduler.manual_run_preflight_get", riskLevel: "observe" as const, description: "Gets redacted manual-run operator preflight." },
    { name: "scheduler.manual_run_preflight_list", riskLevel: "observe" as const, description: "Lists redacted manual-run operator preflights." },
    { name: "scheduler.manual_run_preflight_archive", riskLevel: "low" as const, description: "Archives manual-run operator preflight metadata." },
    { name: "scheduler.manual_run_acknowledge", riskLevel: "low" as const, description: "Records explicit redacted manual-run preflight acknowledgement." },
    { name: "scheduler.manual_run_acknowledgement_get", riskLevel: "observe" as const, description: "Gets redacted manual-run acknowledgement metadata." },
    { name: "scheduler.manual_run_acknowledgement_list", riskLevel: "observe" as const, description: "Lists redacted manual-run acknowledgement metadata." },
    { name: "scheduler.manual_run_acknowledgement_archive", riskLevel: "low" as const, description: "Archives manual-run acknowledgement metadata." },
    { name: "scheduler.manual_run_request_create", riskLevel: "low" as const, description: "Creates audit-only manual-run request metadata." },
    { name: "scheduler.manual_run_request_get", riskLevel: "observe" as const, description: "Gets redacted manual-run request audit metadata." },
    { name: "scheduler.manual_run_request_list", riskLevel: "observe" as const, description: "Lists redacted manual-run request audit metadata." },
    { name: "scheduler.manual_run_request_archive", riskLevel: "low" as const, description: "Archives manual-run request audit metadata." },
    { name: "scheduler.manual_run_request_review", riskLevel: "low" as const, description: "Reviews manual-run request approval metadata without execution." },
    { name: "scheduler.manual_run_request_apply_review", riskLevel: "low" as const, description: "Applies approved manual-run request metadata only." },
    { name: "scheduler.manual_run_request_review_get", riskLevel: "observe" as const, description: "Gets redacted manual-run request review metadata." },
    { name: "scheduler.manual_run_request_review_list", riskLevel: "observe" as const, description: "Lists redacted manual-run request reviews." },
    { name: "scheduler.manual_run_request_revoke", riskLevel: "low" as const, description: "Revokes manual-run request approval metadata without execution." },
    { name: "scheduler.manual_run_request_review_archive", riskLevel: "low" as const, description: "Archives terminal manual-run request review metadata." },
    { name: "scheduler.manual_run_request_approval_validity", riskLevel: "observe" as const, description: "Checks manual-run approval expiry and dependency staleness." },
    { name: "scheduler.manual_run_request_approval_explain", riskLevel: "observe" as const, description: "Explains redacted manual-run approval audit and recovery guidance." },
    { name: "scheduler.manual_run_request_approval_list_stale", riskLevel: "observe" as const, description: "Lists expired or stale manual-run approval metadata." },
    { name: "overlay.get_capabilities", riskLevel: "observe" as const, description: "Reports local visual overlay renderer capabilities." },
    { name: "overlay.renderer_status", riskLevel: "observe" as const, description: "Reports local overlay renderer health and dependency status." },
    { name: "overlay.renderer_diagnose", riskLevel: "observe" as const, description: "Explains local overlay renderer failures and safe recovery guidance." },
    { name: "overlay.renderer_setup_instructions", riskLevel: "observe" as const, description: "Returns manual GTK3/X11 overlay setup instructions." },
    { name: "overlay.renderer_restart", riskLevel: "low" as const, description: "Explicitly restarts only the visual overlay child process." },
    { name: "overlay.assistance_session_create", riskLevel: "low" as const, description: "Creates bounded visual-only assistance session." },
    { name: "overlay.assistance_session_get", riskLevel: "observe" as const, description: "Gets redacted visual assistance session metadata." },
    { name: "overlay.assistance_session_list", riskLevel: "observe" as const, description: "Lists redacted visual assistance sessions." },
    { name: "overlay.assistance_session_start", riskLevel: "low" as const, description: "Starts visual-only assistance session." },
    { name: "overlay.assistance_step_show", riskLevel: "low" as const, description: "Shows one current validated visual assistance step." },
    { name: "overlay.assistance_step_apply_event", riskLevel: "low" as const, description: "Records one validated visual assistance intent event." },
    { name: "overlay.assistance_step_advance", riskLevel: "low" as const, description: "Explicitly advances one visual assistance step." },
    { name: "overlay.assistance_session_pause", riskLevel: "low" as const, description: "Pauses visual assistance and clears owned overlays." },
    { name: "overlay.assistance_session_cancel", riskLevel: "low" as const, description: "Cancels visual assistance and clears owned overlays." },
    { name: "overlay.assistance_session_complete", riskLevel: "low" as const, description: "Completes fully advanced visual assistance session." },
    { name: "overlay.assistance_step_preview", riskLevel: "observe" as const, description: "Previews current visual assistance step without rendering or advancing." },
    { name: "overlay.assistance_session_explain", riskLevel: "observe" as const, description: "Explains redacted visual assistance session state." },
    { name: "overlay.assistance_template_validate", riskLevel: "observe" as const, description: "Validates constrained visual assistance template metadata." },
    { name: "overlay.assistance_template_preview", riskLevel: "observe" as const, description: "Previews literal-bound visual assistance template metadata." },
    { name: "overlay.assistance_template_save", riskLevel: "low" as const, description: "Saves visual assistance template as draft metadata." },
    { name: "overlay.assistance_template_get", riskLevel: "observe" as const, description: "Gets redacted visual assistance template metadata." },
    { name: "overlay.assistance_template_list", riskLevel: "observe" as const, description: "Lists redacted visual assistance templates." },
    { name: "overlay.assistance_template_archive", riskLevel: "low" as const, description: "Archives visual assistance template metadata." },
    { name: "overlay.assistance_template_instantiate", riskLevel: "low" as const, description: "Creates draft visual assistance session from safe template metadata." },
    { name: "overlay.control_surface_show", riskLevel: "low" as const, description: "Shows one bounded visual assistance control surface." },
    { name: "overlay.control_surface_get", riskLevel: "observe" as const, description: "Gets redacted visual control surface state." },
    { name: "overlay.control_surface_update", riskLevel: "low" as const, description: "Refreshes visual control surface state." },
    { name: "overlay.control_surface_hide", riskLevel: "low" as const, description: "Hides one visual control surface." },
    { name: "overlay.control_surface_apply_event", riskLevel: "low" as const, description: "Applies one allowlisted visual operator intent event." },
    { name: "overlay.get_state", riskLevel: "observe" as const, description: "Returns redacted visual overlay state for this session." },
    { name: "overlay.show_pointer", riskLevel: "low" as const, strategy: "gui_control" as const, description: "Shows a grounded visual pointer without moving or clicking the desktop pointer." },
    { name: "overlay.highlight_target", riskLevel: "low" as const, strategy: "gui_control" as const, description: "Highlights a fresh grounded target without changing the target application." },
    { name: "overlay.show_tooltip", riskLevel: "low" as const, strategy: "gui_control" as const, description: "Shows redacted grounded guidance text without target-app actions." },
    { name: "overlay.show_widget", riskLevel: "low" as const, strategy: "gui_control" as const, description: "Shows a constrained local widget with safe intent events only." },
    { name: "overlay.update", riskLevel: "low" as const, strategy: "gui_control" as const, description: "Updates bounded local overlay metadata and visuals." },
    { name: "overlay.dismiss", riskLevel: "low" as const, strategy: "gui_control" as const, description: "Dismisses one local overlay." },
    { name: "overlay.clear", riskLevel: "low" as const, strategy: "gui_control" as const, description: "Clears overlays owned by this session." },
    { name: "overlay.emergency_hide", riskLevel: "low" as const, strategy: "gui_control" as const, description: "Immediately hides all local overlays." },
    { name: "checkpoint.evaluate", riskLevel: "low" as const, description: "Evaluates read-only semantic post-action checkpoints." },
    { name: "checkpoint.wait_for", riskLevel: "low" as const, description: "Polls read-only semantic checkpoints with bounded timeout." },
    { name: "vision.prepare_pointer_action", riskLevel: "medium" as const, strategy: "gui_control" as const, description: "Prepares validated desktop.click dry-run suggestion from fresh trusted screenshot evidence." },
    { name: "vision.analyze_image", riskLevel: "low" as const, strategy: "gui_control" as const, description: "Runs local redacted OCR on an approved image without desktop actions." },
    { name: "vision.find_text", riskLevel: "low" as const, strategy: "gui_control" as const, description: "Finds redacted local OCR text and image-relative bounds without desktop actions." },
    { name: "vision.find_target", riskLevel: "low" as const, strategy: "gui_control" as const, description: "Ranks local OCR target candidates without clicking or typing." },
    { name: "workflow.trace_start", riskLevel: "low" as const, description: "Starts explicit local redacted workflow tracing for this MCP session." },
    { name: "workflow.trace_stop", riskLevel: "low" as const, description: "Stops and finalizes one redacted local workflow trace." },
    { name: "workflow.trace_get", riskLevel: "observe" as const, description: "Returns one redacted workflow trace." },
    { name: "workflow.trace_list", riskLevel: "observe" as const, description: "Lists redacted local workflow traces." },
    { name: "workflow.trace_archive", riskLevel: "low" as const, description: "Archives one stopped redacted workflow trace." },
    { name: "workflow.skill_save_from_trace", riskLevel: "low" as const, description: "Creates a draft reusable workflow skill from a stopped redacted trace." },
    { name: "workflow.skill_list", riskLevel: "observe" as const, description: "Lists local workflow skill metadata." },
    { name: "workflow.skill_get", riskLevel: "observe" as const, description: "Returns one local workflow skill." },
    { name: "workflow.skill_archive", riskLevel: "low" as const, description: "Archives one workflow skill without deleting it." },
    { name: "workflow.skill_run_dryrun", riskLevel: "low" as const, description: "Previews a workflow skill without executing any workflow action." },
    { name: "workflow.skill_bind_checkpoints", riskLevel: "low" as const, description: "Validates redacted workflow checkpoint bindings without evaluation or actions." },
    { name: "workflow.skill_checkpoints_dryrun", riskLevel: "low" as const, description: "Previews or read-only evaluates bound workflow checkpoints without skill replay." },
    { name: "workflow.skill_replay_dryrun", riskLevel: "low" as const, description: "Builds a redacted future skill replay plan without executing or storing workflow actions." },
    { name: "workflow.replay_session_start", riskLevel: "low" as const, description: "Starts a redacted controlled replay session without executing steps." },
    { name: "workflow.replay_session_get", riskLevel: "observe" as const, description: "Gets one redacted controlled replay session." },
    { name: "workflow.replay_session_diagnose", riskLevel: "observe" as const, description: "Explains redacted replay recovery state without actions." },
    { name: "workflow.replay_session_list", riskLevel: "observe" as const, description: "Lists redacted local replay session metadata." },
    { name: "workflow.replay_session_cancel", riskLevel: "low" as const, description: "Cancels a controlled replay session without background actions." },
    { name: "workflow.replay_session_archive", riskLevel: "low" as const, description: "Archives terminal replay session without deleting records." },
    { name: "workflow.replay_session_recreate_from_plan", riskLevel: "low" as const, description: "Creates fresh replay session from explicit parameters only." },
    { name: "workflow.replay_step_prepare", riskLevel: "low" as const, description: "Prepares only current replay step for original-tool invocation." },
    { name: "workflow.replay_step_apply_result", riskLevel: "low" as const, description: "Records a redacted original-tool step result without execution." },
    { name: "workflow.replay_step_verify", riskLevel: "low" as const, description: "Runs read-only checkpoint verification for current replay step." },
    { name: "workflow.skill_checkpoint_template_propose", riskLevel: "low" as const, description: "Creates a local non-executable checkpoint-template review proposal." },
    { name: "workflow.skill_checkpoint_template_review", riskLevel: "low" as const, description: "Reviews checkpoint-template safety without applying or executing it." },
    { name: "workflow.skill_checkpoint_template_apply", riskLevel: "low" as const, description: "Applies an approved safe checkpoint-template review without workflow execution." },
    { name: "workflow.skill_checkpoint_template_archive", riskLevel: "low" as const, description: "Archives a checkpoint template locally without deleting review history." },
    { name: "workflow.skill_checkpoint_template_list_reviews", riskLevel: "observe" as const, description: "Lists redacted local checkpoint-template review metadata." },
    { name: "workflow.skill_checkpoint_template_get_review", riskLevel: "observe" as const, description: "Gets one redacted local checkpoint-template review." },
    { name: "browser.find_element", riskLevel: "low" as const, strategy: "browser_automation" as const, description: "Finds bounded, redacted browser elements through the paired extension." },
    { name: "browser.click_element", riskLevel: "medium" as const, strategy: "browser_automation" as const, description: "Confirmation-gated click of one revalidated safe browser element." },
    { name: "browser.fill_text", riskLevel: "medium" as const, strategy: "browser_automation" as const, description: "Confirmation-gated draft-only text fill of one safe browser field." },
    { name: "browser.focus_element", riskLevel: "medium" as const, strategy: "browser_automation" as const, description: "Confirmation-gated focus of one safe browser element." },
    { name: "browser.wait_for_state", riskLevel: "low" as const, strategy: "browser_automation" as const, description: "Waits for bounded browser state checkpoints." },
    { name: "browser.get_form_state", riskLevel: "low" as const, strategy: "browser_automation" as const, description: "Reads safe browser form metadata without values." },
    { name: "browser.get_selected_text", riskLevel: "low" as const, strategy: "browser_automation" as const, description: "Reads bounded redacted browser selected text." },
    { name: "browser.detect", riskLevel: "observe" as const, strategy: "browser_automation" as const, description: "Reports local WebExtension browser bridge status." },
    { name: "browser.setup_status", riskLevel: "observe" as const, strategy: "browser_automation" as const, description: "Reports local browser bridge, prepared extension, and pairing setup status." },
    { name: "browser.diagnose_bridge", riskLevel: "observe" as const, strategy: "browser_automation" as const, description: "Diagnoses local browser bridge setup without exposing tokens or page data." },
    { name: "browser.generate_pairing_token", riskLevel: "medium" as const, strategy: "browser_automation" as const, description: "Confirmation-gated browser pairing-token rotation." },
    { name: "browser.reset_pairing", riskLevel: "medium" as const, strategy: "browser_automation" as const, description: "Confirmation-gated browser pairing reset." },
    { name: "browser.get_extension_install_instructions", riskLevel: "observe" as const, strategy: "browser_automation" as const, description: "Returns browser-specific explicit unpacked extension install steps." },
    { name: "browser.verify_pairing", riskLevel: "observe" as const, strategy: "browser_automation" as const, description: "Verifies active paired extension connection without page access." },
    { name: "browser.list_tabs", riskLevel: "observe" as const, strategy: "browser_automation" as const, description: "Lists sanitized tabs from the paired local browser." },
    { name: "browser.get_active_tab", riskLevel: "observe" as const, strategy: "browser_automation" as const, description: "Returns the active paired-browser tab metadata." },
    { name: "browser.current_url", riskLevel: "low" as const, strategy: "browser_automation" as const, description: "Returns a sanitized paired-browser URL." },
    { name: "browser.open_url", riskLevel: "medium" as const, strategy: "browser_automation" as const, description: "Confirmation-gated navigation in the paired local browser." },
    { name: "browser.get_page_context", riskLevel: "low" as const, strategy: "browser_automation" as const, description: "Reads bounded, redacted page structure through the paired extension." },
    { name: "browser.extract_text", riskLevel: "low" as const, strategy: "browser_automation" as const, description: "Reads bounded, redacted visible page text through the paired extension." },
    {
      name: "forge.list_dispatchable_tools",
      riskLevel: "observe" as const,
      description: "Lists inert generated Forge tool metadata; generated names are never live MCP tools."
    },
    {
      name: "forge.get_dispatchable_tool",
      riskLevel: "observe" as const,
      description: "Returns metadata for one inert generated Forge tool."
    },
    {
      name: "forge.dispatch_generated_tool",
      riskLevel: "medium" as const,
      description: "Dispatches one eligible inert generated Forge tool through the fixed sandboxed JSON runner."
    },
    {
      name: "system.get_info",
      riskLevel: "observe" as const,
      description: "Returns local system information and AgentHost runtime details."
    },
    {
      name: "system.list_capabilities",
      riskLevel: "observe" as const,
      description: "Lists AgentHost strategies, tools, and registered app capabilities."
    },
    {
      name: "system.check_dependency",
      riskLevel: "low" as const,
      description: "Checks whether a command or desktop app appears to be available."
    },
    {
      name: "policy.get_profile",
      riskLevel: "observe" as const,
      description: "Returns the active AgentHost permission profile and default grant requirements."
    },
    {
      name: "policy.list_profiles",
      riskLevel: "observe" as const,
      description: "Lists built-in AgentHost permission profiles and their default behavior."
    },
    {
      name: "policy.list_grants",
      riskLevel: "observe" as const,
      description: "Lists active persistent and session grants as safe summaries."
    },
    {
      name: "policy.explain_decision",
      riskLevel: "low" as const,
      description: "Explains how the active profile and grants classify a potential action."
    },
    {
      name: "forge.validate_manifest",
      riskLevel: "low" as const,
      description: "Validates a Tool Forge manifest for future generated tools, adapters, skills, or workflows."
    },
    {
      name: "forge.review_manifest",
      riskLevel: "low" as const,
      description: "Reviews a Tool Forge manifest against the active profile and grants without applying anything."
    },
    {
      name: "forge.propose_grants",
      riskLevel: "low" as const,
      description: "Maps a Tool Forge manifest to proposed grants without saving or applying them."
    },
    {
      name: "forge.save_manifest",
      riskLevel: "medium" as const,
      description: "Validates and stores an inert Tool Forge manifest plus artifact record under AgentHost home."
    },
    {
      name: "forge.list_manifests",
      riskLevel: "low" as const,
      description: "Lists stored Tool Forge manifests and inert artifact summaries."
    },
    {
      name: "forge.get_manifest",
      riskLevel: "low" as const,
      description: "Returns a stored Tool Forge manifest and its inert artifact record."
    },
    {
      name: "forge.create_review",
      riskLevel: "medium" as const,
      description: "Creates and stores a Tool Forge review record bound to an exact manifest hash."
    },
    {
      name: "forge.get_review",
      riskLevel: "low" as const,
      description: "Returns one stored Tool Forge review record."
    },
    {
      name: "forge.list_reviews",
      riskLevel: "low" as const,
      description: "Lists stored Tool Forge review summaries."
    },
    {
      name: "forge.archive_manifest",
      riskLevel: "medium" as const,
      description: "Marks an inert Tool Forge artifact as archived without deleting stored files."
    },
    {
      name: "forge.apply_session_grants_from_review",
      riskLevel: "medium" as const,
      description: "Applies eligible session-only grants from a reviewed inert Tool Forge artifact."
    },
    {
      name: "forge.scaffold_project",
      riskLevel: "medium" as const,
      description: "Creates an inert generated project scaffold under AgentHost Forge storage without registering or executing it."
    },
    {
      name: "forge.validate_project",
      riskLevel: "medium" as const,
      description: "Validates an inert generated project scaffold and stores a non-executable validation record."
    },
    {
      name: "forge.get_artifact",
      riskLevel: "low" as const,
      description: "Returns one stored Forge artifact record."
    },
    {
      name: "forge.list_artifacts",
      riskLevel: "low" as const,
      description: "Lists stored Forge artifact summaries."
    },
    {
      name: "forge.get_validation",
      riskLevel: "low" as const,
      description: "Returns one stored Forge validation record."
    },
    {
      name: "forge.list_validations",
      riskLevel: "low" as const,
      description: "Lists stored Forge validation summaries."
    },
    {
      name: "forge.run_validation_harness",
      riskLevel: "medium" as const,
      description: "Runs a controlled inert validation harness for a generated Forge project and stores a harness record."
    },
    {
      name: "forge.get_harness_run",
      riskLevel: "low" as const,
      description: "Returns one stored Forge harness run record."
    },
    {
      name: "forge.list_harness_runs",
      riskLevel: "low" as const,
      description: "Lists stored Forge harness run summaries."
    },
    {
      name: "forge.check_registration_eligibility",
      riskLevel: "low" as const,
      description: "Checks whether a generated Forge artifact is eligible for inert registration."
    },
    {
      name: "forge.register_artifact",
      riskLevel: "medium" as const,
      description: "Creates a registered_inert Forge registration record without making generated tools callable."
    },
    {
      name: "forge.get_registration",
      riskLevel: "low" as const,
      description: "Returns one stored Forge registration record."
    },
    {
      name: "forge.list_registrations",
      riskLevel: "low" as const,
      description: "Lists stored Forge registration summaries."
    },
    {
      name: "forge.revoke_registration",
      riskLevel: "medium" as const,
      description: "Marks a Forge registration record revoked without deleting it or exposing generated tools."
    },
    {
      name: "forge.check_runtime_eligibility",
      riskLevel: "low" as const,
      description: "Checks whether a registered inert Forge artifact is eligible for limited sandbox runtime handling."
    },
    {
      name: "forge.check_sandbox_support",
      riskLevel: "observe" as const,
      description: "Reports read-only OS-level sandbox support without enabling sandbox execution."
    },
    {
      name: "forge.run_sandboxed_tool",
      riskLevel: "medium" as const,
      description: "Runs a confirmation-gated metadata stub for one registered inert Forge tool without executing generated code."
    },
    {
      name: "forge.get_runtime_run",
      riskLevel: "low" as const,
      description: "Returns one stored Forge runtime run record."
    },
    {
      name: "forge.list_runtime_runs",
      riskLevel: "low" as const,
      description: "Lists stored Forge runtime run summaries."
    },
    {
      name: "app.detect",
      riskLevel: "low" as const,
      description: "Detects a Linux app generically and reports available automation strategies."
    },
    {
      name: "app.list_installed",
      riskLevel: "low" as const,
      description: "Lists installed Linux desktop apps and commands on a best-effort basis."
    },
    {
      name: "app.open",
      riskLevel: "medium" as const,
      description: "Opens a detected Linux app through a generic CLI or desktop-entry launch path."
    },
    {
      name: "app.get_strategy",
      riskLevel: "low" as const,
      description: "Recommends an app-agnostic automation strategy for an app and task type."
    },
    {
      name: "shell.run_safe",
      riskLevel: "medium" as const,
      description: "Runs a classified command with shell disabled, timeout, and output limits."
    },
    {
      name: "file.write",
      riskLevel: "medium" as const,
      description: "Writes a new file inside approved roots only."
    },
    {
      name: "file.read",
      riskLevel: "low" as const,
      description: "Reads a file when path safety policy allows it."
    },
    {
      name: "file.exists",
      riskLevel: "low" as const,
      description: "Checks whether a path exists when path safety policy allows it."
    },
    {
      name: "file.list",
      riskLevel: "low" as const,
      description: "Lists a directory non-recursively when path safety policy allows it."
    },
    {
      name: "file.ensure_dir",
      riskLevel: "medium" as const,
      description: "Creates an approved directory if needed."
    },
    {
      name: "desktop.get_active_window",
      riskLevel: "low" as const,
      strategy: "gui_control" as const,
      description: "Returns best-effort metadata about the current active window."
    },
    {
      name: "desktop.get_capabilities",
      riskLevel: "low" as const,
      strategy: "gui_control" as const,
      description: "Reports detected desktop session and safe backend capabilities."
    },
    {
      name: "desktop.screenshot",
      riskLevel: "medium" as const,
      strategy: "gui_control" as const,
      description: "Captures a screenshot into an approved local AgentHost folder."
    },
    {
      name: "desktop.hotkey",
      riskLevel: "medium" as const,
      strategy: "gui_control" as const,
      description: "Sends a desktop hotkey when policy and active-window context allow it."
    },
    {
      name: "desktop.type_text",
      riskLevel: "medium" as const,
      strategy: "gui_control" as const,
      description: "Types text into the active window when policy and safety allow it."
    },
    {
      name: "desktop.click",
      riskLevel: "medium" as const,
      strategy: "gui_control" as const,
      description: "Clicks screen coordinates when policy and active-window context allow it."
    },
    ...["desktop.move_mouse", "desktop.scroll", "desktop.double_click", "desktop.right_click", "desktop.drag"].map((name) => ({
      name,
      riskLevel: "medium" as const,
      strategy: "gui_control" as const,
      description: "Performs a bounded confirmation-gated desktop pointer action on X11."
    })),
    {
      name: "window.list",
      riskLevel: "low" as const,
      strategy: "gui_control" as const,
      description: "Lists visible windows when a safe desktop backend is available."
    },
    {
      name: "window.focus",
      riskLevel: "medium" as const,
      strategy: "gui_control" as const,
      description: "Focuses a window when a safe backend and policy allow it."
    },
    {
      name: "accessibility.get_tree",
      riskLevel: "low" as const,
      strategy: "accessibility" as const,
      description: "Returns a capped, redacted accessibility tree when a safe backend is available."
    },
    {
      name: "accessibility.find_element",
      riskLevel: "low" as const,
      strategy: "accessibility" as const,
      description: "Finds candidate UI elements from accessibility data without acting on them."
    },
    {
      name: "accessibility.inspect_element",
      riskLevel: "low" as const,
      strategy: "accessibility" as const,
      description: "Returns capped, redacted metadata about one resolved accessibility element."
    },
    {
      name: "accessibility.invoke_action",
      riskLevel: "medium" as const,
      strategy: "accessibility" as const,
      description: "Invokes a named AT-SPI accessibility action on one resolved element."
    },
    {
      name: "accessibility.set_value",
      riskLevel: "medium" as const,
      strategy: "accessibility" as const,
      description: "Sets an accessibility element value or text without exposing secret content."
    },
    {
      name: "accessibility.focus_element",
      riskLevel: "medium" as const,
      strategy: "accessibility" as const,
      description: "Focuses one resolved accessibility element without falling back to raw GUI input."
    },
    {
      name: "guide.create_steps",
      riskLevel: "observe" as const,
      strategy: "guide_only" as const,
      description: "Creates structured guide-only steps for unsupported, unknown, sensitive, or unsafe workflows."
    },
    {
      name: "guide.explain_strategy",
      riskLevel: "observe" as const,
      strategy: "guide_only" as const,
      description: "Explains why guide mode is recommended and suggests structured guide steps."
    },
    {
      name: "adapter.list",
      riskLevel: "observe" as const,
      description: "Lists registered optional app adapters."
    },
    {
      name: "adapter.get_capabilities",
      riskLevel: "low" as const,
      description: "Lists capabilities exposed by registered app adapters."
    },
    {
      name: "adapter.detect_for_app",
      riskLevel: "low" as const,
      description: "Detects whether registered app adapters can support a given app."
    }
  ]) {
    registry.registerTool(capability);
  }

  return registry;
}
