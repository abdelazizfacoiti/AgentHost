import { createHash } from "node:crypto";
import {
  ConfirmationError,
  activeApprovalCoversRisk,
  consumeConfirmation,
  evaluateSafety,
  loadTask,
  prepareConfirmation,
  readActiveTaskApproval,
  summarizeForLog,
  toolFailure,
  toolSuccess,
  evaluateRunStateGate,
  readRunState,
  type ApprovalInfo,
  type RiskLevel,
  type ToolConfirmationInfo,
  type ToolExecutionMetadata,
  type ToolResult,
  type ToolTracePhase
} from "@agenthost/core";
import type { AgentHostMcpContext } from "./context.js";
import type { ToolActionHandle } from "./action-overlay.js";
import { shouldShowActionCard } from "./activity.js";
import { createSafetyEvaluationContext } from "./grants.js";
import { withStateChangingLane } from "./execution-gate.js";

export interface ToolPreviewEffect {
  summary?: string;
  targetFingerprint?: string;
  riskLevel?: RiskLevel;
  approval?: ApprovalInfo;
  blocked?: boolean;
  reasons?: string[];
  requiresConfirmation?: boolean;
  data?: unknown;
}

export interface AgentHostToolDefinition<Input, Output, Context = AgentHostMcpContext> {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  inputSchema: any;
  mcpInputSchema: any;
  inputSummary: string | ((input: Input) => string);
  safety: { actionType: string; getInput?: (input: Input) => any };
  handler: (input: Input, context: Context, runtime?: ToolExecutionMetadata) => Promise<ToolResult<Output>>;
  auditInputSummary?: (input: Input) => string;
  auditOutputSummary?: (result: ToolResult<Output>) => string;
  preview?: {
    isDryRun?: (input: Input) => boolean;
    resolveEffect?: (input: Input, context: Context) => ToolPreviewEffect | Promise<ToolPreviewEffect>;
  };
  execution?: ToolExecutionMetadata;
  requiredGrantIds?: string[];
}

export type AnyAgentHostToolDefinition<Context = AgentHostMcpContext> = AgentHostToolDefinition<any, any, Context>;

interface ExecutionTimings {
  overlayWait: number;
  safetyEval: number;
  preview: number;
  handler: number;
  auditWrite: number;
}

interface AuditMeta {
  inputSummary: string;
  preview: boolean;
  confirmation?: ToolConfirmationInfo;
  timings: ExecutionTimings;
}

function emptyTimings(): ExecutionTimings {
  return { overlayWait: 0, safetyEval: 0, preview: 0, handler: 0, auditWrite: 0 };
}

function elapsedSince(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

async function traceEvent(
  context: AgentHostMcpContext,
  tool: string,
  phase: ToolTracePhase,
  startedAt: number,
  extra: { riskLevel?: RiskLevel | undefined; ok?: boolean | undefined; code?: string | undefined; summary?: string | undefined } = {}
): Promise<void> {
  if (context.trace === undefined) return;
  try {
    await context.trace.event({
      timestamp: new Date().toISOString(),
      sessionId: context.sessionId,
      tool,
      phase,
      elapsedMs: elapsedSince(startedAt),
      ...extra
    });
  } catch {
    /* Tracing is optional diagnostics and never changes execution. */
  }
}

function confirmationInfo(
  status: ToolConfirmationInfo["status"],
  input: {
    tokenId?: string;
    expiresAt?: string;
    reason: string;
    used?: boolean;
    accepted?: boolean;
    executed?: boolean;
  }
): ToolConfirmationInfo {
  return {
    status,
    used: input.used === true,
    accepted: input.accepted === true,
    executed: input.executed === true,
    reason: input.reason,
    ...(input.tokenId === undefined ? {} : { tokenId: input.tokenId }),
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt })
  };
}

function inputSummaryForAudit(tool: AnyAgentHostToolDefinition, input: unknown): string {
  try {
    const summary = tool.auditInputSummary?.(input)
      ?? (typeof tool.inputSummary === "function" ? tool.inputSummary(input) : tool.inputSummary);
    return summarizeForLog(summary);
  } catch {
    return "Tool input summary unavailable.";
  }
}

