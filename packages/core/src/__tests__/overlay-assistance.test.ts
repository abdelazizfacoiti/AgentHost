import { describe, expect, it } from "vitest";
import { validateOverlayAssistanceEvent, validateOverlayAssistanceSteps, validateOverlayControlSurfaceEvent, type OverlayAssistanceStep } from "../index.js";

const expiresAt = new Date(Date.now() + 20_000).toISOString();
const pointer: OverlayAssistanceStep = { stepId: "step-1", index: 0, type: "pointer", primitive: { type: "pointer", sensitivity: "public" } };

describe("overlay assistance validation", () => {
  it("accepts bounded forward visual steps and rejects cycles/oversized flows", () => {
    expect(validateOverlayAssistanceSteps([pointer])).toEqual([]);
    const cyclic: OverlayAssistanceStep[] = [
      { ...pointer, transitions: [{ fromStepId: "step-1", event: "next", toStepId: "step-2", automatic: false }] },
      { stepId: "step-2", index: 1, type: "clear", transitions: [{ fromStepId: "step-2", event: "back", toStepId: "step-1", automatic: false }] }
    ];
    expect(validateOverlayAssistanceSteps(cyclic)).toContain("assistance_transition_cycle");
    expect(validateOverlayAssistanceSteps(Array.from({ length: 51 }, (_, index) => ({ ...pointer, stepId: `step-${index}`, index })))).toContain("assistance_step_count_invalid");
  });

  it("rejects stale, unknown, or unbound events", () => {
    expect(validateOverlayAssistanceEvent({ eventId: "event-1", sessionId: "assist-1", stepId: "step-1", event: "next", createdAt: new Date(Date.now() - 120_000).toISOString(), ownerSessionId: "owner" })).toContain("assistance_event_stale");
    expect(validateOverlayAssistanceEvent({ eventId: "event-1", sessionId: "assist-1", stepId: "step-1", event: "bad" as never, createdAt: expiresAt, ownerSessionId: "owner" })).toContain("assistance_event_not_allowed");
  });

  it("allows only strict control-surface actions", () => {
    const base = { eventId: "event-1", controlSurfaceId: "surface-1", assistanceSessionId: "assist-1", overlayId: "overlay-1", createdAt: new Date().toISOString(), ownerSessionId: "owner" };
    expect(validateOverlayControlSurfaceEvent({ ...base, action: "pause" })).toEqual([]);
    expect(validateOverlayControlSurfaceEvent({ ...base, action: "back" as never })).toContain("control_surface_action_not_allowed");
  });
});
