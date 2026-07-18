import { describe, expect, it } from "vitest";
import {
  compareCandidatePlans,
  determineGoalDecisionLevel,
  planReplanDecision,
  selectCandidatePlan,
  selectGoalVisualSurface,
  validateActionRoute,
  validateAgentGoal,
  validateCandidatePlanEvaluation,
  validateExecutionPlan,
  validateGoalOutcome,
  validatePlanStep,
  validateVerificationCheckpoint,
  type ActionRoute,
  type AgentGoal,
  type CandidatePlanEvaluation,
  type ExecutionPlan,
  type GoalOutcome,
  type PlanStep,
  type VerificationCheckpoint
} from "../goal-planning.js";

const createdAt = "2026-07-18T12:00:00.000Z";
const updatedAt = "2026-07-18T12:01:00.000Z";
const expiresAt = "2026-07-18T13:00:00.000Z";

function checkpoint(overrides: Partial<VerificationCheckpoint> = {}): VerificationCheckpoint {
  return {
    checkpointId: "check_state",
    kind: "browser_state",
    summary: "Expected browser state observed",
    sensitivity: "public",
    required: true,
    minimumStrength: "strong",
    completionCondition: "checkpoint_passes",
    timeoutMs: 10_000,
    status: "pending",
    ...overrides
  };
}

function step(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    stepId: "step_inspect",
    order: 0,
    operation: "inspect_state",
    requiredCapability: "browser",
    allowedRoutes: ["browser_bridge", "accessibility"],
    expectedEffect: "observe",
    expectedExecutionClass: "read_only",
    riskLevel: "observe",
    grounding: "live_browser_state",
    confirmation: "none",
    timeoutMs: 10_000,
    retryLimit: 0,
    fallbackBudget: 1,
    dependencyStepIds: [],
    verificationCheckpointIds: ["check_state"],
    completionCondition: "checkpoint_passes",
    safeFailureCodes: ["capability_unavailable", "verification_failed"],
    ...overrides
  };
}

function goal(overrides: Partial<AgentGoal> = {}): AgentGoal {
  return {
    schemaVersion: 1,
    goalId: "goal_public",
    ownerSessionId: "session_owner",
    category: "webpage_inspection",
    summary: "Inspect authorized public page",
    desiredOutcome: "Public page structure is available for review",
    successCriteria: [{
      criterionId: "criterion_observed",
      kind: "state_observed",
      summary: "Page structure is observed",
      required: true
    }],
    constraints: ["local_only", "operator_present", "read_only", "no_background"],
    allowedEffects: ["observe", "visual_assistance"],
    prohibitedEffects: ["communication_send", "external_submit", "upload", "delete", "payment"],
    requiredConfirmations: ["none"],
    privacy: "public",
    appFamily: "browser",
    priority: "normal",
    executionBudget: {
      maxSteps: 4,
      maxDurationMs: 120_000,
      maxExternalEffects: 0,
      maxUserInterruptions: 1
    },
    fallbackPolicy: {
      allowed: true,
      maxFallbacksPerStep: 2,
      maxReplans: 2,
      allowGuideMode: true
    },
    verification: {
      mode: "all_required",
      minimumStrength: "strong",
      independentObservationRequired: true
    },
    status: "ready",
    createdAt,
    updatedAt,
    expiresAt,
    redacted: true,
    ...overrides
  };
}

function plan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    schemaVersion: 1,
    planId: "plan_public",
    goalId: "goal_public",
    revision: 1,
    assumptions: ["Browser capability health will be checked before use"],
    prerequisites: [{ capability: "browser", requiredHealth: "healthy" }],
    steps: [step()],
    permittedRouteFamilies: ["browser_bridge", "accessibility", "guide_only"],
    checkpoints: [checkpoint()],
    expectedEffects: ["observe"],
    confirmationBoundaries: ["none"],
    expectedLatencyMs: 500,
    expectedCostClass: "low",
    uncertainty: "low",
    fallbackBudget: 2,
    replanBudget: 2,
    currentStepIndex: 0,
    state: "selected",
    createdAt,
    updatedAt,
    expiresAt,
    executable: false,
    redacted: true,
    ...overrides
  };
}

