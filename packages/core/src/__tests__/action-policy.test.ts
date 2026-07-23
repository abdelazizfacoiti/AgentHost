import { describe, expect, it } from "vitest";
import { createGovernedActionEffect, decideGovernedAction, fingerprintActionBinding, getPolicyProfile, validateGovernedActionEffect } from "../index.js";

describe("universal governed-action policy", () => {
  it("returns precise grant recovery for an external effect without a scoped grant", () => {
    const effect = createGovernedActionEffect({
      ownerSessionId: "session-policy-test",
      operationFamily: "communication",
      operation: "send",
      executionClass: "state_changing",
      externalEffect: true,
      confirmationLevel: "standard",
      verificationKind: "receipt",
      bindings: { recipient: fingerprintActionBinding("recipient"), content: fingerprintActionBinding("message") }
    });
    const decision = decideGovernedAction({
      effect,
      safety: { allowed: false, blocked: true, guideOnly: false, riskLevel: "high", appSensitivity: "communication" },
      grantDecision: { matchedGrantIds: [], allowedByGrantIds: [], deniedByGrantIds: [], guideOnlyByGrantIds: [], requiresDryRun: true, requiresConfirmationToken: true, requiresApproval: false, requiresExactTarget: true },
      policy: getPolicyProfile("dev")
    });
    expect(decision.code).toBe("action_grant_missing");
    expect(decision.recovery).toBe("confirm");
  });

  it("requires a governed route for financial state changes", () => {
    const effect = createGovernedActionEffect({
      ownerSessionId: "session-policy-test",
      operationFamily: "browser",
      operation: "payment",
      executionClass: "state_changing",
      externalEffect: true,
      confirmationLevel: "strong",
      verificationKind: "receipt",
      bindings: { target: fingerprintActionBinding("target") }
    });
    const decision = decideGovernedAction({
      effect,
      safety: { allowed: true, blocked: false, guideOnly: false, riskLevel: "high", appSensitivity: "financial" },
      grantDecision: { matchedGrantIds: ["exact-financial"], allowedByGrantIds: ["exact-financial"], deniedByGrantIds: [], guideOnlyByGrantIds: [], requiresDryRun: true, requiresConfirmationToken: true, requiresApproval: false, requiresExactTarget: true },
      policy: getPolicyProfile("dev")
    });
    expect(decision.decision).toBe("unsupported");
    expect(decision.code).toBe("action_route_unavailable");
  });

  it("rejects tampered effect fingerprints", () => {
    const effect = createGovernedActionEffect({
      ownerSessionId: "session-policy-test",
      operationFamily: "file",
      operation: "write",
      executionClass: "state_changing",
      bindings: { target: fingerprintActionBinding("/approved/root/file") }
    });
    const result = validateGovernedActionEffect({ ...effect, operation: "delete" });
    expect(result).toMatchObject({ ok: false, code: "action_binding_changed" });
  });
});
