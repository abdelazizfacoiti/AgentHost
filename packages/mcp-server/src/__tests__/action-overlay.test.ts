import { describe, expect, it, vi } from "vitest";
import { toolFailure, toolSuccess, type OverlayWidget } from "@agenthost/core";
import type { OverlayManager } from "@agenthost/app-overlay";
import { ToolActionOverlay } from "../action-overlay.js";

function fakeManager() {
  let visible = false;
  const shown: OverlayWidget[] = [];
  const updated: OverlayWidget[] = [];
  const showWidget = vi.fn(async (widget: OverlayWidget) => {
    visible = true;
    shown.push(widget);
    return { ok: true, errors: [] };
  });
  const updateWidget = vi.fn(async (widget: OverlayWidget) => {
    updated.push(widget);
    return visible ? { ok: true, reason: "overlay_widget_updated", acknowledged: true } : { ok: false, reason: "overlay_not_found" };
  });
  const dismiss = vi.fn(async () => {
    visible = false;
    return { ok: true, reason: "dismissed", acknowledged: true };
  });
  const manager = {
    showWidget,
    updateWidget,
    dismiss,
    pollEvents: vi.fn(async () => [])
  } as unknown as OverlayManager;
  return { manager, shown, updated, dismiss };
}

function badge(widget: OverlayWidget): string | undefined {
  const component = widget.components.find((entry) => entry.type === "status_badge");
  return component?.type === "status_badge" ? component.text : undefined;
}

describe("automatic action overlay", () => {
  it("shows a persistent public card and completes it in place", async () => {
    const fake = fakeManager();
    const overlay = new ToolActionOverlay(fake.manager, { widgetId: "action-card", now: () => 1_000 });
    const handle = await overlay.begin({ tool: "shell.run", summary: "Run ls with 0 argument(s)", riskLevel: "high" });
    expect(fake.shown).toHaveLength(1);
    expect(fake.shown[0]).toMatchObject({
      widgetId: "action-card",
      title: "AgentHost · shell.run",
      sensitivity: "public",
      persistent: true,
      placement: "top_right"
    });
    expect(badge(fake.shown[0]!)).toBe("Running");

    await handle.finish(toolSuccess({ tool: "shell.run", riskLevel: "high", data: { exitCode: 0 } }));
    expect(fake.updated).toHaveLength(1);
    expect(badge(fake.updated[0]!)).toBe("Done");
    expect(fake.updated[0]!.components.find((entry) => entry.type === "key_value" && entry.key === "Risk")).toMatchObject({ value: "HIGH" });
    await overlay.close();
  });

  it("surfaces approval waits and failures without leaking secrets", async () => {
    const fake = fakeManager();
    const overlay = new ToolActionOverlay(fake.manager, { widgetId: "action-card", now: () => 1_000 });
    const waiting = await overlay.begin({ tool: "file.write", summary: "Write file", riskLevel: "medium" });
    await waiting.finish(toolFailure({
      tool: "file.write",
      riskLevel: "medium",
      preview: true,
      error: { code: "confirmation_required", message: "An operator must confirm the prepared preview." },
      observations: ["No action was executed."]
    }));
    expect(badge(fake.updated.at(-1)!)).toBe("Waiting for approval");
    expect(JSON.stringify(fake.updated.at(-1))).not.toContain("conf_");

    const failed = await overlay.begin({ tool: "desktop.click", summary: "Click left at (10, 20)", riskLevel: "medium" });
    await failed.finish(toolFailure({
      tool: "desktop.click",
      riskLevel: "medium",
      error: { code: "active_window_mismatch", message: "token=super-secret-value" },
      observations: []
    }));
    expect(badge(fake.updated.at(-1)!)).toBe("Failed");
    expect(JSON.stringify(fake.updated.at(-1))).not.toContain("super-secret-value");
    await overlay.close();
  });

  it("auto-hides non-persistent terminal cards", async () => {
    vi.useFakeTimers();
    const fake = fakeManager();
    const overlay = new ToolActionOverlay(fake.manager, { widgetId: "action-card", persistent: false, autoHideMs: 2_000, now: () => Date.now() });
    const handle = await overlay.begin({ tool: "file.write", summary: "Write file", riskLevel: "medium" });
    await handle.finish(toolSuccess({ tool: "file.write", riskLevel: "medium", data: { wrote: true } }));
    await vi.advanceTimersByTimeAsync(2_100);
    expect(fake.dismiss).toHaveBeenCalledWith("action-card");
    await overlay.close();
    vi.useRealTimers();
  });
});
