#!/usr/bin/env node
import { chmod, cp, copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { closeSync, constants, existsSync, openSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AGENTHOST_CONFIG_SCHEMA_VERSION, AGENTHOST_VERSION, acceptConfirmation, beginTakeover, clearActiveTaskApproval, clearStop, defaultAgentHostHome, defaultPublicConfigPath, endTakeover, legacyConfigPath, listConfirmations, loadAgentHostConfig, normalizeSha256, readActiveTaskApproval, readRunState, readSha256Sidecar, redactLocalPath, rejectConfirmation, requestStop, sha256File, transitionTask } from "@agenthost/core";
import { renderTaskHtml, renderTaskMarkdown } from "./task-export.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const home = os.homedir();
const agentHome = path.resolve(process.env.AGENTHOST_HOME ?? defaultAgentHostHome(home));
const publicConfig = path.resolve(process.env.AGENTHOST_CONFIG ?? defaultPublicConfigPath(home));
const lockPath = path.join(agentHome, "run", "agenthost.lock.json");

type Json = Record<string, unknown>;
type Output = { ok: boolean; command: string; data?: unknown; error?: string; warnings?: string[] };

async function print(value: Output, json = false): Promise<void> {
  const output = json ? `${JSON.stringify(value)}\n` : value.data === undefined ? "" : typeof value.data === "string" ? `${value.data}\n` : `${JSON.stringify(value.data, null, 2)}\n`;
  if (value.ok && output) process.stdout.write(output);
  if (!value.ok) process.stderr.write(`agenthost ${value.command}: ${value.error ?? "failed"}\n`);
  for (const warning of value.warnings ?? []) process.stderr.write(`warning: ${warning}\n`);
}
function fail(command: string, error: string): Output { return { ok: false, command, error }; }
async function safeMkdir(directory: string): Promise<void> { await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700); }
async function safeWrite(file: string, content: string): Promise<void> { await safeMkdir(path.dirname(file)); const temporary = `${file}.tmp-${process.pid}-${Date.now()}`; await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, file); await chmod(file, 0o600); }
async function readJson(file: string): Promise<Json | undefined> { try { return JSON.parse(await readFile(file, "utf8")) as Json; } catch { return undefined; } }
function redact(value: unknown): unknown {
  if (typeof value === "string") {
    if (/token|secret|password|credential|api.?key|cookie/i.test(value)) return "[redacted]";
    return value.replaceAll(home, "[home]").replaceAll(/(Bearer\s+)[^\s]+/gi, "$1[redacted]");
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /token|secret|password|credential|api.?key/i.test(key) ? "[redacted]" : redact(item)]));
  return value;
}
function commandExists(command: string): boolean { return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0; }
function pythonModuleExists(expression: string): boolean { return spawnSync("python3", ["-c", expression], { stdio: "ignore" }).status === 0; }
async function probeMcp(entry: string): Promise<{ started: boolean; handshake: boolean; reason?: string }> {
  if (!existsSync(entry)) return { started: false, handshake: false, reason: "mcp_runtime_missing" };
  const isolatedHome = await mkdtemp(path.join(os.tmpdir(), "agenthost-doctor-")).catch(() => undefined);
  return await new Promise((resolve) => {
    const probeHome = isolatedHome ?? path.join(os.tmpdir(), "agenthost-doctor-fallback");
    const outputFile = path.join(probeHome, "mcp-output.jsonl"); const inputFile = path.join(probeHome, "mcp-input.jsonl");
    writeFileSync(inputFile, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "agenthost-doctor", version: AGENTHOST_VERSION } } }) + "\n");
    const inputFd = openSync(inputFile, "r"); const outputFd = openSync(outputFile, "w");
    const child = spawn(process.execPath, [entry], { stdio: [inputFd, outputFd, "ignore"], env: { ...process.env, AGENTHOST_HOME: probeHome, AGENTHOST_CONFIG: path.join(probeHome, "config.json"), AGENTHOST_STDIO_EXIT_ON_STDIN_END: "1" } });
    let settled = false;
    const finish = (value: { started: boolean; handshake: boolean; reason?: string }): void => { if (settled) return; settled = true; clearTimeout(timer); child.kill("SIGTERM"); closeSync(inputFd); closeSync(outputFd); if (isolatedHome) void rm(isolatedHome, { recursive: true, force: true }); resolve(value); };
    const readHandshake = async (): Promise<boolean> => (await readFile(outputFile, "utf8").catch(() => "")).split("\n").some((line) => { try { const message = JSON.parse(line) as { id?: unknown; result?: unknown }; return message.id === 1 && message.result !== undefined; } catch { return false; } });
    const timer = setTimeout(async () => { const handshake = await readHandshake(); finish({ started: true, handshake, ...(handshake ? {} : { reason: "mcp_handshake_timeout" }) }); }, 3_000);
    child.on("error", () => finish({ started: false, handshake: false, reason: "mcp_start_failed" }));
    child.on("exit", async () => { if (settled) return; const handshake = await readHandshake(); finish({ started: true, handshake, ...(handshake ? {} : { reason: "mcp_process_exited" }) }); });
  });
}
function runtimeRoot(): string {
  if (process.env.AGENTHOST_RELEASE_ROOT) return path.resolve(process.env.AGENTHOST_RELEASE_ROOT);
  return path.resolve(here, "../../..");
}
function mcpEntry(): string {
  const explicit = process.env.AGENTHOST_MCP_ENTRY;
  if (explicit) return path.resolve(explicit);
  const root = runtimeRoot();
  const candidates = [path.join(root, "packages/mcp-server/dist/index.js"), path.join(root, "dist/mcp-server/index.js"), path.join(root, "mcp-server/index.js")];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}
