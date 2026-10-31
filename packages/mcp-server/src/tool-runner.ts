import { createHash } from "node:crypto";
import {
  ConfirmationError,
  activeApprovalCoversRisk,
  consumeConfirmation,
  evaluateSafety,
  loadTask,
  listTasks,
  appendTaskEvent,
  updateTask,
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
  type ToolStateSnapshot,
  type ToolTracePhase
} from "@agenthost/core";
import type { AgentHostMcpContext } from "./context.js";
import type { ToolActionHandle, ToolActionTarget } from "./action-overlay.js";
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

async function actionTargetFor(toolName: string, input: unknown, context: AgentHostMcpContext): Promise<ToolActionTarget | undefined> {
  if (input === null || typeof input !== "object") return undefined;
  const value = input as Record<string, unknown>;
  const point = (x: unknown, y: unknown): ToolActionTarget | undefined => (
    typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)
      ? { x, y }
      : undefined
  );
  if (toolName === "desktop.click") return point(value.x, value.y);
  if (toolName === "desktop.pointer") {
    return point(value.startX, value.startY) ?? point(value.x, value.y);
  }
  if (toolName === "window.focus") {
    const wanted = value.target !== null && typeof value.target === "object" ? value.target as Record<string, unknown> : value;
    const windows = await context.linux.listWindows({ limit: 100, includeTitles: true }).catch(() => undefined);
    const match = windows?.windows.find((window) =>
      (typeof wanted.windowId !== "string" || window.windowId === wanted.windowId)
      && (typeof wanted.appName !== "string" || window.appName?.toLowerCase() === wanted.appName.toLowerCase())
      && (typeof wanted.title !== "string" || window.title?.toLowerCase() === wanted.title.toLowerCase())
      && (typeof wanted.pid !== "number" || window.pid === wanted.pid)
    );
    const bounds = match?.bounds;
    if (bounds !== undefined) return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      ...(match?.windowId === undefined ? {} : { windowId: match.windowId })
    };
  }
  return undefined;
}

const STATE_RESULT_FAMILIES = new Set(["desktop", "window", "file", "shell"]);
type CapturedToolState = Omit<ToolStateSnapshot, "newlyAppearedWindows"> & {
  screenFingerprint?: string;
  windows?: NonNullable<ToolStateSnapshot["newlyAppearedWindows"]>;
};

function needsStateResult(tool: AnyAgentHostToolDefinition): boolean {
  return tool.execution?.executionClass === "state_changing" && STATE_RESULT_FAMILIES.has(tool.name.split(".", 1)[0] ?? "");
}

async function captureToolState(context: AgentHostMcpContext): Promise<CapturedToolState> {
  const [active, windows, screen] = await Promise.all([
    context.linux.getActiveWindow().catch(() => undefined),
    context.linux.listWindows({ limit: 50, includeTitles: true }).catch(() => undefined),
    context.linux.getScreenGeometry?.().catch(() => undefined) ?? Promise.resolve(undefined)
  ]);
  return {
    capturedAt: new Date().toISOString(),
    ...(active?.activeWindow === undefined ? {} : { activeWindow: active.activeWindow }),
    ...(windows === undefined ? {} : { windows: windows.windows }),
    ...(screen?.bounds === undefined ? {} : { screenFingerprint: JSON.stringify(screen.bounds) })
  };
}

