import { toolFailure, toolSuccess } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";
import type { GoalPlanPreviewInput } from "../goal-planning-service.js";

const inputSchema = z.object({
  goalCategory: z.string().trim().min(1).max(80).regex(/^[a-z][a-z0-9_.-]*$/u),
  goalStatus: z.enum(["proposed", "clarified", "ready", "active", "waiting_for_user", "waiting_for_approval", "blocked", "completed", "failed", "cancelled", "expired"]).default("proposed"),
  planState: z.enum(["draft", "selected", "active", "waiting", "replanning", "blocked", "completed", "failed", "cancelled", "superseded"]).optional(),
  knownOperationCount: z.number().int().min(0).max(12).default(0),
  healthyRouteCount: z.number().int().min(0).max(8).default(0),
  decompositionRequired: z.boolean().default(false),
  directVerificationAvailable: z.boolean().default(false),
  activeVerifiedStrategy: z.boolean().default(false),
  materiallyAmbiguous: z.boolean().default(false),
  sensitiveExternalEffect: z.boolean().default(false),
  guideModeRequired: z.boolean().default(false),
  stepCount: z.number().int().min(0).max(12).default(0),
  currentStepIndex: z.number().int().min(0).max(12).default(0),
  expectedRemainingMs: z.number().int().min(0).max(86_400_000).default(0),
  waitingForApproval: z.boolean().default(false),
  blocked: z.boolean().default(false),
  recovering: z.boolean().default(false),
  choiceCount: z.number().int().min(0).max(4).default(0),
  goalSummary: z.string().trim().max(240).optional(),
  desiredOutcome: z.string().trim().max(500).optional(),
  requestedEffect: z.enum(["observe", "inspect_private_data", "local_metadata_write", "local_file_create", "local_file_modify", "application_state_change", "browser_navigation", "form_draft", "communication_send", "external_submit", "upload", "delete", "payment", "local_audio", "visual_assistance"]).optional(),
  privacy: z.enum(["public", "private", "secret"]).optional(),
  appFamily: z.enum(["browser", "communication", "office", "development", "media", "system", "unknown"]).optional(),
  riskLevel: z.enum(["observe", "low", "medium", "high", "blocked"]).optional(),
  constraints: z.array(z.enum(["local_only", "operator_present", "read_only", "no_external_send", "no_submit", "no_upload", "no_delete", "no_payment", "no_credentials", "no_private_data", "no_background", "no_retry"])).max(12).optional(),
  allowedEffects: z.array(z.enum(["observe", "inspect_private_data", "local_metadata_write", "local_file_create", "local_file_modify", "application_state_change", "browser_navigation", "form_draft", "communication_send", "external_submit", "upload", "delete", "payment", "local_audio", "visual_assistance"])).max(10).optional(),
  prohibitedEffects: z.array(z.enum(["observe", "inspect_private_data", "local_metadata_write", "local_file_create", "local_file_modify", "application_state_change", "browser_navigation", "form_draft", "communication_send", "external_submit", "upload", "delete", "payment", "local_audio", "visual_assistance"])).max(15).optional(),
  requiredConfirmations: z.array(z.enum(["none", "before_state_change", "before_private_read", "before_external_effect", "before_target_change", "every_state_change"])).max(6).optional()
}).strict();

const readOnly = {
  executionClass: "read_only" as const,
  externalEffect: false,
  requiresDryRun: false,
  requiresConfirmationToken: false,
  requiresExactTarget: false,
  source: "base" as const,
  availability: "available" as const
};