function parseFlags(args: string[]): { positional: string[]; flags: Set<string>; values: Map<string, string> } {
  const positional: string[] = [], flags = new Set<string>(), values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) { const item = args[i]!; if (!item.startsWith("--")) { positional.push(item); continue; } const [key, inline] = item.slice(2).split("=", 2); if (inline !== undefined) values.set(key!, inline); else if (args[i + 1] !== undefined && !args[i + 1]!.startsWith("--")) { values.set(key!, args[++i]!); } else flags.add(key!); }
  return { positional, flags, values };
}
async function verifyArchiveChecksum(archive: string, supplied: string | undefined): Promise<string> {
  const expected = supplied === undefined ? await readSha256Sidecar(archive) : normalizeSha256(supplied);
  if (expected === undefined) throw new Error("release_checksum_required");
  const actual = await sha256File(archive);
  if (actual !== expected) throw new Error("release_checksum_mismatch");
  return actual;
}
async function configObject(): Promise<Json> {
  const candidate = existsSync(publicConfig) ? publicConfig : legacyConfigPath(home);
  return (await readJson(candidate)) ?? {};
}
async function configValidate(): Promise<Output> {
  try { const config = await loadAgentHostConfig({ env: { ...process.env, AGENTHOST_CONFIG: existsSync(publicConfig) ? publicConfig : legacyConfigPath(home) } }); return { ok: true, command: "config validate", data: { valid: true, schemaVersion: config.schemaVersion ?? 1, configPath: "[config]" } }; } catch (error) { return fail("config validate", error instanceof Error ? error.message : "config_invalid"); }
}
async function configShow(): Promise<Output> { return { ok: true, command: "config show", data: redact(await configObject()) }; }
async function setup(flags: ReturnType<typeof parseFlags>): Promise<Output> {
  try {
    await safeMkdir(agentHome); await safeMkdir(path.join(agentHome, "logs")); await safeMkdir(path.join(agentHome, "run")); await safeMkdir(path.dirname(publicConfig));
    if (!existsSync(publicConfig)) {
      const legacy = legacyConfigPath(home);
      if (existsSync(legacy)) {
        const migrated = (await readJson(legacy)) ?? {};
        migrated.schemaVersion = AGENTHOST_CONFIG_SCHEMA_VERSION;
        await safeWrite(`${legacy}.migration.bak`, await readFile(legacy, "utf8"));
        await safeWrite(publicConfig, JSON.stringify(migrated, null, 2) + "\n");
      } else {
        await safeWrite(publicConfig, JSON.stringify({ schemaVersion: AGENTHOST_CONFIG_SCHEMA_VERSION }, null, 2) + "\n");
      }
    }
    const stateFile = path.join(agentHome, "setup", "state.json"); const state = (await readJson(stateFile)) ?? { schemaVersion: 1, completed: [] };
    const completed = ["environment", "home_config", ...(existsSync(mcpEntry()) ? ["mcp_runtime"] : []), "privacy", "validation"];
    const manual = ["codex", "overlay"];
    state.schemaVersion = 1; state.completed = completed; state.pendingManual = flags.flags.has("skip-optional") ? [] : manual; state.skipped = flags.flags.has("skip-optional") ? manual : []; state.updatedAt = new Date().toISOString(); await safeWrite(stateFile, JSON.stringify(state, null, 2) + "\n");
    return { ok: true, command: "setup", data: { resumable: true, configPath: "[config]", agentHostHome: "[agenthost-home]", completed, pendingManual: state.pendingManual, skipped: state.skipped }, warnings: ["Browser installation and pairing remain manual.", "System dependencies are not installed automatically."] };
  } catch (error) { return fail("setup", error instanceof Error ? error.message : "setup_failed"); }
}
async function readLock(): Promise<Json | undefined> { return readJson(lockPath); }
function processAlive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
async function status(): Promise<Output> {
  const lock = await readLock();
  const pid = typeof lock?.pid === "number" ? lock.pid : undefined;
  const [runState, approval] = await Promise.all([readRunState(agentHome), readActiveTaskApproval(agentHome)]);
  return {
    ok: true,
    command: "status",
    data: {
      version: AGENTHOST_VERSION,
      configured: existsSync(publicConfig) || existsSync(legacyConfigPath(home)),
      running: pid !== undefined && processAlive(pid),
      pid: pid ?? null,
      mcpEntryAvailable: existsSync(mcpEntry()),
      runState,
      activeTaskApproval: approval ?? null,
      note: "MCP is normally launched by the client; status only tracks agenthost-managed background processes."
    }
  };
}
async function start(flags: ReturnType<typeof parseFlags>): Promise<Output> {
  const entry = mcpEntry(); if (!existsSync(entry)) return fail("start", "mcp_runtime_missing");
  const current = await readLock(); if (typeof current?.pid === "number" && processAlive(current.pid)) return fail("start", "agenthost_already_running");
  await safeMkdir(path.dirname(lockPath)); const childEnv = { ...process.env, AGENTHOST_CONFIG: existsSync(publicConfig) ? publicConfig : legacyConfigPath(home) };
  if (flags.flags.has("background")) return fail("start", "background_unsupported: run agenthost start in the foreground or let the MCP client spawn it");
  const child = spawn(process.execPath, [entry], { stdio: "inherit", env: childEnv });
  const exit = await new Promise<number>((resolve) => { child.once("error", () => resolve(1)); child.once("exit", (code) => resolve(code ?? 1)); });
  return exit === 0 ? { ok: true, command: "start", data: { stopped: true } } : fail("start", `mcp_exit_${exit}`);
}
async function stop(): Promise<Output> {
  await safeWrite(path.join(agentHome, "run", "stop.requested"), JSON.stringify({ stopped: true, reason: "cli_stop", at: new Date().toISOString() }) + "\n");
  await rm(path.join(agentHome, "tasks", "approvals", "active.json"), { force: true }).catch(() => undefined);
  const lock = await readLock(); const pid = typeof lock?.pid === "number" ? lock.pid : undefined;
  if (pid === undefined || !processAlive(pid)) { await unlink(lockPath).catch(() => undefined); return { ok: true, command: "stop", data: { stopped: true, background: false, reason: "stop_flag_written" } }; }
  try { process.kill(pid, "SIGTERM"); } catch { return fail("stop", "process_stop_failed"); }
  const deadline = Date.now() + 2_000; while (processAlive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  if (processAlive(pid)) return fail("stop", "process_stop_timeout");
  await unlink(lockPath).catch(() => undefined); return { ok: true, command: "stop", data: { stopped: true, background: true } };
}
async function taskCommand(args: ReturnType<typeof parseFlags>): Promise<Output> {
  const [action, id] = args.positional.slice(1);
  const taskDir = path.join(agentHome, "tasks");
  if (action === undefined || action === "list") {
    let files: string[] = [];
    try { files = (await readdir(taskDir)).filter((f) => f.endsWith(".json")); } catch { files = []; }
    const tasks: unknown[] = [];
    for (const f of files.slice(0, 50)) { const t = await readJson(path.join(taskDir, f)); if (t) tasks.push({ taskId: t.taskId, goal: String(t.goal ?? "").slice(0, 120), status: t.status, phase: t.phase, updatedAt: t.updatedAt }); }
    return { ok: true, command: "task list", data: { tasks } };
  }
  if ((action === "status" || action === "resume" || action === "pause") && id) {
    const safe = id.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 200);
    const record = await readJson(path.join(taskDir, `${safe}.json`));
    if (!record) return fail(`task ${action}`, "task_not_found");
    if (action === "status") return { ok: true, command: "task status", data: record };
    try {
      const updated = await transitionTask(agentHome, safe, action === "pause" ? "paused" : "active");
      return { ok: true, command: `task ${action}`, data: updated };
    } catch (error) {
      return fail(`task ${action}`, error instanceof Error ? error.message : "task_transition_failed");
    }
  }
  if (action === "stop") { await requestStop(agentHome, "cli_task_stop"); await clearActiveTaskApproval(agentHome); return { ok: true, command: "task stop", data: { stopped: true } }; }
  if (action === "watch" && id) {
    // Live progress tail: what the agent is doing in the background, without
    // watching its windows. Polls the redacted task event log; --follow keeps
    // polling until a terminal state, --notify sends a desktop notification.
    const safe = id.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 200);
    const follow = args.flags.has("follow");
    const notify = args.flags.has("notify");
    const readTask = async () => readJson(path.join(taskDir, `${safe}.json`)) as Promise<{ taskId?: string; goal?: string; status?: string; phase?: string; currentAction?: string; updatedAt?: string; events?: Array<{ at?: string; kind?: string; summary?: string }> } | undefined>;
    let record = await readTask();
    if (!record) return fail("task watch", "task_not_found");
    // Optional native progress card: mirrors the redacted task log on the
    // operator's screen and stays until explicitly dismissed.
    const overlay = args.flags.has("overlay") ? await attachTaskOverlay(safe, String(record.goal ?? safe), record) : undefined;
    let seen = 0;
    const render = (current: NonNullable<Awaited<ReturnType<typeof readTask>>>) => {
      const events = Array.isArray(current.events) ? current.events : [];
      const fresh = events.slice(seen);
      seen = events.length;
      // Styled follow-up: counts by kind plus the latest error/recovery, so
      // one glance shows where the task stands without scrolling the log.
      const counts = new Map<string, number>();
      for (const event of events) {
        const kind = typeof event.kind === "string" ? event.kind : "?";
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
      }
      const breakdown = [...counts.entries()].map(([kind, count]) => `${kind}x${count}`).join(" ");
      const lastAlert = [...events].reverse().find((event) => event.kind === "error" || event.kind === "recovery");
      const header = `task ${safe} [${current.status ?? "?"}] phase=${current.phase ?? "?"} action=${current.currentAction ?? "?"}` +
        (events.length > 0 ? ` (${events.length} events${breakdown ? `: ${breakdown}` : ""})` : " (no events yet)") +
        (lastAlert ? ` last ${lastAlert.kind}: ${String(lastAlert.summary ?? "").slice(0, 120)}` : "");
      const lines = fresh.map((event) => `  ${event.at ?? "?"} ${event.kind ?? "?"} ${String(event.summary ?? "").slice(0, 160)}`);
      return { header, lines, status: current.status, eventCount: events.length };
    };
    let first = render(record);
    process.stdout.write(`${first.header}\n${first.lines.slice(-10).join("\n")}${first.lines.length > 0 ? "\n" : ""}`);
    let terminal: NonNullable<Awaited<ReturnType<typeof readTask>>> | undefined;
    if (follow) {
      for (let i = 0; i < 150; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const current = await readTask();
        if (!current) return fail("task watch", "task_not_found");
        const update = render(current);
        if (update.lines.length > 0) process.stdout.write(`${update.lines.join("\n")}\n`);
        if (overlay) await overlay.update(current);
        if (current.status === "completed" || current.status === "cancelled") {
          process.stdout.write(`task ${safe} ${current.status}\n`);
          if (notify) { try { spawnSync("notify-send", ["AgentHost", `Task ${current.status}: ${String(current.goal ?? safe).slice(0, 120)}`], { stdio: "ignore" }); } catch { /* notifications are best effort */ } }
          terminal = current;
          break;
        }
      }
      if (overlay) {
        process.stdout.write("progress card stays visible until Dismiss / Ctrl+C / `agenthost overlay hide`\n");
        await overlay.waitForDismiss();
        await overlay.close();
      }
      return { ok: true, command: "task watch", data: { taskId: safe, status: terminal?.status ?? record.status, phase: terminal?.phase ?? record.phase, eventCount: seen, ...(overlay ? { overlay: true } : {}), ...(terminal === undefined ? { note: "follow window expired (5 min); rerun to keep watching." } : {}) } };
    }
    if (notify) { try { spawnSync("notify-send", ["AgentHost", `Task ${record.status}: ${String(record.goal ?? safe).slice(0, 120)}`], { stdio: "ignore" }); } catch { /* notifications are best effort */ } }
    if (overlay) {
      await overlay.update(record);
      process.stdout.write("progress card stays visible until Dismiss / Ctrl+C / `agenthost overlay hide`\n");
      await overlay.waitForDismiss();
      await overlay.close();
    }
    return { ok: true, command: "task watch", data: { taskId: safe, goal: record.goal, status: record.status, phase: record.phase, currentAction: record.currentAction, updatedAt: record.updatedAt, ...(overlay ? { overlay: true } : {}), recentEvents: (Array.isArray(record.events) ? record.events : []).slice(-10) } };
  }
  if (action === "approve" && id) {
    const safe = id.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 200);
    const record = await readJson(path.join(taskDir, `${safe}.json`));
    if (!record) return fail("task approve", "task_not_found");
    if (record.status !== "active") return fail("task approve", "task_not_active");
    const maxRisk = args.values.get("max-risk") ?? "medium";
    if (maxRisk !== "low" && maxRisk !== "medium") return fail("task approve", "usage: agenthost task approve <id> [--max-risk low|medium]");
    const approval = { approvalId: `task_approval_cli_${Date.now()}`, taskId: safe, maxRisk, origin: "cli", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() };
    await safeMkdir(path.join(taskDir, "approvals"));
    await safeWrite(path.join(taskDir, "approvals", "active.json"), JSON.stringify(approval, null, 2) + "\n");
    return { ok: true, command: "task approve", data: { taskId: safe, maxRisk, expiresAt: approval.expiresAt, note: "Routine low/medium effects chain server-side; high/critical still need per-action confirmation." } };
  }
  if (action === "export" && id) {
    return taskExportCommand(args, taskDir, id);
  }
  return fail("task", "usage: agenthost task [list|status <id>|watch <id> [--follow] [--notify]|export <id> [--format md|html] [--out <path>]|pause <id>|resume <id>|stop|approve <id>]");
}

