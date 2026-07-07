import { spawn } from "node:child_process";
import type { ShellRunResult } from "@agenthost/core";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface RunSafeCommandInput {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(value), min), max);
}

function appendLimited(current: Buffer[], chunk: Buffer, maxBytes: number): { chunks: Buffer[]; truncated: boolean } {
  const currentBytes = current.reduce((sum, item) => sum + item.byteLength, 0);
  const remaining = maxBytes - currentBytes;

  if (remaining <= 0) {
    return { chunks: current, truncated: true };
  }

  if (chunk.byteLength <= remaining) {
    return { chunks: [...current, chunk], truncated: false };
  }

  return { chunks: [...current, chunk.subarray(0, remaining)], truncated: true };
}

export function formatCommandForSafety(input: RunSafeCommandInput): string {
  return [input.command, ...(input.args ?? [])].join(" ");
}

export async function runSafeLinuxCommand(input: RunSafeCommandInput): Promise<ShellRunResult> {
  const startedAt = Date.now();
  const timeoutMs = clamp(input.timeoutMs, DEFAULT_TIMEOUT_MS, 1, MAX_TIMEOUT_MS);
  const maxOutputBytes = clamp(input.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, 1, MAX_OUTPUT_BYTES);
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let finalStdoutChunks = stdoutChunks;
  let finalStderrChunks = stderrChunks;
  let truncated = false;
  let timedOut = false;

  return await new Promise<ShellRunResult>((resolve, reject) => {
    const child = spawn(input.command, input.args ?? [], {
      cwd: input.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      const result = appendLimited(finalStdoutChunks, chunk, maxOutputBytes);
      finalStdoutChunks = result.chunks;
      truncated = truncated || result.truncated;
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const result = appendLimited(finalStderrChunks, chunk, maxOutputBytes);
      finalStderrChunks = result.chunks;
      truncated = truncated || result.truncated;
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        signal,
        stdout: Buffer.concat(finalStdoutChunks).toString("utf8"),
        stderr: Buffer.concat(finalStderrChunks).toString("utf8"),
        durationMs: Date.now() - startedAt,
        timedOut,
        truncated
      });
    });
  });
}
