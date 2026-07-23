import { randomUUID } from "node:crypto";
import {
  AGENT_GOAL_CATEGORIES,
  determineGoalDecisionLevel,
  selectGoalVisualSurface,
  validateAgentGoal,
  validateExecutionPlan,
  workflowValueSummary,
  type ActionRoute,
  type AgentGoal,
  type AgentGoalCategory,
  type CapabilityRouteFamily,
  type CapabilityRouteSelection,
  type ExecutionPlan,
  type GoalConfirmationRequirement,
  type GoalDecisionInput,
  type GoalEffect,
  type GoalVisualDecisionInput,
  type PlanCapabilityFamily,
  type PlanOperationCategory,
  type PlanStep,
  type VerificationCheckpoint,
  type RiskLevel
} from "@agenthost/core";

export interface GoalPlanPreviewInput extends GoalDecisionInput, Omit<GoalVisualDecisionInput, "goalCategory" | "planState"> {
  goalCategory: string;
  planState?: GoalVisualDecisionInput["planState"];
  goalSummary?: string;
  desiredOutcome?: string;
  requestedEffect?: GoalEffect;
  privacy?: "public" | "private" | "secret";
  appFamily?: "browser" | "communication" | "office" | "development" | "media" | "system" | "unknown";
  constraints?: string[];
  allowedEffects?: GoalEffect[];
  prohibitedEffects?: GoalEffect[];
  requiredConfirmations?: GoalConfirmationRequirement[];
  riskLevel?: RiskLevel;
}

export interface GoalPlanBuildContext {
  ownerSessionId: string;
  routeSelection?: CapabilityRouteSelection;
}

export interface GoalPlanningProjection {
  status: "idle" | "previewed";
  goalCategory?: string;
  decisionLevel?: 0 | 1 | 2 | 3;
  visualSurface?: ReturnType<typeof selectGoalVisualSurface>;
  goal?: AgentGoal;
  plan?: ExecutionPlan;
  route?: ActionRoute;
  candidatePlanCount?: number;
  candidateRoutes?: Array<{ routeFamily: CapabilityRouteFamily; eligible: boolean; reasonCode: string }>;
  candidatePlans?: Array<{ routeFamily: CapabilityRouteFamily; selected: boolean; eligible: boolean; safety: "safe" | "conditional" | "blocked"; verificationStrength: "strong" | "medium" | "weak"; estimatedLatencyMs: number; reasonCode: string }>;
  stepCount?: number;
  currentStepIndex?: number;
  updatedAt?: string;
  executable: false;
  actionsExecuted: false;
  confirmationTokensCreated: false;
  redacted: true;
}