async function attachTaskOverlay(taskId: string, goal: string, initial: Json): Promise<{
  update: (record: Json) => Promise<void>;
  waitForDismiss: () => Promise<boolean>;
  close: () => Promise<void>;
} | undefined> {
  try {
    const { createOverlayRenderer, OverlayManager, TaskProgressOverlay } = await import("@agenthost/app-overlay");
    const sessionId = `cli-task-watch-${process.pid}`;
    const renderer = createOverlayRenderer("auto", { sessionId, environment: process.env });
    const capabilities = await renderer.capabilities();
    if (!capabilities.supported) { await renderer.close?.(); return undefined; }
    const manager = new OverlayManager(renderer, { sessionId }, { hideMarkerPath: path.join(agentHome, "run", "overlay.hide") });
    let locallyPaused = false;
    let terminalHandled = false;
    let interrupted = false;
    const onInterrupt = (): void => { interrupted = true; };
    process.once("SIGINT", onInterrupt);
    const controller = new TaskProgressOverlay({
      manager,
      taskId,
      title: `Task ${taskId}: ${String(goal).slice(0, 100)}`,
      onAction: (action) => {
        if (action === "pause") locallyPaused = true;
        if (action === "resume") locallyPaused = false;
        if (action === "stop") {
          void safeWrite(path.join(agentHome, "run", "stop.requested"), `${JSON.stringify({ stopped: true, reason: "overlay_stop", at: new Date().toISOString() })}\n`).catch(() => undefined);
          void controller.requestStop();
        }
      }
    });
    if (!(await controller.start())) { process.off("SIGINT", onInterrupt); await manager.close(); return undefined; }
    const update = async (record: Json): Promise<void> => {
      if (terminalHandled) return;
      const status = String(record.status ?? "running");
      const detail = [record.phase, record.currentAction].filter((value): value is string => typeof value === "string" && value.length > 0).join(" · ");
      if (status === "completed") { terminalHandled = true; await controller.complete(detail || "Completed"); return; }
      if (status === "failed") { terminalHandled = true; await controller.fail(detail || "Failed"); return; }
      if (status === "cancelled") { terminalHandled = true; await controller.stopped(detail || "Cancelled"); return; }
      if (status === "blocked" || status === "waiting_approval") { await controller.waitingForApproval(taskId); if (detail) await controller.setDetail(detail); return; }
      if (locallyPaused) { if (detail) await controller.setDetail(detail); return; }
      const current = controller.snapshot().status;
      if (current === "paused" || current === "pause_requested" || current === "waiting_approval") await controller.resume();
      if (detail) await controller.setDetail(detail);
    };
    const waitForDismiss = async (): Promise<boolean> => {
      while (!interrupted) {
        const actions = await controller.pollEvents().catch(() => [] as string[]);
        if (actions.includes("dismiss")) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const dismissed = !interrupted;
      process.off("SIGINT", onInterrupt);
      return dismissed;
    };
    const close = async (): Promise<void> => { await controller.dismiss(); await manager.close(); };
    await update(initial);
    return { update, waitForDismiss, close };
  } catch {
    return undefined;
  }
}

async function taskExportCommand(args: ReturnType<typeof parseFlags>, taskDir: string, id: string): Promise<Output> {
  // Shareable run report: renders the redacted event log (same bounded
  // summaries as `task watch`) to Markdown or self-contained HTML.
  const safe = id.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 200);
  const record = await readJson(path.join(taskDir, `${safe}.json`));
  if (!record) return fail("task export", "task_not_found");
  const format = args.values.get("format") ?? "md";
  if (format !== "md" && format !== "html") return fail("task export", "usage: agenthost task export <id> [--format md|html] [--out <path>]");
  const content = format === "html" ? renderTaskHtml(record) : renderTaskMarkdown(record);
  const out = path.resolve(args.values.get("out") ?? `agenthost-task-${safe}.${format === "html" ? "html" : "md"}`);
  await safeWrite(out, content);
  const events = Array.isArray(record.events) ? (record.events as unknown[]).length : 0;
  return { ok: true, command: "task export", data: { taskId: safe, format, path: out, eventCount: events } };
}
async function confirmationsCommand(args: ReturnType<typeof parseFlags>): Promise<Output> {
  const action = args.positional[1];
  if (action === undefined || action === "list") {
    const records = await listConfirmations(agentHome);
    return { ok: true, command: "confirmations", data: { pending: records.map((record) => ({
      tokenId: record.tokenId,
      tool: record.tool,
      riskLevel: record.riskLevel,
      summary: redact(record.summary),
      status: record.status,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt
    })) } };
  }
  const tokenId = args.positional[2];
  if (tokenId === undefined) return fail(`confirmations ${action}`, `usage: agenthost ${action} <tokenId>`);
  if (action !== "confirm" && action !== "deny") return fail("confirmations", "usage: agenthost confirmations [list]|confirm <tokenId>|deny <tokenId>");
  try {
    const record = action === "confirm" ? await acceptConfirmation(agentHome, tokenId) : await rejectConfirmation(agentHome, tokenId);
    return { ok: true, command: action, data: { tokenId: record.tokenId, tool: record.tool, status: record.status, summary: redact(record.summary), expiresAt: record.expiresAt } };
  } catch (error) {
    return fail(action, error instanceof Error ? error.message : "confirmation_failed");
  }
}

