import {
  evaluateSafety,
  toolFailure,
  toolSuccess,
  type AccessibilityFindElementResult,
  type AccessibilityFocusElementResult,
  type AccessibilityInspectElementResult,
  type AccessibilityInvokeActionResult,
  type AccessibilitySetValueResult,
  type AccessibilityTreeResult,
  type ActionPreviewResult,
  type DataSensitivity,
  type ToolResult
} from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type {
  AgentHostToolDefinition,
  AnyAgentHostToolDefinition,
  ToolExecutionRuntime
} from "../tool-runner.js";
import {
  acceptedConfirmation,
  buildPreviewResult,
  confirmationRequired,
  guideAlternative,
  inspectElementAlternative,
  rejectedConfirmation,
  summarizeAccessibilityElement,
  toAccessibilityPreviewTarget
} from "./preview.js";

const appNameSchema = z.string().trim().min(1).max(200);
const querySchema = z.string().trim().min(1).max(500);
const roleSchema = z.string().trim().min(1).max(100);
const elementIdSchema = z.string().trim().min(1).max(200);
const windowIdSchema = z.string().trim().min(1).max(200);

const getTreeInputSchema = z
  .object({
    appName: appNameSchema.optional(),
    windowId: windowIdSchema.optional(),
    pid: z.number().int().min(1).optional(),
    maxDepth: z.number().int().min(1).max(6).optional(),
    maxNodes: z.number().int().min(1).max(1000).optional(),
    includeText: z.boolean().optional()
  })
  .strict();

const findElementInputSchema = z
  .object({
    appName: appNameSchema.optional(),
    windowId: windowIdSchema.optional(),
    pid: z.number().int().min(1).optional(),
    query: querySchema,
    role: roleSchema.optional(),
    limit: z.number().int().min(1).max(50).optional()
  })
  .strict();

const targetInputObject = z
  .object({
    appName: appNameSchema.optional(),
    windowId: windowIdSchema.optional(),
    pid: z.number().int().min(1).optional(),
    elementId: elementIdSchema.optional(),
    query: querySchema.optional(),
    role: roleSchema.optional()
  })
  .strict();

const requireElementTarget = (input: { elementId?: string | undefined; query?: string | undefined }, ctx: z.RefinementCtx) => {
  if (input.elementId === undefined && input.query === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Accessibility target must include either elementId or query."
    });
  }
};

const targetInputSchema = targetInputObject.superRefine(requireElementTarget);
const inspectInputSchema = targetInputSchema;

const invokeActionInputSchema = targetInputObject
  .extend({
    actionName: z.string().trim().min(1).max(100),
    requireExactMatch: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    confirmationToken: z.string().trim().min(1).max(500).optional()
  })
  .superRefine(requireElementTarget);

const setValueInputSchema = targetInputObject
  .extend({
    value: z.string().min(1).max(10_000),
    dataSensitivity: z.enum(["none", "low", "sensitive", "secret"]).optional(),
    dryRun: z.boolean().optional(),
    confirmationToken: z.string().trim().min(1).max(500).optional()
  })
  .superRefine(requireElementTarget);

const focusElementInputSchema = targetInputObject
  .extend({
    dryRun: z.boolean().optional(),
    confirmationToken: z.string().trim().min(1).max(500).optional()
  })
  .superRefine(requireElementTarget);

type GetTreeInput = z.infer<typeof getTreeInputSchema>;
type FindElementInput = z.infer<typeof findElementInputSchema>;
type InspectInput = z.infer<typeof inspectInputSchema>;
type InvokeActionInput = z.infer<typeof invokeActionInputSchema>;
type SetValueInput = z.infer<typeof setValueInputSchema>;
type FocusElementInput = z.infer<typeof focusElementInputSchema>;

const DATA_SENSITIVITY_ORDER: DataSensitivity[] = ["none", "low", "sensitive", "secret"];

function strongerDataSensitivity(
  a: DataSensitivity | undefined,
  b: DataSensitivity | undefined
): DataSensitivity | undefined {
  if (a === undefined) {
    return b;
  }

  if (b === undefined) {
    return a;
  }

  return DATA_SENSITIVITY_ORDER.indexOf(a) >= DATA_SENSITIVITY_ORDER.indexOf(b) ? a : b;
}