function candidate(overrides: Partial<CandidatePlanEvaluation> = {}): CandidatePlanEvaluation {
  return {
    plan: plan(),
    policyCompatible: true,
    safety: "safe",
    maximumRisk: "observe",
    goalCoverage: 100,
    successCriteriaCoverage: 100,
    verificationStrength: "strong",
    capabilityHealth: "healthy",
    verifiedReliability: 0.8,
    expectedRecoveryMs: 100,
    confirmationCount: 0,
    externalEffectCount: 0,
    userInterruptionCount: 0,
    contextTokens: 200,
    dependencyCount: 1,
    ...overrides
  };
}

describe("bounded AgentGoal model", () => {
  it("accepts safe structural goal metadata", () => {
    expect(validateAgentGoal(goal())).toEqual([]);
  });

  it("rejects unknown fields and raw private or executable text", () => {
    expect(validateAgentGoal({
      ...goal(),
      summary: "Inspect recipient@example.com with $(shell)",
      rawPrompt: "private"
    } as never)).toEqual(expect.arrayContaining(["goal_unknown_field", "goal_text_unsafe"]));
  });

  it("rejects effect conflicts and constraints that silently broaden goal", () => {
    expect(validateAgentGoal(goal({
      allowedEffects: ["observe", "communication_send"],
      prohibitedEffects: ["communication_send"],
      constraints: ["no_external_send"]
    }))).toEqual(expect.arrayContaining(["goal_effect_conflict", "goal_constraint_effect_conflict"]));
  });

  it("enforces finite confirmation and execution budgets", () => {
    expect(validateAgentGoal(goal({
      requiredConfirmations: ["none", "before_state_change"],
      executionBudget: { ...goal().executionBudget, maxSteps: 13 },
      fallbackPolicy: { ...goal().fallbackPolicy, maxReplans: 4 }
    }))).toEqual(expect.arrayContaining([
      "goal_confirmations_conflict",
      "goal_budget_invalid",
      "goal_fallback_invalid"
    ]));
  });

  it("requires explicit confirmation boundaries for private reads and state changes", () => {
    expect(validateAgentGoal(goal({
      constraints: ["local_only"],
      allowedEffects: ["observe", "inspect_private_data", "browser_navigation"],
      requiredConfirmations: ["none"]
    }))).toEqual(expect.arrayContaining([
      "goal_private_read_confirmation_required",
      "goal_state_change_confirmation_required"
    ]));
  });

  it("rejects duplicate success criteria and invalid timestamps", () => {
    const criterion = goal().successCriteria[0]!;
    expect(validateAgentGoal(goal({
      successCriteria: [criterion, criterion],
      updatedAt: "2026-07-18T14:00:00.000Z"
    }))).toEqual(expect.arrayContaining(["goal_criterion_id_invalid", "goal_timestamps_invalid"]));
  });
});