async function agentCommand(args: ReturnType<typeof parseFlags>): Promise<Output> {
  const action = args.positional[1];
  if (action === undefined || action === "status") {
    const [runState, approval] = await Promise.all([readRunState(agentHome), readActiveTaskApproval(agentHome)]);
    return { ok: true, command: "agent status", data: { runState, activeTaskApproval: approval ?? null } };
  }
  if (action === "stop") {
    const reason = args.values.get("reason") ?? "cli_agent_stop";
    await requestStop(agentHome, reason);
    await clearActiveTaskApproval(agentHome);
    return { ok: true, command: "agent stop", data: { runState: await readRunState(agentHome) } };
  }
  if (action === "takeover-begin" || action === "takeover") {
    const reason = args.values.get("reason") ?? "cli_agent_takeover";
    await beginTakeover(agentHome, reason);
    await clearActiveTaskApproval(agentHome);
    return { ok: true, command: "agent takeover-begin", data: { runState: await readRunState(agentHome) } };
  }
  if (action === "resume") {
    const clearStopFlag = args.flags.has("stop");
    const clearTakeoverFlag = args.flags.has("takeover");
    if (!clearStopFlag && !clearTakeoverFlag) return fail("agent resume", "usage: agenthost agent resume --stop|--takeover [--stop --takeover]");
    if (clearStopFlag) await clearStop(agentHome);
    if (clearTakeoverFlag) await endTakeover(agentHome);
    return { ok: true, command: "agent resume", data: { runState: await readRunState(agentHome), cleared: { stop: clearStopFlag, takeover: clearTakeoverFlag } } };
  }
  return fail("agent", "usage: agenthost agent status|stop [--reason text]|takeover-begin [--reason text]|resume --stop|--takeover");
}

