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
    }
  ]) {
    registry.registerTool(capability);
  }

  return registry;
}