function toTargetInput(input: InspectInput | InvokeActionInput | SetValueInput | FocusElementInput) {
  return {
    ...(input.appName === undefined ? {} : { appName: input.appName }),
    ...(input.windowId === undefined ? {} : { windowId: input.windowId }),
    ...(input.pid === undefined ? {} : { pid: input.pid }),
    ...(input.elementId === undefined ? {} : { elementId: input.elementId }),
    ...(input.query === undefined ? {} : { query: input.query }),
    ...(input.role === undefined ? {} : { role: input.role })
  };
}

function toTreeInput(input: GetTreeInput) {
  return {
    ...(input.appName === undefined ? {} : { appName: input.appName }),
    ...(input.windowId === undefined ? {} : { windowId: input.windowId }),
    ...(input.pid === undefined ? {} : { pid: input.pid }),
    ...(input.maxDepth === undefined ? {} : { maxDepth: input.maxDepth }),
    ...(input.maxNodes === undefined ? {} : { maxNodes: input.maxNodes }),
    ...(input.includeText === undefined ? {} : { includeText: input.includeText })
  };
}

function toFindElementInput(input: FindElementInput) {
  return {
    ...(input.appName === undefined ? {} : { appName: input.appName }),
    ...(input.windowId === undefined ? {} : { windowId: input.windowId }),
    ...(input.pid === undefined ? {} : { pid: input.pid }),
    query: input.query,
    ...(input.role === undefined ? {} : { role: input.role }),
    ...(input.limit === undefined ? {} : { limit: input.limit })
  };
}

function safetyFailure(tool: string, safety: ReturnType<typeof evaluateSafety>): ToolResult<never> {
  return toolFailure({
    tool,
    riskLevel: safety.riskLevel,
    approval: safety.approval,
    error: {
      code: safety.blocked ? "safety_blocked" : "approval_required",
      message: safety.blocked
        ? "Tool execution was blocked by the safety engine."
        : "Tool execution requires approval before it can run.",
      details: safety
    },
    observations: safety.reasons
  });
}

function inspectFromAction(input: InspectInput | InvokeActionInput | SetValueInput | FocusElementInput) {
  return toTargetInput(input);
}

function previewReasons(primaryReason: string, safetyReasons: string[]): string[] {
  return safetyReasons.includes(primaryReason) ? safetyReasons : [primaryReason, ...safetyReasons];
}

function initialSafetyForPreview(
  runtime: ToolExecutionRuntime | undefined,
  tool: "accessibility.invoke_action" | "accessibility.set_value" | "accessibility.focus_element",
  actionType: "accessibility_action" | "accessibility_set_value" | "accessibility_focus",
  context: AgentHostMcpContext,
  input: InvokeActionInput | SetValueInput | FocusElementInput
) {
  if (runtime?.safetyDecision !== undefined) {
    return runtime.safetyDecision;
  }

  return evaluateSafety(
    {
      tool,
      actionType,
      ...(input.appName === undefined ? {} : { appName: input.appName }),
      ...("dataSensitivity" in input && input.dataSensitivity !== undefined
        ? { dataSensitivity: input.dataSensitivity }
        : {})
    },
    context.policy,
    { agentHostDir: context.config.agentHostDir }
  );
}

