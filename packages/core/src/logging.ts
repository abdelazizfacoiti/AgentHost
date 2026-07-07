import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { redactForLog } from "./safety/redaction.js";
import type { AuditLogEntry, AuditLogger, ToolResult } from "./types.js";

const MAX_SUMMARY_LENGTH = 500;

function truncate(input: string): string {
  if (input.length <= MAX_SUMMARY_LENGTH) {
    return input;
  }

  return `${input.slice(0, MAX_SUMMARY_LENGTH)}...`;
}

export function summarizeForLog(value: unknown): string {
  if (value === undefined) {
    return "";
  }

  const redacted = redactForLog(value);
  const raw = typeof redacted === "string" ? redacted : JSON.stringify(redacted);
  return truncate(raw);
}

export function createSessionId(): string {
  return `session_${randomUUID()}`;
}

export class JsonlAuditLogger implements AuditLogger {
  constructor(readonly logFile: string) {}

  async log(entry: AuditLogEntry): Promise<void> {
    await mkdir(path.dirname(this.logFile), { recursive: true });
    await appendFile(this.logFile, `${JSON.stringify(entry)}\n`, "utf8");
  }
}

export function summarizeToolResult(result: ToolResult): string {
  if (!result.ok) {
    return result.error === null ? "Tool failed." : `${result.error.code}: ${result.error.message}`;
  }

  return summarizeForLog(result.data);
}
