import { spawn } from "node:child_process";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildBubblewrapLaunchPlan, type ForgeRuntimeSandboxSelection } from "./forge-os-sandbox.js";

export const RUNTIME_TIMEOUT_MS = 5_000;
export const RUNTIME_STDOUT_BYTES_MAX = 8_192;
export const RUNTIME_STDERR_BYTES_MAX = 8_192;
export const RUNTIME_OUTPUT_BYTES_MAX = 64 * 1024;
export const RUNTIME_ENV = { HOME: "/home/sandbox", TMPDIR: "/run/tmp", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", NODE_ENV: "production" } as const;
export const RUNTIME_BLOCKED_ENV = ["DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "OPENAI_API_KEY", "SSH_AUTH_SOCK", "GPG_AGENT_INFO", "AWS_*", "AZURE_*", "GOOGLE_*", "GITHUB_TOKEN", "GH_TOKEN", "NPM_TOKEN", "NODE_AUTH_TOKEN", "*_PROXY"] as const;

export interface ForgeSubprocessResult { status: "passed" | "failed" | "timeout"; durationMs: number; outputSizeBytes: number; result?: unknown; errorSummary?: string; stdoutSummary: string; stderrSummary: string; cwd: string; envKeys: string[]; commandSummary: string; sandboxBackend: ForgeRuntimeSandboxSelection["backend"]; sandboxLimitations: string[]; }

function bounded(value: string, max: number): string { return Buffer.byteLength(value, "utf8") <= max ? value : `${Buffer.from(value).subarray(0, max).toString("utf8")} [truncated]`; }

export async function prepareRuntimeRun(input: { runDirectory: string; payload: unknown }): Promise<{ inputPath: string; outputPath: string; tempDirectory: string }> {
  const tempDirectory = path.join(input.runDirectory, "temp");
  await mkdir(tempDirectory, { recursive: true, mode: 0o700 });
  const inputPath = path.join(input.runDirectory, "input.json");
  const outputPath = path.join(input.runDirectory, "output.json");
  const encoded = JSON.stringify(input.payload);
  if (Buffer.byteLength(encoded, "utf8") > RUNTIME_OUTPUT_BYTES_MAX) throw new Error("Runtime input exceeds sandbox size limit.");
  await writeFile(inputPath, `${encoded}\n`, { encoding: "utf8", mode: 0o600 });
  return { inputPath, outputPath, tempDirectory };
}

export async function runForgeSubprocess(input: { projectPath: string; manifestPath: string; handlerPath: string; toolName: string; inputPath: string; outputPath: string; tempDirectory: string; timeoutMs?: number; runnerPath?: string; allowedOperations?: string[]; sandbox?: ForgeRuntimeSandboxSelection }): Promise<ForgeSubprocessResult> {
  const startedAt = Date.now();
  let runner = input.runnerPath ?? fileURLToPath(new URL("./forge-runner.js", import.meta.url));
  if (input.runnerPath === undefined) {
    try { await access(runner); } catch { runner = path.resolve(process.cwd(), "packages/mcp-server/dist/runtime/forge-runner.js"); }
  }
  const timeoutMs = input.timeoutMs ?? RUNTIME_TIMEOUT_MS;
  await Promise.all([access(runner), access(input.projectPath), access(input.manifestPath), access(input.handlerPath), access(input.inputPath)]);
  const sandbox = input.sandbox ?? { requestedMode: "none" as const, backend: "none" as const, fallbackUsed: false, limitations: ["No OS-level sandbox selection supplied; fixed runner limits remain active."] };
  if (sandbox.backend === "firejail" || sandbox.backend === "unshare") throw new Error(sandbox.limitations[0] ?? "Requested sandbox backend is not enabled.");
  if (sandbox.backend === "bubblewrap" && sandbox.commandPath === undefined) throw new Error("Bubblewrap command path is unavailable.");
  const launch = sandbox.backend === "bubblewrap"
    ? await buildBubblewrapLaunchPlan({ commandPath: sandbox.commandPath!, nodePath: process.execPath, runnerPath: runner, projectPath: input.projectPath, manifestPath: input.manifestPath, handlerPath: input.handlerPath, toolName: input.toolName, inputPath: input.inputPath, outputPath: input.outputPath, runDirectory: path.dirname(input.inputPath), ...(input.allowedOperations === undefined ? {} : { allowedOperations: input.allowedOperations }) })
    : { command: process.execPath, args: ["--no-addons", "--disable-proto=delete", runner, "--manifest", input.manifestPath, "--project", input.projectPath, "--tool", input.toolName, "--input", input.inputPath, "--output", input.outputPath, "--handler", input.handlerPath, ...(input.allowedOperations === undefined ? [] : ["--allowed-operations", JSON.stringify(input.allowedOperations)])], cwd: input.projectPath, env: { ...RUNTIME_ENV }, envKeys: Object.keys(RUNTIME_ENV), commandSummary: "node fixed forge-runner --manifest [path] --project [path] --tool [name] --input [path] --output [path]" };
  const child = spawn(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = ""; let capped = false; let timedOut = false;
  const stop = (signal: NodeJS.Signals) => { if (!child.killed) child.kill(signal); };
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); if (Buffer.byteLength(stdout, "utf8") > RUNTIME_STDOUT_BYTES_MAX) { capped = true; stop("SIGKILL"); } });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); if (Buffer.byteLength(stderr, "utf8") > RUNTIME_STDERR_BYTES_MAX) { capped = true; stop("SIGKILL"); } });
  const timer = setTimeout(() => { timedOut = true; stop("SIGTERM"); setTimeout(() => stop("SIGKILL"), 100).unref(); }, timeoutMs);
  const outcome = await new Promise<{ code: number | null; error?: Error }>((resolve) => { child.once("error", (error) => resolve({ code: null, error })); child.once("close", (code) => resolve({ code })); });
  clearTimeout(timer);
  const durationMs = Date.now() - startedAt;
  const base = { durationMs, stdoutSummary: bounded(stdout, RUNTIME_STDOUT_BYTES_MAX), stderrSummary: bounded(stderr, RUNTIME_STDERR_BYTES_MAX), cwd: launch.cwd, envKeys: launch.envKeys, commandSummary: launch.commandSummary, sandboxBackend: sandbox.backend, sandboxLimitations: sandbox.limitations };
  if (timedOut) return { status: "timeout", outputSizeBytes: 0, errorSummary: "Runner timed out.", ...base };
  if (capped) return { status: "failed", outputSizeBytes: 0, errorSummary: "Runner stdout/stderr exceeded sandbox limit.", ...base };
  if (outcome.error !== undefined || outcome.code !== 0) return { status: "failed", outputSizeBytes: 0, errorSummary: bounded(stderr || outcome.error?.message || "Runner failed.", 512), ...base };
  try {
    const output = await readFile(input.outputPath, "utf8");
    const outputSizeBytes = Buffer.byteLength(output, "utf8");
    if (outputSizeBytes > RUNTIME_OUTPUT_BYTES_MAX) return { status: "failed", outputSizeBytes, errorSummary: "Runner output exceeds sandbox size limit.", ...base };
    const parsed = JSON.parse(output) as { ok?: unknown; result?: unknown; error?: { message?: unknown } };
    if (parsed.ok !== true) return { status: "failed", outputSizeBytes, errorSummary: typeof parsed.error?.message === "string" ? bounded(parsed.error.message, 512) : "Runner returned invalid error.", ...base };
    return { status: "passed", outputSizeBytes, result: parsed.result, ...base };
  } catch (error) { return { status: "failed", outputSizeBytes: 0, errorSummary: error instanceof Error ? bounded(error.message, 512) : "Runner output missing.", ...base }; }
}

export function createRuntimeRunDirectory(root: string): { runId: string; runDirectory: string } { const runId = `runtime.${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 17)}.${randomUUID().slice(0, 12)}`; return { runId, runDirectory: path.join(root, runId) }; }

export async function pathIsFile(candidate: string): Promise<boolean> { try { return (await stat(candidate)).isFile(); } catch { return false; } }