export function createAccessibilityTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const getTree: AgentHostToolDefinition<GetTreeInput, AccessibilityTreeResult, AgentHostMcpContext> = {
    name: "accessibility.get_tree",
    description: "Returns a capped, redacted accessibility tree when a safe backend is available.",
    riskLevel: "low",
    inputSchema: getTreeInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        appName: { type: "string", minLength: 1, maxLength: 200 },
        windowId: { type: "string", minLength: 1, maxLength: 200 },
        pid: { type: "integer", minimum: 1 },
        maxDepth: { type: "integer", minimum: 1, maximum: 6 },
        maxNodes: { type: "integer", minimum: 1, maximum: 1000 },
        includeText: { type: "boolean" }
      },
      additionalProperties: false
    },
    inputSummary: "Get accessibility tree",
    safety: {
      actionType: "inspect",
      getInput: (input) => (input.appName === undefined ? {} : { appName: input.appName })
    },
    async handler(input, context): Promise<ToolResult<AccessibilityTreeResult>> {
      return toolSuccess({
        tool: "accessibility.get_tree",
        riskLevel: "low",
        strategy: "accessibility",
        data: await context.linux.getAccessibilityTree(toTreeInput(input)),
        observations: ["Read capped accessibility data through a safe backend when available."]
      });
    }
  };

  const findElement: AgentHostToolDefinition<FindElementInput, AccessibilityFindElementResult, AgentHostMcpContext> = {
    name: "accessibility.find_element",
    description: "Finds candidate UI elements from accessibility data without acting on them.",
    riskLevel: "low",
    inputSchema: findElementInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        appName: { type: "string", minLength: 1, maxLength: 200 },
        windowId: { type: "string", minLength: 1, maxLength: 200 },
        pid: { type: "integer", minimum: 1 },
        query: { type: "string", minLength: 1, maxLength: 500 },
        role: { type: "string", minLength: 1, maxLength: 100 },
        limit: { type: "integer", minimum: 1, maximum: 50 }
      },
      required: ["query"],
      additionalProperties: false
    },
    inputSummary: "Find accessibility element",
    safety: {
      actionType: "inspect",
      getInput: (input) => (input.appName === undefined ? {} : { appName: input.appName })
    },
    async handler(input, context): Promise<ToolResult<AccessibilityFindElementResult>> {
      return toolSuccess({
        tool: "accessibility.find_element",
        riskLevel: "low",
        strategy: "accessibility",
        data: await context.linux.findAccessibilityElement(toFindElementInput(input)),
        observations: ["Found accessibility element candidates without acting on them."]
      });
    }
  };

  const inspectElement: AgentHostToolDefinition<InspectInput, AccessibilityInspectElementResult, AgentHostMcpContext> = {
    name: "accessibility.inspect_element",
    description: "Returns capped, redacted metadata about one resolved accessibility element.",
    riskLevel: "low",
    inputSchema: inspectInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        appName: { type: "string", minLength: 1, maxLength: 200 },
        windowId: { type: "string", minLength: 1, maxLength: 200 },
        pid: { type: "integer", minimum: 1 },
        elementId: { type: "string", minLength: 1, maxLength: 200 },
        query: { type: "string", minLength: 1, maxLength: 500 },
        role: { type: "string", minLength: 1, maxLength: 100 }
      },
      additionalProperties: false
    },
    inputSummary: "Inspect accessibility element",
    safety: {
      actionType: "inspect",
      getInput: (input) => (input.appName === undefined ? {} : { appName: input.appName })
    },
    async handler(input, context): Promise<ToolResult<AccessibilityInspectElementResult>> {
      return toolSuccess({
        tool: "accessibility.inspect_element",
        riskLevel: "low",
        strategy: "accessibility",
        data: await context.linux.inspectAccessibilityElement(toTargetInput(input)),
        observations: ["Inspected one resolved accessibility element without acting on it."]
      });
    }
  };

  const invokeAction: AgentHostToolDefinition<
    InvokeActionInput,
    AccessibilityInvokeActionResult | ActionPreviewResult,
    AgentHostMcpContext
  > = {
    name: "accessibility.invoke_action",
    description: "Invokes a named AT-SPI accessibility action on one resolved element.",
    riskLevel: "medium",
    inputSchema: invokeActionInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        appName: { type: "string", minLength: 1, maxLength: 200 },
        windowId: { type: "string", minLength: 1, maxLength: 200 },
        pid: { type: "integer", minimum: 1 },
        elementId: { type: "string", minLength: 1, maxLength: 200 },
        query: { type: "string", minLength: 1, maxLength: 500 },
        role: { type: "string", minLength: 1, maxLength: 100 },
        actionName: { type: "string", minLength: 1, maxLength: 100 },
        requireExactMatch: { type: "boolean" },
        dryRun: { type: "boolean" },
        confirmationToken: { type: "string", minLength: 1, maxLength: 500 }
      },
      required: ["actionName"],
      additionalProperties: false
    },
    inputSummary: "Invoke accessibility action",
    safety: {
      actionType: "accessibility_action",
      getInput: (input) => (input.appName === undefined ? {} : { appName: input.appName })
    },
    preview: {
      isDryRun: (input) => input.dryRun === true
    },
    async handler(input, context, runtime): Promise<ToolResult<AccessibilityInvokeActionResult | ActionPreviewResult>> {
      const inspected = await context.linux.inspectAccessibilityElement(inspectFromAction(input));

      if (runtime?.isDryRun) {
        const preflightSafety = initialSafetyForPreview(
          runtime,
          "accessibility.invoke_action",
          "accessibility_action",
          context,
          input
        );
        const unresolvedSummary =
          input.elementId !== undefined ? `Accessibility element ${input.elementId}` : `Accessibility query "${input.query}"`;

        if (!inspected.supported || !inspected.matched || inspected.ambiguous || inspected.element === undefined) {
          return buildPreviewResult({
            tool: "accessibility.invoke_action",
            riskLevel: "medium",
            strategy: "accessibility",
            safety: preflightSafety,
            targetSummary: inspected.element === undefined ? unresolvedSummary : summarizeAccessibilityElement(inspected.element),
            ...(inspected.element === undefined ? {} : { target: toAccessibilityPreviewTarget(inspected.element) }),
            supported: inspected.supported,
            backend: inspected.backend,
            ambiguous: inspected.ambiguous,
            wouldExecute: false,
            reasons: previewReasons(inspected.reason, preflightSafety.reasons),
            saferAlternative: inspected.ambiguous
              ? inspectElementAlternative("Resolve the exact target with elementId before invoking an accessibility action.")
              : undefined,
            observations: ["Previewed accessibility action resolution without invoking the action."]
          });
        }

        const postResolutionSafety = evaluateSafety(
          {
            tool: "accessibility.invoke_action",
            actionType: "accessibility_action",
            strategy: "accessibility",
            ...(inspected.element.appName === undefined ? {} : { appName: inspected.element.appName }),
            ...(inspected.element.dataSensitivity === undefined ? {} : { dataSensitivity: inspected.element.dataSensitivity })
          },
          context.policy,
          { agentHostDir: context.config.agentHostDir }
        );
        const actionAvailable = inspected.element.availableActions.includes(input.actionName);
        const availabilityReason = actionAvailable
          ? `The action "${input.actionName}" is available on the resolved element.`
          : `The action "${input.actionName}" is not advertised by the resolved element.`;

        return buildPreviewResult({
          tool: "accessibility.invoke_action",
          riskLevel: "medium",
          strategy: "accessibility",
          safety: postResolutionSafety,
          targetSummary: summarizeAccessibilityElement(inspected.element),
          target: toAccessibilityPreviewTarget(inspected.element),
          dataSensitivity: inspected.element.dataSensitivity,
          supported: inspected.supported,
          backend: inspected.backend,
          wouldExecute: actionAvailable && postResolutionSafety.allowed,
          confirmation: {
            manager: context.confirmations,
            sessionId: context.sessionId,
            input,
            target: inspected.element,
            explanation: "Use this token to invoke the exact previewed accessibility action before it expires.",
            riskLevel: postResolutionSafety.riskLevel,
            appSensitivity: postResolutionSafety.appSensitivity,
            dataSensitivity: inspected.element.dataSensitivity
          },
          reasons: previewReasons(availabilityReason, postResolutionSafety.reasons),
          saferAlternative: postResolutionSafety.blocked
            ? guideAlternative("Sensitive or blocked accessibility actions should stay in guide mode.")
            : undefined,
          observations: ["Previewed the accessibility action without invoking it."]
        });
      }

      if (!inspected.supported || !inspected.matched || inspected.ambiguous || inspected.element === undefined) {
        return toolSuccess({
          tool: "accessibility.invoke_action",
          riskLevel: "medium",
          strategy: "accessibility",
          data: {
            supported: inspected.supported,
            backend: inspected.backend,
            matched: inspected.matched,
            ambiguous: inspected.ambiguous,
            performed: false,
            redacted: inspected.redacted,
            actionName: input.actionName,
            reason: inspected.reason,
            ...(inspected.element === undefined ? {} : { target: inspected.element })
          },
          observations: ["Resolved the accessibility target before deciding whether to act."]
        });
      }

      const postResolutionSafety = evaluateSafety(
        {
          tool: "accessibility.invoke_action",
          actionType: "accessibility_action",
          strategy: "accessibility",
          ...(inspected.element.appName === undefined ? {} : { appName: inspected.element.appName }),
          ...(inspected.element.dataSensitivity === undefined ? {} : { dataSensitivity: inspected.element.dataSensitivity })
        },
        context.policy,
        { agentHostDir: context.config.agentHostDir }
      );

      if (!postResolutionSafety.allowed) {
        return safetyFailure("accessibility.invoke_action", postResolutionSafety);
      }

      if (input.confirmationToken === undefined) {
        const reason = "Execution requires a fresh dry-run preview confirmation token.";
        return toolFailure({
          tool: "accessibility.invoke_action",
          riskLevel: postResolutionSafety.riskLevel,
          strategy: "accessibility",
          confirmation: confirmationRequired(reason),
          error: {
            code: "confirmation_required",
            message: reason
          },
          observations: [reason]
        });
      }

      const verification = context.confirmations.verifyAndConsume(input.confirmationToken, {
        sessionId: context.sessionId,
        tool: "accessibility.invoke_action",
        input,
        target: inspected.element,
        riskLevel: postResolutionSafety.riskLevel
      });

      if (!verification.ok) {
        return toolFailure({
          tool: "accessibility.invoke_action",
          riskLevel: postResolutionSafety.riskLevel,
          strategy: "accessibility",
          confirmation: rejectedConfirmation(verification.tokenId, verification.reason),
          error: {
            code: "confirmation_rejected",
            message: verification.reason
          },
          observations: [verification.reason]
        });
      }

      return toolSuccess({
        tool: "accessibility.invoke_action",
        riskLevel: "medium",
        strategy: "accessibility",
        confirmation: acceptedConfirmation(verification.tokenId, true, "Confirmation token accepted and accessibility action executed."),
        data: await context.linux.invokeAccessibilityAction({
          ...(inspected.element.appName === undefined ? {} : { appName: inspected.element.appName }),
          ...(inspected.element.pid === undefined ? {} : { pid: inspected.element.pid }),
          elementId: inspected.element.elementId,
          actionName: input.actionName,
          ...(input.requireExactMatch === undefined ? {} : { requireExactMatch: input.requireExactMatch })
        }),
        observations: ["Invoked an accessibility action on one resolved element when safety allowed it."]
      });
    }
  };

  const setValue: AgentHostToolDefinition<
    SetValueInput,
    AccessibilitySetValueResult | ActionPreviewResult,
    AgentHostMcpContext
  > = {
    name: "accessibility.set_value",
    description: "Sets an accessibility element value or text without exposing secret content.",
    riskLevel: "medium",
    inputSchema: setValueInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        appName: { type: "string", minLength: 1, maxLength: 200 },
        windowId: { type: "string", minLength: 1, maxLength: 200 },
        pid: { type: "integer", minimum: 1 },
        elementId: { type: "string", minLength: 1, maxLength: 200 },
        query: { type: "string", minLength: 1, maxLength: 500 },
        role: { type: "string", minLength: 1, maxLength: 100 },
        value: { type: "string", minLength: 1, maxLength: 10000 },
        dataSensitivity: { type: "string", enum: ["none", "low", "sensitive", "secret"] },
        dryRun: { type: "boolean" },
        confirmationToken: { type: "string", minLength: 1, maxLength: 500 }
      },
      required: ["value"],
      additionalProperties: false
    },
    inputSummary: "Set accessibility value",
    safety: {
      actionType: "accessibility_set_value",
      getInput: (input) => ({
        ...(input.appName === undefined ? {} : { appName: input.appName }),
        ...(input.dataSensitivity === undefined ? {} : { dataSensitivity: input.dataSensitivity })
      })
    },
    preview: {
      isDryRun: (input) => input.dryRun === true
    },
    async handler(input, context, runtime): Promise<ToolResult<AccessibilitySetValueResult | ActionPreviewResult>> {
      const inspected = await context.linux.inspectAccessibilityElement(inspectFromAction(input));

      if (runtime?.isDryRun) {
        const preflightSafety = initialSafetyForPreview(
          runtime,
          "accessibility.set_value",
          "accessibility_set_value",
          context,
          input
        );
        const unresolvedSummary =
          input.elementId !== undefined ? `Accessibility element ${input.elementId}` : `Accessibility query "${input.query}"`;

        if (!inspected.supported || !inspected.matched || inspected.ambiguous || inspected.element === undefined) {
          return buildPreviewResult({
            tool: "accessibility.set_value",
            riskLevel: "medium",
            strategy: "accessibility",
            safety: preflightSafety,
            targetSummary: inspected.element === undefined ? unresolvedSummary : summarizeAccessibilityElement(inspected.element),
            ...(inspected.element === undefined ? {} : { target: toAccessibilityPreviewTarget(inspected.element) }),
            dataSensitivity: strongerDataSensitivity(input.dataSensitivity, inspected.element?.dataSensitivity),
            supported: inspected.supported,
            backend: inspected.backend,
            ambiguous: inspected.ambiguous,
            wouldExecute: false,
            reasons: previewReasons(inspected.reason, preflightSafety.reasons),
            saferAlternative: inspected.ambiguous
              ? inspectElementAlternative("Resolve the exact target with elementId before previewing a value change.")
              : undefined,
            observations: ["Previewed accessibility value targeting without changing the value."]
          });
        }

        const combinedDataSensitivity = strongerDataSensitivity(input.dataSensitivity, inspected.element.dataSensitivity);
        const postResolutionSafety = evaluateSafety(
          {
            tool: "accessibility.set_value",
            actionType: "accessibility_set_value",
            strategy: "accessibility",
            ...(inspected.element.appName === undefined ? {} : { appName: inspected.element.appName }),
            ...(combinedDataSensitivity === undefined ? {} : { dataSensitivity: combinedDataSensitivity })
          },
          context.policy,
          { agentHostDir: context.config.agentHostDir }
        );
        const valueMetadata = inspected.element.valueMetadata;
        const canSetValue =
          valueMetadata !== undefined &&
          valueMetadata.editable &&
          !valueMetadata.readOnly &&
          (valueMetadata.supportsText || valueMetadata.supportsValue);
        const capabilityReason = canSetValue
          ? "The resolved element advertises editable text or value support."
          : "The resolved element does not advertise editable text or value support.";

        return buildPreviewResult({
          tool: "accessibility.set_value",
          riskLevel: "medium",
          strategy: "accessibility",
          safety: postResolutionSafety,
          targetSummary: summarizeAccessibilityElement(inspected.element),
          target: toAccessibilityPreviewTarget(inspected.element),
          dataSensitivity: combinedDataSensitivity,
          supported: inspected.supported,
          backend: inspected.backend,
          wouldExecute: canSetValue && postResolutionSafety.allowed,
          confirmation: {
            manager: context.confirmations,
            sessionId: context.sessionId,
            input,
            target: inspected.element,
            explanation: "Use this token to set the exact previewed accessibility value before it expires.",
            riskLevel: postResolutionSafety.riskLevel,
            appSensitivity: postResolutionSafety.appSensitivity,
            dataSensitivity: combinedDataSensitivity
          },
          reasons: previewReasons(capabilityReason, postResolutionSafety.reasons),
          saferAlternative: postResolutionSafety.blocked
            ? guideAlternative("Sensitive value changes should stay blocked or guide-only until approved.")
            : undefined,
          observations: ["Previewed an accessibility value change without sending the value."]
        });
      }

      if (!inspected.supported || !inspected.matched || inspected.ambiguous || inspected.element === undefined) {
        return toolSuccess({
          tool: "accessibility.set_value",
          riskLevel: "medium",
          strategy: "accessibility",
          data: {
            supported: inspected.supported,
            backend: inspected.backend,
            matched: inspected.matched,
            ambiguous: inspected.ambiguous,
            changed: false,
            redacted: true,
            redactedValue: true,
            reason: inspected.reason,
            ...(inspected.element === undefined ? {} : { target: inspected.element })
          },
          observations: ["Resolved the accessibility target before deciding whether to set a value."]
        });
      }

      const combinedDataSensitivity = strongerDataSensitivity(input.dataSensitivity, inspected.element.dataSensitivity);
      const postResolutionSafety = evaluateSafety(
        {
          tool: "accessibility.set_value",
          actionType: "accessibility_set_value",
          strategy: "accessibility",
          ...(inspected.element.appName === undefined ? {} : { appName: inspected.element.appName }),
          ...(combinedDataSensitivity === undefined ? {} : { dataSensitivity: combinedDataSensitivity })
        },
        context.policy,
        { agentHostDir: context.config.agentHostDir }
      );

      if (!postResolutionSafety.allowed) {
        return safetyFailure("accessibility.set_value", postResolutionSafety);
      }

      if (input.confirmationToken === undefined) {
        const reason = "Execution requires a fresh dry-run preview confirmation token.";
        return toolFailure({
          tool: "accessibility.set_value",
          riskLevel: postResolutionSafety.riskLevel,
          strategy: "accessibility",
          confirmation: confirmationRequired(reason),
          error: {
            code: "confirmation_required",
            message: reason
          },
          observations: [reason]
        });
      }

      const verification = context.confirmations.verifyAndConsume(input.confirmationToken, {
        sessionId: context.sessionId,
        tool: "accessibility.set_value",
        input,
        target: inspected.element,
        riskLevel: postResolutionSafety.riskLevel
      });

      if (!verification.ok) {
        return toolFailure({
          tool: "accessibility.set_value",
          riskLevel: postResolutionSafety.riskLevel,
          strategy: "accessibility",
          confirmation: rejectedConfirmation(verification.tokenId, verification.reason),
          error: {
            code: "confirmation_rejected",
            message: verification.reason
          },
          observations: [verification.reason]
        });
      }

      return toolSuccess({
        tool: "accessibility.set_value",
        riskLevel: "medium",
        strategy: "accessibility",
        confirmation: acceptedConfirmation(verification.tokenId, true, "Confirmation token accepted and accessibility value set executed."),
        data: await context.linux.setAccessibilityValue({
          ...(inspected.element.appName === undefined ? {} : { appName: inspected.element.appName }),
          ...(inspected.element.pid === undefined ? {} : { pid: inspected.element.pid }),
          elementId: inspected.element.elementId,
          value: input.value,
          ...(combinedDataSensitivity === undefined ? {} : { dataSensitivity: combinedDataSensitivity })
        }),
        observations: ["Set an accessibility value on one resolved element when safety allowed it."]
      });
    }
  };

  const focusElement: AgentHostToolDefinition<
    FocusElementInput,
    AccessibilityFocusElementResult | ActionPreviewResult,
    AgentHostMcpContext
  > = {
    name: "accessibility.focus_element",
    description: "Focuses one resolved accessibility element without falling back to raw GUI input.",
    riskLevel: "medium",
    inputSchema: focusElementInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        appName: { type: "string", minLength: 1, maxLength: 200 },
        windowId: { type: "string", minLength: 1, maxLength: 200 },
        pid: { type: "integer", minimum: 1 },
        elementId: { type: "string", minLength: 1, maxLength: 200 },
        query: { type: "string", minLength: 1, maxLength: 500 },
        role: { type: "string", minLength: 1, maxLength: 100 },
        dryRun: { type: "boolean" },
        confirmationToken: { type: "string", minLength: 1, maxLength: 500 }
      },
      additionalProperties: false
    },
    inputSummary: "Focus accessibility element",
    safety: {
      actionType: "accessibility_focus",
      getInput: (input) => (input.appName === undefined ? {} : { appName: input.appName })
    },
    preview: {
      isDryRun: (input) => input.dryRun === true
    },
    async handler(input, context, runtime): Promise<ToolResult<AccessibilityFocusElementResult | ActionPreviewResult>> {
      const inspected = await context.linux.inspectAccessibilityElement(inspectFromAction(input));

      if (runtime?.isDryRun) {
        const preflightSafety = initialSafetyForPreview(
          runtime,
          "accessibility.focus_element",
          "accessibility_focus",
          context,
          input
        );
        const unresolvedSummary =
          input.elementId !== undefined ? `Accessibility element ${input.elementId}` : `Accessibility query "${input.query}"`;

        if (!inspected.supported || !inspected.matched || inspected.ambiguous || inspected.element === undefined) {
          return buildPreviewResult({
            tool: "accessibility.focus_element",
            riskLevel: "medium",
            strategy: "accessibility",
            safety: preflightSafety,
            targetSummary: inspected.element === undefined ? unresolvedSummary : summarizeAccessibilityElement(inspected.element),
            ...(inspected.element === undefined ? {} : { target: toAccessibilityPreviewTarget(inspected.element) }),
            dataSensitivity: inspected.element?.dataSensitivity,
            supported: inspected.supported,
            backend: inspected.backend,
            ambiguous: inspected.ambiguous,
            wouldExecute: false,
            reasons: previewReasons(inspected.reason, preflightSafety.reasons),
            saferAlternative: inspected.ambiguous
              ? inspectElementAlternative("Resolve the exact target with elementId before previewing focus.")
              : undefined,
            observations: ["Previewed accessibility focus targeting without moving focus."]
          });
        }

        const postResolutionSafety = evaluateSafety(
          {
            tool: "accessibility.focus_element",
            actionType: "accessibility_focus",
            strategy: "accessibility",
            ...(inspected.element.appName === undefined ? {} : { appName: inspected.element.appName }),
            ...(inspected.element.dataSensitivity === undefined ? {} : { dataSensitivity: inspected.element.dataSensitivity })
          },
          context.policy,
          { agentHostDir: context.config.agentHostDir }
        );

        return buildPreviewResult({
          tool: "accessibility.focus_element",
          riskLevel: "medium",
          strategy: "accessibility",
          safety: postResolutionSafety,
          targetSummary: summarizeAccessibilityElement(inspected.element),
          target: toAccessibilityPreviewTarget(inspected.element),
          dataSensitivity: inspected.element.dataSensitivity,
          supported: inspected.supported,
          backend: inspected.backend,
          confirmation: {
            manager: context.confirmations,
            sessionId: context.sessionId,
            input,
            target: inspected.element,
            explanation: "Use this token to focus the exact previewed accessibility element before it expires.",
            riskLevel: postResolutionSafety.riskLevel,
            appSensitivity: postResolutionSafety.appSensitivity,
            dataSensitivity: inspected.element.dataSensitivity
          },
          saferAlternative: postResolutionSafety.blocked
            ? guideAlternative("Sensitive app focus changes should stay blocked or guide-only.")
            : undefined,
          observations: ["Previewed accessibility focus without moving focus."]
        });
      }

      if (!inspected.supported || !inspected.matched || inspected.ambiguous || inspected.element === undefined) {
        return toolSuccess({
          tool: "accessibility.focus_element",
          riskLevel: "medium",
          strategy: "accessibility",
          data: {
            supported: inspected.supported,
            backend: inspected.backend,
            matched: inspected.matched,
            ambiguous: inspected.ambiguous,
            focused: false,
            redacted: inspected.redacted,
            reason: inspected.reason,
            ...(inspected.element === undefined ? {} : { target: inspected.element })
          },
          observations: ["Resolved the accessibility target before deciding whether to focus it."]
        });
      }

      const postResolutionSafety = evaluateSafety(
        {
          tool: "accessibility.focus_element",
          actionType: "accessibility_focus",
          strategy: "accessibility",
          ...(inspected.element.appName === undefined ? {} : { appName: inspected.element.appName }),
          ...(inspected.element.dataSensitivity === undefined ? {} : { dataSensitivity: inspected.element.dataSensitivity })
        },
        context.policy,
        { agentHostDir: context.config.agentHostDir }
      );

      if (!postResolutionSafety.allowed) {
        return safetyFailure("accessibility.focus_element", postResolutionSafety);
      }

      if (input.confirmationToken === undefined) {
        const reason = "Execution requires a fresh dry-run preview confirmation token.";
        return toolFailure({
          tool: "accessibility.focus_element",
          riskLevel: postResolutionSafety.riskLevel,
          strategy: "accessibility",
          confirmation: confirmationRequired(reason),
          error: {
            code: "confirmation_required",
            message: reason
          },
          observations: [reason]
        });
      }

      const verification = context.confirmations.verifyAndConsume(input.confirmationToken, {
        sessionId: context.sessionId,
        tool: "accessibility.focus_element",
        input,
        target: inspected.element,
        riskLevel: postResolutionSafety.riskLevel
      });

      if (!verification.ok) {
        return toolFailure({
          tool: "accessibility.focus_element",
          riskLevel: postResolutionSafety.riskLevel,
          strategy: "accessibility",
          confirmation: rejectedConfirmation(verification.tokenId, verification.reason),
          error: {
            code: "confirmation_rejected",
            message: verification.reason
          },
          observations: [verification.reason]
        });
      }

      return toolSuccess({
        tool: "accessibility.focus_element",
        riskLevel: "medium",
        strategy: "accessibility",
        confirmation: acceptedConfirmation(verification.tokenId, true, "Confirmation token accepted and accessibility focus executed."),
        data: await context.linux.focusAccessibilityElement({
          ...(inspected.element.appName === undefined ? {} : { appName: inspected.element.appName }),
          ...(inspected.element.pid === undefined ? {} : { pid: inspected.element.pid }),
          elementId: inspected.element.elementId
        }),
        observations: ["Focused one resolved accessibility element when safety allowed it."]
      });
    }
  };

  return [getTree, findElement, inspectElement, invokeAction, setValue, focusElement];
}