// Only windows absent from the pre-call snapshot are reported; the full list
// stays private so results do not repeat every open window on each call.
function attachStateDelta(result: ToolResult, before: CapturedToolState | undefined, after: CapturedToolState): ToolResult {
  const { screenFingerprint: afterScreen, windows: afterWindows, ...afterState } = after;
  if (before === undefined) {
    result.state = afterState;
    return result;
  }
  const beforeActive = before.activeWindow;
  const afterActive = after.activeWindow;
  const windowChanged = JSON.stringify(beforeActive ?? null) !== JSON.stringify(afterActive ?? null);
  const newlyAppearedWindows = before.windows === undefined
    ? []
    : (afterWindows ?? []).filter((window) => !before.windows!.some((prior) => prior.windowId === window.windowId)).slice(0, 8);
  const beforeScreen = before.screenFingerprint;
  result.state = {
    ...afterState,
    windowChanged,
    ...(beforeScreen === undefined || afterScreen === undefined ? {} : { screenChangedHint: beforeScreen !== afterScreen }),
    ...(newlyAppearedWindows.length === 0 ? {} : { newlyAppearedWindows })
  };
  return result;
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

interface RoutineTaskMetadata { phase?: string; currentAction?: string }

function parseRoutineTaskMetadata(value: unknown): { metadata?: RoutineTaskMetadata; error?: string } {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { error: "task metadata must be an object" };
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "phase" && key !== "currentAction")) return { error: "task metadata contains an unsupported field" };
  const phase = record.phase;
  const currentAction = record.currentAction;
  if (phase !== undefined && (typeof phase !== "string" || phase.trim().length === 0 || phase.length > 200)) return { error: "task.phase must be a bounded non-empty string" };
  if (currentAction !== undefined && (typeof currentAction !== "string" || currentAction.trim().length === 0 || currentAction.length > 500)) return { error: "task.currentAction must be a bounded non-empty string" };
  return { metadata: { ...(phase === undefined ? {} : { phase: phase.trim() }), ...(currentAction === undefined ? {} : { currentAction: currentAction.trim() }) } };
}

