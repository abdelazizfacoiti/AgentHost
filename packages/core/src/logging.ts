import { randomUUID } from "node:crypto";
import { chmod, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { redactForLog } from "./safety/redaction.js";
import type { AuditLogEntry, AuditLogger, ToolResult, ToolTraceEvent, ToolTraceLogger } from "./types.js";

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

async function appendJsonl(filePath: string, entry: unknown): Promise<void> {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  try {
    await chmod(filePath, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const handle = await open(filePath, "a", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(entry)}\n`, "utf8");
    await chmod(filePath, 0o600);
  } finally {
    await handle.close();
  }
}

export class JsonlAuditLogger implements AuditLogger {
  constructor(readonly logFile: string) {}

  async log(entry: AuditLogEntry): Promise<void> {
    await appendJsonl(this.logFile, entry);
  }
}

export class JsonlTraceLogger implements ToolTraceLogger {
  constructor(readonly traceFile: string) {}

  async event(entry: ToolTraceEvent): Promise<void> {
    await appendJsonl(this.traceFile, entry);
  }
}

export function summarizeToolResult(result: ToolResult): string {
  if (!result.ok) {
    return result.error === null ? "Tool failed." : `${result.error.code}: ${result.error.message}`;
  }

  return summarizeForLog(result.data);
}
