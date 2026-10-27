import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { OverlayRenderer } from "../renderer.js";
import { HeadlessOverlayRenderer } from "../headless-renderer.js";
import { OverlayManager } from "../manager.js";

describe("OverlayManager prewarm", () => {
  it("warms the renderer once without creating a card", async () => {
    const warmup = vi.fn(async () => undefined);
    const show = vi.fn();
    const renderer = {
      capabilities: () => ({ renderer: "test" }),
      show,
      update: vi.fn(),
      dismiss: vi.fn(),
      clear: vi.fn(),
      emergencyHide: vi.fn(),
      state: vi.fn(),
      events: vi.fn(),
      warmup
    } as unknown as OverlayRenderer;
    const manager = new OverlayManager(renderer, { sessionId: "test" }, { hideMarkerPath: null });
    expect(await manager.prewarm()).toBe(true);
    expect(warmup).toHaveBeenCalledTimes(1);
    expect(show).not.toHaveBeenCalled();
    await manager.close();
  });

  it("reports unsupported prewarm without failing the manager", async () => {
    const renderer = {
      capabilities: () => ({ renderer: "test" }),
      show: vi.fn(),
      update: vi.fn(),
      dismiss: vi.fn(),
      clear: vi.fn(),
      emergencyHide: vi.fn(),
      state: vi.fn(),
      events: vi.fn()
    } as unknown as OverlayRenderer;
    const manager = new OverlayManager(renderer, { sessionId: "test" }, { hideMarkerPath: null });
    expect(await manager.prewarm()).toBe(false);
    await manager.close();
  });

  it("ignores a stale cross-process hide marker so new cards survive startup", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agenthost-overlay-marker-"));
    const marker = path.join(directory, "overlay.hide");
    const manager = new OverlayManager(new HeadlessOverlayRenderer(), { sessionId: "test" }, { hideMarkerPath: marker });
    try {
      const shown = await manager.showWidget({ widgetId: "card", title: "Card", sensitivity: "public", components: [{ type: "text", text: "Visible" }] });
      expect(shown.ok).toBe(true);
      await writeFile(marker, `${JSON.stringify({ hidden: true, at: new Date(Date.now() - 1_000).toISOString() })}\n`, "utf8");
      expect(await manager.pollEvents("card")).toEqual([]);
      expect((await manager.state()).overlays).toHaveLength(1);
      expect(existsSync(marker)).toBe(false);
    } finally {
      await manager.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