function schemaIssues(error: { issues?: Array<{ path?: Array<string | number>; message?: string }> }): Array<{ path: string; message: string }> {
  return (error.issues ?? []).slice(0, 20).map((issue) => ({
    path: (issue.path ?? []).map((entry) => String(entry)).join(".").slice(0, 200),
    message: (issue.message ?? "Invalid input").slice(0, 300)
  }));
}

function resolveRisk(effect: ToolPreviewEffect | undefined, fallback: RiskLevel): RiskLevel {
  return effect?.riskLevel ?? fallback;
}

function inputPassesSchema(tool: AnyAgentHostToolDefinition, input: unknown): boolean {
  if (tool.inputSchema === undefined || typeof tool.inputSchema.safeParse !== "function") return true;
  try {
    return tool.inputSchema.safeParse(input).success === true;
  } catch {
    return false;
  }
}

function resolveApproval(effect: ToolPreviewEffect | undefined): ApprovalInfo {
  return effect?.approval ?? { required: false, status: "not_required" };
}

function tokenAuditRef(tokenId: string): string {
  return `sha256:${createHash("sha256").update(tokenId).digest("hex").slice(0, 16)}`;
}

function targetFingerprint(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined;
  return createHash("sha256").update(value).digest("hex");
}

function safetyEffect(
  tool: AnyAgentHostToolDefinition,
  input: unknown,
  context: AgentHostMcpContext
): ToolPreviewEffect {
  const summary = inputSummaryForAudit(tool, input);
  if (tool.safety.getInput === undefined) return { summary };
  try {
    const safetyInput = tool.safety.getInput(input) ?? {};
    const safety = evaluateSafety(
      { ...safetyInput, tool: tool.name, actionType: tool.safety.actionType },
      context.policy,
      createSafetyEvaluationContext(context)
    );
    return {
      summary,
      ...(typeof safetyInput.filePath === "string" ? { targetFingerprint: safetyInput.filePath } : {}),
      riskLevel: safety.riskLevel,
      approval: safety.approval,
      blocked: safety.blocked,
      reasons: safety.reasons,
      requiresConfirmation: safety.grantDecision.requiresConfirmationToken
        || safety.riskLevel === "high"
        || safety.appSensitivity === "communication"
        || safety.appSensitivity === "financial"
    };
  } catch {
    return { summary };
  }
}

async function previewEffect(
  tool: AnyAgentHostToolDefinition,
  input: unknown,
  context: AgentHostMcpContext
): Promise<ToolPreviewEffect> {
  if (tool.preview?.resolveEffect === undefined) {
    return safetyEffect(tool, input, context);
  }
  try {
    return await tool.preview.resolveEffect(input, context);
  } catch (error) {
    throw new Error(`preview_failed: ${error instanceof Error ? error.message : "effect could not be resolved"}`);
  }
}

async function prepareForTool(input: {
  tool: AnyAgentHostToolDefinition;
  parsedInput: unknown;
  context: AgentHostMcpContext;
  riskLevel: RiskLevel;
  effect: ToolPreviewEffect;
}): Promise<{ tokenId: string; expiresAt: string }> {
  const effectTarget = targetFingerprint(input.effect.targetFingerprint);
  const record = await prepareConfirmation({
    agentHostDir: input.context.config.agentHostDir,
    tool: input.tool.name,
    riskLevel: input.riskLevel,
    args: input.parsedInput,
    summary: input.effect.summary ?? inputSummaryForAudit(input.tool, input.parsedInput),
    ...(effectTarget === undefined ? {} : { targetFingerprint: effectTarget }),
    sessionId: input.context.sessionId
  });
  return { tokenId: record.tokenId, expiresAt: record.expiresAt };
}

