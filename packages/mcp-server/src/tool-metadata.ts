import type { ToolCapability, ToolExecutionMetadata } from "@agenthost/core";
import type { AnyAgentHostToolDefinition } from "./tool-runner.js";

const readOnly = (source: "base" | "optional_adapter" = "base"): ToolExecutionMetadata => ({ executionClass: "read_only", externalEffect: false, requiresDryRun: false, requiresConfirmationToken: false, requiresExactTarget: false, source, availability: "available", operationFamily: "observe", operation: "inspect", reversibility: "reversible", sensitivity: "normal", requiredBindings: [], confirmationLevel: "none", verificationKind: "none", cleanupKind: "none" });
const diagnostic = (): ToolExecutionMetadata => ({ ...readOnly(), executionClass: "diagnostic" });
const metadataOnly = (): ToolExecutionMetadata => ({ ...readOnly(), executionClass: "metadata_only" });
const directStateChanging = (source: "base" | "optional_adapter" = "base"): ToolExecutionMetadata => ({ executionClass: "state_changing", externalEffect: false, requiresDryRun: false, requiresConfirmationToken: false, requiresExactTarget: false, source, availability: "available", operationFamily: "state_change", operation: "governed_action", reversibility: "persistent", sensitivity: "normal", requiredBindings: [], confirmationLevel: "none", verificationKind: "tool_result", cleanupKind: "none" });
const confirmedStateChanging = (source: "base" | "optional_adapter" = "base"): ToolExecutionMetadata => ({ ...directStateChanging(source), requiresDryRun: true, requiresConfirmationToken: true, requiresExactTarget: true, requiredBindings: ["target"], confirmationLevel: "standard" });

/*
 * Explicit production declarations. This is an allowlist, not name inference:
 * adding a new tool without adding a declaration fails server startup.
 */
const TOOL_EXECUTION_DECLARATIONS: Record<string, ToolExecutionMetadata> = {};
const declare = (names: string[], metadata: ToolExecutionMetadata): void => { for (const name of names) TOOL_EXECUTION_DECLARATIONS[name] = metadata; };

declare([
  "adapter.list", "adapter.get", "computer.observe_state", "computer.wait_for", "file.exists", "file.list", "file.read", "system.get_info", "system.list_capabilities", "vision.analyze_image", "vision.find_target", "vision.find_text", "window.list"
], readOnly());
declare(["system.check_dependency"], diagnostic());
declare(["agent.status"], readOnly());
declare(["agent.stop", "agent.takeover_begin"], metadataOnly());
declare(["task.create", "task.status", "task.update", "task.update_status", "task.add_event", "task.list"], metadataOnly());
declare([
  "desktop.click", "desktop.hotkey", "desktop.pointer", "desktop.screenshot", "desktop.type_text", "file.copy", "file.ensure_dir", "file.move", "file.write", "shell.run", "window.focus"
], directStateChanging());
declare(["file.delete"], confirmedStateChanging());
declare(["blender.run_python"], confirmedStateChanging("optional_adapter"));
declare(["ssh.run_command"], confirmedStateChanging("optional_adapter"));

export function applyProductionExecutionMetadata(tools: AnyAgentHostToolDefinition[]): AnyAgentHostToolDefinition[] {
  return tools.map((definition) => {
    const declared = TOOL_EXECUTION_DECLARATIONS[definition.name];
    if (declared === undefined) throw new Error(`Missing execution classification metadata for ${definition.name}`);
    return { ...definition, execution: declared };
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
  if (metadata.executionClass === "state_changing" && metadata.requiresExactTarget && !metadata.requiresConfirmationToken) {
    throw new Error(`Exact-target state-changing tool must require confirmation for ${toolName}`);
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
  return {
    ...metadata,
    operationFamily: metadata.operationFamily === "state_change" || metadata.operationFamily === "observe" || metadata.operationFamily === undefined
      ? (stateChanging ? familyHint : metadata.operationFamily ?? "observe")
      : metadata.operationFamily,
    operation: metadata.operation === "governed_action" || metadata.operation === "inspect" || metadata.operation === undefined
      ? (stateChanging ? operationHint : metadata.operation ?? "inspect")
      : metadata.operation,
    reversibility: metadata.reversibility ?? (stateChanging ? "persistent" : "reversible"),
    sensitivity: metadata.sensitivity ?? "normal",
    requiredBindings: metadata.requiredBindings ?? (metadata.requiresExactTarget ? ["target"] : []),
    confirmationLevel: metadata.confirmationLevel ?? (stateChanging ? "standard" : "none"),
    verificationKind: metadata.verificationKind ?? (stateChanging ? "tool_result" : "none"),
    cleanupKind: metadata.cleanupKind ?? "none"
  };
}

export function materializeToolDefinitions(tools: AnyAgentHostToolDefinition[]): AnyAgentHostToolDefinition[] {
  const names = new Set<string>();
  return tools.map((definition) => {
    if (names.has(definition.name)) throw new Error(`Duplicate loaded tool: ${definition.name}`);
    names.add(definition.name);
    const execution = TOOL_EXECUTION_DECLARATIONS[definition.name];
    if (execution === undefined) throw new Error(`Missing execution classification metadata for ${definition.name}`);
    validateToolExecutionMetadata(execution, definition.name);
    return { ...definition, execution: normalizeEffectMetadata(execution, definition.name) };
  });
}

export function toolCapabilities(tools: AnyAgentHostToolDefinition[]): ToolCapability[] {
  return tools.map((tool) => ({
    name: tool.name,
    riskLevel: tool.riskLevel,
    description: tool.description,
    inputSchema: tool.mcpInputSchema,
    execution: normalizeEffectMetadata(TOOL_EXECUTION_DECLARATIONS[tool.name]!, tool.name)
  }));
}
