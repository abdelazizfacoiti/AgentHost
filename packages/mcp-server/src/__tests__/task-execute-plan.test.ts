import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAdapterRegistry, createBaseCapabilityRegistry, getPolicyProfile, toolSuccess, type AgentHostConfig, type AuditLogger, type ToolExecutionMetadata } from "@agenthost/core";
import { BrowserBridgeServer } from "@agenthost/app-browser";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ConfirmationManager } from "../confirmation.js";
import type { AgentHostMcpContext } from "../context.js";
import { ForgeStore } from "../forge-store.js";
import { GrantStore } from "../grants.js";
import { clearStop, requestStop } from "../stop-flag.js";
import { runTool } from "../tool-runner.js";
import { createTaskTools } from "../tools/tasks.js";

class Logger implements AuditLogger { entries: unknown[] = []; async log(entry: unknown) { this.entries.push(entry); } }

const readOnlyExecution: ToolExecutionMetadata = { executionClass: "read_only", externalEffect: false, requiresDryRun: false, requiresConfirmationToken: false, requiresExactTarget: false, source: "base", availability: "available", operationFamily: "observe", operation: "inspect", reversibility: "reversible", sensitivity: "normal", requiredBindings: [], confirmationLevel: "none", verificationKind: "none", cleanupKind: "none" };

const echoTool = {
  name: "test.echo",
  description: "Test-only echo step.",
  riskLevel: "low" as const,
  inputSchema: z.object({ text: z.string().optional() }).strict(),
  mcpInputSchema: { type: "object", properties: {} },
  inputSummary: "Echo",
  safety: { actionType: "observe" as const },
  execution: readOnlyExecution,
  handler: async (input: { text?: string }) => toolSuccess({ tool: "test.echo", riskLevel: "low" as const, data: { text: input.text ?? "" } })
};

const failTool = {
  ...echoTool,
  name: "test.fail",
  handler: async () => ({ ok: false as const, tool: "test.fail", riskLevel: "low" as const, approval: { required: false, status: "not_required" as const }, data: null, observations: [], error: { code: "test_step_failed", message: "Planned failure." } })
};

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-plan-"));
  const policy = getPolicyProfile("dev");
  const config: AgentHostConfig = { agentHostDir: root, configPath: `${root}/config.json`, logFile: `${root}/logs/x.jsonl`, profile: "dev", policy, browserBridge: { enabled: false, port: 43117, pairingTokenFile: `${root}/browser/pairing-token` } };
  const context: AgentHostMcpContext = { sessionId: "plan-test", config, policy, registry: createBaseCapabilityRegistry(), adapters: createAdapterRegistry(), logger: new Logger(), confirmations: new ConfirmationManager(), grants: new GrantStore(), forge: new ForgeStore(root), browserBridge: new BrowserBridgeServer(config.browserBridge!), linux: {} as never };
  const tools = [...createTaskTools(), echoTool as never, failTool as never];
  context.tools = new Map(tools.map((tool) => [(tool as { name: string }).name, tool]));
  const call = (name: string, input: unknown) => runTool((context.tools as Map<string, never>).get(name)!, input, context);
  const created = await call("task.create", { goal: "Execute a small plan" });
  const taskId = (created.data as { taskId: string }).taskId;
  return { root, context, call, taskId };
}

describe("task.execute_plan", () => {
  it("validates the plan in dry-run without executing steps", async () => {
    const { call, taskId } = await fixture();
    const preview = await call("task.execute_plan", { taskId, steps: [{ tool: "test.echo", input: { text: "hi" } }], dryRun: true });
    expect(preview).toMatchObject({ ok: true, preview: true, tool: "task.execute_plan" });
    const data = preview.data as { targetSummary?: string; confirmationRequired?: boolean; confirmationToken?: string };
    expect(data.targetSummary).toContain("1 plan steps");
    expect(data.confirmationRequired).toBe(true);
    expect(typeof data.confirmationToken).toBe("string");
  });

  it("rejects unknown tools and self-nesting without executing anything", async () => {
    const { call, taskId, context } = await fixture();
    const bad = await call("task.execute_plan", { taskId, steps: [{ tool: "nope.missing" }], dryRun: true });
    expect(bad).toMatchObject({ ok: true, preview: true });
    const nested = await call("task.execute_plan", { taskId, steps: [{ tool: "task.execute_plan" }], dryRun: true });
    expect(nested).toMatchObject({ ok: true, preview: true });
    expect(context.tools?.has("task.execute_plan")).toBe(true);
  });

  it("executes steps in order, logs progress, and halts at the first failure", async () => {
    const { call, taskId } = await fixture();
    const preview = await call("task.execute_plan", { taskId, steps: [{ tool: "test.echo", input: { text: "one" } }, { tool: "test.fail" }, { tool: "test.echo", input: { text: "never" } }], dryRun: true });
    const token = (preview.data as { confirmationToken: string }).confirmationToken;
    const result = await call("task.execute_plan", { taskId, steps: [{ tool: "test.echo", input: { text: "one" } }, { tool: "test.fail" }, { tool: "test.echo", input: { text: "never" } }], confirmationToken: token });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error?.code).toBe("test_step_failed");
      expect(result.error?.message).toContain("Step 2/3 (test.fail) failed");
      expect(result.observations.join(" ")).toContain("test.echo:ok, test.fail:test_step_failed");
    }
    const status = await call("task.status", { taskId });
    const events = ((status.data as { events: Array<{ summary: string }> }).events).map((event) => event.summary);
    expect(events).toContain("test.echo: ok");
    expect(events).toContain("test.fail: test_step_failed");
  });

  it("completes a fully successful plan with a step summary", async () => {
    const { call, taskId } = await fixture();
    const preview = await call("task.execute_plan", { taskId, steps: [{ tool: "test.echo", input: { text: "a" } }, { tool: "test.echo", input: { text: "b" } }], dryRun: true });
    const token = (preview.data as { confirmationToken: string }).confirmationToken;
    const result = await call("task.execute_plan", { taskId, steps: [{ tool: "test.echo", input: { text: "a" } }, { tool: "test.echo", input: { text: "b" } }], confirmationToken: token });
    expect(result).toMatchObject({ ok: true, tool: "task.execute_plan" });
    if (result.ok) expect(result.data).toMatchObject({ taskId, completed: 2, total: 2 });
  });

  it("refuses to start when an operator stop is requested", async () => {
    const { root, call, taskId } = await fixture();
    await requestStop(root);
    const preview = await call("task.execute_plan", { taskId, steps: [{ tool: "test.echo" }], dryRun: true });
    const token = (preview.data as { confirmationToken: string }).confirmationToken;
    const result = await call("task.execute_plan", { taskId, steps: [{ tool: "test.echo" }], confirmationToken: token });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error?.code).toBe("operator_stopped");
    await clearStop(root);
  });
});
