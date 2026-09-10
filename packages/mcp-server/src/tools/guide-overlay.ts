import { toolFailure, toolSuccess, type ToolResult } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";
import { guideOverlays } from "../guide-overlay-store.js";

const point = z.object({ x: z.number().int().min(0).max(100_000), y: z.number().int().min(0).max(100_000) }).strict();
const stepInput = z.object({
  title: z.string().trim().min(1).max(120),
  instruction: z.string().trim().min(1).max(500),
  target: z.object({ kind: z.literal("screen_point"), point }).strict().optional()
}).strict();
const presentInput = z.object({
  title: z.string().trim().min(1).max(120),
  steps: z.array(stepInput).min(1).max(20),
  ttlMs: z.number().int().min(10_000).max(300_000).optional()
}).strict();
const idInput = z.object({ guideId: z.string().trim().min(1).max(200) }).strict();
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, ...(required.length > 0 ? { required } : {}), additionalProperties: false });

function fail(tool: string, error: unknown): ToolResult<never> {
  return toolFailure({ tool, riskLevel: "low", error: { code: "guide_failed", message: error instanceof Error ? error.message : "Guide overlay failed." }, observations: ["Visual guidance only; no target-app action occurred."] });
}

/**
 * One-call pretty visual guidance: checklist widget with progress plus a
 * highlight and tooltip on the current step's screen target. The agent
 * advances as the user progresses (observed via screenshots/checkpoints);
 * the guide auto-expires and never controls applications.
 */
export function createGuideOverlayTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const present: AgentHostToolDefinition<z.infer<typeof presentInput>, unknown, AgentHostMcpContext> = {
    name: "overlay.guide_present",
    description: "Presents a pretty step-by-step visual guide: checklist with progress, highlight and tooltip on the current target. One call; advance as the user progresses.",
    riskLevel: "low",
    inputSchema: presentInput,
    mcpInputSchema: schema({ title: { type: "string" }, steps: { type: "array", maxItems: 20 }, ttlMs: { type: "integer" } }, ["title", "steps"]),
    inputSummary: "Present visual guide",
    safety: { actionType: "inspect" },
    async handler(input, context): Promise<ToolResult<unknown>> {
      try {
        if (context.overlay === undefined) return fail("overlay.guide_present", "overlay_unavailable");
        const guide = await guideOverlays.present(context.overlay, context.sessionId, input.title, input.steps);
        return toolSuccess({
          tool: "overlay.guide_present",
          riskLevel: "low",
          data: { guideId: guide.guideId, title: guide.title, stepCount: guide.steps.length, currentIndex: 0, overlayIds: guide.overlayIds, expiresAt: guide.expiresAt },
          observations: ["Guide rendered: checklist, highlight, and tooltip. Advance when the user completes the visible step; guides expire automatically."]
        });
      } catch (error) {
        return fail("overlay.guide_present", error);
      }
    }
  };
  const advance: AgentHostToolDefinition<z.infer<typeof idInput>, unknown, AgentHostMcpContext> = {
    name: "overlay.guide_advance",
    description: "Advances the visual guide to the next step, moving the checklist, highlight, and tooltip. Completes (dismissing everything) after the last step.",
    riskLevel: "low",
    inputSchema: idInput,
    mcpInputSchema: schema({ guideId: { type: "string" } }, ["guideId"]),
    inputSummary: "Advance visual guide",
    safety: { actionType: "inspect" },
    async handler(input, context): Promise<ToolResult<unknown>> {
      try {
        if (context.overlay === undefined) return fail("overlay.guide_advance", "overlay_unavailable");
        const guide = guideOverlays.get(input.guideId, context.sessionId);
        if (guide === undefined) return toolFailure({ tool: "overlay.guide_advance", riskLevel: "low", error: { code: "guide_not_found", message: "Guide expired, dismissed, or belongs to another session." } });
        const updated = await guideOverlays.advance(context.overlay, guide);
        const done = updated.currentIndex >= updated.steps.length;
        return toolSuccess({
          tool: "overlay.guide_advance",
          riskLevel: "low",
          data: { guideId: updated.guideId, done, currentIndex: updated.currentIndex, stepCount: updated.steps.length, overlayIds: updated.overlayIds },
          observations: [done ? "Guide complete; all guide overlays dismissed." : "Guide advanced; checklist and target highlight moved."]
        });
      } catch (error) {
        return fail("overlay.guide_advance", error);
      }
    }
  };
  const dismiss: AgentHostToolDefinition<z.infer<typeof idInput>, unknown, AgentHostMcpContext> = {
    name: "overlay.guide_dismiss",
    description: "Dismisses every overlay belonging to a visual guide immediately.",
    riskLevel: "low",
    inputSchema: idInput,
    mcpInputSchema: schema({ guideId: { type: "string" } }, ["guideId"]),
    inputSummary: "Dismiss visual guide",
    safety: { actionType: "inspect" },
    async handler(input, context): Promise<ToolResult<unknown>> {
      try {
        if (context.overlay === undefined) return fail("overlay.guide_dismiss", "overlay_unavailable");
        const guide = guideOverlays.get(input.guideId, context.sessionId);
        if (guide === undefined) return toolSuccess({ tool: "overlay.guide_dismiss", riskLevel: "low", data: { dismissed: false, reason: "guide_not_found" } });
        await guideOverlays.dismiss(context.overlay, guide);
        return toolSuccess({ tool: "overlay.guide_dismiss", riskLevel: "low", data: { dismissed: true, guideId: guide.guideId } });
      } catch (error) {
        return fail("overlay.guide_dismiss", error);
      }
    }
  };
  return [present, advance, dismiss];
}