export class GoalPlanningService {
  #last: GoalPlanningProjection = {
    status: "idle",
    executable: false,
    actionsExecuted: false,
    confirmationTokensCreated: false,
    redacted: true
  };

  preview(input: GoalPlanPreviewInput): GoalPlanningProjection {
    const category: AgentGoalCategory = AGENT_GOAL_CATEGORIES.includes(input.goalCategory as AgentGoalCategory)
      ? input.goalCategory as AgentGoalCategory
      : "unknown";
    const decisionLevel = determineGoalDecisionLevel({
      knownOperationCount: input.knownOperationCount,
      healthyRouteCount: input.healthyRouteCount,
      decompositionRequired: input.decompositionRequired,
      directVerificationAvailable: input.directVerificationAvailable,
      activeVerifiedStrategy: input.activeVerifiedStrategy,
      materiallyAmbiguous: input.materiallyAmbiguous,
      sensitiveExternalEffect: input.sensitiveExternalEffect,
      guideModeRequired: input.guideModeRequired
    });
    const visualInput: GoalVisualDecisionInput = {
      goalCategory: category,
      goalStatus: input.goalStatus,
      stepCount: input.stepCount,
      currentStepIndex: input.currentStepIndex,
      expectedRemainingMs: input.expectedRemainingMs,
      waitingForApproval: input.waitingForApproval,
      blocked: input.blocked,
      recovering: input.recovering,
      guideMode: input.guideMode,
      choiceCount: input.choiceCount
    };
    if (input.planState !== undefined) visualInput.planState = input.planState;
    const visualSurface = selectGoalVisualSurface(visualInput);
    this.#last = {
      status: "previewed",
      goalCategory: category,
      decisionLevel,
      visualSurface,
      stepCount: input.stepCount,
      currentStepIndex: input.currentStepIndex,
      updatedAt: new Date().toISOString(),
      executable: false,
      actionsExecuted: false,
      confirmationTokensCreated: false,
      redacted: true
    };
    return { ...this.#last };
  }

  /** Builds one bounded, non-executable goal/plan/route projection. It never invokes a route. */
  previewPlan(input: GoalPlanPreviewInput, context: GoalPlanBuildContext): GoalPlanningProjection {
    const base = this.preview(input);
    const category: AgentGoalCategory = AGENT_GOAL_CATEGORIES.includes(input.goalCategory as AgentGoalCategory)
      ? input.goalCategory as AgentGoalCategory
      : "unknown";
    const timestamp = new Date();
    const createdAt = timestamp.toISOString();
    const expiresAt = new Date(timestamp.getTime() + 15 * 60_000).toISOString();
    const requestedEffect = input.requestedEffect ?? "observe";
    // Guide/preview route must not rewrite user-requested effect. It is a
    // recovery route for the same goal, not permission to change its effect.
    const effect: GoalEffect = requestedEffect;
    const stepTotal = Math.max(1, Math.min(12, Math.floor(input.stepCount || 1)));
    const allowedEffects: GoalEffect[] = [...new Set<GoalEffect>([...(input.allowedEffects ?? [effect]), "visual_assistance"] )];
    const prohibitedEffects: GoalEffect[] = [...new Set<GoalEffect>(input.prohibitedEffects ?? [])];
    const constraints = [...new Set(input.constraints ?? ["local_only", "operator_present", "no_background", "no_retry"])];
    if (effect === "observe" && !constraints.includes("read_only")) constraints.push("read_only");
    const requiredConfirmations = input.requiredConfirmations ?? (effect === "observe" || effect === "visual_assistance" ? ["none"] : ["before_state_change"]);
    const goal: AgentGoal = {
      schemaVersion: 1,
      goalId: `goal_${randomUUID()}`,
      ownerSessionId: context.ownerSessionId,
      category,
      summary: workflowValueSummary(input.goalSummary ?? `Bounded ${category.replaceAll("_", " ")} goal`),
      desiredOutcome: workflowValueSummary(input.desiredOutcome ?? "Required bounded success criteria are verified."),
      successCriteria: [{ criterionId: "criterion_verified", kind: "checkpoint_passed", summary: "Required bounded verification passes.", required: true }],
      constraints: constraints as AgentGoal["constraints"],
      allowedEffects,
      prohibitedEffects,
      requiredConfirmations,
      privacy: input.privacy ?? (input.sensitiveExternalEffect ? "private" : "public"),
      ...(input.appFamily === undefined ? {} : { appFamily: input.appFamily }),
      priority: "normal",
      executionBudget: { maxSteps: stepTotal, maxDurationMs: 120_000, maxExternalEffects: effect === "observe" || effect === "visual_assistance" ? 0 : stepTotal, maxUserInterruptions: 1 },
      fallbackPolicy: { allowed: true, maxFallbacksPerStep: 2, maxReplans: 3, allowGuideMode: true },
      verification: { mode: "all_required", minimumStrength: context.routeSelection?.selectedRoute === "guide_only" ? "strong" : "medium", independentObservationRequired: true },
      status: input.goalStatus,
      createdAt,
      updatedAt: createdAt,
      expiresAt,
      redacted: true
    };
    const routeFamily = context.routeSelection?.selectedRoute ?? "guide_only";
    const routeDefinition = routeDefinitionFor(routeFamily, effect);
    const checkpoints: VerificationCheckpoint[] = Array.from({ length: stepTotal }, (_, index) => ({
      checkpointId: `checkpoint_${index}`,
      kind: routeDefinition.checkpointKind,
      summary: "Fresh bounded state observation is required.",
      sensitivity: goal.privacy,
      required: true,
      minimumStrength: goal.verification.minimumStrength,
      completionCondition: routeDefinition.completionCondition,
      timeoutMs: 10_000,
      status: "pending" as const
    }));
    const steps: PlanStep[] = Array.from({ length: stepTotal }, (_, index) => ({
      stepId: `step_${index}`,
      order: index,
      operation: routeDefinition.operation,
      requiredCapability: routeDefinition.capability,
      allowedRoutes: [routeFamily],
      expectedEffect: routeDefinition.effect,
      expectedExecutionClass: routeDefinition.executionClass,
      riskLevel: input.riskLevel ?? "observe",
      grounding: routeDefinition.grounding,
      confirmation: requiredConfirmations[0] ?? "none",
      timeoutMs: 30_000,
      retryLimit: 0,
      fallbackBudget: 2,
      dependencyStepIds: index === 0 ? [] : [`step_${index - 1}`],
      verificationCheckpointIds: [`checkpoint_${index}`],
      completionCondition: routeDefinition.completionCondition,
      safeFailureCodes: ["capability_unavailable", "verification_failed", "target_stale", "timeout"]
    }));
    const currentStepIndex = Math.min(Math.max(0, input.currentStepIndex), stepTotal - 1);
    const plan: ExecutionPlan = {
      schemaVersion: 1,
      planId: `plan_${randomUUID()}`,
      goalId: goal.goalId,
      revision: 1,
      assumptions: ["Capability health and target state are rechecked before any governed action."],
      prerequisites: [{ capability: routeDefinition.capability, requiredHealth: "healthy" }],
      steps,
      permittedRouteFamilies: [routeFamily],
      checkpoints,
      expectedEffects: [routeDefinition.effect],
      confirmationBoundaries: requiredConfirmations,
      expectedLatencyMs: 300,
      expectedCostClass: routeDefinition.effect === "observe" ? "low" : "medium",
      uncertainty: context.routeSelection?.selectedRoute === undefined ? "high" : "medium",
      fallbackBudget: 2,
      replanBudget: 3,
      currentStepIndex,
      state: input.blocked || context.routeSelection?.selectedRoute === undefined ? "blocked" : "selected",
      createdAt,
      updatedAt: createdAt,
      expiresAt,
      executable: false,
      redacted: true
    };
    const goalErrors = validateAgentGoal(goal);
    const planErrors = validateExecutionPlan(plan, goal);
    if (goalErrors.length > 0 || planErrors.length > 0) throw new Error("goal_plan_preview_invalid");
    const route = context.routeSelection?.selectedRoute === undefined ? undefined : {
      routeId: `route_${randomUUID()}`,
      planId: plan.planId,
      stepId: steps[currentStepIndex]?.stepId ?? "step_0",
      family: routeFamily,
      health: context.routeSelection.selectedRoute === "guide_only" ? "healthy" : "degraded",
      verificationStrength: goal.verification.minimumStrength,
      latencyClass: "moderate",
      riskLevel: steps[currentStepIndex]?.riskLevel ?? "observe",
      expectedEffect: steps[currentStepIndex]?.expectedEffect ?? routeDefinition.effect,
      requiresConfirmation: (steps[currentStepIndex]?.confirmation ?? "none") !== "none",
      reasonCode: context.routeSelection.reasonCode === "healthy_verified_route" ? "healthy_verified_route" : "bounded_safe_route",
      selectedAt: createdAt,
      expiresAt,
      executable: false as const
    } satisfies ActionRoute;
    const candidateRoutes = context.routeSelection === undefined || context.routeSelection.candidates.length === 0
      ? [{ routeFamily, eligible: true, reasonCode: "eligible" }]
      : context.routeSelection.candidates.slice(0, 4).map((candidate) => ({
        routeFamily: candidate.routeFamily,
        eligible: candidate.compatible !== false && candidate.health !== "unavailable" && candidate.riskLevel !== "blocked",
        reasonCode: candidate.unavailableReason ?? "eligible"
      }));
    const candidatePlans = context.routeSelection === undefined || context.routeSelection.candidates.length === 0
      ? [{ routeFamily, selected: route !== undefined, eligible: true, safety: "safe" as const, verificationStrength: goal.verification.minimumStrength, estimatedLatencyMs: plan.expectedLatencyMs, reasonCode: "eligible" }]
      : context.routeSelection.candidates.slice(0, 4).map((candidate) => ({
        routeFamily: candidate.routeFamily,
        selected: candidate.routeFamily === context.routeSelection?.selectedRoute,
        eligible: candidate.compatible !== false && candidate.health !== "unavailable" && candidate.riskLevel !== "blocked",
        safety: candidate.riskLevel === "blocked" || candidate.compatible === false || candidate.health === "unavailable" ? "blocked" as const : candidate.riskLevel === "observe" && candidate.verificationStrength === "strong" ? "safe" as const : "conditional" as const,
        verificationStrength: candidate.verificationStrength,
        estimatedLatencyMs: Math.min(86_400_000, Math.max(0, Math.round(candidate.estimatedProbeMs + candidate.estimatedSetupMs + candidate.estimatedExecutionMs + candidate.estimatedVerificationMs))),
        reasonCode: candidate.unavailableReason ?? (candidate.routeFamily === context.routeSelection?.selectedRoute ? context.routeSelection.reasonCode : "deferred_lower_rank")
      }));
    this.#last = {
      ...base,
      goal,
      plan,
      ...(route === undefined ? {} : { route }),
      candidatePlanCount: Math.min(4, context.routeSelection?.candidates.length ?? 1),
      candidateRoutes,
      candidatePlans
    };
    return { ...this.#last };
  }

  summary(): Record<string, unknown> {
    return { ...this.#last };
  }
}

