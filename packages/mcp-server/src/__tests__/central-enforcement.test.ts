import { describe, expect, it } from "vitest";
import { createBaseCapabilityRegistry, createGovernedActionEffect, fingerprintActionBinding, getPolicyProfile, toolFailure, toolSuccess, type AuditLogger, type CapabilityGrant, type CapabilityRegistrySnapshot } from "@agenthost/core";
import { z } from "zod";
import { ConfirmationManager } from "../confirmation.js";
import { GrantStore } from "../grants.js";
import { runTool, type AgentHostToolDefinition, type ToolExecutionContext } from "../tool-runner.js";
import { buildPreviewResult } from "../tools/preview.js";

const inputSchema = z.object({
  dryRun: z.boolean().optional(),
  confirmationToken: z.string().optional(),
  value: z.string().optional()
}).strict();

function context(profile: "dev" | "strict" = "dev", registry: CapabilityRegistrySnapshot = createBaseCapabilityRegistry()): ToolExecutionContext {
  const policy = getPolicyProfile(profile);
  const logger: AuditLogger = { log: async () => undefined };
  return {
    sessionId: "central-enforcement-test",
    config: {
      agentHostDir: "/tmp/agenthost-central-enforcement",
      configPath: "/tmp/agenthost-central-enforcement/config.json",
      logFile: "/tmp/agenthost-central-enforcement/logs/test.jsonl",
      profile,
      policy
    },
    policy,
    registry,
    logger,
    grants: new GrantStore({ persistentGrants: [] })
  };
}

function stateTool(handler: AgentHostToolDefinition<z.infer<typeof inputSchema>, unknown>["handler"], safety = true): AgentHostToolDefinition<z.infer<typeof inputSchema>, unknown> {
  return {
    name: "file.write",
    description: "test state-changing tool",
    riskLevel: "medium",
    inputSchema,
    mcpInputSchema: { type: "object" },
    inputSummary: "central enforcement test",
    ...(safety ? { safety: { actionType: "file_write" as const } } : {}),
    preview: { isDryRun: (input) => input.dryRun === true },
    execution: {
      executionClass: "state_changing",
      externalEffect: false,
      requiresDryRun: true,
      requiresConfirmationToken: true,
      requiresExactTarget: false,
      source: "base",
      availability: "available"
    },
    handler
  };
}