describe("bounded execution-plan model", () => {
  it("accepts a safe non-executable plan bound to its goal", () => {
    expect(validateExecutionPlan(plan(), goal())).toEqual([]);
  });

  it("rejects arbitrary fields, unsafe assumptions, and goal mismatch", () => {
    expect(validateExecutionPlan({
      ...plan(),
      goalId: "goal_other",
      assumptions: ["Run curl https://private.example"],
      arbitraryTool: "browser.open_url"
    } as never, goal())).toEqual(expect.arrayContaining([
      "plan_unknown_field",
      "plan_goal_mismatch",
      "plan_assumptions_unsafe"
    ]));
  });

  it("rejects forward dependencies, missing checkpoints, and unpermitted routes", () => {
    const second = step({
      stepId: "step_second",
      order: 1,
      dependencyStepIds: ["step_future"],
      verificationCheckpointIds: ["check_missing"],
      allowedRoutes: ["desktop_input"]
    });
    expect(validateExecutionPlan(plan({ steps: [step(), second] }))).toEqual(expect.arrayContaining([
      "plan_step_dependency_invalid",
      "plan_step_checkpoint_missing",
      "plan_step_route_not_permitted"
    ]));
  });

  it("fails malformed nested plan records closed without throwing", () => {
    const value = plan({
      steps: [null as never],
      checkpoints: [null as never]
    });
    expect(() => validateExecutionPlan(value)).not.toThrow();
    expect(validateExecutionPlan(value)).toEqual(expect.arrayContaining([
      "plan_step_invalid",
      "plan_checkpoint_invalid"
    ]));
  });

  it("rejects effects and budgets beyond stable goal bounds", () => {
    expect(validateExecutionPlan(plan({
      expectedEffects: ["observe", "communication_send"],
      fallbackBudget: 2,
      replanBudget: 3
    }), goal({
      fallbackPolicy: { ...goal().fallbackPolicy, maxFallbacksPerStep: 1, maxReplans: 1 }
    }))).toEqual(expect.arrayContaining(["plan_goal_effect_violation", "plan_goal_budget_violation"]));
  });

  it("requires state-changing steps to declare confirmation", () => {
    expect(validatePlanStep(step({
      operation: "navigate",
      expectedEffect: "browser_navigation",
      expectedExecutionClass: "state_changing",
      riskLevel: "medium",
      confirmation: "none"
    }))).toContain("plan_step_confirmation_required");
  });

  it("allows only class-matched metadata and visual effects", () => {
    expect(validatePlanStep(step({
      operation: "check_prerequisite",
      requiredCapability: "file",
      expectedEffect: "local_metadata_write",
      expectedExecutionClass: "metadata_only",
      grounding: "none"
    }))).not.toContain("plan_step_effect_class_conflict");
    expect(validatePlanStep(step({
      operation: "show_visual_guidance",
      requiredCapability: "overlay",
      allowedRoutes: ["guide_only"],
      expectedEffect: "visual_assistance",
      expectedExecutionClass: "visual_only",
      grounding: "operator_observation"
    }))).not.toContain("plan_step_effect_class_conflict");
    expect(validatePlanStep(step({
      expectedEffect: "local_file_create",
      expectedExecutionClass: "read_only"
    }))).toContain("plan_step_effect_class_conflict");
    expect(validatePlanStep(step({
      expectedEffect: "observe",
      expectedExecutionClass: "state_changing",
      confirmation: "before_state_change"
    }))).toContain("plan_step_effect_class_conflict");
  });

  it("rejects secret checkpoints and unsafe summaries", () => {
    expect(validateVerificationCheckpoint(checkpoint({
      sensitivity: "secret",
      summary: "Token bearer abc"
    }))).toEqual(expect.arrayContaining([
      "verification_checkpoint_invalid",
      "verification_checkpoint_secret_blocked"
    ]));
  });
});

