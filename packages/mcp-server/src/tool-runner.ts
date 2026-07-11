import { performance } from "node:perf_hooks";
import type {
  AgentHostConfig,
  AuditLogEntry,
  AuditLogger,
  SafetyDecision,
  SafetyInput,
  CapabilityRegistrySnapshot,
  PolicyProfile,
  RiskLevel,
  ToolResult
} from "@agenthost/core";
import { evaluateSafety, summarizeToolResult, toolFailure } from "@agenthost/core";
import type { z } from "zod";
import type { GrantStore } from "./grants.js";

export interface ToolExecutionContext {
  sessionId: string;
  config: AgentHostConfig;
  policy: PolicyProfile;
  registry: CapabilityRegistrySnapshot;
  logger: AuditLogger;
  grants: GrantStore;
}

export interface ToolExecutionRuntime {
  isDryRun: boolean;
  safetyDecision?: SafetyDecision | undefined;
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
  /** Safe per-call audit label; must never include unredacted user payloads or tokens. */
  auditInputSummary?(input: TInput): string;
  safety?: {
    actionType: SafetyInput["actionType"];
    getInput?: (input: TInput) => Partial<SafetyInput>;
  };
  preview?: {
    isDryRun(input: TInput): boolean;
  };
  handler(
    input: TInput,
    context: TContext,
    runtime?: ToolExecutionRuntime
  ): Promise<ToolResult<TData>> | ToolResult<TData>;
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
    profile: context.policy.name,
    tool: result.tool,
    riskLevel: result.riskLevel,
    ...(result.preview === true ? { preview: true } : {}),
    ...(result.confirmation === undefined
      ? {}
      : {
          confirmationStatus: result.confirmation.status,
          ...(result.confirmation.tokenId === undefined ? {} : { confirmationTokenId: result.confirmation.tokenId }),
          confirmationReason: result.confirmation.reason
        }),
    ...(result.grantDecision === undefined
      ? {}
      : {
          matchedGrantIds: result.grantDecision.matchedGrantIds,
          deniedGrantIds: result.grantDecision.deniedByGrantIds,
          guideOnlyGrantIds: result.grantDecision.guideOnlyByGrantIds,
          grantDecision: result.grantDecision,
          dryRunRequired: result.grantDecision.requiresDryRun,
          confirmationRequiredByGrant: result.grantDecision.requiresConfirmationToken,
          approvalRequiredByGrant: result.grantDecision.requiresApproval,
          grantDenied:
            result.grantDecision.deniedByGrantIds.length > 0 || result.grantDecision.guideOnlyByGrantIds.length > 0
        }),
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

function hasConfirmationToken(rawInput: unknown): boolean {
  if (typeof rawInput !== "object" || rawInput === null) {
    return false;
  }

  return typeof (rawInput as { confirmationToken?: unknown }).confirmationToken === "string";
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
      const isDryRun = definition.preview?.isDryRun(parsed.data) ?? false;

      if (definition.safety !== undefined) {
        const dynamicSafetyInput = definition.safety.getInput?.(parsed.data) ?? {};
        const safetyInput: SafetyInput = {
          ...dynamicSafetyInput,
          tool: definition.name,
          actionType: definition.safety.actionType
        };
        const safetyDecision = evaluateSafety(safetyInput, context.policy, {
          agentHostDir: context.config.agentHostDir,
          grants: context.grants.listActiveGrants()
        });

        if (!safetyDecision.allowed && !isDryRun) {
          result = toolFailure<TData>({
            tool: definition.name,
            riskLevel: safetyDecision.riskLevel,
            grantDecision: safetyDecision.grantDecision,
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
          result = await definition.handler(parsed.data, context, {
            isDryRun,
            safetyDecision
          });

          if (result.grantDecision === undefined) {
            result = {
              ...result,
              grantDecision: safetyDecision.grantDecision
            };
          }
        }
      } else {
        result = await definition.handler(parsed.data, context, {
          isDryRun
        });
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
  const inputSummary = parsed.success && definition.auditInputSummary !== undefined
    ? definition.auditInputSummary(parsed.data)
    : definition.inputSummary;
  await context.logger.log(createAuditLogEntry(result, context, inputSummary, durationMs));
  return result;
}