describe("central tool-runner execution baseline", () => {
  it("fails closed when execution metadata is missing", async () => {
    let calls = 0;
    const { execution: _execution, ...definition } = stateTool(async () => { calls += 1; return toolSuccess({ tool: "file.write", riskLevel: "medium", data: {} }); });
    const emptyRegistry = { listStrategies: () => [], listTools: () => [], listAppCapabilities: () => [] };
    const result = await runTool(definition, {}, context("dev", emptyRegistry));
    expect(result.error?.code).toBe("execution_metadata_missing");
    expect(calls).toBe(0);
  });

  it("rejects state-changing tools without safety metadata", async () => {
    let calls = 0;
    const result = await runTool(stateTool(async () => { calls += 1; return toolSuccess({ tool: "file.write", riskLevel: "medium", data: {} }); }, false), {}, context());
    expect(result.error?.code).toBe("safety_metadata_missing");
    expect(calls).toBe(0);
  });

  it("requires a dry-run token before a safe state-changing call", async () => {
    let calls = 0;
    const result = await runTool(stateTool(async () => { calls += 1; return toolSuccess({ tool: "file.write", riskLevel: "medium", data: {} }); }), { value: "x" }, context());
    expect(result.error?.code).toBe("dry_run_required");
    expect(calls).toBe(0);
  });

  it("evaluates protected policy before dry-run/confirmation errors", async () => {
    let calls = 0;
    const definition = {
      ...stateTool(async () => { calls += 1; return toolSuccess({ tool: "file.write", riskLevel: "high", data: {} }); }),
      name: "shell.run_safe",
      safety: { actionType: "shell_command" as const, getInput: (input: z.infer<typeof inputSchema>) => input.value === undefined ? {} : { shellCommand: input.value } }
    };
    const result = await runTool(definition, { value: "rm -rf /" }, context("strict"));
    expect(result.error?.code).toBe("safety_blocked");
    expect(calls).toBe(0);
  });

  it("validates the non-consuming confirmation envelope before the handler", async () => {
    const current = context();
    let calls = 0;
    const definition = stateTool(async (input, handlerContext) => {
      calls += 1;
      const verification = handlerContext.confirmations?.verifyEnvelope(input.confirmationToken ?? "", {
        sessionId: handlerContext.sessionId, tool: "file.write", input, riskLevel: "medium"
      });
      return verification?.ok
        ? toolSuccess({ tool: "file.write", riskLevel: "medium", data: {} })
        : toolFailure({ tool: "file.write", riskLevel: "medium", error: { code: "confirmation_rejected", message: "rejected" } });
    });
    const token = new ConfirmationManager();
    current.confirmations = token;
    const preview = token.createPreviewToken({ sessionId: "other-session", tool: "file.write", input: { value: "x" }, riskLevel: "medium", targetSummary: "test" });
    const result = await runTool(definition, { value: "x", confirmationToken: preview.confirmationToken }, current);
    expect(result.error?.code).toBe("confirmation_rejected");
    expect(calls).toBe(0);
  });

  it("leaves the single consuming confirmation operation to the handler", async () => {
    const current = context();
    const confirmationManager = new ConfirmationManager();
    current.confirmations = confirmationManager;
    const preview = confirmationManager.createPreviewToken({
      sessionId: current.sessionId,
      tool: "file.write",
      input: { value: "x" },
      riskLevel: "medium",
      targetSummary: "test"
    });
    let handlerConsumed = false;
    const definition = stateTool(async (input, handlerContext) => {
      const consumed = handlerContext.confirmations!.verifyAndConsume(preview.confirmationToken, {
        sessionId: handlerContext.sessionId,
        tool: "file.write",
        input,
        riskLevel: "medium"
      });
      handlerConsumed = consumed.ok;
      return toolSuccess({ tool: "file.write", riskLevel: "medium", data: {} });
    });
    const result = await runTool(definition, { value: "x", confirmationToken: preview.confirmationToken }, current);
    expect(result.ok).toBe(true);
    expect(handlerConsumed).toBe(true);
    expect(confirmationManager.verifyEnvelope(preview.confirmationToken, {
      sessionId: current.sessionId, tool: "file.write", input: { value: "x" }, riskLevel: "medium"
    }).reason).toMatch(/already used/i);
  });

  it("rejects unresolved exact effects before handler execution", async () => {
    let calls = 0;
    const definition = {
      ...stateTool(async () => { calls += 1; return toolSuccess({ tool: "file.write", riskLevel: "medium", data: {} }); }),
      execution: { ...stateTool(async () => toolSuccess({ tool: "file.write", riskLevel: "medium", data: {} })).execution!, requiresExactTarget: true },
      resolveEffect: () => createGovernedActionEffect({
        ownerSessionId: "central-enforcement-test",
        operationFamily: "file",
        operation: "write",
        executionClass: "state_changing",
        bindings: {}
      })
    };
    const result = await runTool(definition, { dryRun: true, value: "x" }, context());
    expect(result.error?.code).toBe("action_target_missing");
    expect(calls).toBe(0);
  });

  it("allows one exact confirmed external effect through a governed mock route", async () => {
    const current = context();
    const confirmationManager = new ConfirmationManager();
    current.confirmations = confirmationManager;
    const target = fingerprintActionBinding("recipient:bounded");
    const content = fingerprintActionBinding("content:bounded");
    const grant: CapabilityGrant = {
      id: "grant.communication.bounded",
      scope: "session",
      effect: "allow",
      match: {
        operationFamilies: ["communication"],
        operations: ["send"],
        targetFingerprints: [target],
        contentFingerprints: [content],
        appSensitivities: ["communication"],
        ownerSessionIds: [current.sessionId]
      },
      requirements: { requiresDryRun: true, requiresConfirmationToken: true, requiresExactTarget: true }
    };
    current.grants = new GrantStore({ persistentGrants: [grant] });
    const definition: AgentHostToolDefinition<z.infer<typeof inputSchema>, unknown> = {
      name: "communication.send_governed",
      description: "Test-only governed communication route.",
      riskLevel: "high",
      inputSchema,
      mcpInputSchema: { type: "object" },
      inputSummary: "Governed communication test",
      safety: { actionType: "communication_send", getInput: () => ({ externalEffect: true, communicative: true, dataSensitivity: "sensitive" }) },
      execution: {
        executionClass: "state_changing", externalEffect: true, requiresDryRun: true,
        requiresConfirmationToken: true, requiresExactTarget: true, source: "base", availability: "available",
        operationFamily: "communication", operation: "send", reversibility: "external", sensitivity: "communication",
        requiredBindings: ["target", "content"], confirmationLevel: "standard", verificationKind: "receipt", cleanupKind: "none"
      },
      preview: { isDryRun: (input) => input.dryRun === true },
      resolveEffect: (_input, ctx) => createGovernedActionEffect({
        ownerSessionId: ctx.sessionId, operationFamily: "communication", operation: "send", executionClass: "state_changing",
        externalEffect: true, sensitivity: "communication", reversibility: "external", confirmationLevel: "standard",
        verificationKind: "receipt", bindings: { target, content }
      }),
      handler: async (input, ctx, runtime) => {
        const exactTarget = { target, content };
        if (runtime?.isDryRun) return buildPreviewResult({ tool: "communication.send_governed", riskLevel: "high", safety: runtime.safetyDecision!, effectFingerprint: runtime.effectFingerprint, targetSummary: "Bounded communication effect", target: { kind: "app", summary: "Exact governed mock recipient" }, confirmation: { manager: confirmationManager, sessionId: ctx.sessionId, input, target: exactTarget, explanation: "Confirm exact bounded communication effect.", riskLevel: "high", appSensitivity: "communication" }, wouldExecute: true });
        const verified = confirmationManager.verifyAndConsume(input.confirmationToken ?? "", { sessionId: ctx.sessionId, tool: "communication.send_governed", input, target: exactTarget, riskLevel: "high", ...(runtime?.effectFingerprint === undefined ? {} : { effectFingerprint: runtime.effectFingerprint }) });
        return verified.ok
          ? toolSuccess({ tool: "communication.send_governed", riskLevel: "high", data: { route: "mock", executed: true }, verification: { required: true, verified: true, kind: "receipt", summary: "Mock route receipt verified.", independent: true } })
          : toolFailure({ tool: "communication.send_governed", riskLevel: "high", error: { code: "confirmation_rejected", message: verified.reason } });
      }
    };
    const preview = await runTool(definition, { value: "bounded", dryRun: true }, current);
    expect(preview.ok).toBe(true);
    const token = (preview.data as { confirmationToken?: string }).confirmationToken;
    expect(token).toEqual(expect.any(String));
    const result = await runTool(definition, { value: "bounded", confirmationToken: token }, current);
    expect(result).toMatchObject({ ok: true, data: { route: "mock", executed: true }, verification: { verified: true } });
  });
});
