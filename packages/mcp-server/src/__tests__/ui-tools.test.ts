import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { getDefaultPolicy } from "@agenthost/core";
import type { AgentHostMcpContext } from "../context.js";
import { createUiTools } from "../tools/ui.js";

function makeContext(linux: Record<string, unknown>): AgentHostMcpContext {
  const home = "/tmp/agenthost-ui-tools";
  return {
    sessionId: "ui-tools",
    config: { agentHostDir: home, configPath: path.join(home, "config.json"), logFile: path.join(home, "logs", "audit.jsonl") },
    policy: getDefaultPolicy(),
    grants: { listActiveGrants: () => [] },
    linux
  } as unknown as AgentHostMcpContext;
}

const tool = (name: string) => createUiTools().find((entry) => entry.name === name)!;

describe("ui tools", () => {
  it("targets the active window's app when no scope is given", async () => {
    const findAccessibilityElement = vi.fn(async () => ({ supported: true, backend: "atspi", candidates: [{ elementId: "1:2/3", role: "push button", name: "Appliquer" }], reason: "ok" }));
    const context = makeContext({
      getActiveWindow: vi.fn(async () => ({ supported: true, backend: "xdotool", activeWindow: { windowId: "58720279", pid: 10243, appName: "firefox" }, reason: "ok" })),
      findAccessibilityElement
    });
    const result = await tool("ui.find").handler({ query: "Appliquer", role: "push button" }, context);
    expect(result.ok).toBe(true);
    expect(findAccessibilityElement).toHaveBeenCalledWith({ pid: 10243, appName: "firefox", query: "Appliquer", role: "push button", limit: 8 });
  });

  it("explains the pixel fallback when an app exposes no accessibility tree", async () => {
    const context = makeContext({
      getAccessibilityTree: vi.fn(async () => ({ supported: false, backend: "atspi", nodeCount: 0, truncated: false, redacted: false, reason: "App exposes no accessibility tree." }))
    });
    const result = await tool("ui.tree").handler({ appName: "blender" }, context);
    expect(result).toMatchObject({ ok: false, error: { code: "accessibility_unavailable" } });
    expect(result.observations?.join(" ")).toContain("desktop.click");
  });

  it("reports ambiguous matches instead of pressing a guess", async () => {
    const context = makeContext({
      invokeAccessibilityAction: vi.fn(async () => ({ supported: true, backend: "atspi", matched: true, ambiguous: true, performed: false, redacted: false, reason: "Several elements match." }))
    });
    const result = await tool("ui.activate").handler({ appName: "firefox", query: "OK" }, context);
    expect(result).toMatchObject({ ok: false, error: { code: "ui_element_ambiguous" } });
  });

  it("keeps credential managers blocked", async () => {
    const getAccessibilityTree = vi.fn();
    const result = await tool("ui.tree").handler({ appName: "keepassxc" }, makeContext({ getAccessibilityTree }));
    expect(result.ok).toBe(false);
    expect(getAccessibilityTree).not.toHaveBeenCalled();
  });
});
