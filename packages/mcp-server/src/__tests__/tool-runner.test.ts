import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  acceptConfirmation,
  createTask,
  clearPause,
  getDefaultPolicy,
  requestPause,
  requestStop,
  toolSuccess,
  type AuditLogEntry,
  type OverlayWidget,
  type RiskLevel,
  type ToolExecutionMetadata
} from "@agenthost/core";
import type { AgentHostMcpContext } from "../context.js";
import type { OverlayManager } from "@agenthost/app-overlay";
import { ToolActionOverlay } from "../action-overlay.js";
import { runTool, type AgentHostToolDefinition } from "../tool-runner.js";
import { createFileTools } from "../tools/file.js";
import { createDesktopTools } from "../tools/desktop.js";
import { createWindowTools } from "../tools/window.js";
import { createShellTools } from "../tools/shell.js";
import { applyProductionExecutionMetadata } from "../tool-metadata.js";

const roots: string[] = [];
async function tempHome(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-runner-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function stateChanging(): ToolExecutionMetadata {
  return {
    executionClass: "state_changing",
    externalEffect: false,
    requiresDryRun: true,
    requiresConfirmationToken: true,
    requiresExactTarget: true,
    source: "base",
    availability: "available"
  };
}

function readOnly(): ToolExecutionMetadata {
  return {
    executionClass: "read_only",
    externalEffect: false,
    requiresDryRun: false,
    requiresConfirmationToken: false,
    requiresExactTarget: false,
    source: "base",
    availability: "available"
  };
}

function makeContext(home: string, logs: AuditLogEntry[]): AgentHostMcpContext {
  return {
    sessionId: "test-session",
    config: { agentHostDir: home, configPath: path.join(home, "config.json"), logFile: path.join(home, "logs", "audit.jsonl") },
    policy: getDefaultPolicy(),
    grants: { listActiveGrants: () => [] },
    logger: { log: async (entry: AuditLogEntry) => { logs.push(entry); } },
    runtime: { version: "9.9.9-test", entryPath: "/opt/agenthost/mcp-server/dist/index.js", startedAt: "2026-01-01T00:00:00.000Z" }
  } as unknown as AgentHostMcpContext;
}

function writeTool(handler: (input: { value: string }) => Promise<unknown>, riskLevel: RiskLevel = "medium"): AgentHostToolDefinition<{ value: string; dryRun?: boolean; confirmationToken?: string }, unknown> {
  return {
    name: "test.write",
    description: "Test write",
    riskLevel: "medium",
    inputSchema: z.object({ value: z.string().min(1), dryRun: z.boolean().optional(), confirmationToken: z.string().optional() }).strict(),
    mcpInputSchema: {},
    inputSummary: "Test write",
    safety: { actionType: "inspect" },
    preview: {
      isDryRun: (input) => input.dryRun === true,
      resolveEffect: (input) => ({ summary: `Write ${input.value}`, targetFingerprint: input.value, riskLevel, data: { value: input.value } })
    },
    execution: stateChanging(),
    handler: async (input) => {
      await handler(input);
      return toolSuccess({ tool: "test.write", riskLevel: "medium", data: { wrote: input.value } });
    }
  } as AgentHostToolDefinition<{ value: string; dryRun?: boolean; confirmationToken?: string }, unknown>;
}

describe("governed tool runner", () => {
  it("records bounded per-phase timings without leaking arguments", async () => {
    const home = await tempHome();
    const logs: AuditLogEntry[] = [];
    const context = makeContext(home, logs);
    const tool = writeTool(async () => undefined);
    tool.execution = { ...stateChanging(), requiresConfirmationToken: false };
    const result = await runTool(tool, { value: "timing-secret" }, context);
    expect(result.ok).toBe(true);
    const timing = logs.at(-1)?.timings;
    expect(timing).toBeDefined();
    for (const value of Object.values(timing ?? {})) expect(value).toBeGreaterThanOrEqual(0);
    expect(timing?.total).toBe(logs.at(-1)?.durationMs);
    expect(JSON.stringify(timing)).not.toContain("timing-secret");
  });

  it("rejects invalid input before calling the handler", async () => {
    const home = await tempHome();
    const logs: AuditLogEntry[] = [];
    const handler = vi.fn(async () => undefined);
    const result = await runTool(writeTool(handler), { value: "" }, makeContext(home, logs));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("invalid_input");
    expect(handler).not.toHaveBeenCalled();
    expect(logs.at(-1)?.errorCode).toBe("invalid_input");
  });

  it("previews, issues a token, executes once after acceptance, and audits provenance", async () => {
    const home = await tempHome();
    const logs: AuditLogEntry[] = [];
    const handler = vi.fn(async () => undefined);
    const tool = writeTool(handler);
    const context = makeContext(home, logs);

    const preview = await runTool(tool, { value: "hello", dryRun: true }, context);
    expect(preview.ok).toBe(true);
    expect(preview.preview).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    const tokenId = preview.confirmation?.tokenId;
    expect(tokenId).toMatch(/^conf_/);

    const blocked = await runTool(tool, { value: "hello", confirmationToken: tokenId }, context);
    expect(blocked.ok).toBe(false);
    expect(blocked.error?.code).toBe("confirmation_not_approved");
    expect(handler).not.toHaveBeenCalled();
    expect(JSON.stringify(logs.at(-1))).not.toContain(tokenId);

    await acceptConfirmation(home, tokenId!);
    const executed = await runTool(tool, { value: "hello", confirmationToken: tokenId }, context);
    expect(executed.ok).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(executed.confirmation?.status).toBe("tokenAccepted");
    expect(executed.serverVersion).toBe("9.9.9-test");
    expect(executed.serverPath).toBe("/opt/agenthost/mcp-server/dist/index.js");
    expect(logs.at(-1)).toMatchObject({ tool: "test.write", ok: true, serverVersion: "9.9.9-test", serverPath: "/opt/agenthost/mcp-server/dist/index.js" });
    expect(JSON.stringify(logs)).not.toContain(tokenId);

    const reused = await runTool(tool, { value: "hello", confirmationToken: tokenId }, context);
    expect(reused.ok).toBe(false);
    expect(reused.error?.code).toBe("confirmation_token_not_found");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not execute blocked previews", async () => {
    const home = await tempHome();
    const handler = vi.fn(async () => undefined);
    const tool = writeTool(handler);
    tool.preview = { resolveEffect: () => ({ summary: "Blocked", riskLevel: "blocked", blocked: true, reasons: ["synthetic block"] }) };
    const result = await runTool(tool, { value: "hello" }, makeContext(home, []));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("safety_blocked");
    expect(handler).not.toHaveBeenCalled();
  });

  it("halts state-changing tools under stop while allowing read-only observation", async () => {
    const home = await tempHome();
    await requestStop(home, "test stop");
    const context = makeContext(home, []);
    const writeHandler = vi.fn(async () => undefined);
    const writeResult = await runTool(writeTool(writeHandler), { value: "hello" }, context);
    expect(writeResult.error?.code).toBe("emergency_stop_requested");
    expect(writeHandler).not.toHaveBeenCalled();

    const readTool: AgentHostToolDefinition<Record<string, never>, unknown> = {
      name: "test.read",
      description: "Test read",
      riskLevel: "observe",
      inputSchema: z.object({}).strict(),
      mcpInputSchema: {},
      inputSummary: "Test read",
      safety: { actionType: "observe" },
      execution: readOnly(),
      handler: async () => toolSuccess({ tool: "test.read", riskLevel: "observe", data: { observed: true } })
    };
    const readResult = await runTool(readTool, {}, context);
    expect(readResult.ok).toBe(true);
  });

  it("halts state-changing tools under pause while allowing observation", async () => {
    const home = await tempHome();
    await requestPause(home, "test pause");
    const context = makeContext(home, []);
    const writeHandler = vi.fn(async () => undefined);
    const writeResult = await runTool(writeTool(writeHandler), { value: "hello" }, context);
    expect(writeResult.error?.code).toBe("pause_requested");
    expect(writeResult.observations?.join(" ")).toContain("test pause");
    expect(writeHandler).not.toHaveBeenCalled();

    const readTool: AgentHostToolDefinition<Record<string, never>, unknown> = {
      name: "test.read",
      description: "Test read",
      riskLevel: "observe",
      inputSchema: z.object({}).strict(),
      mcpInputSchema: {},
      inputSummary: "Test read",
      safety: { actionType: "observe" },
      execution: readOnly(),
      handler: async () => toolSuccess({ tool: "test.read", riskLevel: "observe", data: { observed: true } })
    };
    expect((await runTool(readTool, {}, context)).ok).toBe(true);

    await clearPause(home);
    const resumed = await runTool(writeTool(writeHandler), { value: "hello", dryRun: true }, context);
    expect(resumed.ok).toBe(true);
    expect(resumed.preview).toBe(true);
  });

  it("writes routine files directly and blocks control-plane targets", async () => {
    const home = await tempHome();
    const context = makeContext(home, []);
    const write = applyProductionExecutionMetadata(createFileTools()).find((tool) => tool.name === "file.write")!;
    const target = path.join(home, "notes.txt");

    const preview = await runTool(write, { path: target, content: "hello", dryRun: true }, context);
    expect(preview.ok).toBe(true);
    expect(preview.preview).toBe(true);
    expect(preview.confirmation).toBeUndefined();
    const executed = await runTool(write, { path: target, content: "hello" }, context);
    expect(executed.ok).toBe(true);
    expect(await (await import("node:fs/promises")).readFile(target, "utf8")).toBe("hello");

    const blocked = await runTool(write, { path: path.join(home, "run", "evil.txt"), content: "x", dryRun: true }, context);
    expect(blocked.ok).toBe(false);
    expect(blocked.error?.code).toBe("safety_blocked");
    expect(blocked.approval.status).toBe("denied");

    const read = applyProductionExecutionMetadata(createFileTools()).find((tool) => tool.name === "file.read")!;
    const bounded = await runTool(read, { path: target, maxBytes: 2 }, context) as { data: { content: string; truncated: boolean } };
    expect(bounded.data).toEqual(expect.objectContaining({ content: "he", truncated: true }));
  });

  it("blocks shell commands whose cwd would enter the AgentHost control plane", async () => {
    const home = await tempHome();
    const context = makeContext(home, []);
    const run = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    (context as unknown as { linux: unknown }).linux = { runSafeCommand: run };
    const tool = applyProductionExecutionMetadata(createShellTools()).find((entry) => entry.name === "shell.run")!;

    const preview = await runTool(tool, { command: "cat", args: ["stop.requested"], cwd: path.join(home, "run"), dryRun: true }, context);
    expect(preview.ok).toBe(false);
    expect(preview.error?.code).toBe("safety_blocked");
    expect(run).not.toHaveBeenCalled();
  });

  it("shows an automatic action card before and during state-changing work", async () => {
    const home = await tempHome();
    const showWidget = vi.fn(async (_widget: OverlayWidget) => ({ ok: true, errors: [] }));
    const updateWidget = vi.fn(async () => ({ ok: true, reason: "overlay_widget_updated", acknowledged: true }));
    const manager = {
      showWidget,
      updateWidget,
      dismiss: vi.fn(async () => ({ ok: true, reason: "dismissed", acknowledged: true })),
      pollEvents: vi.fn(async () => [])
    } as unknown as OverlayManager;
    const context = makeContext(home, []);
    context.actionOverlay = new ToolActionOverlay(manager, { widgetId: "action-card", minDisplayMs: 0, now: () => Date.now() });
    const handler = vi.fn(async () => {
      expect(showWidget).toHaveBeenCalledTimes(1);
    });
    const tool = writeTool(handler);
    tool.execution = { ...stateChanging(), requiresConfirmationToken: false };

    const result = await runTool(tool, { value: "hello" }, context);
    expect(result.ok).toBe(true);
    expect(showWidget).toHaveBeenCalledTimes(1);
    expect(showWidget.mock.calls[0]?.[0]).toMatchObject({ widgetId: "action-card", title: "AgentHost · test.write" });
    expect(updateWidget).toHaveBeenCalled();

    const readTool: AgentHostToolDefinition<Record<string, never>, unknown> = {
      name: "test.read",
      description: "Test read",
      riskLevel: "observe",
      inputSchema: z.object({}).strict(),
      mcpInputSchema: {},
      inputSummary: "Test read",
      safety: { actionType: "observe" },
      execution: readOnly(),
      handler: async () => toolSuccess({ tool: "test.read", riskLevel: "observe", data: { observed: true } })
    };
    await runTool(readTool, {}, context);
    expect(showWidget).toHaveBeenCalledTimes(1);
    await context.actionOverlay.close();
  });

  it("routes read-only computer actions by overlay.mode", async () => {
    const home = await tempHome();
    const context = makeContext(home, []);
    const finish = vi.fn(async () => undefined);
    const begin = vi.fn(async () => ({ finish }));
    (context as unknown as { actionOverlay: unknown }).actionOverlay = { begin };
    const observation: AgentHostToolDefinition<Record<string, never>, unknown> = {
      name: "computer.observe_state",
      description: "Observe",
      riskLevel: "observe",
      inputSchema: z.object({}).strict(),
      mcpInputSchema: {},
      inputSummary: "Observe computer state",
      safety: { actionType: "observe" },
      execution: readOnly(),
      handler: async () => toolSuccess({ tool: "computer.observe_state", riskLevel: "observe", data: { observed: true } })
    };

    (context.config as { overlay?: { mode: string } }).overlay = { mode: "always" };
    await runTool(observation, {}, context);
    expect(begin).toHaveBeenCalledTimes(1);

    (context.config as { overlay?: { mode: string } }).overlay = { mode: "on_change" };
    await runTool(observation, {}, context);
    expect(begin).toHaveBeenCalledTimes(1);

    const write = writeTool(vi.fn(async () => undefined));
    write.execution = { ...stateChanging(), requiresConfirmationToken: false };
    (context.config as { overlay?: { mode: string } }).overlay = { mode: "off" };
    await runTool(write, { value: "hello" }, context);
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it("reports overlay unavailability without failing the action", async () => {
    const home = await tempHome();
    const context = makeContext(home, []);
    const finish = vi.fn(async () => ({ started: false, visible: false, hidden: false, error: "overlay_show_timeout" }));
    (context as unknown as { actionOverlay: unknown }).actionOverlay = { begin: vi.fn(async () => ({ finish })) };
    const tool = writeTool(async () => undefined);
    tool.execution = { ...stateChanging(), requiresConfirmationToken: false };
    const result = await runTool(tool, { value: "hello" }, context);
    expect(result.ok).toBe(true);
    expect(result.overlay).toBe("unavailable:overlay_show_timeout");
  });

  it("captures routine screenshots directly with suppression", async () => {
    const home = await tempHome();
    const context = makeContext(home, []);
    let suppressed = false;
    const screenshot = vi.fn(async (input: { path: string }) => {
      expect(suppressed).toBe(true);
      return { supported: true, backend: "scrot", path: input.path, bytesWritten: 3, reason: "Captured." };
    });
    (context as unknown as { linux: unknown }).linux = { screenshot };
    context.overlayScreenshotSuppression = async (capture) => {
      suppressed = true;
      try {
        return await capture();
      } finally {
        suppressed = false;
      }
    };
    const tool = applyProductionExecutionMetadata(createDesktopTools()).find((entry) => entry.name === "desktop.screenshot")!;
    const outputDir = path.join(home, "shots");
    const target = path.join(outputDir, "screenshot-test-session-screen.png");

    const preview = await runTool(tool, { outputDir, dryRun: true }, context);
    expect(preview.ok).toBe(true);
    expect(preview.data).toMatchObject({ summary: `Capture screenshot to ${target}` });
    expect(preview.confirmation).toBeUndefined();
    const executed = await runTool(tool, { outputDir }, context);
    expect(executed.ok).toBe(true);
    expect(screenshot).toHaveBeenCalledWith(expect.objectContaining({ path: target }));
  });

  it("returns failures for desktop actions that did not complete", async () => {
    const home = await tempHome();
    const context = makeContext(home, []);
    (context as unknown as { linux: unknown }).linux = {
      screenshot: vi.fn(async (input: { path: string }) => ({
        supported: false,
        backend: "scrot",
        path: input.path,
        reason: "The screenshot backend did not produce a non-empty image file."
      })),
      getActiveWindow: vi.fn(async () => ({
        supported: true,
        backend: "xdotool",
        activeWindow: { windowId: "123" },
        reason: "Read the active window."
      })),
      typeText: vi.fn(async () => ({
        supported: false,
        backend: "xdotool",
        typed: false,
        characterCount: 3,
        activeWindow: { windowId: "123" },
        method: "clipboard",
        reason: "Layout-unsafe characters require a clipboard backend; install xclip or xsel."
      })),
      hotkey: vi.fn(async () => ({
        supported: false,
        backend: "xdotool",
        sent: false,
        keys: ["CTRL+L"],
        activeWindow: { windowId: "123" },
        reason: "The hotkey backend did not complete successfully."
      })),
      click: vi.fn(async () => ({
        supported: false,
        backend: "xdotool",
        clicked: false,
        x: 10,
        y: 20,
        button: "left",
        activeWindow: { windowId: "123" },
        reason: "The click backend did not complete successfully."
      })),
      pointer: vi.fn(async () => ({
        supported: false,
        backend: "xdotool",
        performed: false,
        action: "move_mouse",
        activeWindow: { windowId: "123" },
        reason: "The pointer backend did not complete successfully."
      })),
      focusWindow: vi.fn(async () => ({
        supported: true,
        backend: "wmctrl",
        focused: false,
        window: { windowId: "123" },
        reason: "The window manager reported success, but the requested window did not become active."
      }))
    };

    const desktopTools = createDesktopTools();
    const screenshot = desktopTools.find((entry) => entry.name === "desktop.screenshot")!;
    const screenshotResult = await screenshot.handler({ outputDir: path.join(home, "shots") }, context);
    expect(screenshotResult).toMatchObject({ ok: false, error: { code: "screenshot_failed" } });

    const typeText = desktopTools.find((entry) => entry.name === "desktop.type_text")!;
    const typeResult = await typeText.handler({ text: "a_b", activeWindow: { windowId: "123" } }, context);
    expect(typeResult).toMatchObject({ ok: false, error: { code: "type_failed" } });
    expect(typeResult.error?.message).toContain("xclip");

    const hotkey = desktopTools.find((entry) => entry.name === "desktop.hotkey")!;
    const hotkeyResult = await hotkey.handler({ keys: ["CTRL+L"], activeWindow: { windowId: "123" } }, context);
    expect(hotkeyResult).toMatchObject({ ok: false, error: { code: "hotkey_failed" } });

    const click = desktopTools.find((entry) => entry.name === "desktop.click")!;
    const clickResult = await click.handler({ x: 10, y: 20, activeWindow: { windowId: "123" } }, context);
    expect(clickResult).toMatchObject({ ok: false, error: { code: "click_failed" } });

    const pointer = desktopTools.find((entry) => entry.name === "desktop.pointer")!;
    const pointerResult = await pointer.handler({ x: 10, y: 20, activeWindow: { windowId: "123" } }, context);
    expect(pointerResult).toMatchObject({ ok: false, error: { code: "pointer_failed" } });

    const focus = createWindowTools().find((entry) => entry.name === "window.focus")!;
    const focusResult = await focus.handler({ windowId: "123" }, context);
    expect(focusResult).toMatchObject({ ok: false, error: { code: "focus_failed" } });
  });

  it("confirms private read-only effects without exposing execution fields to the schema", async () => {
    const home = await tempHome();
    const context = makeContext(home, []);
    const handler = vi.fn(async (_input: { path: string }, toolContext: AgentHostMcpContext) => {
      expect(toolContext.confirmationSatisfied).toBe(true);
      return toolSuccess({ tool: "test.private_read", riskLevel: "medium", data: { read: true } });
    });
    const read: AgentHostToolDefinition<{ path: string; dryRun?: boolean; confirmationToken?: string }, unknown> = {
      name: "test.private_read",
      description: "Test private read",
      riskLevel: "low",
      inputSchema: z.object({ path: z.string().min(1) }).strict(),
      mcpInputSchema: {},
      inputSummary: "Read private data",
      safety: {
        actionType: "file_read",
        getInput: (input) => ({ filePath: input.path, appName: "Gmail", dataSensitivity: "sensitive" as const })
      },
      execution: readOnly(),
      handler
    };

    const pending = await runTool(read, { path: "/tmp/notes.txt" }, context);
    expect(pending.ok).toBe(false);
    expect(pending.error?.code).toBe("confirmation_required");
    const tokenId = pending.confirmation?.tokenId;
    expect(tokenId).toMatch(/^conf_/);
    expect(pending.confirmation?.executed).toBe(false);
    expect(handler).not.toHaveBeenCalled();

    await acceptConfirmation(home, tokenId!);
    const executed = await runTool(read, { path: "/tmp/notes.txt", confirmationToken: tokenId }, context);
    expect(executed.ok).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(executed.confirmation?.status).toBe("tokenAccepted");
  });

  it("auto-chains only low/medium effects covered by an active task approval", async () => {
    const home = await tempHome();
    const task = await createTask(home, "Batch safe work");
    const approvalPath = path.join(home, "tasks", "approvals", "active.json");
    await mkdir(path.dirname(approvalPath), { recursive: true });
    await writeFile(approvalPath, JSON.stringify({
      approvalId: "approval-1",
      taskId: task.taskId,
      maxRisk: "medium",
      origin: "cli",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    }));

    const context = makeContext(home, []);
    const handler = vi.fn(async () => undefined);
    const medium = await runTool(writeTool(handler, "medium"), { value: "covered" }, context);
    expect(medium.ok).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);

    const high = await runTool(writeTool(handler, "high"), { value: "needs-token" }, context);
    expect(high.ok).toBe(false);
    expect(high.error?.code).toBe("confirmation_required");
    expect(handler).toHaveBeenCalledTimes(1);

    const privateRead: AgentHostToolDefinition<{ path: string }, unknown> = {
      name: "test.private_read",
      description: "Test private read",
      riskLevel: "low",
      inputSchema: z.object({ path: z.string().min(1) }).strict(),
      mcpInputSchema: {},
      inputSummary: "Read private data",
      safety: {
        actionType: "file_read",
        getInput: (input) => ({ filePath: input.path, appName: "Gmail", dataSensitivity: "sensitive" as const })
      },
      execution: readOnly(),
      handler: async () => toolSuccess({ tool: "test.private_read", riskLevel: "medium", data: { read: true } })
    };
    const privatePending = await runTool(privateRead, { path: "/tmp/private.txt" }, context);
    expect(privatePending.ok).toBe(false);
    expect(privatePending.error?.code).toBe("confirmation_required");
  });

  it("warns once when the exact same call repeats without progress", async () => {
    const home = await tempHome();
    const context = makeContext(home, []);
    const probe: AgentHostToolDefinition<{ query: string }, unknown> = {
      name: "desktop.probe",
      description: "Test probe",
      riskLevel: "observe",
      inputSchema: z.object({ query: z.string().min(1) }).strict(),
      mcpInputSchema: {},
      inputSummary: "Probe desktop",
      safety: { actionType: "observe" },
      execution: readOnly(),
      handler: async () => toolSuccess({ tool: "desktop.probe", riskLevel: "observe", data: { found: true } })
    };
    const results = [];
    for (let index = 0; index < 6; index += 1) results.push(await runTool(probe, { query: "domains" }, context));
    expect(results[1]?.observations?.join(" ")).not.toContain("run 3 times");
    expect(results[2]?.observations?.join(" ")).toContain("run 3 times");
    expect(results[4]?.observations?.join(" ")).not.toContain("run 6 times");
    expect(results[5]?.observations?.join(" ")).toContain("run 6 times");
  });

  it("surfaces approval waits for read-only tools that need confirmation", async () => {
    const home = await tempHome();
    const context = makeContext(home, []);
    const finish = vi.fn(async () => undefined);
    const begin = vi.fn(async () => ({ finish }));
    (context as unknown as { actionOverlay: unknown }).actionOverlay = { begin };
    (context.config as { overlay?: { mode: string } }).overlay = { mode: "on_change" };
    const privateRead: AgentHostToolDefinition<{ path: string }, unknown> = {
      name: "file.read",
      description: "Read private data",
      riskLevel: "low",
      inputSchema: z.object({ path: z.string().min(1) }).strict(),
      mcpInputSchema: {},
      inputSummary: "Read private data",
      safety: {
        actionType: "file_read",
        getInput: (input) => ({ filePath: input.path, appName: "Gmail", dataSensitivity: "sensitive" as const })
      },
      execution: readOnly(),
      handler: async () => toolSuccess({ tool: "file.read", riskLevel: "medium", data: { read: true } })
    };
    const result = await runTool(privateRead, { path: "/tmp/private.txt" }, context);
    expect(result.error?.code).toBe("confirmation_required");
    expect(begin).toHaveBeenCalledWith(expect.objectContaining({ tool: "file.read" }));
    expect(finish).toHaveBeenCalledWith(result);
  });
});
