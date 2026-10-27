import { describe, expect, it } from "vitest";
import { classifyComputerAction, shouldShowActionCard, shouldShowActivityCard } from "../activity.js";
import { createComputerTools } from "../tools/computer.js";
import { createDesktopTools } from "../tools/desktop.js";
import { createFileTools } from "../tools/file.js";
import { createShellTools } from "../tools/shell.js";
import { createVisionTools } from "../tools/vision.js";
import { createWindowTools } from "../tools/window.js";

describe("overlay activity classification", () => {
  it("recognizes computer-action families and excludes control-plane metadata", () => {
    for (const tool of ["computer.observe_state", "desktop.screenshot", "window.list", "vision.find_text", "file.read", "shell.run", "browser.navigate", "blender.run_python", "ssh.run_command"]) {
      expect(classifyComputerAction(tool).computerAction).toBe(true);
    }
    for (const tool of ["task.create", "agent.stop", "system.get_info", "adapter.list", "policy.list", "unknown"]) {
      expect(classifyComputerAction(tool).computerAction).toBe(false);
    }
  });

  it("shows a card for every registered computer-action family in always mode", () => {
    const tools = [
      ...createComputerTools(),
      ...createDesktopTools(),
      ...createWindowTools(),
      ...createVisionTools(),
      ...createFileTools(),
      ...createShellTools()
    ];
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(shouldShowActionCard(tool.name, tool.execution?.executionClass, "always"), tool.name).toBe(true);
    }
    for (const family of ["computer", "desktop", "window", "vision", "file", "shell"]) {
      expect(tools.some((tool) => tool.name.startsWith(`${family}.`)), family).toBe(true);
    }
  });

  it("selects action-card triggers by mode", () => {
    expect(shouldShowActionCard("computer.observe_state", "read_only", "always")).toBe(true);
    expect(shouldShowActionCard("task.create", "metadata_only", "always")).toBe(false);
    expect(shouldShowActionCard("file.write", "state_changing", "always")).toBe(true);
    expect(shouldShowActionCard("computer.observe_state", "read_only", "on_change")).toBe(false);
    expect(shouldShowActionCard("file.write", "state_changing", "on_change")).toBe(true);
    expect(shouldShowActionCard("file.write", "state_changing", "off")).toBe(false);
    expect(shouldShowActivityCard("computer.observe_state", "always")).toBe(true);
    expect(shouldShowActivityCard("computer.observe_state", "on_change")).toBe(false);
    expect(shouldShowActivityCard("computer.observe_state", "off")).toBe(false);
  });
});
