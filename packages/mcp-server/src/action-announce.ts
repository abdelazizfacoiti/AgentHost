import type { AgentHostMcpContext } from "./context.js";

const HIGHLIGHT_TTL_MS = 1_200;

function validCoord(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100_000
    ? value
    : undefined;
}

/**
 * Best-effort spatial highlight for point actions (click, move, drag target).
 *
 * Fire-and-forget and visual-only: it never moves the pointer, never carries
 * confirmation semantics, and never rejects. Coordinates are public geometry;
 * no text, titles, or secrets are included. Headless renderers, out-of-bounds
 * points, and screenshot-suppression windows resolve to a silent no-op so the
 * underlying action is never delayed by narration.
 *
 * Callers should start the announcement and run the real backend call
 * concurrently, awaiting the announcement afterwards (it is already settled
 * by then), so narration adds no latency to the critical path.
 */
export function announcePointAction(
  context: AgentHostMcpContext,
  x: unknown,
  y: unknown
): Promise<void> {
  const px = validCoord(x);
  const py = validCoord(y);
  const overlay = context.overlay;
  if (px === undefined || py === undefined || overlay === undefined) {
    return Promise.resolve();
  }
  const expiresAt = new Date(Date.now() + 10_000).toISOString();
  return (async () => {
    try {
      await overlay.showPrimitive({
        type: "highlight",
        target: { kind: "screen_point", point: { x: px, y: py }, trusted: true as const, expiresAt },
        sensitivity: "public",
        ttlMs: HIGHLIGHT_TTL_MS
      });
    } catch {
      /* Narration never changes the action result. */
    }
  })();
}
