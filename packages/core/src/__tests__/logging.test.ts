import { mkdtemp, readFile } from "node:fs/promises";
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
});
