import { createHash } from "node:crypto";
import { toolFailure, toolSuccess, type RiskLevel, type ToolResult } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";
import { runTool } from "../tool-runner.js";

const MAX_STEPS = 20;
const MAX_INPUT_BYTES = 64 * 1024;

const stepInput = z.object({
  tool: z.string().trim().min(3).max(100),
  input: z.record(z.unknown()).optional()
}).strict();

const runStepsInput = z.object({
  steps: z.array(stepInput).min(1).max(MAX_STEPS),
  stopOnError: z.boolean().optional()
}).strict().superRefine((value, ctx) => {
  if (Buffer.byteLength(JSON.stringify(value.steps), "utf8") > MAX_INPUT_BYTES) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Plan input exceeds 64 KiB." });
  }
  for (const [index, step] of value.steps.entries()) {
    if (step.tool === "computer.run_steps") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["steps", index, "tool"], message: "Nested run_steps is not allowed." });
    }
  }
});

type RunStepsInput = z.infer<typeof runStepsInput>;
type Step = RunStepsInput["steps"][number];

const RISK_ORDER: Record<RiskLevel, number> = { observe: 0, low: 1, medium: 2, high: 3, blocked: 4 };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function planFingerprint(steps: Step[]): string {
  return createHash("sha256").update(canonical(steps.map((step) => ({ tool: step.tool, input: step.input ?? {} })))).digest("hex").slice(0, 20);
}

function nestedRequiresConfirmation(result: ToolResult): boolean {
  const data = result.data;
  return data !== null && typeof data === "object" && (data as { requiresConfirmation?: unknown }).requiresConfirmation === true;
}

function blockedCode(result: ToolResult): boolean {
  return ["invalid_input", "safety_blocked", "emergency_stop_requested", "human_takeover_active", "pause_requested"].includes(result.error?.code ?? "");
}

function maxRisk(results: Array<{ riskLevel: RiskLevel }>, fallback: RiskLevel): RiskLevel {
  return results.reduce<RiskLevel>((highest, entry) => RISK_ORDER[entry.riskLevel] > RISK_ORDER[highest] ? entry.riskLevel : highest, fallback);
}

function previewContext(context: AgentHostMcpContext): AgentHostMcpContext {
  const {
    actionOverlay: _actionOverlay,
    trace: _trace,
    confirmationSatisfied: _confirmationSatisfied,
    planApproval: _planApproval,
    ...rest
  } = context;
  return { ...rest, logger: { log: async () => undefined } };
}

