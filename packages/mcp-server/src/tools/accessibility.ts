import {
  toolSuccess,
  type AccessibilityFindElementResult,
  type AccessibilityTreeResult,
  type ToolResult
} from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";

const appNameSchema = z.string().trim().min(1).max(200);
const querySchema = z.string().trim().min(1).max(500);

const getTreeInputSchema = z
  .object({
    appName: appNameSchema.optional(),
    windowId: z.string().trim().min(1).max(200).optional(),
    pid: z.number().int().min(1).optional(),
    maxDepth: z.number().int().min(1).max(6).optional(),
    maxNodes: z.number().int().min(1).max(1000).optional(),
    includeText: z.boolean().optional()
  })
  .strict();

const findElementInputSchema = z
  .object({
    appName: appNameSchema.optional(),
    windowId: z.string().trim().min(1).max(200).optional(),
    pid: z.number().int().min(1).optional(),
    query: querySchema,
    role: z.string().trim().min(1).max(100).optional(),
    limit: z.number().int().min(1).max(50).optional()
  })
  .strict();

type GetTreeInput = z.infer<typeof getTreeInputSchema>;
type FindElementInput = z.infer<typeof findElementInputSchema>;

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

  return [getTree, findElement];
}
