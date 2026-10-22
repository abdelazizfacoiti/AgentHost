import { describe, expect, it } from "vitest";
import { HeadlessOverlayRenderer } from "../headless-renderer.js";
import { VisualSurfaceCoordinator } from "../visual-surface-coordinator.js";
import type { VisualSurfaceProtocolEnvelope, OverlayWidget } from "@agenthost/core";

const surface = (id: string): VisualSurfaceProtocolEnvelope => ({ schemaVersion: 1, surfaceId: id, ownerSessionId: "surface-owner", source: "assistance", type: "instruction_card", content: { title: "Safe", components: [{ type: "text", text: "Visual only" }] }, state: "draft", placement: "top_left", priority: "normal", interactionMode: "click_through", approvedIntents: ["acknowledge"], ttlMs: 30_000, sensitivity: "public", screenshotBehavior: "hide", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30_000).toISOString() });

describe("visual surface coordinator", () => {
  it("keeps headless visible state honest and owner-bound", async () => {
    const coordinator = new VisualSurfaceCoordinator(new HeadlessOverlayRenderer(), { sessionId: "surface-owner" });
    const result = await coordinator.showSurface(surface("surface_one"));
    expect(result.ok).toBe(true);
    expect(result.visible).toBe(false);
    expect((await coordinator.diagnostics()).capabilities.visible).toBe(false);
    const foreign = await coordinator.showSurface({ ...surface("surface_two"), ownerSessionId: "other" });
    expect(foreign.ok).toBe(false);
    await coordinator.close();
  });
  it("suppresses and restores all projected surfaces without actions", async () => {
    const coordinator = new VisualSurfaceCoordinator(new HeadlessOverlayRenderer(), { sessionId: "surface-owner" });
    await coordinator.showSurface(surface("surface_one"));
    await coordinator.withScreenshotSuppressed(async () => expect((await coordinator.state()).overlays).toHaveLength(0));
    expect((await coordinator.state()).overlays).toHaveLength(1);
    await coordinator.close();
  });
  it("blocks direct widget shows and updates during screenshot suppression", async () => {
    const coordinator = new VisualSurfaceCoordinator(new HeadlessOverlayRenderer(), { sessionId: "surface-owner" });
    await coordinator.withScreenshotSuppressed(async () => {
      const widget: OverlayWidget = {
        widgetId: "suppressed-widget",
        title: "Action",
        components: [{ type: "text", text: "Running" }],
        sensitivity: "public"
      };
      const shown = await coordinator.showWidget(widget);
      expect(shown.ok).toBe(false);
      const updated = await coordinator.updateWidget(widget);
      expect(updated.ok).toBe(false);
      expect((await coordinator.state()).overlays).toHaveLength(0);
    });
    await coordinator.close();
  });
  it("stores only redacted surface content", async () => {
    const coordinator = new VisualSurfaceCoordinator(new HeadlessOverlayRenderer(), { sessionId: "surface-owner" });
    await coordinator.showSurface({ ...surface("redacted"), content: { title: "Email me@example.com", components: [{ type: "text", text: "token=abc123456789012345678901234567890" }] } });
    expect(JSON.stringify(coordinator.surfaceSnapshot())).not.toContain("me@example.com");
    await coordinator.close();
  });
  it("projects legacy widget calls into the unified surface registry", async () => {
    const coordinator = new VisualSurfaceCoordinator(new HeadlessOverlayRenderer(), { sessionId: "surface-owner" });
    const widget: OverlayWidget = {
      title: "Legacy visual state",
      components: [{ type: "text", text: "Email me@example.com" }],
      sensitivity: "public",
      interaction: { interactive: false, focus: "never", dismissible: false, allowedEvents: [] }
    };
    const shown = await coordinator.showWidget(widget);
    expect(shown.ok).toBe(true);
    expect(coordinator.surfaceSnapshot()).toHaveLength(1);
    expect(JSON.stringify(coordinator.surfaceSnapshot())).not.toContain("me@example.com");
    await coordinator.dismiss(shown.overlay!.overlayId);
    expect(coordinator.surfaceSnapshot()).toHaveLength(0);
    await coordinator.close();
  });
});