export function createRunStepsTool(): AnyAgentHostToolDefinition<AgentHostMcpContext> {
  const tool: AgentHostToolDefinition<RunStepsInput, unknown, AgentHostMcpContext> = {
    name: "computer.run_steps",
    description: "Runs a bounded, governed plan of up to 20 AgentHost tool calls with one plan-scoped approval for low/medium effects. Each step still re-enters full safety, stop/takeover, confirmation, audit, and execution gates; high-risk steps still need their own token.",
    riskLevel: "medium",
    inputSchema: runStepsInput,
    mcpInputSchema: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          minItems: 1,
          maxItems: MAX_STEPS,
          items: {
            type: "object",
            properties: {
              tool: { type: "string" },
              input: { type: "object", additionalProperties: true }
            },
            required: ["tool"],
            additionalProperties: false
          }
        },
        stopOnError: { type: "boolean" }
      },
      required: ["steps"],
      additionalProperties: false
    },
    inputSummary: (input) => `Run ${input.steps.length} planned step${input.steps.length === 1 ? "" : "s"}`,
    safety: { actionType: "plan" },
    auditInputSummary: (input) => `Plan with ${input.steps.length} governed steps`,
    auditOutputSummary: (result) => result.ok ? "Plan completed." : `Plan stopped: ${result.error?.code ?? "failed"}`,
    preview: {
      async resolveEffect(input, context) {
        const fingerprint = planFingerprint(input.steps);
        const steps: Array<{ index: number; tool: string; ok: boolean; riskLevel: RiskLevel; status: "ready" | "blocked"; summary?: string; error?: string }> = [];
        const blockedReasons: string[] = [];
        let planNeedsConfirmation = false;
        const tools = context.tools;
        for (const [index, step] of input.steps.entries()) {
          const target = tools?.get(step.tool);
          if (target === undefined) {
            steps.push({ index, tool: step.tool, ok: false, riskLevel: "blocked", status: "blocked", error: "unknown_tool" });
            blockedReasons.push(`Step ${index + 1}: unknown tool ${step.tool}.`);
            continue;
          }
          const result = await runTool(
            target as AnyAgentHostToolDefinition<AgentHostMcpContext>,
            { ...(step.input ?? {}), dryRun: true },
            previewContext(context),
            { previewOnly: true }
          );
          const blocked = blockedCode(result) || result.riskLevel === "blocked";
          if (blocked) blockedReasons.push(`Step ${index + 1} ${step.tool}: ${result.error?.message ?? "blocked"}`);
          if (nestedRequiresConfirmation(result) && (result.riskLevel === "low" || result.riskLevel === "medium")) planNeedsConfirmation = true;
          const summary = typeof result.data === "object" && result.data !== null
            ? (result.data as { summary?: string }).summary
            : undefined;
          steps.push({
            index,
            tool: step.tool,
            ok: result.ok,
            riskLevel: result.riskLevel,
            status: blocked ? "blocked" : "ready",
            ...(summary === undefined ? {} : { summary }),
            ...(result.error?.code === undefined ? {} : { error: result.error.code })
          });
        }
        if (blockedReasons.length > 0) {
          return { summary: "Plan contains blocked steps.", blocked: true, reasons: blockedReasons, targetFingerprint: fingerprint, data: { planFingerprint: fingerprint, steps } };
        }
        return {
          summary: `Plan of ${input.steps.length} governed step${input.steps.length === 1 ? "" : "s"}`,
          targetFingerprint: fingerprint,
          requiresConfirmation: planNeedsConfirmation,
          data: { planFingerprint: fingerprint, steps, planRequiresConfirmation: planNeedsConfirmation }
        };
      }
    },
    async handler(input, context): Promise<ToolResult<unknown>> {
      const fingerprint = planFingerprint(input.steps);
      const tools = context.tools;
      if (tools === undefined) {
        return toolFailure({ tool: "computer.run_steps", riskLevel: "medium", error: { code: "plan_unavailable", message: "Tool registry is unavailable." }, observations: ["No action was executed."] });
      }
      const { confirmationSatisfied: _ignored, ...baseContext } = context;
      const planApproved = context.confirmationSatisfied === true;
      const childContext: AgentHostMcpContext = planApproved
        ? { ...baseContext, planApproval: { planFingerprint: fingerprint, maxRisk: "medium" } }
        : baseContext;
      const stopOnError = input.stopOnError !== false;
      const results: Array<{ index: number; tool: string; ok: boolean; riskLevel: RiskLevel; data?: unknown; error?: unknown; observations?: string[] }> = [];
      let failed: ToolResult | undefined;
      for (const [index, step] of input.steps.entries()) {
        const target = tools.get(step.tool);
        if (target === undefined) {
          failed = toolFailure({ tool: "computer.run_steps", riskLevel: "medium", error: { code: "unknown_tool", message: `Unknown tool: ${step.tool}` }, observations: [`Step ${index + 1} was not executed.`] });
          break;
        }
        const result = await runTool(target as AnyAgentHostToolDefinition<AgentHostMcpContext>, step.input ?? {}, childContext);
        results.push({
          index,
          tool: step.tool,
          ok: result.ok,
          riskLevel: result.riskLevel,
          data: result.data,
          error: result.error,
          observations: result.observations
        });
        if (!result.ok) {
          failed = result;
          if (stopOnError) break;
        }
      }
      const failedCode = failed?.error?.code;
      const data = { planFingerprint: fingerprint, steps: results, ...(failedCode === undefined ? {} : { failedCode }) };
      if (failed !== undefined) {
        const code = failed.error?.code === "confirmation_required" || blockedCode(failed)
          ? failed.error?.code ?? "step_failed"
          : "step_failed";
        const result: ToolResult<unknown> = toolFailure({
          tool: "computer.run_steps",
          riskLevel: maxRisk(results, "medium"),
          error: {
            code,
            message: code === "confirmation_required"
              ? "A plan step requires its own confirmation before the plan can continue."
              : failed.error?.message ?? "A plan step failed.",
            details: { failedStep: results.at(-1)?.index, failedTool: results.at(-1)?.tool }
          },
          observations: ["The plan stopped at the failed step.", ...(failed.observations ?? [])]
        });
        result.data = data;
        return result;
      }
      return toolSuccess({
        tool: "computer.run_steps",
        riskLevel: maxRisk(results, "medium"),
        data,
        observations: [`Completed ${results.length} governed step${results.length === 1 ? "" : "s"}.`, "Verify the final state before reporting completion."]
      });
    }
  };
  return tool as AnyAgentHostToolDefinition<AgentHostMcpContext>;
}
