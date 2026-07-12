import type { WorkflowStepAction, WorkflowStrategy } from "./types.js";

export const WORKFLOW_BLOCKED_ACTIONS = [
  "send", "submit", "post", "pay", "buy", "delete", "archive", "upload", "install", "external_network_send", "credential_access", "private_data_without_grant"
] as const;

export function workflowStrategyForTool(tool: string): WorkflowStrategy {
  if (tool.startsWith("browser.")) return "browser";
  if (tool.startsWith("desktop.")) return tool === "desktop.click" || /mouse|scroll|drag|double_click|right_click/.test(tool) ? "pointer" : "desktop";
  if (tool.startsWith("accessibility.")) return "accessibility";
  if (tool.startsWith("file.")) return "file";
  if (tool.startsWith("shell.")) return "shell";
  if (tool.startsWith("adapter.") || tool.startsWith("app.")) return "app_adapter";
  if (tool.startsWith("guide.")) return "guide";
  if (tool.startsWith("forge.")) return "forge_runtime";
  return "unknown";
}

export function workflowActionForTool(tool: string): WorkflowStepAction {
  if (tool.startsWith("checkpoint.")) return "checkpoint";
  if (tool === "browser.open_url") return "open_url";
  if (tool === "browser.wait_for_state") return "wait_for_state";
  if (tool === "browser.find_element") return "find_element";
  if (tool === "browser.click_element") return "click_element";
  if (tool === "browser.fill_text" || tool === "desktop.type_text" || tool === "accessibility.set_value") return "fill_text_redacted";
  if (tool === "browser.extract_text" || tool === "browser.get_selected_text") return "extract_text_redacted";
  if (tool.startsWith("accessibility.")) return "accessibility_action";
  if (tool.startsWith("desktop.")) return "pointer_action";
  if (tool.startsWith("file.")) return "file_operation";
  if (tool.startsWith("shell.")) return "shell_operation";
  if (tool.startsWith("app.") && /open/.test(tool)) return "open_app";
  if (tool.startsWith("guide.")) return "guide_step";
  if (tool.startsWith("forge.")) return "forge_runtime_action";
  if (tool.startsWith("adapter.") || tool.startsWith("app.")) return "adapter_action";
  return "tool_action";
}

export function isBlockedWorkflowAction(action: WorkflowStepAction, tool: string): string | undefined {
  const candidate = `${action} ${tool}`.toLowerCase();
  return WORKFLOW_BLOCKED_ACTIONS.find((blocked) => candidate.includes(blocked));
}