describe("action routes and goal outcomes", () => {
  it("binds advisory route to current plan step and keeps it non-executable", () => {
    const route: ActionRoute = {
      routeId: "route_public",
      planId: "plan_public",
      stepId: "step_inspect",
      family: "browser_bridge",
      health: "healthy",
      verificationStrength: "strong",
      latencyClass: "fast",
      riskLevel: "observe",
      expectedEffect: "observe",
      requiresConfirmation: false,
      reasonCode: "healthy_verified_route",
      selectedAt: createdAt,
      expiresAt,
      executable: false
    };
    expect(validateActionRoute(route, plan())).toEqual([]);
    expect(validateActionRoute({ ...route, family: "desktop_input", executable: true } as never, plan()))
      .toEqual(expect.arrayContaining(["action_route_non_executable_required", "action_route_plan_mismatch"]));
    expect(validateActionRoute({ ...route, requiresConfirmation: true }, plan()))
      .toContain("action_route_confirmation_mismatch");
  });

  it("does not equate unverified completion with goal success", () => {
    const value: GoalOutcome = {
      goalId: "goal_public",
      planId: "plan_public",
      status: "completed",
      verified: false,
      criteria: [{ criterionId: "criterion_observed", satisfied: true }],
      checkpointIds: ["check_state"],
      summary: "Goal completion awaits verification",
      completedAt: updatedAt,
      redacted: true
    };
    expect(validateGoalOutcome(value, goal(), plan())).toContain("goal_outcome_completion_unverified");
  });

  it("requires every required success criterion before completion", () => {
    const value: GoalOutcome = {
      goalId: "goal_public",
      planId: "plan_public",
      status: "completed",
      verified: true,
      criteria: [{ criterionId: "criterion_other", satisfied: true }],
      checkpointIds: ["check_state"],
      summary: "Required criterion not yet satisfied",
      completedAt: updatedAt,
      redacted: true
    };
    expect(validateGoalOutcome(value, goal(), plan())).toContain("goal_outcome_required_criterion_missing");
  });

  it("accepts verified completion only after completed plan and satisfied criteria", () => {
    const value: GoalOutcome = {
      goalId: "goal_public",
      planId: "plan_public",
      status: "completed",
      verified: true,
      criteria: [{ criterionId: "criterion_observed", satisfied: true }],
      checkpointIds: ["check_state"],
      summary: "Required public state was verified",
      completedAt: updatedAt,
      redacted: true
    };
    expect(validateGoalOutcome(value, goal(), plan({ state: "completed" }))).toEqual([]);
  });

  it("fails malformed outcome collections closed without throwing", () => {
    const value = {
      goalId: "goal_public",
      planId: "plan_public",
      status: "completed",
      verified: true,
      criteria: "private raw result",
      checkpointIds: "check_state",
      summary: "Malformed result is rejected",
      completedAt: updatedAt,
      redacted: true
    };
    expect(() => validateGoalOutcome(value as never, goal(), plan())).not.toThrow();
    expect(validateGoalOutcome(value as never, goal(), plan())).toEqual(expect.arrayContaining([
      "goal_outcome_criteria_invalid",
      "goal_outcome_checkpoints_invalid"
    ]));
    const malformedNested = {
      ...(value as Record<string, unknown>),
      criteria: [null],
      checkpointIds: []
    };
    expect(() => validateGoalOutcome(malformedNested as never, goal(), plan())).not.toThrow();
  });
});

describe("deterministic planning decisions", () => {
  it("selects explicit decision levels 0 through 3", () => {
    const base = {
      knownOperationCount: 1,
      healthyRouteCount: 1,
      decompositionRequired: false,
      directVerificationAvailable: true,
      activeVerifiedStrategy: false,
      materiallyAmbiguous: false,
      sensitiveExternalEffect: false,
      guideModeRequired: false
    };
    expect(determineGoalDecisionLevel(base)).toBe(0);
    expect(determineGoalDecisionLevel({ ...base, directVerificationAvailable: false, activeVerifiedStrategy: true })).toBe(1);
    expect(determineGoalDecisionLevel({ ...base, knownOperationCount: 2, decompositionRequired: true })).toBe(2);
    expect(determineGoalDecisionLevel({ ...base, materiallyAmbiguous: true })).toBe(3);
    expect(determineGoalDecisionLevel({ ...base, healthyRouteCount: 0 })).toBe(3);
  });

  it("always ranks safety and verification before large latency savings", () => {
    const safeSlow = candidate({
      plan: plan({ planId: "plan_safe", expectedLatencyMs: 1_000_000 }),
      safety: "safe",
      maximumRisk: "observe",
      verificationStrength: "strong"
    });
    const fastRisky = candidate({
      plan: plan({ planId: "plan_fast", expectedLatencyMs: 1 }),
      safety: "conditional",
      maximumRisk: "medium",
      verificationStrength: "weak"
    });
    expect(compareCandidatePlans(safeSlow, fastRisky)).toBeLessThan(0);
    expect(selectCandidatePlan([fastRisky, safeSlow]).selected?.planId).toBe("plan_safe");
  });

  it("uses a stable plan ID tie-break and rejects blocked candidates", () => {
    const beta = candidate({ plan: plan({ planId: "plan_beta" }) });
    const alpha = candidate({ plan: plan({ planId: "plan_alpha" }) });
    const blocked = candidate({ plan: plan({ planId: "plan_blocked" }), safety: "blocked" });
    const result = selectCandidatePlan([beta, blocked, alpha]);
    expect(result.rankedPlanIds.slice(0, 2)).toEqual(["plan_alpha", "plan_beta"]);
    expect(result.rejectedPlanIds).toEqual(["plan_blocked"]);
  });

  it("rejects malformed candidate metrics and candidate sets beyond bound", () => {
    expect(validateCandidatePlanEvaluation(candidate({ contextTokens: -1 }))).toContain("candidate_plan_cost_invalid");
    expect(selectCandidatePlan(Array.from({ length: 5 }, (_, index) =>
      candidate({ plan: plan({ planId: `plan_${index}` }) })))).toEqual({
      rankedPlanIds: [],
      rejectedPlanIds: [],
      reasonCode: "no_safe_candidate"
    });
  });
});

