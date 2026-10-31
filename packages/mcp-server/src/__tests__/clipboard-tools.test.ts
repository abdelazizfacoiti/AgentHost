import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acceptConfirmation, getDefaultPolicy, type AuditLogEntry } from "@agenthost/core";
import type { AgentHostMcpContext } from "../context.js";
import { runTool } from "../tool-runner.js";
import { applyProductionExecutionMetadata } from "../tool-metadata.js";
import { createClipboardTools } from "../tools/clipboard.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeContext(linux: Record<string, unknown>): Promise<{ context: AgentHostMcpContext; home: string }> {
  const home = await mkdtemp(path.join(os.tmpdir(), "agenthost-clipboard-"));
  roots.push(home);
  const logs: AuditLogEntry[] = [];
  const context = {
    sessionId: "clipboard",
    config: { agentHostDir: home, configPath: path.join(home, "config.json"), logFile: path.join(home, "logs", "audit.jsonl") },
    policy: getDefaultPolicy(),
    grants: { listActiveGrants: () => [] },
    logger: { log: async (entry: AuditLogEntry) => { logs.push(entry); } },
    linux
  } as unknown as AgentHostMcpContext;
  return { context, home };
}

const tools = applyProductionExecutionMetadata(createClipboardTools());
const tool = (name: string) => tools.find((entry) => entry.name === name)!;

describe("clipboard tools", () => {
  it("sets the clipboard directly", async () => {
    const setClipboard = vi.fn(async () => ({ supported: true, backend: "gtk", reason: "ok" }));
    const { context } = await makeContext({ setClipboard });
    const result = await runTool(tool("clipboard.set"), { text: "https://www.avito.ma/?a=1&b=2" }, context);
    expect(result.ok).toBe(true);
    expect(setClipboard).toHaveBeenCalledWith({ text: "https://www.avito.ma/?a=1&b=2" });
  });

  it("requires an exact confirmation before reading the clipboard", async () => {
    const getClipboard = vi.fn(async () => ({ supported: true, backend: "gtk", text: "copied", reason: "ok" }));
    const { context, home } = await makeContext({ getClipboard });
    const pending = await runTool(tool("clipboard.get"), {}, context);
    expect(pending).toMatchObject({ ok: false, error: { code: "confirmation_required" } });
    expect(getClipboard).not.toHaveBeenCalled();
    await acceptConfirmation(home, pending.confirmation!.tokenId!);
    const read = await runTool(tool("clipboard.get"), { confirmationToken: pending.confirmation!.tokenId }, context);
    expect(read.ok).toBe(true);
    expect(getClipboard).toHaveBeenCalledTimes(1);
  });
});
