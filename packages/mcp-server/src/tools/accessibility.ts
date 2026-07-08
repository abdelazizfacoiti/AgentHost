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
  type DataSensitivity,
  type ToolResult
} from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";

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

const targetInputSchema = targetInputObject
  .superRefine((input, ctx) => {
    if (input.elementId === undefined && input.query === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Accessibility target must include either elementId or query."
      });
    }
  });

const inspectInputSchema = targetInputSchema;

const invokeActionInputSchema = targetInputObject.extend({
  actionName: z.string().trim().min(1).max(100),
  requireExactMatch: z.boolean().optional()
}).superRefine((input, ctx) => {
  if (input.elementId === undefined && input.query === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Accessibility target must include either elementId or query."
    });
  }
});

const setValueInputSchema = targetInputObject.extend({
  value: z.string().min(1).max(10_000),
  dataSensitivity: z.enum(["none", "low", "sensitive", "secret"]).optional()
}).superRefine((input, ctx) => {
  if (input.elementId === undefined && input.query === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Accessibility target must include either elementId or query."
    });
  }
});

const focusElementInputSchema = targetInputSchema;

type GetTreeInput = z.infer<typeof getTreeInputSchema>;
type FindElementInput = z.infer<typeof findElementInputSchema>;
type InspectInput = z.infer<typeof inspectInputSchema>;
type InvokeActionInput = z.infer<typeof invokeActionInputSchema>;
type SetValueInput = z.infer<typeof setValueInputSchema>;
type FocusElementInput = z.infer<typeof focusElementInputSchema>;

const DATA_SENSITIVITY_ORDER: DataSensitivity[] = ["none", "low", "sensitive", "secret"];

function strongerDataSensitivity(a: DataSensitivity | undefined, b: DataSensitivity | undefined): DataSensitivity | undefined {
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

  const invokeAction: AgentHostToolDefinition<InvokeActionInput, AccessibilityInvokeActionResult, AgentHostMcpContext> = {
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
        requireExactMatch: { type: "boolean" }
      },
      required: ["actionName"],
      additionalProperties: false
    },
    inputSummary: "Invoke accessibility action",
    safety: {
      actionType: "accessibility_action",
      getInput: (input) => (input.appName === undefined ? {} : { appName: input.appName })
    },
    async handler(input, context): Promise<ToolResult<AccessibilityInvokeActionResult>> {
      const inspected = await context.linux.inspectAccessibilityElement(inspectFromAction(input));

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

      return toolSuccess({
        tool: "accessibility.invoke_action",
        riskLevel: "medium",
        strategy: "accessibility",
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

  const setValue: AgentHostToolDefinition<SetValueInput, AccessibilitySetValueResult, AgentHostMcpContext> = {
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
        dataSensitivity: { type: "string", enum: ["none", "low", "sensitive", "secret"] }
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
    async handler(input, context): Promise<ToolResult<AccessibilitySetValueResult>> {
      const inspected = await context.linux.inspectAccessibilityElement(inspectFromAction(input));

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

      return toolSuccess({
        tool: "accessibility.set_value",
        riskLevel: "medium",
        strategy: "accessibility",
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

  const focusElement: AgentHostToolDefinition<FocusElementInput, AccessibilityFocusElementResult, AgentHostMcpContext> = {
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
        role: { type: "string", minLength: 1, maxLength: 100 }
      },
      additionalProperties: false
    },
    inputSummary: "Focus accessibility element",
    safety: {
      actionType: "accessibility_focus",
      getInput: (input) => (input.appName === undefined ? {} : { appName: input.appName })
    },
    async handler(input, context): Promise<ToolResult<AccessibilityFocusElementResult>> {
      const inspected = await context.linux.inspectAccessibilityElement(inspectFromAction(input));

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

      return toolSuccess({
        tool: "accessibility.focus_element",
        riskLevel: "medium",
        strategy: "accessibility",
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
