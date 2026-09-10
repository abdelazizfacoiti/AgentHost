import { randomUUID } from "node:crypto";
import type { OverlayManager } from "@agenthost/app-overlay";

export interface GuidePresentStep {
  title: string;
  instruction: string;
  target?: { kind: "screen_point"; point: { x: number; y: number }; displayId?: string | undefined } | undefined;
}

function screenPointBinding(point: { x: number; y: number }, ttlMs: number): { kind: "screen_point"; point: { x: number; y: number }; trusted: true; expiresAt: string } {
  return { kind: "screen_point", point: { x: point.x, y: point.y }, trusted: true, expiresAt: new Date(Date.now() + ttlMs).toISOString() };
}

export interface VisualGuide {
  guideId: string;
  ownerSessionId: string;
  title: string;
  steps: GuidePresentStep[];
  currentIndex: number;
  overlayIds: string[];
  createdAt: string;
  expiresAt: string;
}

const GUIDE_TTL_MS = 10 * 60_000;

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Ephemeral visual guides: pretty checklist + highlight + tooltip in one call..restart-safe: none — guides are live UI, not records. */
export class GuideOverlayStore {
  readonly #guides = new Map<string, VisualGuide>();

  sweep(): void {
    const now = Date.now();
    for (const [id, guide] of this.#guides) {
      if (Date.parse(guide.expiresAt) <= now) this.#guides.delete(id);
    }
  }

  get(guideId: string, ownerSessionId: string): VisualGuide | undefined {
    this.sweep();
    const guide = this.#guides.get(guideId);
    return guide !== undefined && guide.ownerSessionId === ownerSessionId ? guide : undefined;
  }

  async present(manager: OverlayManager, ownerSessionId: string, title: string, steps: GuidePresentStep[]): Promise<VisualGuide> {
    this.sweep();
    const cleanTitle = boundedText(title, 120) ?? "Guide";
    const cleanSteps = steps.slice(0, 20).map((step) => ({
      title: boundedText(step.title, 120) ?? "Step",
      instruction: boundedText(step.instruction, 500) ?? "",
      ...(step.target?.kind === "screen_point"
        && Number.isInteger(step.target.point.x) && Number.isInteger(step.target.point.y)
        && step.target.point.x >= 0 && step.target.point.y >= 0
        ? { target: { kind: "screen_point" as const, point: { x: step.target.point.x, y: step.target.point.y } } }
        : {})
    }));
    if (cleanSteps.length === 0) throw new Error("guide_empty:Provide at least one step.");
    const guideId = `guide_${randomUUID()}`;
    const created: VisualGuide = {
      guideId, ownerSessionId, title: cleanTitle, steps: cleanSteps, currentIndex: 0,
      overlayIds: [], createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + GUIDE_TTL_MS).toISOString()
    };
    const shown: string[] = [];
    try {
      const checklist = await manager.showWidget({
        title: cleanTitle,
        components: [
          { type: "text", text: `Step 1 of ${cleanSteps.length}: ${cleanSteps[0]!.title}` },
          { type: "checklist", items: cleanSteps.map((step, index) => ({ label: step.title, checked: index === 0 })) },
          { type: "progress", value: 0, label: `0/${cleanSteps.length}` }
        ],
        sensitivity: "public",
        ttlMs: GUIDE_TTL_MS
      });
      if (!checklist.ok || checklist.overlay === undefined) throw new Error(checklist.errors[0] ?? "guide_render_failed");
      shown.push(checklist.overlay.overlayId);
      const first = cleanSteps[0]!;
      if (first.target !== undefined) {
        const highlight = await manager.showPrimitive({
          type: "highlight",
          target: screenPointBinding(first.target.point, GUIDE_TTL_MS),
          sensitivity: "public",
          ttlMs: GUIDE_TTL_MS
        });
        if (highlight.ok && highlight.overlay !== undefined) shown.push(highlight.overlay.overlayId);
        const tooltip = await manager.showPrimitive({
          type: "tooltip",
          text: first.instruction.slice(0, 300),
          target: screenPointBinding(first.target.point, GUIDE_TTL_MS),
          sensitivity: "public",
          ttlMs: GUIDE_TTL_MS
        });
        if (tooltip.ok && tooltip.overlay !== undefined) shown.push(tooltip.overlay.overlayId);
      } else if (first.instruction.length > 0) {
        const tooltip = await manager.showPrimitive({
          type: "tooltip",
          text: first.instruction.slice(0, 300),
          sensitivity: "public",
          ttlMs: GUIDE_TTL_MS
        });
        if (tooltip.ok && tooltip.overlay !== undefined) shown.push(tooltip.overlay.overlayId);
      }
    } catch (error) {
      for (const id of shown) await manager.dismiss(id).catch(() => undefined);
      throw error;
    }
    created.overlayIds = shown;
    this.#guides.set(guideId, created);
    return created;
  }

  async advance(manager: OverlayManager, guide: VisualGuide): Promise<VisualGuide> {
    for (const id of guide.overlayIds) await manager.dismiss(id).catch(() => undefined);
    guide.overlayIds = [];
    guide.currentIndex = Math.min(guide.currentIndex + 1, guide.steps.length);
    if (guide.currentIndex >= guide.steps.length) {
      this.#guides.delete(guide.guideId);
      return guide;
    }
    const current = guide.steps[guide.currentIndex]!;
    const shown: string[] = [];
    try {
      const checklist = await manager.showWidget({
        title: guide.title,
        components: [
          { type: "text", text: `Step ${guide.currentIndex + 1} of ${guide.steps.length}: ${current.title}` },
          { type: "checklist", items: guide.steps.map((step, index) => ({ label: step.title, checked: index <= guide.currentIndex })) },
          { type: "progress", value: guide.currentIndex / guide.steps.length, label: `${guide.currentIndex}/${guide.steps.length}` }
        ],
        sensitivity: "public",
        ttlMs: GUIDE_TTL_MS
      });
      if (!checklist.ok || checklist.overlay === undefined) throw new Error(checklist.errors[0] ?? "guide_render_failed");
      shown.push(checklist.overlay.overlayId);
      if (current.target !== undefined) {
        const highlight = await manager.showPrimitive({
          type: "highlight",
          target: screenPointBinding(current.target.point, GUIDE_TTL_MS),
          sensitivity: "public",
          ttlMs: GUIDE_TTL_MS
        });
        if (highlight.ok && highlight.overlay !== undefined) shown.push(highlight.overlay.overlayId);
        if (current.instruction.length > 0) {
          const tooltip = await manager.showPrimitive({
            type: "tooltip",
            text: current.instruction.slice(0, 300),
            target: screenPointBinding(current.target.point, GUIDE_TTL_MS),
            sensitivity: "public",
            ttlMs: GUIDE_TTL_MS
          });
          if (tooltip.ok && tooltip.overlay !== undefined) shown.push(tooltip.overlay.overlayId);
        }
      }
    } catch (error) {
      for (const id of shown) await manager.dismiss(id).catch(() => undefined);
      throw error;
    }
    guide.overlayIds = shown;
    return guide;
  }

  async dismiss(manager: OverlayManager, guide: VisualGuide): Promise<void> {
    for (const id of guide.overlayIds) await manager.dismiss(id).catch(() => undefined);
    this.#guides.delete(guide.guideId);
  }
}

/** Process-wide ephemeral guides, strictly owner-session scoped. */
export const guideOverlays = new GuideOverlayStore();
