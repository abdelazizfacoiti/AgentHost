import { describe, expect, it, vi } from "vitest";
import { announcePointAction } from "../action-announce.js";

describe("announcePointAction", () => {
  it("resolves silently without an overlay", async () => {
    await expect(announcePointAction({ overlay: undefined } as never, 10, 20)).resolves.toBeUndefined();
  });

  it("shows a public highlight at the requested point", async () => {
    const showPrimitive = vi.fn().mockResolvedValue({ ok: true, overlay: {}, errors: [] });
    await announcePointAction({ overlay: { showPrimitive } } as never, 520, 340);
    expect(showPrimitive).toHaveBeenCalledOnce();
    expect(showPrimitive.mock.calls[0]?.[0]).toMatchObject({
      type: "highlight",
      sensitivity: "public",
      ttlMs: 1200,
      target: { kind: "screen_point", point: { x: 520, y: 340 } }
    });
  });

  it("never rejects when the renderer fails", async () => {
    const showPrimitive = vi.fn().mockRejectedValue(new Error("headless"));
    await expect(announcePointAction({ overlay: { showPrimitive } } as never, 1, 2)).resolves.toBeUndefined();
  });

  it("ignores invalid coordinates without touching the overlay", async () => {
    const showPrimitive = vi.fn();
    await announcePointAction({ overlay: { showPrimitive } } as never, -5, 20);
    expect(showPrimitive).not.toHaveBeenCalled();
  });
});