async function executeGoverned(
  tool: AnyAgentHostToolDefinition,
  rawInput: unknown,
  context: AgentHostMcpContext,
  audit: AuditMeta,
  startedAt: number,
  previewOnly: boolean
): Promise<ToolResult> {
  let phase: "safety" | "preview" | "handler" | "done" = "safety";
  let phaseStartedAt = Date.now();
  const advancePhase = (next: typeof phase): void => {
    const now = Date.now();
    if (phase === "safety") audit.timings.safetyEval += now - phaseStartedAt;
    else if (phase === "preview") audit.timings.preview += now - phaseStartedAt;
    else if (phase === "handler") audit.timings.handler += now - phaseStartedAt;
    phase = next;
    phaseStartedAt = now;
  };
  const stateChanging = tool.execution?.executionClass === "state_changing";
  try {
  const rawObject = rawInput !== null && typeof rawInput === "object" && !Array.isArray(rawInput)
    ? rawInput as Record<string, unknown>
    : undefined;
  const dryRun = tool.preview?.isDryRun?.(rawInput as never)
    ?? rawObject?.dryRun === true;
  const providedToken = typeof rawObject?.confirmationToken === "string" ? rawObject.confirmationToken : undefined;
  const parseInput = rawObject === undefined
    ? rawInput
    : Object.fromEntries(Object.entries(rawObject).filter(([key, value]) =>
        !(key === "dryRun" && typeof value === "boolean") &&
        !(key === "confirmationToken" && typeof value === "string")));

  let parsedInput = parseInput;
  if (tool.inputSchema !== undefined && typeof tool.inputSchema.safeParse === "function") {
    const parsed = tool.inputSchema.safeParse(parseInput);
    if (parsed.success !== true) {
      audit.inputSummary = "Invalid tool input";
      return toolFailure({
        tool: tool.name,
        riskLevel: tool.riskLevel,
        error: {
          code: "invalid_input",
          message: "Tool input failed schema validation.",
          details: { issues: schemaIssues(parsed.error) }
        },
        observations: ["No action was executed."]
      });
    }
    parsedInput = parsed.data;
  }

  audit.inputSummary = inputSummaryForAudit(tool, parsedInput);
  if (stateChanging) {
    const gate = evaluateRunStateGate(await readRunState(context.config.agentHostDir));
    if (!gate.allowed) {
      await traceEvent(context, tool.name, "safety", startedAt, { riskLevel: tool.riskLevel, ok: false, code: gate.code ?? "emergency_stop_requested" });
      return toolFailure({
        tool: tool.name,
        riskLevel: tool.riskLevel,
        error: { code: gate.code ?? "emergency_stop_requested", message: gate.reason ?? "Execution is halted by the operator." },
        observations: [gate.reason ?? "Execution is halted by the operator."]
      });
    }
  }
  await traceEvent(context, tool.name, "safety", startedAt, { riskLevel: tool.riskLevel, ok: true });
  advancePhase("preview");
  const needsEffect = stateChanging || tool.preview?.resolveEffect !== undefined || tool.safety.getInput !== undefined;
  let effect: ToolPreviewEffect;
  try {
    effect = needsEffect
      ? await previewEffect(tool, parsedInput, context)
      : { summary: audit.inputSummary };
  } catch (error) {
    return toolFailure({
      tool: tool.name,
      riskLevel: tool.riskLevel,
      error: {
        code: "preview_failed",
        message: error instanceof Error ? error.message : "Tool preview could not be resolved."
      },
      observations: ["No action was executed."]
    });
  }
  const riskLevel = resolveRisk(effect, tool.riskLevel);
  const approval = resolveApproval(effect);
  await traceEvent(context, tool.name, "preview", startedAt, { riskLevel, ok: effect.blocked !== true });
  const requiresConfirmation = (
    tool.execution?.requiresConfirmationToken === true ||
    effect.requiresConfirmation === true ||
    approval.required ||
    riskLevel === "high"
  );

  audit.preview = dryRun === true;
  if (effect.blocked === true || approval.status === "denied") {
    return toolFailure({
      tool: tool.name,
      riskLevel,
      approval,
      error: {
        code: "safety_blocked",
        message: "Blocked by the safety engine.",
        details: { reasons: effect.reasons ?? [] }
      },
      observations: effect.reasons ?? ["Blocked by the safety engine."]
    });
  }

  if (dryRun === true) {
    let confirmation: ToolConfirmationInfo | undefined;
    if (requiresConfirmation && !previewOnly) {
      const pending = await prepareForTool({ tool, parsedInput, context, riskLevel, effect });
      confirmation = confirmationInfo("previewGenerated", {
        tokenId: pending.tokenId,
        expiresAt: pending.expiresAt,
        reason: "Preview generated; operator confirmation is required before execution."
      });
    }
    if (confirmation !== undefined) audit.confirmation = confirmation;
    await traceEvent(context, tool.name, "confirmation", startedAt, {
      riskLevel,
      ok: true,
      code: confirmation === undefined ? "preview_only" : "confirmation_required"
    });
    return toolSuccess({
      tool: tool.name,
      riskLevel,
      approval,
      preview: true,
      ...(confirmation === undefined ? {} : { confirmation }),
      data: {
        summary: effect.summary ?? audit.inputSummary,
        ...(effect.targetFingerprint === undefined ? {} : { targetFingerprint: targetFingerprint(effect.targetFingerprint) }),
        ...(effect.data === undefined ? {} : { effect: effect.data }),
        requiresConfirmation
      },
      observations: [
        "No action was executed.",
        ...(confirmation?.tokenId === undefined ? [] : [`Operator approval: agenthost confirm ${confirmation.tokenId}`]),
        ...(effect.reasons ?? [])
      ]
    });
  }

  let confirmationAccepted = false;
  const planCovers = context.planApproval !== undefined
    && context.planApproval.planFingerprint.length > 0
    && (riskLevel === "low" || (riskLevel === "medium" && context.planApproval.maxRisk === "medium"));
  if (requiresConfirmation && planCovers) {
    audit.confirmation = confirmationInfo("tokenAccepted", {
      reason: "Plan-scoped confirmation covered this low/medium effect.",
      used: false,
      accepted: true,
      executed: false
    });
    confirmationAccepted = true;
    await traceEvent(context, tool.name, "confirmation", startedAt, { riskLevel, ok: true, code: "plan_approval" });
  } else if (requiresConfirmation) {
    const tokenId = providedToken;
    const activeApproval = await readActiveTaskApproval(context.config.agentHostDir);
    const activeTask = activeApproval === undefined ? undefined : await loadTask(context.config.agentHostDir, activeApproval.taskId);
    const exactConfirmationRequired = effect.requiresConfirmation === true || riskLevel === "high";
    const allowPending = !exactConfirmationRequired
      && activeApprovalCoversRisk(activeApproval, riskLevel)
      && activeTask?.status === "active";

    if (tokenId === undefined) {
      if (!allowPending) {
        const pending = await prepareForTool({ tool, parsedInput, context, riskLevel, effect });
        const confirmation = confirmationInfo("previewGenerated", {
          tokenId: pending.tokenId,
          expiresAt: pending.expiresAt,
          reason: "Operator confirmation is required."
        });
        audit.preview = true;
        audit.confirmation = confirmation;
        const result: ToolResult = toolFailure({
          tool: tool.name,
          riskLevel,
          approval,
          preview: true,
          confirmation,
          error: {
            code: "confirmation_required",
            message: "No action was executed. An operator must confirm the prepared preview.",
            details: { expiresAt: pending.expiresAt }
          },
          observations: [
            "No action was executed.",
            `Preview: ${effect.summary ?? audit.inputSummary}`,
            `Operator approval: agenthost confirm ${pending.tokenId}`
          ]
        });
        result.data = {
          summary: effect.summary ?? audit.inputSummary,
          ...(effect.targetFingerprint === undefined ? {} : { targetFingerprint: targetFingerprint(effect.targetFingerprint) }),
          ...(effect.data === undefined ? {} : { effect: effect.data })
        };
        return result;
      }

      const effectTarget = targetFingerprint(effect.targetFingerprint);
      const prepared = await prepareForTool({ tool, parsedInput, context, riskLevel, effect });
      await consumeConfirmation({
        agentHostDir: context.config.agentHostDir,
        tokenId: prepared.tokenId,
        tool: tool.name,
        args: parsedInput,
        ...(effectTarget === undefined ? {} : { targetFingerprint: effectTarget }),
        allowPending: true
      });
      audit.confirmation = confirmationInfo("tokenAccepted", {
        tokenId: prepared.tokenId,
        expiresAt: prepared.expiresAt,
        reason: "Active task approval covered this low/medium effect.",
        used: true,
        accepted: true,
        executed: false
      });
    } else {
      const effectTarget = targetFingerprint(effect.targetFingerprint);
      await consumeConfirmation({
        agentHostDir: context.config.agentHostDir,
        tokenId,
        tool: tool.name,
        args: parsedInput,
        ...(effectTarget === undefined ? {} : { targetFingerprint: effectTarget }),
        allowPending
      });
      audit.confirmation = confirmationInfo("tokenAccepted", {
        tokenId,
        reason: "Single-use confirmation token accepted.",
        used: true,
        accepted: true,
        executed: false
      });
    }
    confirmationAccepted = true;
    await traceEvent(context, tool.name, "confirmation", startedAt, {
      riskLevel,
      ok: true,
      code: audit.confirmation?.tokenId === undefined ? "task_approval" : "token_accepted"
    });
  }

  const handlerContext = confirmationAccepted && context.confirmationSatisfied !== true
    ? { ...context, confirmationSatisfied: true }
    : context;
  advancePhase("handler");
  const runHandler = async (): Promise<ToolResult> => {
    if (stateChanging) {
      const gate = evaluateRunStateGate(await readRunState(context.config.agentHostDir));
      if (!gate.allowed) {
        return toolFailure({
          tool: tool.name,
          riskLevel,
          error: {
            code: gate.code ?? "emergency_stop_requested",
            message: gate.reason ?? "Execution is halted by the operator."
          },
          observations: ["No action was executed.", gate.reason ?? "Execution is halted by the operator."]
        });
      }
    }
    return tool.handler(parsedInput, handlerContext, tool.execution);
  };
  const result = stateChanging
    ? await withStateChangingLane(context, runHandler)
    : await runHandler();
  advancePhase("done");
  await traceEvent(context, tool.name, "handler", startedAt, { riskLevel: result.riskLevel, ok: result.ok, code: result.error?.code });
  if (audit.confirmation !== undefined) audit.confirmation.executed = result.ok;
  if (result.confirmation === undefined && audit.confirmation !== undefined) {
    result.confirmation = audit.confirmation;
  }
  return result;
  } finally {
    const now = Date.now();
    if (phase === "safety") audit.timings.safetyEval += now - phaseStartedAt;
    else if (phase === "preview") audit.timings.preview += now - phaseStartedAt;
    else if (phase === "handler") audit.timings.handler += now - phaseStartedAt;
  }
}

