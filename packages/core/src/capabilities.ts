import {
  AUTOMATION_STRATEGIES,
  type AppCapability,
  type AutomationStrategy,
  type CapabilityRegistrySnapshot,
  type ToolCapability
} from "./types.js";

export class CapabilityRegistry implements CapabilityRegistrySnapshot {
  readonly #tools = new Map<string, ToolCapability>();
  readonly #appCapabilities = new Map<string, AppCapability>();

  registerTool(capability: ToolCapability): void {
    if (this.#tools.has(capability.name)) {
      throw new Error(`Tool capability is already registered: ${capability.name}`);
    }

    this.#tools.set(capability.name, { ...capability });
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
