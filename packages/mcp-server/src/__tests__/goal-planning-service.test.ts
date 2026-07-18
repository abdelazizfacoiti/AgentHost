import { describe, expect, it } from "vitest";
import { GoalPlanningService } from "../goal-planning-service.js";

describe("GoalPlanningService", () => {
  it("keeps a redacted advisory projection and selects bounded visual surfaces", () => {
    const service = new GoalPlanningService();
    const result = service.preview({
      goalCategory: "browser_setup",
      goalStatus: "active",
      knownOperationCount: 1,
      healthyRouteCount: 1,
      decompositionRequired: false,
      directVerificationAvailable: true,
      activeVerifiedStrategy: true,
      materiallyAmbiguous: false,
      sensitiveExternalEffect: false,
      guideModeRequired: false,
      stepCount: 3,
      currentStepIndex: 1,
      expectedRemainingMs: 10_000,
      waitingForApproval: false,
      blocked: false,
      recovering: false,
      guideMode: false,
      choiceCount: 0
    });
    expect(result).toMatchObject({ status: "previewed", goalCategory: "browser_setup", executable: false, actionsExecuted: false, confirmationTokensCreated: false, redacted: true });
    expect(result.visualSurface?.surfaceType).toBe("task_checklist");
    expect(service.summary()).toEqual(result);
    expect(JSON.stringify(result)).not.toContain("http");
  });

  it("normalizes unsafe categories instead of echoing private labels", () => {
    const service = new GoalPlanningService();
    const result = service.preview({
      goalCategory: "recipient@example.com private request",
      goalStatus: "proposed",
      knownOperationCount: 0,
      healthyRouteCount: 0,
      decompositionRequired: false,
      directVerificationAvailable: false,
      activeVerifiedStrategy: false,
      materiallyAmbiguous: true,
      sensitiveExternalEffect: false,
      guideModeRequired: true,
      stepCount: 0,
      currentStepIndex: 0,
      expectedRemainingMs: 0,
      waitingForApproval: false,
      blocked: false,
      recovering: false,
      guideMode: true,
      choiceCount: 0
    });
    expect(result.goalCategory).toBe("unknown");
    expect(JSON.stringify(result)).not.toContain("recipient@example.com");
  });

  it("builds a bounded non-executable plan projection from trusted owner context", () => {
    const service = new GoalPlanningService();
    const result = service.previewPlan({
      goalCategory: "webpage_inspection",
      goalStatus: "ready",
      knownOperationCount: 1,
      healthyRouteCount: 1,
      decompositionRequired: false,
      directVerificationAvailable: true,
      activeVerifiedStrategy: true,
      materiallyAmbiguous: false,
      sensitiveExternalEffect: false,
      guideModeRequired: false,
      stepCount: 1,
      currentStepIndex: 0,
      expectedRemainingMs: 1000,
      waitingForApproval: false,
      blocked: false,
      recovering: false,
      guideMode: false,
      choiceCount: 0,
      goalSummary: "Inspect the current page",
      desiredOutcome: "A bounded observation is verified."
    }, { ownerSessionId: "session_test" });
    expect(result.goal?.ownerSessionId).toBe("session_test");
    expect(result.plan?.steps).toHaveLength(1);
    expect(result.candidatePlans).toHaveLength(1);
    expect(result.executable).toBe(false);
    expect(result.actionsExecuted).toBe(false);
    expect(result.confirmationTokensCreated).toBe(false);
    expect(JSON.stringify(result)).not.toContain("http");
  });

  it("keeps state-changing previews confirmation-bound and non-executable", () => {
    const service = new GoalPlanningService();
    const result = service.previewPlan({
      goalCategory: "browser_navigation",
      goalStatus: "ready",
      knownOperationCount: 1,
      healthyRouteCount: 1,
      decompositionRequired: false,
      directVerificationAvailable: true,
      activeVerifiedStrategy: true,
      materiallyAmbiguous: false,
      sensitiveExternalEffect: true,
      guideModeRequired: false,
      stepCount: 1,
      currentStepIndex: 0,
      expectedRemainingMs: 1000,
      waitingForApproval: false,
      blocked: false,
      recovering: false,
      guideMode: false,
      choiceCount: 0,
      requestedEffect: "browser_navigation",
      requiredConfirmations: ["before_state_change"]
    }, { ownerSessionId: "session_test" });
    expect(result.plan?.steps[0]?.confirmation).toBe("before_state_change");
    expect(result.plan?.executable).toBe(false);
  });

  it("redacts free-form goal summary and outcome before projection", () => {
    const service = new GoalPlanningService();
    const result = service.previewPlan({
      goalCategory: "webpage_inspection",
      goalStatus: "ready",
      knownOperationCount: 1,
      healthyRouteCount: 1,
      decompositionRequired: false,
      directVerificationAvailable: true,
      activeVerifiedStrategy: true,
      materiallyAmbiguous: false,
      sensitiveExternalEffect: false,
      guideModeRequired: false,
      stepCount: 1,
      currentStepIndex: 0,
      expectedRemainingMs: 1000,
      waitingForApproval: false,
      blocked: false,
      recovering: false,
      guideMode: false,
      choiceCount: 0,
      goalSummary: "Inspect https://user:secret@example.test/private?token=abc",
      desiredOutcome: "Review bearer abc123 and recipient@example.test"
    }, { ownerSessionId: "session_test" });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret@example.test");
    expect(serialized).not.toContain("token=abc");
    expect(serialized).not.toContain("recipient@example.test");
    expect(result.goal?.summary).toMatch(/^\[redacted-value length=/);
    expect(result.goal?.desiredOutcome).toMatch(/^\[redacted-value length=/);
  });

  it("creates a bounded ordered multi-step plan without executing steps", () => {
    const service = new GoalPlanningService();
    const result = service.previewPlan({
      goalCategory: "workflow_assistance",
      goalStatus: "ready",
      knownOperationCount: 3,
      healthyRouteCount: 1,
      decompositionRequired: true,
      directVerificationAvailable: false,
      activeVerifiedStrategy: true,
      materiallyAmbiguous: false,
      sensitiveExternalEffect: false,
      guideModeRequired: true,
      stepCount: 3,
      currentStepIndex: 1,
      expectedRemainingMs: 5000,
      waitingForApproval: false,
      blocked: false,
      recovering: false,
      guideMode: true,
      choiceCount: 0
    }, { ownerSessionId: "session_test" });
    expect(result.plan?.steps.map((step) => step.order)).toEqual([0, 1, 2]);
    expect(result.plan?.steps[1]?.dependencyStepIds).toEqual(["step_0"]);
    expect(result.plan?.currentStepIndex).toBe(1);
    expect(result.plan?.executable).toBe(false);
  });
});