async function capabilitiesCommand(args?: ReturnType<typeof parseFlags>): Promise<Output> {
  if (args?.flags.has("markdown") === true) {
    const { buildCapabilityMarkdown } = await import("@agenthost/core");
    return {
      ok: true,
      command: "capabilities",
      data: buildCapabilityMarkdown({ version: AGENTHOST_VERSION })
        + "\nLive counts: call system.list_capabilities over MCP, or read agenthost://capabilities.\n"
    };
  }
  return { ok: true, command: "capabilities", data: { families: ["computer", "filesystem", "shell", "applications", "mcp", "vision", "ocr"], note: "Authoritative live list: system.list_capabilities over MCP. Permissions: agenthost permissions." } };
}
async function permissionsCommand(): Promise<Output> {
  return { ok: true, command: "permissions", data: { model: "observe/low->governed automatic; medium/high state changes->exact confirmation or short-lived task approval; blocked->denied", capabilities: { computer: "allow", filesystem: "allow", shell: "allow", applications: "allow", mcp: "allow", vision: "allow", ocr: "allow" }, hardStop: "agenthost stop halts state-changing tools via run/stop.requested" } };
}
async function sessionsCommand(): Promise<Output> {
  const lock = await readLock();
  return { ok: true, command: "sessions", data: { background: lock ?? null, tasksDir: "[agenthost-home]/tasks", stopRequested: existsSync(path.join(agentHome, "run", "stop.requested")), takeoverActive: existsSync(path.join(agentHome, "run", "takeover.active")) } };
}
function rendererPids(): number[] {
  try {
    const found = spawnSync("pgrep", ["-f", "app-overlay/runtime/gtk3-renderer.py --protocol"], { encoding: "utf8" });
    return found.stdout.split(/\s+/).map(Number).filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  } catch {
    return [];
  }
}
function terminateOrphanRenderers(): { killed: number[]; skippedLive: number[] } {
  // Terminate orphaned AgentHost renderer children (matched by our own script
  // path, never anything else) when their parent is already gone. Live
  // renderers owned by a running server are left alone.
  const killed: number[] = [];
  const skippedLive: number[] = [];
  for (const pid of rendererPids()) {
    let parentAlive = false;
    try {
      const ppid = Number(spawnSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim());
      if (Number.isInteger(ppid) && ppid > 1) {
        try {
          process.kill(ppid, 0);
          parentAlive = true;
        } catch {
          parentAlive = false;
        }
      }
    } catch {
      parentAlive = false;
    }
    if (parentAlive) {
      skippedLive.push(pid);
      continue;
    }
    try {
      process.kill(pid, "SIGTERM");
      killed.push(pid);
    } catch {
      /* Already exited. */
    }
  }
  return { killed, skippedLive };
}
async function overlayCommand(sub: string | undefined, flags: ReturnType<typeof parseFlags>): Promise<Output> {
  if (sub === "hide") {
    // Full hide: write the cross-process hide marker that every live
    // OverlayManager polls (persistent cards included), then sweep orphans.
    // --orphans keeps the old renderer-only behavior for diagnostics.
    const orphansOnly = flags.flags.has("orphans");
    if (!orphansOnly) await safeWrite(path.join(agentHome, "run", "overlay.hide"), `${JSON.stringify({ hidden: true, reason: "cli_overlay_hide", at: new Date().toISOString() })}\n`);
    const { killed, skippedLive } = terminateOrphanRenderers();
    return { ok: true, command: "overlay hide", data: { hidden: !orphansOnly || killed.length > 0, liveManagersNotified: !orphansOnly, hideMarker: !orphansOnly, terminatedRenderers: killed, skippedLiveRenderers: skippedLive } };
  }
  if (sub === "status") {
    const record = await readJson(path.join(agentHome, "run", "overlay-renderer.pid"));
    const pid = typeof record?.pid === "number" ? record.pid : undefined;
    return { ok: true, command: "overlay status", data: { hideMarkerPending: existsSync(path.join(agentHome, "run", "overlay.hide")), registeredRenderer: pid === undefined ? null : { pid, alive: processAlive(pid), sessionId: typeof record?.sessionId === "string" ? record.sessionId : null }, rendererProcesses: rendererPids().length } };
  }
  return await doctor();
}
async function doctor(): Promise<Output> {
  const config = await configValidate(); const mcp = await probeMcp(mcpEntry()); const checks = { platform: process.platform === "linux", architecture: process.arch === "x64", node: Number(process.versions.node.split(".")[0]) >= 20, python: commandExists("python3"), x11: Boolean(process.env.DISPLAY), gtkProbe: pythonModuleExists("import gi; from gi.repository import Gtk"), mcpEntry: existsSync(mcpEntry()), mcpHandshake: mcp.handshake, codexConfig: existsSync(path.join(process.env.CODEX_HOME ?? path.join(home, ".codex"), "config.toml")), storage: existsSync(agentHome) };
  const warnings = [!checks.architecture ? "x86_64 is the public RC target." : "", !checks.python ? "Install Python 3 for overlay diagnostics." : "", !checks.x11 ? "X11 DISPLAY is unavailable; visible overlay is unsupported." : ""].filter(Boolean);
  if (!mcp.handshake) warnings.push(mcp.reason ?? "mcp_handshake_unavailable");
  return { ok: config.ok, command: "doctor", data: { version: AGENTHOST_VERSION, checks, config: config.ok ? "valid" : config.error, mcp, process: await status(), paths: { agentHostHome: "[agenthost-home]", config: "[config]", mcpEntry: "[installed-mcp-runtime]" } }, warnings };
}
async function codex(action: string, flags: ReturnType<typeof parseFlags>): Promise<Output> {
  const dir = process.env.CODEX_HOME ?? path.join(home, ".codex"); const file = path.join(dir, "config.toml"); if (action === "status") { const text = await readFile(file, "utf8").catch(() => ""); return { ok: true, command: "integrations codex status", data: { configured: text.includes("[mcp_servers.agenthost]"), configPath: existsSync(file) ? "[codex-config]" : null, usesRepositoryPath: /packages[\\/]mcp-server[\\/]dist/.test(text) } }; }
  if (!existsSync(file)) return fail(`integrations codex ${action}`, "codex_config_missing"); const text = await readFile(file, "utf8"); const header = "[mcp_servers.agenthost]"; const startAt = text.indexOf(header); const endAt = startAt < 0 ? -1 : (() => { const next = text.indexOf("\n[", startAt + header.length); return next < 0 ? text.length : next; })(); const entry = `${header}\ncommand = \"agenthost\"\nargs = [\"start\"]\n`;
  if (text.length > 2_000_000 || text.includes("\u0000") || text.split("\n").some((line) => line.trimStart().startsWith("[") && !line.trim().endsWith("]"))) return fail(`integrations codex ${action}`, "codex_config_unsupported_or_invalid");
  if (action === "remove") { if (!flags.flags.has("apply")) return { ok: true, command: "integrations codex remove", data: { preview: true, changed: startAt >= 0 } }; const updated = startAt >= 0 ? text.slice(0, startAt) + text.slice(endAt) : text; await safeWrite(`${file}.agenthost.bak`, text); await safeWrite(file, updated); return { ok: true, command: "integrations codex remove", data: { applied: true, backup: "[codex-backup]" } }; }
  const updated = startAt >= 0 ? text.slice(0, startAt) + entry + text.slice(endAt) : `${text.trimEnd()}\n\n${entry}`; if (!flags.flags.has("apply")) return { ok: true, command: "integrations codex add", data: { preview: true, proposed: { command: "agenthost", args: ["start"] }, preservesExisting: true, changed: updated !== text } };
  await safeWrite(`${file}.agenthost.bak`, text); await safeWrite(file, updated); return { ok: true, command: "integrations codex add", data: { applied: true, backup: "[codex-backup]", command: "agenthost", args: ["start"] } };
}
async function update(args: ReturnType<typeof parseFlags>): Promise<Output> {
  const current = path.join(home, ".local", "share", "agenthost", "current");
  if (args.flags.has("rollback")) {
    const previous = `${current}.previous`;
    if (!existsSync(previous)) return fail("update rollback", "previous_release_missing");
    if (!args.flags.has("apply")) return { ok: true, command: "update rollback", data: { preview: true, rollbackAvailable: true } };
    const temporary = `${current}.rollback-${process.pid}`; await rename(current, temporary).catch(() => undefined); await rename(previous, current); await rm(temporary, { recursive: true, force: true }); return { ok: true, command: "update rollback", data: { applied: true, healthCheck: "manifest_present" } };
  }
  const archive = args.values.get("archive"); if (!archive) return fail("update", "archive_required"); if (!existsSync(archive)) return fail("update", "archive_missing");
  const checksum = await verifyArchiveChecksum(archive, args.values.get("sha256"));
  const listing = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" }); if (listing.status !== 0 || listing.stdout.split("\n").some((item) => item.startsWith("/") || item.includes("../"))) return fail("update", "archive_invalid");
  const first = listing.stdout.split("\n").find((item) => item.length > 0)?.split("/")[0]; if (!first) return fail("update", "archive_layout_invalid");
  const version = first.replace(/^agenthost-v/, "").replace(/-linux-x64$/, ""); if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) return fail("update", "release_version_invalid");
  const preview = { archive: path.basename(archive), version, checksum, checksumVerified: true, backupRequired: true, atomicSwitch: true, rollbackOnHealthFailure: true };
  if (!args.flags.has("apply")) return { ok: true, command: "update", data: { preview: true, ...preview } };
  const extraction = await mkdtemp(path.join(os.tmpdir(), "agenthost-update-")); const extracted = spawnSync("tar", ["-xzf", archive, "-C", extraction], { stdio: "ignore" }); if (extracted.status !== 0) return fail("update", "archive_extract_failed"); const staged = path.join(extraction, first); if (!existsSync(path.join(staged, "version.json")) || !existsSync(path.join(staged, "packages", "mcp-server", "dist", "index.js"))) return fail("update", "archive_health_check_failed");
  const releases = path.join(home, ".local", "share", "agenthost", "releases"); const manifestVersion = JSON.parse(await readFile(path.join(staged, "version.json"), "utf8")).version as string; if (manifestVersion !== version) return fail("update", "release_version_mismatch"); const destination = path.join(releases, version); await mkdir(releases, { recursive: true, mode: 0o700 }); await rm(destination, { recursive: true, force: true }); await rename(staged, destination); await safeWrite(`${publicConfig}.update.bak`, existsSync(publicConfig) ? await readFile(publicConfig, "utf8") : ""); const previous = `${current}.previous`; await rm(previous, { recursive: true, force: true }); if (existsSync(current)) await rename(current, previous); try { await rename(destination, current); } catch (error) { await rename(previous, current).catch(() => undefined); throw error; } return { ok: true, command: "update", data: { applied: true, version, checksumVerified: true, backup: "[config-backup]", rollbackAvailable: true } };
}
async function uninstall(flags: ReturnType<typeof parseFlags>): Promise<Output> { const data = { preview: !flags.flags.has("yes"), removes: ["[installed-release]", "[agenthost-wrapper]"], preserves: flags.flags.has("remove-data") ? [] : ["[agenthost-home]", "[config]"] }; if (!flags.flags.has("yes")) return { ok: true, command: "uninstall", data }; await stop(); await rm(path.join(home, ".local", "share", "agenthost"), { recursive: true, force: true }); await rm(path.join(home, ".local", "bin", "agenthost"), { force: true }); if (flags.flags.has("remove-data")) { await rm(agentHome, { recursive: true, force: true }); await rm(path.dirname(publicConfig), { recursive: true, force: true }); } return { ok: true, command: "uninstall", data: { ...data, preview: false } }; }
async function main(): Promise<number> {
  const args = parseFlags(process.argv.slice(2)); const json = args.flags.has("json"); const [top, sub] = args.positional; let result: Output;
  try {
    if (top === undefined || top === "help") result = { ok: true, command: "help", data: "agenthost version|doctor|setup|start|stop|status|task|confirmations|confirm|deny|agent|capabilities|permissions|sessions|overlay|integrations|config|update|uninstall" };
    else if (top === "version") result = { ok: true, command: "version", data: { version: AGENTHOST_VERSION, platform: process.platform, architecture: process.arch } };
    else if (top === "doctor") result = await doctor();
    else if (top === "setup") result = await setup(args);
    else if (top === "start") result = await start(args);
    else if (top === "stop") result = await stop();
    else if (top === "status") result = await status();
    else if (top === "task") result = await taskCommand(args);
    else if (top === "confirm" || top === "deny") result = await confirmationsCommand({ ...args, positional: ["confirmations", top, ...args.positional.slice(1)] });
    else if (top === "confirmations") result = await confirmationsCommand(args);
    else if (top === "agent") result = await agentCommand(args);
    else if (top === "capabilities") result = await capabilitiesCommand(args);
    else if (top === "permissions") result = await permissionsCommand();
    else if (top === "sessions") result = await sessionsCommand();
    else if (top === "integrations" && sub === "codex") result = await codex(args.positional[2] ?? "status", args);
    else if (top === "config") result = sub === "validate" ? await configValidate() : await configShow();
    else if (top === "update") result = await update(args);
    else if (top === "uninstall") result = await uninstall(args);
    else if (top === "overlay") result = await overlayCommand(sub, args);
    else result = fail(top, "unknown_command");
  } catch (error) { result = fail(top ?? "agenthost", error instanceof Error ? error.message : "command_failed"); }
  await print(result, json); return result.ok ? 0 : 1;
}
void main().then((code) => { process.exitCode = code; });