async function recordRoutineTaskMetadata(context: AgentHostMcpContext, metadata: RoutineTaskMetadata | undefined, tool: string, result: ToolResult): Promise<void> {
  if (metadata === undefined) return;
  try {
    const active = (await listTasks(context.config.agentHostDir)).find((task) => task.status === "active");
    if (active === undefined) return;
    await updateTask(context.config.agentHostDir, active.taskId, metadata);
    const summary = result.ok
      ? `${tool} completed${result.observations?.[0] === undefined ? "." : `: ${summarizeForLog(result.observations[0])}`}`
      : `${tool} failed: ${summarizeForLog(result.error?.message ?? result.error?.code ?? "tool_failed")}`;
    await appendTaskEvent(context.config.agentHostDir, active.taskId, result.ok ? "observation" : "error", summary);
  } catch {
    /* Routine bookkeeping must never change the governed tool result. */
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
  const taskMetadata = parseRoutineTaskMetadata(rawObject?.task);
  if (taskMetadata.error !== undefined) {
    audit.inputSummary = "Invalid tool input";
    return toolFailure({ tool: tool.name, riskLevel: tool.riskLevel, error: { code: "invalid_input", message: taskMetadata.error }, observations: ["No action was executed."] });
  }
  const parseInput = rawObject === undefined
    ? rawInput
    : Object.fromEntries(Object.entries(rawObject).filter(([key, value]) =>
        !(key === "dryRun" && typeof value === "boolean") &&
        !(key === "confirmationToken" && typeof value === "string") &&
        !(key === "task" && value !== undefined)));

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
  stateKey?: string;
}

const REPEAT_TRACKER = new WeakMap<AgentHostMcpContext, Map<string, RepeatEntry>>();
const REPEAT_EXEMPT = /^(?:task|agent|system|adapter|policy)\./;
const REPEAT_EXEMPT_TOOLS = new Set(["desktop.screenshot", "computer.wait", "computer.wait_for", "computer.observe_state", "desktop.scroll"]);
const NAVIGATION_KEYS = new Set([
  "page_down", "page_up", "next", "prior", "down", "up", "left", "right", "tab", "home", "end", "space", "return", "enter", "escape"
]);

// Paging, scrolling and observing legitimately repeat the same input while the
// screen advances, so they never count toward the "stop looping" nudge.
function isRepeatExempt(toolName: string, input: unknown): boolean {
  if (REPEAT_EXEMPT.test(toolName) || REPEAT_EXEMPT_TOOLS.has(toolName)) return true;
  if (input === null || typeof input !== "object" || Array.isArray(input)) return false;
  const record = input as Record<string, unknown>;
  if (toolName === "desktop.pointer" && record.action === "scroll") return true;
  if (toolName === "desktop.hotkey" && Array.isArray(record.keys)) {
    const keys = record.keys.map((key) => String(key).toLowerCase()).filter((key) => key !== "shift");
    return keys.length > 0 && keys.every((key) => NAVIGATION_KEYS.has(key));
  }
  return false;
}

function repeatStateKey(result: ToolResult): string | undefined {
  const state = result.state;
  if (state === undefined) return undefined;
  return stableKey({ activeWindow: state.activeWindow ?? null, appeared: (state.newlyAppearedWindows ?? []).map((window) => window.windowId) });
}

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

function noteRepeatedCall(context: AgentHostMcpContext, toolName: string, input: unknown, stateKey?: string): number {
  if (isRepeatExempt(toolName, input)) return 0;
  const comparable = input !== null && typeof input === "object" && !Array.isArray(input)
    ? Object.fromEntries(Object.entries(input as Record<string, unknown>).filter(([key]) => key !== "dryRun" && key !== "confirmationToken"))
    : input;
  let session = REPEAT_TRACKER.get(context);
  if (session === undefined) {
    session = new Map();
    REPEAT_TRACKER.set(context, session);
  }
  const key = `${toolName}:${stableKey(comparable)}`;
  const entry: RepeatEntry = session.get(key) ?? { count: 0 };
  // A call whose observable state differs from the last identical call made
  // progress, so the streak restarts instead of escalating.
  entry.count = entry.count > 0 && stateKey !== undefined && entry.stateKey !== undefined && entry.stateKey !== stateKey
    ? 1
    : entry.count + 1;
  if (stateKey !== undefined) entry.stateKey = stateKey;
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
  const visibleAction = shouldShowActionCard(tool.name, tool.execution?.executionClass, activityMode) && inputPassesSchema(tool, input);
  // Preview-only nested plan steps are not actions the user should see happen.
  const finishTimelineEntry = visibleAction && options.previewOnly !== true ? context.actionTimeline?.begin(tool.name, input) : undefined;
  if (visibleAction) {
    const overlayStartedAt = Date.now();
    const target = await actionTargetFor(tool.name, input, context);
    try {
      action = await context.actionOverlay?.begin({
        tool: tool.name,
        summary: inputSummaryForAudit(tool, input),
        riskLevel: tool.riskLevel,
        ...(target === undefined ? {} : { target }),
        ...(context.planStep === undefined ? {} : { step: context.planStep }),
        ...(input !== null && typeof input === "object" && (input as Record<string, unknown>).dryRun === true ? { dryRun: true } : {})
      });
    } catch {
      action = undefined;
    } finally {
      audit.timings.overlayWait += elapsedSince(overlayStartedAt);
    }
  }
  await traceEvent(context, tool.name, "overlay", startedAt, { riskLevel: tool.riskLevel, ok: true });

  let result: ToolResult;
  const stateBefore = needsStateResult(tool) ? await captureToolState(context).catch(() => undefined) : undefined;

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

  if (needsStateResult(tool)) {
    context.linux?.invalidateWindowCache?.();
    const stateAfter = await captureToolState(context).catch(() => undefined);
    if (stateAfter !== undefined) attachStateDelta(result, stateBefore, stateAfter);
  }
  const routineTask = input !== null && typeof input === "object" && !Array.isArray(input)
    ? parseRoutineTaskMetadata((input as Record<string, unknown>).task).metadata
    : undefined;
  await recordRoutineTaskMetadata(context, routineTask, tool.name, result);

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
        riskLevel: result.riskLevel,
        ...(context.planStep === undefined ? {} : { step: context.planStep })
      });
    } catch {
      action = undefined;
    } finally {
      audit.timings.overlayWait += elapsedSince(overlayStartedAt);
    }
  }

  await traceEvent(context, tool.name, "audit", startedAt, { riskLevel: result.riskLevel, ok: result.ok, code: result.error?.code });
  const auditPreparedAt = Date.now();
  const repeats = noteRepeatedCall(context, tool.name, input, repeatStateKey(result));
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

  void finishTimelineEntry?.(result).catch(() => undefined);
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
