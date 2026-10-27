import { describe, expect, it, vi } from "vitest";
import { toolFailure, toolSuccess, type OverlayWidget } from "@agenthost/core";
import type { OverlayManager } from "@agenthost/app-overlay";
import { ToolActionOverlay } from "../action-overlay.js";

function fakeManager(capabilitiesVisible = true) {
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
    capabilities: vi.fn(() => ({ visible: capabilitiesVisible, supported: capabilitiesVisible })),
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
    const overlay = new ToolActionOverlay(fake.manager, { widgetId: "action-card", minDisplayMs: 0, now: () => 1_000 });
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
    const overlay = new ToolActionOverlay(fake.manager, { widgetId: "action-card", minDisplayMs: 0, now: () => 1_000 });
    const waiting = await overlay.begin({ tool: "file.write", summary: "Write file", riskLevel: "medium" });
    await waiting.finish(toolFailure({
      tool: "file.write",
      riskLevel: "medium",
      preview: true,
      error: { code: "confirmation_required", message: "An operator must confirm the prepared preview." },
      observations: ["No action was executed."]
    }));
    expect(badge(fake.updated.at(-1)!)).toBe("Waiting for approval");
    expect(fake.updated.at(-1)!.interaction).toMatchObject({ dismissible: true });
    expect(fake.updated.at(-1)!.components).toContainEqual({ type: "button", label: "Dismiss", event: "dismissed" });
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

  it("bounds the visible-card wait and records a timed-out render", async () => {
    const fake = fakeManager();
    let resolveShow: ((value: { ok: boolean; errors: string[] }) => void) | undefined;
    vi.mocked(fake.manager.showWidget).mockImplementationOnce(() => new Promise((resolve) => {
      resolveShow = resolve;
    }));
    const overlay = new ToolActionOverlay(fake.manager, { widgetId: "action-card", minDisplayMs: 0, showTimeoutMs: 20 });
    const handle = await overlay.begin({ tool: "computer.observe_state", summary: "Observe computer state", riskLevel: "observe" });
    expect(overlay.snapshot()).toMatchObject({ started: false, showTimedOut: true });
    resolveShow?.({ ok: true, errors: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(overlay.snapshot()).toMatchObject({ started: true, showTimedOut: false });
    await handle.finish(toolSuccess({ tool: "computer.observe_state", riskLevel: "observe", data: {} }));
    await overlay.close();
  });

  it("reports a headless fallback card as started but not visible", async () => {
    const fake = fakeManager(false);
    const overlay = new ToolActionOverlay(fake.manager, { widgetId: "action-card", minDisplayMs: 0 });
    const handle = await overlay.begin({ tool: "computer.observe_state", summary: "Observe computer state", riskLevel: "observe" });
    expect(overlay.snapshot()).toMatchObject({ started: true, visible: false });
    await handle.finish(toolSuccess({ tool: "computer.observe_state", riskLevel: "observe", data: {} }));
    await overlay.close();
  });

  it("holds a fast action's terminal state for the minimum display window", async () => {
    vi.useFakeTimers();
    const fake = fakeManager();
    const overlay = new ToolActionOverlay(fake.manager, { widgetId: "action-card", minDisplayMs: 400, now: () => Date.now() });
    const handle = await overlay.begin({ tool: "file.write", summary: "Write file", riskLevel: "medium" });
    const finished = handle.finish(toolSuccess({ tool: "file.write", riskLevel: "medium", data: { wrote: true } }));
    await vi.advanceTimersByTimeAsync(399);
    expect(fake.updated).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await finished;
    expect(badge(fake.updated.at(-1)!)).toBe("Done");
    await overlay.close();
    vi.useRealTimers();
  });

  it("auto-hides non-persistent terminal cards", async () => {
    vi.useFakeTimers();
    const fake = fakeManager();
    const overlay = new ToolActionOverlay(fake.manager, { widgetId: "action-card", minDisplayMs: 0, persistent: false, autoHideMs: 2_000, now: () => Date.now() });
    const handle = await overlay.begin({ tool: "file.write", summary: "Write file", riskLevel: "medium" });
    await handle.finish(toolSuccess({ tool: "file.write", riskLevel: "medium", data: { wrote: true } }));
    await vi.advanceTimersByTimeAsync(2_100);
    expect(fake.dismiss).toHaveBeenCalledWith("action-card");
    await overlay.close();
    vi.useRealTimers();
  });

  it("keeps approval waits visible until the operator acts", async () => {
    vi.useFakeTimers();
    const fake = fakeManager();
    const overlay = new ToolActionOverlay(fake.manager, { widgetId: "action-card", minDisplayMs: 0, persistent: false, autoHideMs: 1_000, now: () => Date.now() });
    const handle = await overlay.begin({ tool: "file.write", summary: "Write file", riskLevel: "medium" });
    await handle.finish(toolFailure({
      tool: "file.write",
      riskLevel: "medium",
      preview: true,
      error: { code: "confirmation_required", message: "An operator must confirm the prepared preview." },
      observations: ["No action was executed."]
    }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fake.dismiss).not.toHaveBeenCalled();
    await overlay.close();
    vi.useRealTimers();
  });

  it("applies operator pause, resume, stop, and close from the card", async () => {
    vi.useFakeTimers();
    const fake = fakeManager();
    const events: Array<{ overlayId: string; event: string }> = [];
    vi.mocked(fake.manager.pollEvents).mockImplementation(async () => events.splice(0, events.length) as never);
    const onPause = vi.fn(async () => undefined);
    const onResume = vi.fn(async () => undefined);
    const onStop = vi.fn(async () => undefined);
    const overlay = new ToolActionOverlay(fake.manager, {
      widgetId: "action-card",
      eventPollMs: 100,
      now: () => Date.now(),
      onPause,
      onResume,
      onStop
    });
    const handle = await overlay.begin({ tool: "file.write", summary: "Write file", riskLevel: "medium" });

    events.push({ overlayId: "action-card", event: "pause" });
    await vi.advanceTimersByTimeAsync(150);
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(badge(fake.updated.at(-1)!)).toBe("Paused");
    expect(fake.updated.at(-1)!.components).toContainEqual({ type: "button", label: "Resume", event: "resume" });

    events.push({ overlayId: "action-card", event: "resume" });
    await vi.advanceTimersByTimeAsync(150);
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(badge(fake.updated.at(-1)!)).toBe("Running");

    events.push({ overlayId: "action-card", event: "emergency_stop_requested" });
    await vi.advanceTimersByTimeAsync(150);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(badge(fake.updated.at(-1)!)).toBe("Halted");
    expect(fake.updated.at(-1)!.components).toContainEqual({ type: "button", label: "Dismiss", event: "dismissed" });

    events.push({ overlayId: "action-card", event: "dismissed" });
    await vi.advanceTimersByTimeAsync(150);
    expect(fake.dismiss).toHaveBeenCalledWith("action-card");
    const shown = fake.shown.length;
    await handle.finish(toolSuccess({ tool: "file.write", riskLevel: "medium", data: { wrote: true } }));
    await overlay.refresh();
    expect(fake.shown).toHaveLength(shown);

    await overlay.close();
    vi.useRealTimers();
  });

  it("does not report a halt when the stop flag could not be written", async () => {
    vi.useFakeTimers();
    const fake = fakeManager();
    const events: Array<{ overlayId: string; event: string }> = [];
    vi.mocked(fake.manager.pollEvents).mockImplementation(async () => events.splice(0, events.length) as never);
    const overlay = new ToolActionOverlay(fake.manager, {
      widgetId: "action-card",
      eventPollMs: 100,
      now: () => Date.now(),
      onStop: async () => { throw new Error("disk full"); }
    });
    await overlay.begin({ tool: "file.write", summary: "Write file", riskLevel: "medium" });
    events.push({ overlayId: "action-card", event: "emergency_stop_requested" });
    await vi.advanceTimersByTimeAsync(150);
    expect(badge(fake.updated.at(-1)!)).toBe("Running");
    expect(fake.updated.at(-1)!.components).toContainEqual({
      type: "warning",
      text: "Stop request failed. State-changing actions may still run."
    });
    await overlay.close();
    vi.useRealTimers();
  });
});