interface RepeatEntry {
  count: number;
}

const REPEAT_TRACKER = new WeakMap<AgentHostMcpContext, Map<string, RepeatEntry>>();
const REPEAT_EXEMPT = /^(?:task|agent|system|adapter|policy)\./;

function stableKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableKey(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function noteRepeatedCall(context: AgentHostMcpContext, toolName: string, input: unknown): number {
  if (REPEAT_EXEMPT.test(toolName)) return 0;
  const comparable = input !== null && typeof input === "object" && !Array.isArray(input)
    ? Object.fromEntries(Object.entries(input as Record<string, unknown>).filter(([key]) => key !== "dryRun" && key !== "confirmationToken"))
    : input;
  let session = REPEAT_TRACKER.get(context);
  if (session === undefined) {
    session = new Map();
    REPEAT_TRACKER.set(context, session);
  }
  const key = `${toolName}:${stableKey(comparable)}`;
  const entry = session.get(key) ?? { count: 0 };
  entry.count += 1;
  if (session.size > 200 && !session.has(key)) {
    const oldest = session.keys().next().value;
    if (oldest !== undefined) session.delete(oldest);
  }
  session.set(key, entry);
  return entry.count;
}

export async function runTool<Input>(
  tool: AnyAgentHostToolDefinition<AgentHostMcpContext>,
  input: Input,
  context: AgentHostMcpContext,
  options: { previewOnly?: boolean } = {}
): Promise<ToolResult> {
  const startedAt = Date.now();
  if (tool.name === "task.create") REPEAT_TRACKER.delete(context);
  const activityMode = context.config.overlay?.mode ?? "always";
  const audit: AuditMeta = { inputSummary: "Tool call", preview: false, timings: emptyTimings() };
  await traceEvent(context, tool.name, "start", startedAt, { riskLevel: tool.riskLevel, ok: true });
  let action: ToolActionHandle | undefined;
  if (shouldShowActionCard(tool.name, tool.execution?.executionClass, activityMode) && inputPassesSchema(tool, input)) {
    const overlayStartedAt = Date.now();
    try {
      action = await context.actionOverlay?.begin({
        tool: tool.name,
        summary: inputSummaryForAudit(tool, input),
        riskLevel: tool.riskLevel
      });
    } catch {
      action = undefined;
    } finally {
      audit.timings.overlayWait += elapsedSince(overlayStartedAt);
    }
  }
  await traceEvent(context, tool.name, "overlay", startedAt, { riskLevel: tool.riskLevel, ok: true });

  let result: ToolResult;

  try {
    result = await executeGoverned(tool, input, context, audit, startedAt, options.previewOnly === true);
  } catch (error) {
    if (error instanceof ConfirmationError) {
      audit.confirmation = confirmationInfo("tokenRejected", {
        reason: error.message,
        used: error.code === "confirmation_token_used",
        accepted: !["confirmation_not_approved", "confirmation_token_rejected", "confirmation_token_expired", "confirmation_token_not_found"].includes(error.code),
        executed: false
      });
      result = toolFailure({
        tool: tool.name,
        riskLevel: tool.riskLevel,
        confirmation: audit.confirmation,
        error: { code: error.code, message: error.message },
        observations: ["No action was executed."]
      });
    } else {
      result = toolFailure({
        tool: tool.name,
        riskLevel: tool.riskLevel,
        error: {
          code: "execution_failed",
          message: error instanceof Error ? error.message : "Tool execution failed."
        },
        observations: ["Tool execution failed."]
      });
    }
  }

  const runtime = context.runtime;
  if (runtime !== undefined) {
    result.serverVersion ??= runtime.version;
    result.serverPath ??= runtime.entryPath;
  }

  if (action === undefined && result.error?.code === "confirmation_required" && activityMode !== "off") {
    const overlayStartedAt = Date.now();
    try {
      action = await context.actionOverlay?.begin({
        tool: tool.name,
        summary: audit.inputSummary,
        riskLevel: result.riskLevel
      });
    } catch {
      action = undefined;
    } finally {
      audit.timings.overlayWait += elapsedSince(overlayStartedAt);
    }
  }

  await traceEvent(context, tool.name, "audit", startedAt, { riskLevel: result.riskLevel, ok: result.ok, code: result.error?.code });
  const auditPreparedAt = Date.now();
  const repeats = noteRepeatedCall(context, tool.name, input);
  if (repeats === 3 || repeats === 6) {
    result.observations = [
      ...(result.observations ?? []),
      repeats === 3
        ? `This exact call has now run ${repeats} times. Decide now: if the outcome is already satisfied, verify and report; otherwise change strategy instead of repeating.`
        : `This exact call has now run ${repeats} times. Stop looping: verify the definition of done, then complete the task or report the blocker.`
    ];
  }

  audit.timings.auditWrite = elapsedSince(auditPreparedAt);
  const totalMs = elapsedSince(startedAt);
  try {
    await context.logger.log({
      timestamp: new Date().toISOString(),
      sessionId: context.sessionId,
      tool: tool.name,
      riskLevel: result.riskLevel,
      ...(runtime === undefined ? {} : { serverVersion: runtime.version, serverPath: runtime.entryPath }),
      ...(result.strategy === undefined ? {} : { strategy: result.strategy }),
      preview: audit.preview || result.preview === true,
      ...(audit.confirmation === undefined
        ? {}
        : {
            confirmationStatus: audit.confirmation.status,
            ...(audit.confirmation.tokenId === undefined ? {} : { confirmationTokenId: tokenAuditRef(audit.confirmation.tokenId) }),
            confirmationReason: summarizeForLog(audit.confirmation.reason)
          }),
      inputSummary: audit.inputSummary,
      approvalStatus: result.approval.status,
      ok: result.ok,
      durationMs: totalMs,
      timings: { ...audit.timings, total: totalMs },
      outputSummary: tool.auditOutputSummary?.(result)
        ?? (result.ok ? `${tool.name} completed.` : `${result.error?.code ?? "tool_failed"}: ${summarizeForLog(result.error?.message ?? "")}`),
      ...(result.error === null ? {} : { errorCode: result.error.code })
    });
  } catch {
    // A local audit write failure must not turn a completed action into a second action.
  }

  const actionStatus = await action?.finish(result).catch(() => undefined);
  if (actionStatus !== undefined && !actionStatus.hidden && (!actionStatus.visible || actionStatus.error !== undefined)) {
    result.overlay = `unavailable:${actionStatus.error ?? "overlay_not_visible"}`;
  }

  await traceEvent(context, tool.name, "finish", startedAt, {
    riskLevel: result.riskLevel,
    ok: result.ok,
    code: result.error?.code,
    summary: summarizeForLog(result.error?.message ?? (result.ok ? "completed" : "failed"))
  });
  return result;
}

export type { AgentHostMcpContext } from "./context.js";
