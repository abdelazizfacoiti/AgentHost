import type { OverlayActivityMode, ToolExecutionClass } from "@agenthost/core";

export const COMPUTER_ACTION_FAMILIES = [
  "browser",
  "computer",
  "desktop",
  "file",
  "shell",
  "vision",
  "window",
  "blender",
  "ssh"
] as const;

const COMPUTER_FAMILIES = new Set<string>(COMPUTER_ACTION_FAMILIES);

export interface ComputerActionClassification {
  computerAction: boolean;
  family: string;
}

export function classifyComputerAction(toolName: string): ComputerActionClassification {
  const family = toolName.split(".", 1)[0] ?? "";
  return { computerAction: COMPUTER_FAMILIES.has(family), family };
}

export function shouldShowActionCard(
  toolName: string,
  executionClass: ToolExecutionClass | undefined,
  mode: OverlayActivityMode
): boolean {
  if (mode === "off") return false;
  if (mode === "on_change") return executionClass === "state_changing";
  return classifyComputerAction(toolName).computerAction || executionClass === "state_changing";
}

export function shouldShowActivityCard(toolName: string, mode: OverlayActivityMode): boolean {
  return mode === "always" && classifyComputerAction(toolName).computerAction;
}
