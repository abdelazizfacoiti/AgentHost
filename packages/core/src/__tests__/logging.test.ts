import { chmod, mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonlAuditLogger, summarizeForLog } from "../index.js";

describe("JsonlAuditLogger", () => {
  it("writes audit entries as JSONL", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agenthost-logger-"));
    const logFile = path.join(dir, "agenthost.jsonl");
    const logger = new JsonlAuditLogger(logFile);

    await logger.log({
      timestamp: "2026-07-07T21:00:00.000Z",
      sessionId: "session_test",
      tool: "system.get_info",
      profile: "strict",
      riskLevel: "observe",
      preview: true,
      inputSummary: "Get system info",
      approvalStatus: "not_required",
      ok: true,
      durationMs: 1,
      outputSummary: "Returned system info"
    });

    const lines = (await readFile(logFile, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      tool: "system.get_info",
      riskLevel: "observe",
      preview: true
    });
  });

  it("redacts obvious secret words from summaries", () => {
    expect(summarizeForLog("token=abc123")).toBe("token=[redacted]");
  });

  it("creates restrictive log directory and file permissions and repairs broad files", async () => {
    if (process.platform === "win32") return;
    const dir = await mkdtemp(path.join(os.tmpdir(), "agenthost-logger-perms-"));
    const logFile = path.join(dir, "nested", "agenthost.jsonl");
    const logger = new JsonlAuditLogger(logFile);
    await logger.log({
      timestamp: "2026-07-07T21:00:00.000Z",
      sessionId: "session_test",
      tool: "system.get_info",
      profile: "strict",
      riskLevel: "observe",
      inputSummary: "Get system info",
      approvalStatus: "not_required",
      ok: true,
      durationMs: 1,
      outputSummary: "Returned system info"
    });
    await chmod(logFile, 0o664);
    await logger.log({
      timestamp: "2026-07-07T21:00:01.000Z",
      sessionId: "session_test",
      tool: "system.get_info",
      profile: "strict",
      riskLevel: "observe",
      inputSummary: "Get system info",
      approvalStatus: "not_required",
      ok: true,
      durationMs: 1,
      outputSummary: "Returned system info"
    });
    expect((await stat(path.dirname(logFile))).mode & 0o777).toBe(0o700);
    expect((await stat(logFile)).mode & 0o777).toBe(0o600);
  });
});
