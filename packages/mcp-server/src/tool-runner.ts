import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import type {
  AgentHostConfig,
  AuditLogEntry,
  AuditLogger,
  SafetyDecision,
  SafetyInput,
  CapabilityRegistrySnapshot,
  PolicyProfile,
  RiskLevel,
  ToolResult,
  WorkflowCheckpoint,
  WorkflowTraceStep,
  ToolExecutionMetadata
} from "@agenthost/core";
import { evaluateSafety, redactWorkflowSummary, summarizeToolResult, toolFailure, workflowActionForTool, workflowStrategyForTool } from "@agenthost/core";
import type { z } from "zod";
import type { GrantStore } from "./grants.js";

export interface ToolExecutionContext {
  sessionId: string;
  config: AgentHostConfig;
  policy: PolicyProfile;
  registry: CapabilityRegistrySnapshot;
  logger: AuditLogger;
  grants: GrantStore;
  receipts?: {
    issue(input: { sessionId: string; tool: string; rawInput: unknown; result: ToolResult; riskLevel: RiskLevel; target?: unknown }): import("@agenthost/core").ToolResultReceipt;
    fingerprintInput(input: unknown): string;
    registerReplayExpectation(input: { replaySessionId: string; preparedStepId: string; prepareId: string; stepIndex: number; sessionId: string; tool: string; inputFingerprint: string; preview: boolean }): void;
    invalidateReplayExpectations(replaySessionId: string): number;
    reserveForReplay(receipt: import("@agenthost/core").ToolResultReceipt, binding: { replaySessionId: string; preparedStepId: string; prepareId: string; stepIndex: number }): { ok: boolean; reason: string; reservationId?: string; receipt?: import("@agenthost/core").ToolResultReceipt };
    commitReservation(receiptId: string, reservationId: string): void;
    releaseReservation(receiptId: string, reservationId: string): void;
  };
  workflowTrace?: { capture(event: { sessionId: string; step: WorkflowTraceStep }): Promise<void> };
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
  auditOutputSummary?(result: ToolResult<TData>): string;
  safety?: {
    actionType: SafetyInput["actionType"];
    getInput?: (input: TInput) => Partial<SafetyInput>;
  };
  preview?: {
    isDryRun(input: TInput): boolean;
  };
  execution?: ToolExecutionMetadata;
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
  durationMs: number,
  outputSummary?: string
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
    ...(result.receipt === undefined ? {} : { receiptId: result.receipt.receiptId }),
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
    outputSummary: outputSummary ?? summarizeToolResult(result)
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
  let safetyDecision: SafetyDecision | undefined;
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
        safetyDecision = evaluateSafety(safetyInput, context.policy, {
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
  if (context.receipts !== undefined && parsed.success) {
    result = { ...result, receipt: context.receipts.issue({ sessionId: context.sessionId, tool: definition.name, rawInput: parsed.data, result, riskLevel: result.riskLevel }) };
  }
  const inputSummary = parsed.success && definition.auditInputSummary !== undefined
    ? definition.auditInputSummary(parsed.data)
    : definition.inputSummary;
  const outputSummary = definition.auditOutputSummary?.(result);
  await context.logger.log(createAuditLogEntry(result, context, inputSummary, durationMs, outputSummary));
  if (context.workflowTrace !== undefined && !definition.name.startsWith("workflow.")) {
    const grants = result.grantDecision;
    const safeOutput = outputSummary === undefined
      ? (result.ok ? "Operation completed; result content intentionally omitted from trace." : `Operation failed: ${result.error?.code ?? "tool_failed"}.`)
      : outputSummary;
    const checkpointResult: WorkflowCheckpoint | undefined = definition.name === "browser.wait_for_state" || definition.name === "shell.run_safe"
      ? {
          checkpointId: `checkpoint_${randomUUID()}`,
          kind: definition.name === "browser.wait_for_state" ? "browser_element_exists" : "command_succeeded",
          expectationSummary: definition.name === "browser.wait_for_state" ? "Requested browser state becomes available." : "Safe command completes successfully.",
          status: result.ok ? "passed" : "failed",
          resultSummary: result.ok ? "Checkpoint completed." : `Checkpoint failed: ${result.error?.code ?? "tool_failed"}.`,
          checkedAt: new Date().toISOString(), reusable: true
        }
      : undefined;
    const step: WorkflowTraceStep = {
      stepId: `step_${randomUUID()}`,
      timestamp: new Date().toISOString(),
      tool: definition.name,
      strategy: workflowStrategyForTool(definition.name),
      actionType: workflowActionForTool(definition.name),
      riskLevel: result.riskLevel,
      inputSummary: redactWorkflowSummary(inputSummary),
      outputSummary: redactWorkflowSummary(safeOutput),
      preview: result.preview === true,
      ok: result.ok,
      ...(result.error === null ? {} : { errorSummary: result.error.code }),
      ...(checkpointResult === undefined ? {} : { checkpointResult }),
      ...(grants === undefined ? {} : { requiredGrantIds: [...grants.allowedByGrantIds] }),
      ...(safetyDecision === undefined ? {} : { safetyDecision: {
        allowed: safetyDecision.allowed, blocked: safetyDecision.blocked, guideOnly: safetyDecision.guideOnly,
        matchedRules: safetyDecision.matchedRules.map(redactWorkflowSummary), requiresDryRun: safetyDecision.grantDecision.requiresDryRun,
        requiresConfirmationToken: safetyDecision.grantDecision.requiresConfirmationToken, requiresApproval: safetyDecision.grantDecision.requiresApproval,
        requiresExactTarget: safetyDecision.grantDecision.requiresExactTarget
      } })
    };
    try { await context.workflowTrace.capture({ sessionId: context.sessionId, step }); } catch { /* Trace capture never changes original tool result. */ }
  }
  return result;
}