type GoalPlanningInput = z.input<typeof inputSchema>;
export function createGoalPlanningTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const tool: AgentHostToolDefinition<GoalPlanningInput, unknown, AgentHostMcpContext> = {
    name: "strategy.goal_plan_preview",
    description: "Previews bounded goal decision level and visual surface choice without executing a plan.",
    riskLevel: "observe",
    inputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        goalCategory: { type: "string", minLength: 1, maxLength: 80 },
        goalStatus: { type: "string" },
        planState: { type: "string", enum: ["draft", "selected", "active", "waiting", "replanning", "blocked", "completed", "failed", "cancelled", "superseded"] },
        knownOperationCount: { type: "integer", minimum: 0, maximum: 12 },
        healthyRouteCount: { type: "integer", minimum: 0, maximum: 8 },
        decompositionRequired: { type: "boolean" },
        directVerificationAvailable: { type: "boolean" },
        activeVerifiedStrategy: { type: "boolean" },
        materiallyAmbiguous: { type: "boolean" },
        sensitiveExternalEffect: { type: "boolean" },
        guideModeRequired: { type: "boolean" },
        stepCount: { type: "integer", minimum: 0, maximum: 12 },
        currentStepIndex: { type: "integer", minimum: 0, maximum: 12 },
        expectedRemainingMs: { type: "integer", minimum: 0, maximum: 86400000 },
        waitingForApproval: { type: "boolean" },
        blocked: { type: "boolean" },
        recovering: { type: "boolean" },
        choiceCount: { type: "integer", minimum: 0, maximum: 4 }
        ,goalSummary: { type: "string", maxLength: 240 },
        desiredOutcome: { type: "string", maxLength: 500 },
        requestedEffect: { type: "string" },
        privacy: { type: "string", enum: ["public", "private", "secret"] },
        appFamily: { type: "string", enum: ["browser", "communication", "office", "development", "media", "system", "unknown"] },
        riskLevel: { type: "string", enum: ["observe", "low", "medium", "high", "blocked"] },
        constraints: { type: "array", maxItems: 12, items: { type: "string" } },
        allowedEffects: { type: "array", maxItems: 10, items: { type: "string" } },
        prohibitedEffects: { type: "array", maxItems: 15, items: { type: "string" } },
        requiredConfirmations: { type: "array", maxItems: 6, items: { type: "string" } }
      },
      required: ["goalCategory"],
      additionalProperties: false
    },
    inputSummary: "Preview bounded goal planning state",
    execution: readOnly,
    safety: { actionType: "inspect" },
    async handler(input, context) {
      try {
        const normalized = inputSchema.parse(input);
        if (context.goalPlanning === undefined) throw new Error("goal_planner_unavailable");
        const previewInput: GoalPlanPreviewInput = {
          goalCategory: normalized.goalCategory,
          goalStatus: normalized.goalStatus,
          ...(normalized.planState === undefined ? {} : { planState: normalized.planState }),
          knownOperationCount: normalized.knownOperationCount,
          healthyRouteCount: normalized.healthyRouteCount,
          decompositionRequired: normalized.decompositionRequired,
          directVerificationAvailable: normalized.directVerificationAvailable,
          activeVerifiedStrategy: normalized.activeVerifiedStrategy,
          materiallyAmbiguous: normalized.materiallyAmbiguous,
          sensitiveExternalEffect: normalized.sensitiveExternalEffect,
          guideModeRequired: normalized.guideModeRequired,
          stepCount: normalized.stepCount,
          currentStepIndex: normalized.currentStepIndex,
          expectedRemainingMs: normalized.expectedRemainingMs,
          waitingForApproval: normalized.waitingForApproval,
          blocked: normalized.blocked,
          recovering: normalized.recovering,
          guideMode: normalized.guideModeRequired,
          choiceCount: normalized.choiceCount
        };
        for (const key of ["goalSummary", "desiredOutcome", "requestedEffect", "privacy", "appFamily", "riskLevel", "constraints", "allowedEffects", "prohibitedEffects", "requiredConfirmations"] as const) {
          const value = normalized[key];
          if (value !== undefined) (previewInput as unknown as Record<string, unknown>)[key] = value;
        }
        let routeSelection;
        if (context.routeRouter !== undefined) {
          routeSelection = await context.routeRouter.preview({
            registry: context.registry,
            adapters: context.adapters,
            profile: context.policy.name,
            ...(context.browser === undefined ? {} : { browser: context.browser }),
            ...(context.browserBridge === undefined ? {} : { browserBridge: context.browserBridge }),
            ...(context.bridgeProbeCache === undefined ? {} : { bridgeProbeCache: context.bridgeProbeCache }),
            ...(context.failureMemory === undefined ? {} : { failureMemory: { list: (options) => context.failureMemory!.list(options) } })
          }, {
            goalCategory: normalized.goalCategory,
            ...(normalized.appFamily === undefined ? {} : { appFamily: normalized.appFamily }),
            riskLevel: normalized.riskLevel ?? (normalized.sensitiveExternalEffect ? "medium" : "observe"),
            protectedContext: normalized.sensitiveExternalEffect,
            requiresConfirmation: normalized.requiredConfirmations?.some((item) => item !== "none") ?? normalized.sensitiveExternalEffect
          });
        }
        const plan = context.goalPlanning.previewPlan(previewInput, { ownerSessionId: context.sessionId, ...(routeSelection === undefined ? {} : { routeSelection }) });
        return toolSuccess({
          tool: "strategy.goal_plan_preview",
          riskLevel: "observe",
          data: {
            goalCategory: normalized.goalCategory,
            ...plan,
            bounded: { maxSteps: 12, maxFallbacks: 2, maxReplans: 3, retriesPerStep: 1 },
            executable: false,
            actionsExecuted: false,
            confirmationTokensCreated: false,
            redacted: true
          },
          observations: ["Advisory planning preview only; no route, tool, confirmation, or permission was created."]
        });
      } catch (error) {
        return toolFailure({ tool: "strategy.goal_plan_preview", riskLevel: "observe", error: { code: error instanceof Error ? error.message : "goal_plan_preview_failed", message: "Goal planning preview failed safely." } });
      }
    }
  };
  return [tool];
}
