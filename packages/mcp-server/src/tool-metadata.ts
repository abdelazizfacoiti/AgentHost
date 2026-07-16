import type { ToolCapability, ToolExecutionMetadata, ToolExecutionClass } from "@agenthost/core";
import type { AnyAgentHostToolDefinition } from "./tool-runner.js";

const STATE_ACTIONS = new Set([
  "app_launch", "shell_command", "file_write", "file_delete", "gui_click", "gui_type",
  "accessibility_action", "accessibility_set_value", "accessibility_focus", "browser_action",
  "communication_send", "upload", "system_change"
]);
const KNOWN_TOOL_PREFIXES = ["system.", "forge.", "browser.", "workflow.", "scheduler.", "overlay.", "vision.", "checkpoint.", "guide.", "policy.", "adapter.", "app.", "shell.", "file.", "desktop.", "window.", "accessibility.", "blender.", "strategy."];

function classify(definition: AnyAgentHostToolDefinition): ToolExecutionClass {
  const name = definition.name;
  if (name === "overlay.assistance_step_preview" || name === "overlay.assistance_session_explain" || name === "overlay.assistance_template_validate" || name === "overlay.assistance_template_preview" || name === "overlay.assistance_template_get" || name === "overlay.assistance_template_list") return "read_only";
  if (name === "overlay.assistance_template_save" || name === "overlay.assistance_template_archive" || name === "overlay.assistance_template_instantiate") return "metadata_only";
  if (name.startsWith("overlay.")) return "visual_only";
  if (name.startsWith("workflow.") || name.startsWith("scheduler.")) return "metadata_only";
  if (name === "forge.check_sandbox_support") return "diagnostic";
  if (name.startsWith("forge.")) {
    return /run_sandboxed_tool|dispatch_generated_tool/.test(name) ? "state_changing" : "metadata_only";
  }
  if (name === "system.check_dependency" || name === "forge.check_sandbox_support" || name.startsWith("browser.setup_")) return "diagnostic";
  if (name.startsWith("guide.")) return "metadata_only";
  if (name.startsWith("strategy.")) return name === "strategy.health" || name === "strategy.verify_outcome" ? "diagnostic" : name === "strategy.list" || name === "strategy.get" || name === "strategy.explain_selection" ? "read_only" : "metadata_only";
  if (name.startsWith("vision.") || name.startsWith("checkpoint.")) return "read_only";
  if (name.startsWith("blender.")) return "state_changing";
  if (STATE_ACTIONS.has(definition.safety?.actionType ?? "")) return "state_changing";
  if (definition.preview !== undefined && /open_url|click|fill|type|write|delete|send|reset|generate|restart|focus|invoke|set_value|hotkey|scroll|drag|mouse/.test(name)) return "state_changing";
  if (name.startsWith("system.")) return "read_only";
  return "read_only";
}

function metadataFor(definition: AnyAgentHostToolDefinition): ToolExecutionMetadata {
  if (!KNOWN_TOOL_PREFIXES.some((prefix) => definition.name.startsWith(prefix))) {
    throw new Error(`Missing execution classification metadata for ${definition.name}`);
  }
  const executionClass = classify(definition);
  const stateChanging = executionClass === "state_changing";
  const targetBound = stateChanging && /browser|desktop|window|accessibility|gui|pointer|click|type|focus|scroll|drag|mouse/.test(definition.name);
  return {
    executionClass,
    externalEffect: stateChanging,
    requiresDryRun: stateChanging,
    requiresConfirmationToken: stateChanging,
    requiresExactTarget: targetBound,
    source: definition.name.startsWith("blender.") ? "optional_adapter" : "base",
    availability: "available"
  };
}

export function validateToolExecutionMetadata(metadata: ToolExecutionMetadata, toolName: string): void {
  if (metadata.availability !== "available") throw new Error(`Unavailable tool cannot be registered: ${toolName}`);
  const inertClass = metadata.executionClass === "read_only" || metadata.executionClass === "diagnostic" || metadata.executionClass === "metadata_only" || metadata.executionClass === "inert" || metadata.executionClass === "visual_only";
  if (inertClass && (metadata.externalEffect || metadata.requiresDryRun || metadata.requiresConfirmationToken || metadata.requiresExactTarget)) {
    throw new Error(`Contradictory execution metadata for ${toolName}`);
  }
  if (metadata.executionClass === "state_changing" && !metadata.externalEffect) {
    throw new Error(`State-changing tool must declare externalEffect for ${toolName}`);
  }
  if (metadata.executionClass === "state_changing" && !metadata.requiresDryRun) {
    throw new Error(`State-changing tool must declare requiresDryRun for ${toolName}`);
  }
  if (metadata.source !== "base" && metadata.source !== "optional_adapter") {
    throw new Error(`Unknown tool source for ${toolName}`);
  }
}

export function materializeToolDefinitions(tools: AnyAgentHostToolDefinition[]): AnyAgentHostToolDefinition[] {
  const names = new Set<string>();
  return tools.map((definition) => {
    if (names.has(definition.name)) throw new Error(`Duplicate loaded tool: ${definition.name}`);
    if (!KNOWN_TOOL_PREFIXES.some((prefix) => definition.name.startsWith(prefix))) {
      throw new Error(`Missing execution classification metadata for ${definition.name}`);
    }
    names.add(definition.name);
    const execution = definition.execution ?? metadataFor(definition);
    validateToolExecutionMetadata(execution, definition.name);
    return { ...definition, execution };
  });
}

export function toolCapabilities(tools: AnyAgentHostToolDefinition[]): ToolCapability[] {
  return tools.map((tool) => ({
    name: tool.name,
    riskLevel: tool.riskLevel,
    description: tool.description,
    inputSchema: tool.mcpInputSchema,
    ...(tool.execution === undefined ? {} : { execution: tool.execution })
  }));
}
