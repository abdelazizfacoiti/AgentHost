import {
  classifyAppSensitivity,
  toolFailure,
  toolSuccess,
  evaluateSafety,
  type AccessibilityFindElementResult,
  type AccessibilityInvokeActionResult,
  type AccessibilitySetValueResult,
  type AccessibilityTreeResult,
  type ActionType,
  type ToolResult
} from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";
import { createSafetyEvaluationContext } from "../grants.js";

/*
 * Accessibility (AT-SPI) tools: read and drive app UIs as structured elements
 * instead of pixels. Faster and more reliable than screenshot + click for
 * browsers, GTK/Qt apps and Electron apps that expose an accessibility tree.
 */

const scope = {
  appName: z.string().trim().min(1).max(200).optional(),
  windowId: z.string().trim().min(1).max(200).optional(),
  pid: z.number().int().min(1).optional()
};
const scopeMcp = {
  appName: { type: "string", minLength: 1, maxLength: 200 },
  windowId: { type: "string", minLength: 1, maxLength: 200 },
  pid: { type: "integer", minimum: 1 }
};
const elementMcp = {
  elementId: { type: "string", minLength: 1, maxLength: 300 },
  query: { type: "string", minLength: 1, maxLength: 200 },
  role: { type: "string", minLength: 1, maxLength: 80 }
};
const elementRefine = (value: { elementId?: string | undefined; query?: string | undefined }, ctx: z.RefinementCtx) => {
  if (value.elementId === undefined && value.query === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide elementId (from ui.find/ui.tree) or query." });
};

const treeInput = z.object({ ...scope, maxDepth: z.number().int().min(1).max(30).optional(), maxNodes: z.number().int().min(1).max(400).optional(), includeText: z.boolean().optional() }).strict();
const findInput = z.object({ ...scope, query: z.string().trim().min(1).max(200), role: z.string().trim().min(1).max(80).optional(), limit: z.number().int().min(1).max(20).optional() }).strict();
const activateInput = z.object({
  ...scope,
  elementId: z.string().trim().min(1).max(300).optional(),
  query: z.string().trim().min(1).max(200).optional(),
  role: z.string().trim().min(1).max(80).optional(),
  actionName: z.string().trim().min(1).max(60).optional(),
  dryRun: z.boolean().optional(),
  confirmationToken: z.string().trim().min(8).max(120).optional()
}).strict().superRefine(elementRefine);
const setTextInput = z.object({
  ...scope,
  elementId: z.string().trim().min(1).max(300).optional(),
  query: z.string().trim().min(1).max(200).optional(),
  role: z.string().trim().min(1).max(80).optional(),
  value: z.string().max(10_000),
  dataSensitivity: z.enum(["none", "low", "sensitive", "secret"]).optional(),
  dryRun: z.boolean().optional(),
  confirmationToken: z.string().trim().min(8).max(120).optional()
}).strict().superRefine(elementRefine);

type Scope = { appName?: string | undefined; windowId?: string | undefined; pid?: number | undefined };

/** Without an explicit app/window/pid, target the app that owns the active window. */
async function resolveScope(input: Scope, context: AgentHostMcpContext): Promise<{ appName?: string; windowId?: string; pid?: number } | undefined> {
  if (input.appName !== undefined || input.windowId !== undefined || input.pid !== undefined) {
    return {
      ...(input.appName === undefined ? {} : { appName: input.appName }),
      ...(input.windowId === undefined ? {} : { windowId: input.windowId }),
      ...(input.pid === undefined ? {} : { pid: input.pid })
    };
  }
  const active = (await context.linux.getActiveWindow().catch(() => undefined))?.activeWindow;
  if (active?.pid === undefined) return undefined;
  return { pid: active.pid, ...(active.appName === undefined ? {} : { appName: active.appName }) };
}

function check(tool: string, actionType: ActionType, context: AgentHostMcpContext, appName: string | undefined, dataSensitivity?: "none" | "low" | "sensitive" | "secret") {
  // The core engine allows high-risk *inspection* of credential apps, but an
  // accessibility tree of a password manager exposes entry names and fields,
  // so UI reads are blocked there just like UI writes.
  if (appName !== undefined && classifyAppSensitivity({ appName }) === "credential_or_security") {
    return evaluateSafety({ tool, actionType: "accessibility_action", strategy: "accessibility", appName }, context.policy, createSafetyEvaluationContext(context));
  }
  return evaluateSafety(
    { tool, actionType, strategy: "accessibility", ...(appName === undefined ? {} : { appName }), ...(dataSensitivity === undefined ? {} : { dataSensitivity }) },
    context.policy,
    createSafetyEvaluationContext(context)
  );
}

function blocked(tool: string, safety: ReturnType<typeof evaluateSafety>): ToolResult<never> {
  return toolFailure({
    tool,
    riskLevel: safety.riskLevel,
    approval: safety.approval,
    error: { code: safety.blocked ? "safety_blocked" : "approval_required", message: safety.blocked ? "Blocked by safety engine." : "Requires approval.", details: safety },
    observations: safety.reasons
  });
}

function noTarget(tool: string): ToolResult<never> {
  return toolFailure({ tool, riskLevel: "low", error: { code: "ui_target_missing", message: "No appName/windowId/pid given and the active window has no pid." } });
}

function unsupported(tool: string, reason: string): ToolResult<never> {
  return toolFailure({ tool, riskLevel: "low", error: { code: "accessibility_unavailable", message: reason }, observations: ["Fall back to desktop.screenshot plus desktop.click for this app."] });
}

export function createUiTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const tree: AgentHostToolDefinition<z.infer<typeof treeInput>, AccessibilityTreeResult, AgentHostMcpContext> = {
    name: "ui.tree",
    description: "Reads the accessibility tree (roles, names, screen bounds, element ids) of an app or the active window. Prefer this over screenshots to understand UI structure; bounds are absolute screen coordinates usable by desktop.click.",
    riskLevel: "low",
    inputSchema: treeInput,
    mcpInputSchema: { type: "object", properties: { ...scopeMcp, maxDepth: { type: "integer", minimum: 1, maximum: 30 }, maxNodes: { type: "integer", minimum: 1, maximum: 400 }, includeText: { type: "boolean" } }, additionalProperties: false },
    inputSummary: "Read UI tree",
    safety: { actionType: "inspect", getInput: (i) => ({ appName: i.appName }) },
    async handler(input, context) {
      const target = await resolveScope(input, context);
      if (target === undefined) return noTarget("ui.tree");
      const safety = check("ui.tree", "inspect", context, target.appName);
      if (!safety.allowed) return blocked("ui.tree", safety);
      const data = await context.linux.getAccessibilityTree({ ...target, maxDepth: input.maxDepth ?? 12, maxNodes: input.maxNodes ?? 150, ...(input.includeText === undefined ? {} : { includeText: input.includeText }) });
      if (!data.supported) return unsupported("ui.tree", data.reason);
      return toolSuccess({ tool: "ui.tree", riskLevel: "low", data, observations: [data.truncated ? "Tree truncated; narrow with ui.find or raise maxNodes." : "Read the full requested tree."] });
    }
  };

  const find: AgentHostToolDefinition<z.infer<typeof findInput>, AccessibilityFindElementResult, AgentHostMcpContext> = {
    name: "ui.find",
    description: "Finds UI elements by visible name/label (and optional role such as 'push button', 'entry', 'link') in an app or the active window. Returns element ids and screen bounds.",
    riskLevel: "low",
    inputSchema: findInput,
    mcpInputSchema: { type: "object", properties: { ...scopeMcp, query: { type: "string", minLength: 1, maxLength: 200 }, role: { type: "string", minLength: 1, maxLength: 80 }, limit: { type: "integer", minimum: 1, maximum: 20 } }, required: ["query"], additionalProperties: false },
    inputSummary: "Find UI element",
    safety: { actionType: "inspect", getInput: (i) => ({ appName: i.appName }) },
    async handler(input, context) {
      const target = await resolveScope(input, context);
      if (target === undefined) return noTarget("ui.find");
      const safety = check("ui.find", "inspect", context, target.appName);
      if (!safety.allowed) return blocked("ui.find", safety);
      const data = await context.linux.findAccessibilityElement({ ...target, query: input.query, ...(input.role === undefined ? {} : { role: input.role }), limit: input.limit ?? 8 });
      if (!data.supported) return unsupported("ui.find", data.reason);
      return toolSuccess({ tool: "ui.find", riskLevel: "low", data, observations: [data.candidates.length === 0 ? "No match; try a shorter query, another role, or ui.tree." : `Found ${data.candidates.length} candidate(s).`] });
    }
  };

  const activate: AgentHostToolDefinition<z.infer<typeof activateInput>, AccessibilityInvokeActionResult, AgentHostMcpContext> = {
    name: "ui.activate",
    description: "Invokes an accessibility action (default 'click'/'press'/'activate') on one element found by elementId or query. Works without moving the mouse and without exact coordinates.",
    riskLevel: "medium",
    inputSchema: activateInput,
    mcpInputSchema: { type: "object", properties: { ...scopeMcp, ...elementMcp, actionName: { type: "string", minLength: 1, maxLength: 60 }, dryRun: { type: "boolean" }, confirmationToken: { type: "string", minLength: 8, maxLength: 120 } }, additionalProperties: false },
    inputSummary: "Activate UI element",
    auditInputSummary: (i) => `Activate UI element${i.role === undefined ? "" : ` (${i.role})`}${i.appName === undefined ? "" : ` in ${i.appName}`}.`,
    safety: { actionType: "accessibility_action", getInput: (i) => ({ appName: i.appName }) },
    async handler(input, context) {
      const target = await resolveScope(input, context);
      if (target === undefined) return noTarget("ui.activate");
      const safety = check("ui.activate", "accessibility_action", context, target.appName);
      if (!safety.allowed) return blocked("ui.activate", safety);
      const data = await context.linux.invokeAccessibilityAction({
        ...target,
        ...(input.elementId === undefined ? {} : { elementId: input.elementId }),
        ...(input.query === undefined ? {} : { query: input.query }),
        ...(input.role === undefined ? {} : { role: input.role }),
        actionName: input.actionName ?? "click",
        requireExactMatch: input.elementId === undefined
      });
      if (!data.supported) return unsupported("ui.activate", data.reason);
      if (!data.performed) {
        return toolFailure({ tool: "ui.activate", riskLevel: "medium", error: { code: data.ambiguous ? "ui_element_ambiguous" : data.matched ? "ui_action_failed" : "ui_element_not_found", message: data.reason }, observations: [data.reason] });
      }
      return toolSuccess({ tool: "ui.activate", riskLevel: "medium", data, observations: ["Invoked the accessibility action; verify the resulting state."] });
    }
  };

  const setText: AgentHostToolDefinition<z.infer<typeof setTextInput>, AccessibilitySetValueResult, AgentHostMcpContext> = {
    name: "ui.set_text",
    description: "Sets the text of an editable element (entry, text area, search box) through accessibility. Layout-independent, so punctuation and non-ASCII text are exact. Mark secrets with dataSensitivity.",
    riskLevel: "medium",
    inputSchema: setTextInput,
    mcpInputSchema: { type: "object", properties: { ...scopeMcp, ...elementMcp, value: { type: "string", maxLength: 10000 }, dataSensitivity: { type: "string", enum: ["none", "low", "sensitive", "secret"] }, dryRun: { type: "boolean" }, confirmationToken: { type: "string", minLength: 8, maxLength: 120 } }, required: ["value"], additionalProperties: false },
    inputSummary: "Set UI element text",
    auditInputSummary: (i) => `Set ${i.value.length} chars in UI element${i.appName === undefined ? "" : ` in ${i.appName}`}.`,
    safety: { actionType: "accessibility_set_value", getInput: (i) => ({ appName: i.appName, ...(i.dataSensitivity === undefined ? {} : { dataSensitivity: i.dataSensitivity }) }) },
    async handler(input, context) {
      const target = await resolveScope(input, context);
      if (target === undefined) return noTarget("ui.set_text");
      const safety = check("ui.set_text", "accessibility_set_value", context, target.appName, input.dataSensitivity);
      if (!safety.allowed) return blocked("ui.set_text", safety);
      const data = await context.linux.setAccessibilityValue({
        ...target,
        ...(input.elementId === undefined ? {} : { elementId: input.elementId }),
        ...(input.query === undefined ? {} : { query: input.query }),
        ...(input.role === undefined ? {} : { role: input.role }),
        value: input.value,
        ...(input.dataSensitivity === undefined ? {} : { dataSensitivity: input.dataSensitivity })
      });
      if (!data.supported) return unsupported("ui.set_text", data.reason);
      if (!data.changed) {
        return toolFailure({ tool: "ui.set_text", riskLevel: "medium", error: { code: data.ambiguous ? "ui_element_ambiguous" : data.matched ? "ui_value_not_set" : "ui_element_not_found", message: data.reason }, observations: [data.reason, "Fall back to clicking the field and desktop.type_text."] });
      }
      return toolSuccess({ tool: "ui.set_text", riskLevel: "medium", data, observations: ["Set the element text."] });
    }
  };

  return [tree, find, activate, setText];
}
