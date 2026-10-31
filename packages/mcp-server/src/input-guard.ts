import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const INPUT_TOOLS = new Set(["desktop.click", "desktop.pointer", "desktop.hotkey", "desktop.type_text", "ui.activate", "ui.set_text"]);

export function inputGuardPath(agentHostDir: string): string {
  return path.join(agentHostDir, "run", "input-active");
}

export function injectsInput(toolName: string): boolean {
  return INPUT_TOOLS.has(toolName);
}

/**
 * Refreshes the marker the overlay renderer checks before honoring a
 * Pause/Resume/Stop press: presses that land while AgentHost is injecting
 * input are the agent's, not the operator's. The marker lives in the
 * control plane (run/), which agent file and shell tools cannot write.
 */
export async function markAgentInput(agentHostDir: string): Promise<void> {
  const target = inputGuardPath(agentHostDir);
  try {
    await writeFile(target, "", { mode: 0o600 });
  } catch {
    try {
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, "", { mode: 0o600 });
    } catch {
      /* Best effort: the renderer still requires pointer activation. */
    }
  }
}
