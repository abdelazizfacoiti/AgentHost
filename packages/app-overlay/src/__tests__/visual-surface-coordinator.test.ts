import { describe, expect, it } from "vitest";
import { HeadlessOverlayRenderer } from "../headless-renderer.js";
import { VisualSurfaceCoordinator } from "../visual-surface-coordinator.js";
import type { VisualSurfaceProtocolEnvelope } from "@agenthost/core";

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
  it("stores only redacted surface content", async () => {
    const coordinator = new VisualSurfaceCoordinator(new HeadlessOverlayRenderer(), { sessionId: "surface-owner" });
    await coordinator.showSurface({ ...surface("redacted"), content: { title: "Email me@example.com", components: [{ type: "text", text: "token=abc123456789012345678901234567890" }] } });
    expect(JSON.stringify(coordinator.surfaceSnapshot())).not.toContain("me@example.com");
    await coordinator.close();
  });
});
