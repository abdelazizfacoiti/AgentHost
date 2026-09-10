import { describe, expect, it, vi } from "vitest";
import { redactOverlayText, validateOverlayAnimation, validateOverlayWidget, type OverlayTargetBinding, type OverlayWidget } from "@agenthost/core";
import { HeadlessOverlayRenderer } from "../headless-renderer.js";
import { OverlayManager } from "../manager.js";
import { probeLinuxOverlay } from "../linux-probe.js";

const target: OverlayTargetBinding = { kind: "screen_point", point: { x: 20, y: 30 }, trusted: true, expiresAt: new Date(Date.now() + 20_000).toISOString() };

describe("overlay foundation", () => {
  it("reports deterministic headless capabilities and lifecycle", async () => {
    const manager = new OverlayManager(new HeadlessOverlayRenderer(), { sessionId: "overlay-test" });
    expect((await manager.capabilities()).rendererStatus).toBe("headless");
    const shown = await manager.showPrimitive({ type: "pointer", target, sensitivity: "public", ttlMs: 10_000 });
    expect(shown.ok).toBe(true);
    expect((await manager.state()).overlays).toHaveLength(1);
    expect((await manager.dismiss(shown.overlay!.overlayId)).ok).toBe(true);
    expect((await manager.state()).overlays).toHaveLength(0);
  });

  it("sweeps expired overlays without state polling", async () => {
    vi.useFakeTimers();
    try {
      class TrackingRenderer extends HeadlessOverlayRenderer {
        dismissed: string[] = [];
        override dismiss(overlayId: string) { this.dismissed.push(overlayId); return super.dismiss(overlayId); }
      }
      const renderer = new TrackingRenderer();
      const manager = new OverlayManager(renderer, { sessionId: "overlay-sweep-test" });
      try {
        const shown = await manager.showPrimitive({ type: "tooltip", text: "short-lived", sensitivity: "public", ttlMs: 1000 });
        expect(shown.ok).toBe(true);
        await vi.advanceTimersByTimeAsync(6000);
        expect(renderer.dismissed).toContain(shown.overlay!.overlayId);
      } finally { await manager.close(); }
    } finally { vi.useRealTimers(); }
  });

  it("expires overlays and emergency hide clears all", async () => {
    const manager = new OverlayManager(new HeadlessOverlayRenderer(), { sessionId: "overlay-test" });
    const shown = await manager.showPrimitive({ type: "highlight", target, sensitivity: "public", ttlMs: 1000 });
    expect(shown.ok).toBe(true);
    await manager.emergencyHide();
    expect((await manager.state()).overlays).toHaveLength(0);
    expect((await manager.state()).emergencyHidden).toBe(true);
  });

  it("rejects secret/raw markup and unsafe motion", () => {
    expect(redactOverlayText("password=secret", "secret").errors).toContain("overlay_secret_content_blocked");
    expect(redactOverlayText("<script>alert(1)</script>", "public").errors).toContain("overlay_unsafe_content_blocked");
    expect(validateOverlayAnimation({ kind: "pulse", durationMs: 1000 }).some((item) => item.includes("infinite"))).toBe(true);
    const widget: OverlayWidget = { title: "Unsafe", sensitivity: "public", components: [{ type: "text", text: "<div>bad</div>" }] };
    expect(validateOverlayWidget(widget)).toContain("overlay_unsafe_content_blocked");
  });

  it("rejects stale or unresolved grounded targets", async () => {
    const manager = new OverlayManager(new HeadlessOverlayRenderer(), { sessionId: "overlay-test" });
    const stale = { ...target, expiresAt: new Date(Date.now() - 1).toISOString() };
    expect((await manager.showPrimitive({ type: "pointer", target: stale, sensitivity: "public" })).errors).toContain("overlay_target_expired");
    const unresolved = await manager.showPrimitive({ type: "pointer", target, sensitivity: "public" }, async () => ({ ok: false, reason: "target_changed" }));
    expect(unresolved.errors).toContain("target_changed");
  });

  it("does not register overlay state before renderer acknowledgement", async () => {
    class NoAckRenderer extends HeadlessOverlayRenderer {
      override show() { return { ok: false, reason: "overlay_render_not_acknowledged", acknowledged: false }; }
    }
    const manager = new OverlayManager(new NoAckRenderer(), { sessionId: "overlay-test" });
    const result = await manager.showPrimitive({ type: "pointer", target, sensitivity: "public" });
    expect(result.ok).toBe(false);
    expect((await manager.state()).overlays).toHaveLength(0);
  });

  it("probes X11, Wayland, and headless without opening windows", () => {
    expect(probeLinuxOverlay({ XDG_SESSION_TYPE: "x11", DISPLAY: ":0" }).sessionType).toBe("x11");
    expect(probeLinuxOverlay({ XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" }).sessionType).toBe("wayland");
    expect(probeLinuxOverlay({}).displayAvailable).toBe(false);
  });
});
