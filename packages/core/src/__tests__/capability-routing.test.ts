import { describe, expect, it } from "vitest";
import { compareCapabilityRoutes, scoreCapabilityRoute, validateVisualSurface, type CapabilityRouteCandidate, type VisualSurfaceProtocolEnvelope } from "@agenthost/core";

function route(overrides: Partial<CapabilityRouteCandidate> = {}): CapabilityRouteCandidate {
  return { routeFamily: "browser_bridge", goalCategory: "browser_navigation", prerequisites: [], health: "healthy", compatible: true, probeTier: 1, estimatedProbeMs: 10, estimatedSetupMs: 10, estimatedExecutionMs: 10, estimatedVerificationMs: 10, verificationStrength: "strong", verifiedSuccesses: 0, verifiedFailures: 0, consecutiveVerifiedFailures: 0, failureProbability: 0.1, recoveryCostMs: 100, contextTokens: 100, riskLevel: "observe", requiresConfirmation: false, tieBreakKey: "00:browser_bridge", ...overrides };
}
describe("adaptive route model", () => {
  it("scores safety and verification before small latency differences", () => {
    expect(scoreCapabilityRoute(route({ routeFamily: "desktop_input", verificationStrength: "weak", riskLevel: "medium", tieBreakKey: "06:desktop_input" }))).toBeGreaterThan(scoreCapabilityRoute(route()));
    expect(compareCapabilityRoutes(route(), route({ routeFamily: "structured_browser", tieBreakKey: "01:structured_browser" }))).toBeLessThan(0);
  });
  it("rejects unavailable and blocked candidates", () => {
    expect(scoreCapabilityRoute(route({ compatible: false }))).toBe(Infinity);
    expect(scoreCapabilityRoute(route({ riskLevel: "blocked", health: "unavailable" }))).toBe(Infinity);
  });
});

describe("visual surface validation", () => {
  const base: VisualSurfaceProtocolEnvelope = { schemaVersion: 1, surfaceId: "surface_test", ownerSessionId: "owner_test", source: "assistance", type: "instruction_card", content: { title: "Safe guidance", components: [{ type: "text", text: "Read-only" }] }, state: "draft", placement: "top_left", priority: "normal", interactionMode: "click_through", approvedIntents: ["acknowledge"], ttlMs: 30_000, sensitivity: "public", screenshotBehavior: "hide", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30_000).toISOString() };
  it("accepts bounded registered content", () => expect(validateVisualSurface(base).ok).toBe(true));
  it("rejects markup, secrets, and unknown fields", () => {
    expect(validateVisualSurface({ ...base, content: { ...base.content, title: "<script>bad</script>" } }).ok).toBe(false);
    expect(validateVisualSurface({ ...base, sensitivity: "secret" }).errors).toContain("visual_surface_secret_blocked");
    expect(validateVisualSurface({ ...base, arbitrary: "blocked" } as never).errors).toContain("visual_surface_unknown_field");
  });
});
