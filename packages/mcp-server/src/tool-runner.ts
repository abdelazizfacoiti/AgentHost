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
import { actionEffectFromSafetyInput, decideGovernedAction, evaluateSafety, redactWorkflowSummary, summarizeToolResult, toolFailure, validateGovernedActionEffect, workflowActionForTool, workflowStrategyForTool, type GovernedActionEffect } from "@agenthost/core";
import type { z } from "zod";
import type { GrantStore } from "./grants.js";
import { validateToolExecutionMetadata } from "./tool-metadata.js";
import type { RuntimeActivityService } from "./runtime-activity-service.js";

export interface ToolExecutionContext {
  sessionId: string;
  config: AgentHostConfig;
  policy: PolicyProfile;
  registry: CapabilityRegistrySnapshot;
  logger: AuditLogger;
  grants: GrantStore;
  /** Non-consuming envelope validation; handlers own exact-target consumption. */
  confirmations?: {
    verifyEnvelope(
      token: string,
      input: { sessionId: string; tool: string; input: unknown; riskLevel: RiskLevel; effectFingerprint?: string }
    ): import("./confirmation.js").ConfirmationVerificationResult;
    verifyAndConsume(
      token: string,
      input: { sessionId: string; tool: string; input: unknown; target?: unknown; riskLevel: RiskLevel; effectFingerprint?: string }
    ): import("./confirmation.js").ConfirmationVerificationResult;
  };
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
  controlRoom?: { recordToolActivity(input: { sessionId: string; timestamp: string; tool: string; strategy?: string; riskLevel: RiskLevel; preview: boolean; ok: boolean; errorCode?: string; durationMs: number; confirmation: boolean; receiptId?: string; actionDecision?: import("@agenthost/core").ActionEffectDecisionSummary; verification?: import("@agenthost/core").ActionVerificationSummary }): Promise<void> | void };
  runtimeActivity?: RuntimeActivityService;
}

export interface ToolExecutionRuntime {
  isDryRun: boolean;
  safetyDecision?: SafetyDecision | undefined;
  effectFingerprint?: string;
  actionDecision?: import("@agenthost/core").ActionEffectDecisionSummary;
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
  /** Structural grant prerequisites for planning projections only. */
  requiredGrantIds?: string[];
  /** Explicit delegation binding for wrappers that consume a token for one
   * underlying fixed tool (for example Forge dispatch). */
  confirmationTool?(input: TInput): string;
  confirmationInput?(input: TInput): unknown;
  /** Resolves exact effect bindings without performing target-app mutation. */
  resolveEffect?(input: TInput, context: TContext): GovernedActionEffect | Promise<GovernedActionEffect>;
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
    ...(result.actionDecision === undefined ? {} : { actionDecision: result.actionDecision }),
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

  const token = (rawInput as { confirmationToken?: unknown }).confirmationToken;
  return typeof token === "string" && token.trim().length > 0;
}

function executionMetadataFor<TContext extends ToolExecutionContext>(
  definition: AgentHostToolDefinition<unknown, unknown, TContext>,
  context: TContext
): ToolExecutionMetadata | undefined {
  return definition.execution ?? context.registry.listTools().find((tool) => tool.name === definition.name)?.execution;
}

function centralFailure<TData>(input: {
  definition: AgentHostToolDefinition<unknown, TData>;
  code: string;
  message: string;
  riskLevel?: RiskLevel;
  safetyDecision?: SafetyDecision;
  actionDecision?: import("@agenthost/core").ActionEffectDecisionSummary;
}): ToolResult<TData> {
  return toolFailure<TData>({
    tool: input.definition.name,
    riskLevel: input.riskLevel ?? input.safetyDecision?.riskLevel ?? input.definition.riskLevel,
    ...(input.safetyDecision?.grantDecision === undefined ? {} : { grantDecision: input.safetyDecision.grantDecision }),
    ...(input.safetyDecision?.approval === undefined ? {} : { approval: input.safetyDecision.approval }),
    ...(input.actionDecision === undefined ? {} : { actionDecision: input.actionDecision }),
    error: { code: input.code, message: input.message },
    observations: input.safetyDecision?.reasons ?? ["Central execution baseline rejected the request before handler execution."]
  });
}