describe("bounded replanning and dynamic visual policy", () => {
  it("preserves goal identity, decrements budget, and requests fresh target confirmation", () => {
    const result = planReplanDecision(plan({ revision: 4, replanBudget: 2 }), "target_stale");
    expect(result).toMatchObject({
      allowed: true,
      goalId: "goal_public",
      priorPlanId: "plan_public",
      nextRevision: 5,
      remainingReplanBudget: 1,
      invalidateTargetBindings: true,
      requiresFreshConfirmation: true,
      code: "replan_allowed"
    });
    for (const reason of ["effect_changed", "recipient_changed", "risk_changed"] as const) {
      expect(planReplanDecision(plan(), reason).requiresFreshConfirmation).toBe(true);
    }
  });

  it("fails replanning closed for exhausted and terminal plans", () => {
    expect(planReplanDecision(plan({ replanBudget: 0 }), "execution_failed").code)
      .toBe("replan_budget_exhausted");
    expect(planReplanDecision(plan({ state: "completed" }), "execution_failed").code)
      .toBe("plan_terminal");
  });

  it("chooses smallest useful surface with safety states taking precedence", () => {
    const base = {
      goalCategory: "webpage_inspection" as const,
      goalStatus: "active" as const,
      planState: "active" as const,
      stepCount: 1,
      currentStepIndex: 0,
      expectedRemainingMs: 500,
      waitingForApproval: false,
      blocked: false,
      recovering: false,
      guideMode: false,
      choiceCount: 1
    };
    expect(selectGoalVisualSurface(base)).toMatchObject({ surfaceType: "activity_pill", compact: true });
    expect(selectGoalVisualSurface({ ...base, stepCount: 3 })).toMatchObject({ surfaceType: "progress_card" });
    expect(selectGoalVisualSurface({ ...base, goalCategory: "browser_setup" })).toMatchObject({ surfaceType: "task_checklist" });
    expect(selectGoalVisualSurface({ ...base, guideMode: true })).toMatchObject({ surfaceType: "instruction_card" });
    expect(selectGoalVisualSurface({ ...base, recovering: true })).toMatchObject({ surfaceType: "recovery_card" });
    expect(selectGoalVisualSurface({ ...base, blocked: true })).toMatchObject({ surfaceType: "blocked_card" });
    expect(selectGoalVisualSurface({ ...base, waitingForApproval: true, blocked: true }))
      .toMatchObject({ surfaceType: "approval_notice" });
    expect(selectGoalVisualSurface({ ...base, goalStatus: "completed" })).toMatchObject({ surfaceType: "result_summary" });
  });
});
