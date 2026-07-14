import { describe, expect, it } from "vitest";
import { createBaseCapabilityRegistry, getPolicyProfile, toolFailure, toolSuccess, type AuditLogger, type CapabilityRegistrySnapshot } from "@agenthost/core";
import { z } from "zod";
import { ConfirmationManager } from "../confirmation.js";
import { GrantStore } from "../grants.js";
import { runTool, type AgentHostToolDefinition, type ToolExecutionContext } from "../tool-runner.js";

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
      externalEffect: true,
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
});