function centralSafetyActionType(definition: AnyAgentHostToolDefinition, execution: ToolExecutionMetadata): SafetyInput["actionType"] {
  const declared = definition.safety?.actionType;
  if (execution.executionClass !== "state_changing" || declared !== "inspect") {
    return declared ?? "unknown";
  }

  const name = definition.name;
  if (name.startsWith("shell.")) return "shell_command";
  if (name === "app.open") return "app_launch";
  if (name.startsWith("file.")) return name.includes("delete") ? "file_delete" : "file_write";
  if (name === "browser.generate_pairing_token"
    || name === "browser.reset_pairing"
    || name === "browser.setup_begin"
    || name === "browser.setup_approve"
    || name === "browser.setup_cancel") return "inspect";
  if (name.startsWith("browser.")) return "browser_action";
  if (name.includes("set_value")) return "accessibility_set_value";
  if (name.includes("invoke_action")) return "accessibility_action";
  if (name.includes("focus_element")) return "accessibility_focus";
  if (name.includes("type_text")) return "gui_type";
  if (name.includes("click") || name.includes("pointer") || name.includes("hotkey") || name.includes("focus")) return "gui_click";
  if (name.startsWith("blender.") || name.startsWith("forge.")) return "file_write";
  return "unknown";
}

export async function runTool<TInput, TData, TContext extends ToolExecutionContext>(
  definition: AgentHostToolDefinition<TInput, TData, TContext>,
  rawInput: unknown,
  context: TContext
): Promise<ToolResult<TData>> {
  const start = performance.now();
  let result!: ToolResult<TData>;
  let safetyDecision: SafetyDecision | undefined;
  const runtimeActivity = context.runtimeActivity?.startDirectTool(definition.name, context.sessionId);
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
      const execution = executionMetadataFor(
        definition as AgentHostToolDefinition<unknown, unknown, TContext>,
        context
      );

      if (execution === undefined) {
        result = centralFailure({
          definition: definition as AgentHostToolDefinition<unknown, TData>,
          code: "execution_metadata_missing",
          message: "Tool execution metadata is missing; the request was rejected before execution."
        });
      } else {
        let metadataValid = true;
        try {
          validateToolExecutionMetadata(execution, definition.name);
        } catch (error) {
          metadataValid = false;
          result = centralFailure({
            definition: definition as AgentHostToolDefinition<unknown, TData>,
            code: "execution_metadata_invalid",
            message: error instanceof Error ? error.message : "Tool execution metadata is invalid."
          });
        }

        if (metadataValid) {
          // The state-changing baseline is intentionally fail-closed. Read-only,
          // diagnostic, metadata-only, inert, and visual-only tools do not enter
          // the confirmation gate.
          const stateChanging = execution.executionClass === "state_changing";
          if (stateChanging && definition.safety === undefined) {
            result = centralFailure({
              definition: definition as AgentHostToolDefinition<unknown, TData>,
              code: "safety_metadata_missing",
              message: "State-changing tools must declare safety metadata before execution."
            });
          } else if (stateChanging && isDryRun && definition.preview === undefined) {
            result = centralFailure({
              definition: definition as AgentHostToolDefinition<unknown, TData>,
              code: "preview_handler_missing",
              message: "This state-changing tool cannot prove a non-executing dry run."
            });
          } else {
            let effectFingerprint: string | undefined;
            let governedEffect: GovernedActionEffect | undefined;
            if (definition.safety !== undefined) {
              const dynamicSafetyInput = definition.safety.getInput?.(parsed.data) ?? {};
              const safetyInput: SafetyInput = {
                ...dynamicSafetyInput,
                tool: definition.name,
                actionType: centralSafetyActionType(definition, execution)
              };
              const effect = execution.executionClass === "state_changing"
                ? definition.resolveEffect !== undefined
                  ? await definition.resolveEffect(parsed.data, context)
                  : actionEffectFromSafetyInput({
                      ...safetyInput,
                      externalEffect: safetyInput.externalEffect ?? execution.externalEffect,
                      destructive: safetyInput.destructive ?? execution.reversibility === "destructive",
                      effect: {
                        ...safetyInput.effect,
                        operationFamily: safetyInput.effect?.operationFamily ?? execution.operationFamily ?? "state_change",
                        operation: safetyInput.effect?.operation ?? execution.operation ?? "governed_action"
                      }
                      }, context.sessionId, execution.executionClass, execution, parsed.data)
                : undefined;
              governedEffect = effect;
              if (effect !== undefined) {
                const requiredEffectBindings = execution.requiredBindings ?? (execution.requiresExactTarget ? ["target"] : []);
                const effectValidation = validateGovernedActionEffect(effect, definition.resolveEffect === undefined ? requiredEffectBindings : requiredEffectBindings, context.sessionId);
                if (!effectValidation.ok) throw new Error(`${effectValidation.code}:${effectValidation.reason}`);
              }
              if (effect !== undefined) safetyInput.effect = effect;
              if (effect !== undefined) {
                safetyInput.externalEffect = safetyInput.externalEffect ?? effect.externalEffect;
                safetyInput.destructive = safetyInput.destructive ?? effect.destructive;
                if (safetyInput.dataSensitivity === undefined && effect.sensitivity === "communication") {
                  safetyInput.dataSensitivity = "sensitive";
                }
              }
              effectFingerprint = typeof safetyInput.effect?.fingerprint === "string" ? safetyInput.effect.fingerprint : undefined;
              safetyDecision = evaluateSafety(safetyInput, context.policy, {
                agentHostDir: context.config.agentHostDir,
                ownerSessionId: context.sessionId,
                grants: context.grants.listActiveGrants()
              });
            }

            const actionDecision = governedEffect === undefined ? undefined : decideGovernedAction({
              effect: governedEffect,
              ...(safetyDecision === undefined ? {} : { safety: { allowed: safetyDecision.allowed, blocked: safetyDecision.blocked, guideOnly: safetyDecision.guideOnly, riskLevel: safetyDecision.riskLevel, appSensitivity: safetyDecision.appSensitivity }, grantDecision: safetyDecision.grantDecision }),
              policy: context.policy
            });
            // Handlers use the safety decision for their preview payloads. Keep
            // its action fingerprint aligned with the central canonical effect
            // so preview-issued confirmations bind to the exact execute path.
            if (safetyDecision !== undefined && actionDecision !== undefined) {
              safetyDecision = { ...safetyDecision, actionDecision };
            }

            // Grant execution requirements are enforced centrally for tools
            // classified as state-changing. Metadata/inert tools may persist
            // their own redacted records and retain their existing domain
            // checks without being upgraded into external-action tools.
            const grantRequiresDryRun = stateChanging && safetyDecision?.grantDecision.requiresDryRun === true;
            const grantRequiresConfirmation = stateChanging && safetyDecision?.grantDecision.requiresConfirmationToken === true;
            const requiresConfirmation = (stateChanging && execution.requiresConfirmationToken) || grantRequiresConfirmation;

            if (!isDryRun && actionDecision !== undefined && ["blocked_by_policy", "unsupported", "unavailable", "verification_unavailable"].includes(actionDecision.decision)) {
              const policyCode = safetyDecision?.blocked === true ? "safety_blocked" : (actionDecision.code ?? "action_policy_blocked");
              result = centralFailure({ definition: definition as AgentHostToolDefinition<unknown, TData>, code: policyCode, message: actionDecision.reason, ...(safetyDecision === undefined ? {} : { safetyDecision }), actionDecision });
            } else if (!isDryRun && actionDecision?.code === "action_grant_missing") {
              result = centralFailure({ definition: definition as AgentHostToolDefinition<unknown, TData>, code: "action_grant_missing", message: actionDecision.reason, ...(safetyDecision === undefined ? {} : { safetyDecision }), actionDecision });
            } else if (!isDryRun && safetyDecision !== undefined && (!safetyDecision.allowed || safetyDecision.guideOnly)) {
              result = centralFailure({
                definition: definition as AgentHostToolDefinition<unknown, TData>,
                code: safetyDecision.blocked || safetyDecision.guideOnly ? "safety_blocked" : "approval_required",
                message: safetyDecision.blocked || safetyDecision.guideOnly
                  ? "Tool execution was blocked by the safety engine."
                  : "Tool execution requires approval before it can run.",
                safetyDecision
              });
            } else if (!isDryRun && (execution.requiresDryRun || grantRequiresDryRun) && !hasConfirmationToken(parsed.data)) {
              result = centralFailure({
                definition: definition as AgentHostToolDefinition<unknown, TData>,
                code: "dry_run_required",
                message: "A successful dry-run and its confirmation token are required before execution.",
                ...(safetyDecision === undefined ? {} : { safetyDecision })
              });
            } else if (requiresConfirmation && !isDryRun && !hasConfirmationToken(parsed.data)) {
              result = centralFailure({
                definition: definition as AgentHostToolDefinition<unknown, TData>,
                code: "confirmation_required",
                message: "A confirmation token is required before this tool can execute.",
                ...(safetyDecision === undefined ? {} : { safetyDecision })
              });
            } else if (!isDryRun && requiresConfirmation && hasConfirmationToken(parsed.data)) {
              const token = typeof (parsed.data as Record<string, unknown>).confirmationToken === "string"
                ? (parsed.data as Record<string, unknown>).confirmationToken as string
                : undefined;
              const confirmationTool = definition.confirmationTool?.(parsed.data) ?? definition.name;
              const envelope = token === undefined || context.confirmations === undefined
                ? { ok: false, reason: "Confirmation manager is unavailable for this state-changing request." }
                : context.confirmations.verifyEnvelope(token, {
                    sessionId: context.sessionId,
                    tool: confirmationTool,
                    input: definition.confirmationInput?.(parsed.data) ?? parsed.data,
                    riskLevel: safetyDecision?.riskLevel ?? definition.riskLevel,
                    ...(effectFingerprint === undefined ? {} : { effectFingerprint })
                  });
              if (!envelope.ok) {
                result = centralFailure({
                  definition: definition as AgentHostToolDefinition<unknown, TData>,
                  code: "confirmation_rejected",
                  message: envelope.reason,
                  ...(safetyDecision === undefined ? {} : { safetyDecision })
                });
              } else {
                result = await definition.handler(parsed.data, context, { isDryRun, safetyDecision, ...(effectFingerprint === undefined ? {} : { effectFingerprint }), ...(actionDecision === undefined ? {} : { actionDecision }) });
              }
            } else {
              result = await definition.handler(parsed.data, context, { isDryRun, safetyDecision, ...(effectFingerprint === undefined ? {} : { effectFingerprint }), ...(actionDecision === undefined ? {} : { actionDecision }) });
            }

            if (!isDryRun && result.ok && governedEffect?.externalEffect === true && result.verification?.verified !== true) {
              result = toolFailure<TData>({
                tool: definition.name,
                riskLevel: result.riskLevel,
                error: { code: "action_verification_unavailable", message: "External effect has no independent verification result." },
                observations: ["Execution result was not accepted without independent post-action verification."]
              });
            }

            if (safetyDecision !== undefined && result.grantDecision === undefined) {
              result = { ...result, grantDecision: safetyDecision.grantDecision };
            }
            if (actionDecision !== undefined && result.actionDecision === undefined) {
              result = { ...result, actionDecision };
            }
            if (safetyDecision?.actionDecision !== undefined && result.actionDecision === undefined) {
              result = { ...result, actionDecision: safetyDecision.actionDecision };
            }
          }
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      const coded = /^(action_[a-z_]+|protected_context_blocked|browser_[a-z_]+)(?::|$)/.exec(detail)?.[1];
      result = toolFailure<TData>({
        tool: definition.name,
        riskLevel: definition.riskLevel,
        error: {
          code: coded ?? "tool_execution_failed",
          message: coded === undefined
            ? (error instanceof Error ? error.message : "Tool execution failed.")
            : coded.startsWith("browser_")
              ? "Browser bridge state could not be resolved safely."
              : "Governed action effect could not be resolved safely.",
          details: error
        }
      });
    }
  }

  const durationMs = Math.round(performance.now() - start);
  if (runtimeActivity !== undefined) {
    try { context.runtimeActivity?.finishDirectTool(runtimeActivity.activityId, result); } catch { /* Activity projection never changes tool result. */ }
  }
  if (context.receipts !== undefined && parsed.success) {
    result = { ...result, receipt: context.receipts.issue({ sessionId: context.sessionId, tool: definition.name, rawInput: parsed.data, result, riskLevel: result.riskLevel }) };
  }
  const inputSummary = parsed.success && definition.auditInputSummary !== undefined
    ? definition.auditInputSummary(parsed.data)
    : definition.inputSummary;
  const outputSummary = definition.auditOutputSummary?.(result);
  await context.logger.log(createAuditLogEntry(result, context, inputSummary, durationMs, outputSummary));
  try { await context.controlRoom?.recordToolActivity({ sessionId: context.sessionId, timestamp: new Date().toISOString(), tool: definition.name, ...(result.strategy === undefined ? {} : { strategy: result.strategy }), riskLevel: result.riskLevel, preview: result.preview === true, ok: result.ok, ...(result.error === null ? {} : { errorCode: result.error.code }), durationMs, confirmation: result.confirmation !== undefined, ...(result.receipt === undefined ? {} : { receiptId: result.receipt.receiptId }), ...(result.actionDecision === undefined ? {} : { actionDecision: result.actionDecision }), ...(result.verification === undefined ? {} : { verification: result.verification }) }); } catch { /* Reporting never changes tool result. */ }
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