function routeDefinitionFor(family: CapabilityRouteFamily, effect: GoalEffect): {
  capability: PlanCapabilityFamily;
  operation: PlanOperationCategory;
  grounding: PlanStep["grounding"];
  completionCondition: PlanStep["completionCondition"];
  checkpointKind: VerificationCheckpoint["kind"];
  executionClass: PlanStep["expectedExecutionClass"];
  effect: GoalEffect;
} {
  if (family === "guide_only") {
    const readOnly = effect === "observe" || effect === "inspect_private_data";
    return { capability: "guide", operation: "wait_for_operator", grounding: "operator_observation", completionCondition: "operator_acknowledges", checkpointKind: "operator_acknowledgement", executionClass: readOnly ? "visual_only" : "state_changing", effect: readOnly ? "visual_assistance" : effect };
  }
  const readOnly = effect === "observe" || effect === "inspect_private_data";
  if (family === "browser_bridge" || family === "structured_browser") return { capability: "browser", operation: readOnly ? "inspect_state" : "navigate", grounding: "live_browser_state", completionCondition: "checkpoint_passes", checkpointKind: "browser_state", executionClass: readOnly ? "read_only" : "state_changing", effect };
  if (family === "native_adapter") return { capability: "native_adapter", operation: readOnly ? "inspect_state" : "change_application_state", grounding: "live_application_state", completionCondition: readOnly ? "checkpoint_passes" : "state_change_verified", checkpointKind: "application_state", executionClass: readOnly ? "read_only" : "state_changing", effect };
  if (family === "accessibility") return { capability: "accessibility", operation: readOnly ? "inspect_state" : "change_application_state", grounding: "fresh_accessibility_state", completionCondition: readOnly ? "checkpoint_passes" : "state_change_verified", checkpointKind: "accessibility_state", executionClass: readOnly ? "read_only" : "state_changing", effect };
  if (family === "local_ocr" || family === "screenshot_vision") return { capability: "vision", operation: "inspect_state", grounding: family === "local_ocr" ? "fresh_screenshot" : "fresh_vision_target", completionCondition: "checkpoint_passes", checkpointKind: "vision_state", executionClass: "read_only", effect: "observe" };
  if (family === "desktop_input") return { capability: "desktop", operation: "change_application_state", grounding: "operator_observation", completionCondition: "state_change_verified", checkpointKind: "application_state", executionClass: "state_changing", effect };
  return { capability: "guide", operation: "check_prerequisite", grounding: "none", completionCondition: "observation_matches", checkpointKind: "operator_acknowledgement", executionClass: "diagnostic", effect: "observe" };
}
