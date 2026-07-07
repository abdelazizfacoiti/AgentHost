import { performance } from "node:perf_hooks";
import type {
  AgentHostConfig,
  AuditLogEntry,
  AuditLogger,
  SafetyInput,
  CapabilityRegistrySnapshot,
  PolicyProfile,
  RiskLevel,
  ToolResult
} from "@agenthost/core";
import { evaluateSafety, summarizeToolResult, toolFailure } from "@agenthost/core";
import type { z } from "zod";

export interface ToolExecutionContext {
  sessionId: string;
  config: AgentHostConfig;
  policy: PolicyProfile;
  registry: CapabilityRegistrySnapshot;
  logger: AuditLogger;
}

export interface AgentHostToolDefinition<
  TInput,
  TData,
  TContext extends ToolExecutionContext = ToolExecutionContext
> {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  inputSchema: z.ZodType<TInput>;
  mcpInputSchema: Record<string, unknown>;
  inputSummary: string;
  safety?: {
    actionType: SafetyInput["actionType"];
    getInput?: (input: TInput) => Partial<SafetyInput>;
  };
  handler(input: TInput, context: TContext): Promise<ToolResult<TData>> | ToolResult<TData>;
}

export type AnyAgentHostToolDefinition<TContext extends ToolExecutionContext = ToolExecutionContext> =
  AgentHostToolDefinition<any, any, TContext>;

function createAuditLogEntry(
  result: ToolResult,
  context: ToolExecutionContext,
  inputSummary: string,
  durationMs: number
): AuditLogEntry {
  const entry: AuditLogEntry = {
    timestamp: new Date().toISOString(),
    sessionId: context.sessionId,
    tool: result.tool,
    riskLevel: result.riskLevel,
    inputSummary,
    approvalStatus: result.approval.status,
    ok: result.ok,
    durationMs,
    outputSummary: summarizeToolResult(result)
  };

  if (result.strategy !== undefined) {
    entry.strategy = result.strategy;
  }

  if (result.error !== null) {
    entry.errorCode = result.error.code;
  }

  return entry;
}

export async function runTool<TInput, TData, TContext extends ToolExecutionContext>(
  definition: AgentHostToolDefinition<TInput, TData, TContext>,
  rawInput: unknown,
  context: TContext
): Promise<ToolResult<TData>> {
  const start = performance.now();
  let result: ToolResult<TData>;
  const parsed = definition.inputSchema.safeParse(rawInput ?? {});

  if (!parsed.success) {
    result = toolFailure<TData>({
      tool: definition.name,
      riskLevel: definition.riskLevel,
      error: {
        code: "invalid_input",
        message: "Tool input failed schema validation.",
        details: parsed.error.flatten()
      },
      observations: ["The request was rejected before execution."]
    });
  } else {
    try {
      if (definition.safety !== undefined) {
        const dynamicSafetyInput = definition.safety.getInput?.(parsed.data) ?? {};
        const safetyInput: SafetyInput = {
          ...dynamicSafetyInput,
          tool: definition.name,
          actionType: definition.safety.actionType
        };
        const safetyDecision = evaluateSafety(safetyInput, context.policy, {
          agentHostDir: context.config.agentHostDir
        });

        if (!safetyDecision.allowed) {
          result = toolFailure<TData>({
            tool: definition.name,
            riskLevel: safetyDecision.riskLevel,
            approval: safetyDecision.approval,
            error: {
              code: safetyDecision.blocked ? "safety_blocked" : "approval_required",
              message: safetyDecision.blocked
                ? "Tool execution was blocked by the safety engine."
                : "Tool execution requires approval before it can run.",
              details: safetyDecision
            },
            observations: safetyDecision.reasons
          });
        } else {
          result = await definition.handler(parsed.data, context);
        }
      } else {
        result = await definition.handler(parsed.data, context);
      }
    } catch (error) {
      result = toolFailure<TData>({
        tool: definition.name,
        riskLevel: definition.riskLevel,
        error: {
          code: "tool_execution_failed",
          message: error instanceof Error ? error.message : "Tool execution failed.",
          details: error
        }
      });
    }
  }

  const durationMs = Math.round(performance.now() - start);
  await context.logger.log(createAuditLogEntry(result, context, definition.inputSummary, durationMs));
  return result;
}
