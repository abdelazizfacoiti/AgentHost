#!/usr/bin/env node
import { chmod, cp, copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { closeSync, constants, existsSync, openSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { AGENTHOST_CONFIG_SCHEMA_VERSION, AGENTHOST_VERSION, defaultAgentHostHome, defaultPublicConfigPath, legacyConfigPath, loadAgentHostConfig, normalizeSha256, readSha256Sidecar, redactLocalPath, sha256File } from "@agenthost/core";
import { BrowserBridgeServer, BrowserSetupStore, browserSetupRecovery, expectedExtensionId, selectBrowserFromInventory, type BrowserInventoryEntry, type BrowserSetupRecord, type SupportedBrowserFamily } from "@agenthost/app-browser";
import { detectLinuxBrowsers } from "@agenthost/os-linux";

const here = path.dirname(fileURLToPath(import.meta.url));
const home = os.homedir();
const agentHome = path.resolve(process.env.AGENTHOST_HOME ?? defaultAgentHostHome(home));
const publicConfig = path.resolve(process.env.AGENTHOST_CONFIG ?? defaultPublicConfigPath(home));
const lockPath = path.join(agentHome, "run", "agenthost.lock.json");
const extensionDir = path.resolve(process.env.AGENTHOST_BROWSER_EXTENSION_DIR ?? path.join(home, ".local", "share", "agenthost", "browser-extension"));

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
function packagedBrowserArtifactsAvailable(): boolean {
  const packagedRoot = path.join(runtimeRoot(), "browser-extension");
  return existsSync(path.join(packagedRoot, "source")) || existsSync(path.join(packagedRoot, "artifacts"));
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
function browserExtensionPaths(family: SupportedBrowserFamily): { root: string; manifest: string } {
  const root = path.join(extensionDir, family);
  return { root, manifest: path.join(root, "manifest.json") };
}
function resolveExecutable(name: string): string | undefined {
  if (name.includes("/")) return existsSync(name) ? name : undefined;
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir.length === 0) continue;
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}
function browserSetupInstructions(family: SupportedBrowserFamily, extensionRoot: string, manifestPath: string): string[] {
  return family === "firefox"
    ? [
        "Open about:debugging#/runtime/this-firefox.",
        "Choose Load Temporary Add-on….",
        `Select ${manifestPath}.`,
        "Open the AgentHost Browser Bridge popup and choose Pair with AgentHost.",
        "Keep this command running until pairing and reconnect verification complete."
      ]
    : [
        "Open chrome://extensions (or edge://extensions).",
        "Enable Developer mode and choose Load unpacked.",
        `Select ${extensionRoot}.`,
        "Open the AgentHost Browser Bridge popup and choose Pair with AgentHost.",
        "Keep this command running until pairing and reconnect verification complete."
      ];
}
function printBrowserSetupGuide(family: SupportedBrowserFamily, extensionRoot: string, manifestPath: string, port: number, waitMs: number, artifactAvailable: boolean, json: boolean): void {
  if (json) return;
  const status = artifactAvailable ? "ready" : "missing (run npm run browser:extension:prepare or reinstall the release)";
  const lines = [
    "",
    "AgentHost Browser Bridge setup",
    `Browser: ${family}`,
    `Extension artifact: ${status}`,
    `Extension directory: ${extensionRoot}`,
    `Manifest: ${manifestPath}`,
    `Bridge: http://127.0.0.1:${port}`,
    "",
    ...browserSetupInstructions(family, extensionRoot, manifestPath).map((instruction, index) => `${index + 1}. ${instruction}`),
    "",
    `Waiting up to ${Math.ceil(waitMs / 1000)} seconds for browser enrollment...`,
    ""
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
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
  try { const config = await loadAgentHostConfig({ env: { ...process.env, AGENTHOST_CONFIG: existsSync(publicConfig) ? publicConfig : legacyConfigPath(home) } }); return { ok: true, command: "config validate", data: { valid: true, schemaVersion: config.schemaVersion ?? 1, configPath: "[config]", profile: config.profile } }; } catch (error) { return fail("config validate", error instanceof Error ? error.message : "config_invalid"); }
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
        await safeWrite(publicConfig, JSON.stringify({ schemaVersion: AGENTHOST_CONFIG_SCHEMA_VERSION, profile: "general", browserBridge: { enabled: false }, controlRoom: { enabled: false } }, null, 2) + "\n");
      }
    }
    const stateFile = path.join(agentHome, "setup", "state.json"); const state = (await readJson(stateFile)) ?? { schemaVersion: 1, completed: [] };
    const completed = ["environment", "home_config", ...(existsSync(mcpEntry()) ? ["mcp_runtime"] : []), "privacy", "validation"];
    const manual = ["browser_artifacts", "browser_setup", "pairing", "reconnect", "codex", "overlay", "control_room", "speech", "strategies"];
    state.schemaVersion = 1; state.completed = completed; state.pendingManual = flags.flags.has("skip-optional") ? [] : manual; state.skipped = flags.flags.has("skip-optional") ? manual : []; state.updatedAt = new Date().toISOString(); await safeWrite(stateFile, JSON.stringify(state, null, 2) + "\n");
    return { ok: true, command: "setup", data: { resumable: true, configPath: "[config]", agentHostHome: "[agenthost-home]", completed, pendingManual: state.pendingManual, skipped: state.skipped }, warnings: ["Browser installation and pairing remain manual.", "System dependencies are not installed automatically."] };
  } catch (error) { return fail("setup", error instanceof Error ? error.message : "setup_failed"); }
}
async function readLock(): Promise<Json | undefined> { return readJson(lockPath); }
function processAlive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
async function status(): Promise<Output> { const lock = await readLock(); const pid = typeof lock?.pid === "number" ? lock.pid : undefined; return { ok: true, command: "status", data: { version: AGENTHOST_VERSION, configured: existsSync(publicConfig) || existsSync(legacyConfigPath(home)), running: pid !== undefined && processAlive(pid), pid: pid ?? null, mcpEntryAvailable: existsSync(mcpEntry()) } }; }
async function start(flags: ReturnType<typeof parseFlags>): Promise<Output> {
  const entry = mcpEntry(); if (!existsSync(entry)) return fail("start", "mcp_runtime_missing");
  const current = await readLock(); if (typeof current?.pid === "number" && processAlive(current.pid)) return fail("start", "agenthost_already_running");
  await safeMkdir(path.dirname(lockPath)); const packagedBrowserRoot = path.join(runtimeRoot(), "browser-extension"); const childEnv = { ...process.env, AGENTHOST_CONFIG: existsSync(publicConfig) ? publicConfig : legacyConfigPath(home), AGENTHOST_BROWSER_EXTENSION_DIR: extensionDir, AGENTHOST_BROWSER_RELEASE_ROOT: path.join(packagedBrowserRoot, "artifacts"), ...(flags.values.has("control-room") ? { AGENTHOST_CONTROL_ROOM_ENABLED: "1" } : {}) };
  if (!flags.flags.has("background")) { const child = spawn(process.execPath, [entry], { stdio: "inherit", env: childEnv }); const exit = await new Promise<number>((resolve) => { child.once("error", () => resolve(1)); child.once("exit", (code) => resolve(code ?? 1)); }); return exit === 0 ? { ok: true, command: "start", data: { stopped: true } } : fail("start", `mcp_exit_${exit}`); }
  const child = spawn(process.execPath, [entry], { stdio: "ignore", detached: true, env: childEnv }); child.unref(); await safeWrite(lockPath, JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString(), version: AGENTHOST_VERSION }) + "\n"); return { ok: true, command: "start", data: { background: true, pid: child.pid } };
}
async function stop(): Promise<Output> {
  await safeWrite(path.join(agentHome, "run", "stop.requested"), JSON.stringify({ stopped: true, reason: "cli_stop", at: new Date().toISOString() }) + "\n");
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
    if (action !== "status") { await rm(path.join(agentHome, "run", "stop.requested"), { force: true }).catch(() => undefined); }
    return { ok: true, command: `task ${action}`, data: action === "status" ? record : { taskId: safe, resumed: action === "resume" } };
  }
  if (action === "stop") { await safeWrite(path.join(agentHome, "run", "stop.requested"), JSON.stringify({ stopped: true, reason: "cli_task_stop", at: new Date().toISOString() }) + "\n"); return { ok: true, command: "task stop", data: { stopped: true } }; }
  return fail("task", "usage: agenthost task [list|status <id>|pause <id>|resume <id>|stop]");
}
async function capabilitiesCommand(): Promise<Output> {
  return { ok: true, command: "capabilities", data: { families: ["computer", "browser", "filesystem", "shell", "applications", "mcp", "network", "vision", "ocr", "speech", "skills"], note: "Authoritative live list: system.list_capabilities over MCP. Permissions: agenthost permissions." } };
}
async function permissionsCommand(): Promise<Output> {
  return { ok: true, command: "permissions", data: { model: "LOW->automatic, MEDIUM->logged, HIGH->approval, CRITICAL->explicit confirmation; blocked stays blocked", capabilities: { computer: "allow", browser: "allow", filesystem: "allow", shell: "allow", applications: "allow", mcp: "allow", network: "approval_required", vision: "allow", ocr: "allow", speech: "allow", skills: "allow" }, hardStop: "agenthost stop halts state-changing tools via run/stop.requested" } };
}
async function skillsCommand(): Promise<Output> {
  return { ok: true, command: "skills", data: { skills: ["software-development", "web-research", "file-management", "browser-work", "desktop-automation", "data-analysis", "document-editing", "testing-debugging", "system-administration"], note: "Detail over MCP: skills.list / skills.get. Skills compose; capabilities are discovered via agent.discover_capabilities." } };
}
async function sessionsCommand(): Promise<Output> {
  const lock = await readLock();
  return { ok: true, command: "sessions", data: { background: lock ?? null, tasksDir: "[agenthost-home]/tasks", stopRequested: existsSync(path.join(agentHome, "run", "stop.requested")), takeoverActive: existsSync(path.join(agentHome, "run", "takeover.active")) } };
}
async function doctor(): Promise<Output> {
  const config = await configValidate(); const mcp = await probeMcp(mcpEntry()); const checks = { platform: process.platform === "linux", architecture: process.arch === "x64", node: Number(process.versions.node.split(".")[0]) >= 20, python: commandExists("python3"), x11: Boolean(process.env.DISPLAY), gtkProbe: pythonModuleExists("import gi; from gi.repository import Gtk"), mcpEntry: existsSync(mcpEntry()), mcpHandshake: mcp.handshake, browserArtifacts: existsSync(extensionDir) || packagedBrowserArtifactsAvailable(), codexConfig: existsSync(path.join(process.env.CODEX_HOME ?? path.join(home, ".codex"), "config.toml")), storage: existsSync(agentHome) };
  const warnings = [!checks.architecture ? "x86_64 is the public RC target." : "", !checks.python ? "Install Python 3 for overlay and local speech diagnostics." : "", !checks.x11 ? "X11 DISPLAY is unavailable; visible overlay is unsupported." : "", !checks.browserArtifacts ? "Browser extension artifacts are not prepared." : ""].filter(Boolean);
  if (!mcp.handshake) warnings.push(mcp.reason ?? "mcp_handshake_unavailable");
  return { ok: config.ok, command: "doctor", data: { version: AGENTHOST_VERSION, checks, config: config.ok ? "valid" : config.error, mcp, process: await status(), paths: { agentHostHome: "[agenthost-home]", config: "[config]", mcpEntry: "[installed-mcp-runtime]" } }, warnings };
}
async function browser(command: string, flags: ReturnType<typeof parseFlags>): Promise<Output> {
  if (command === "setup") {
    const requestedValue = flags.values.get("browser");
    const requested = requestedValue === undefined
      ? undefined
      : requestedValue === "firefox" || requestedValue === "chromium"
        ? requestedValue
        : undefined;
    if (requestedValue !== undefined && requested === undefined) {
      return fail("browser setup", "browser_unsupported");
    }
    const packagedCandidates = [
      path.join(runtimeRoot(), "browser-extension", "source"),
      path.join(runtimeRoot(), "packages", "app-browser", "extension")
    ];
    const packaged = packagedCandidates.find((candidate) => existsSync(candidate));
    await safeMkdir(extensionDir);
    const artifactAvailability = new Map<SupportedBrowserFamily, boolean>();
    for (const family of ["firefox", "chromium"] as const) {
      const destination = path.join(extensionDir, family);
      if (packaged !== undefined) {
        await safeMkdir(destination);
        for (const file of ["background.js", "popup.html", "popup.js", "popup.css"]) {
          await cp(path.join(packaged, file), path.join(destination, file), { force: true }).catch(() => undefined);
        }
        await cp(path.join(packaged, `manifest.${family}.json`), path.join(destination, "manifest.json"), { force: true }).catch(() => undefined);
      }
      artifactAvailability.set(family, existsSync(path.join(destination, "manifest.json")));
    }
    const probes = await detectLinuxBrowsers(process.env);
    const inventory: BrowserInventoryEntry[] = probes.map((probe) => ({
      family: probe.family,
      supported: true,
      installed: probe.installed,
      executableAvailable: probe.executableAvailable,
      ...(probe.executableName === undefined ? {} : { executableName: probe.executableName }),
      running: probe.running,
      expectedExtensionId: expectedExtensionId(probe.family),
      extensionArtifactAvailable: artifactAvailability.get(probe.family) === true,
      extensionConnectionState: "unknown",
      pairedDeviceState: "unknown",
      protocolCompatible: true,
      runtimeCompatible: true,
      reconnectReady: false,
      lastHealthStatus: probe.installed ? "degraded" : "unavailable",
      ...(!probe.installed ? { safeFailureCode: "browser_not_detected" as const } : {}),
      recommendedNextAction: !probe.installed
        ? browserSetupRecovery("browser_not_detected").action
        : "Load approved extension artifact and begin local enrollment."
    }));
    const selection = selectBrowserFromInventory(inventory, requested);
    let selectedBrowser = selection.selected;
    if (selectedBrowser === undefined && selection.failureCode === "browser_selection_required" && requested === undefined && process.stdin.isTTY && process.stdout.isTTY) {
      const installed = inventory.filter((item) => item.installed && item.executableAvailable);
      const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        const choices = installed.map((item) => item.family).join("/");
        const answer = await prompt.question(`Select browser (${choices}): `);
        const choice = answer.trim();
        if (choice === "firefox" || choice === "chromium") selectedBrowser = choice;
      } finally {
        prompt.close();
      }
    }
    if (selectedBrowser === undefined) {
      return {
        ok: false,
        command: "browser setup",
        error: selection.failureCode ?? "browser_not_detected",
        data: { inventory, tokenReturned: false, ...(selection.failureCode === "browser_selection_required" ? { next: "Rerun with --browser firefox or --browser chromium." } : {}) }
      };
    }
    const family = selectedBrowser;
    const auto = flags.flags.has("auto");
    const extensionPaths = browserExtensionPaths(family);
    const artifactAvailable = artifactAvailability.get(family) === true;
    const instructions = browserSetupInstructions(family, extensionPaths.root, extensionPaths.manifest);
    if (auto && family === "firefox") {
      return {
        ok: false,
        command: "browser setup",
        error: "firefox_auto_unsupported",
        data: {
          selectedBrowser: family,
          instructions,
          extensionDir: extensionPaths.root,
          manifestPath: extensionPaths.manifest,
          tokenReturned: false,
          next: "Firefox requires manual temporary add-on loading. Rerun without --auto and follow the printed steps, or use --browser chromium --auto."
        }
      };
    }
    if (!flags.flags.has("apply")) {
      return {
        ok: true,
        command: "browser setup",
        data: {
          preview: true,
          selectedBrowser: family,
          inventory,
          instructions,
          extensionRoot: extensionDir,
          extensionDir: extensionPaths.root,
          manifestPath: extensionPaths.manifest,
          extensionArtifactAvailable: artifactAvailable,
          pairingMode: "browser_side_approval",
          tokenReturned: false,
          next: "Rerun with --apply; use --approve in non-interactive terminals."
        }
      };
    }
    const config = await configObject();
    const bridgeValue = config.browserBridge !== null && typeof config.browserBridge === "object"
      ? config.browserBridge as Json
      : {};
    config.schemaVersion = AGENTHOST_CONFIG_SCHEMA_VERSION;
    config.browserBridge = {
      ...bridgeValue,
      enabled: true,
      port: Number.isInteger(bridgeValue.port) ? bridgeValue.port : 43117
    };
    await safeWrite(publicConfig, `${JSON.stringify(config, null, 2)}\n`);
    const loaded = await loadAgentHostConfig({
      env: { ...process.env, AGENTHOST_CONFIG: publicConfig }
    });
    const bridgeConfig = loaded.browserBridge;
    if (bridgeConfig === undefined) return fail("browser setup", "bridge_unavailable");
    const server = new BrowserBridgeServer(bridgeConfig, AGENTHOST_VERSION);
    const setupStore = new BrowserSetupStore(agentHome, `cli-${process.pid}`);
    await setupStore.ensureStructure();
    let setupRecord: BrowserSetupRecord = await setupStore.create(family);
    setupRecord = await setupStore.transition(setupRecord.setupId, "browser_selected");
    setupRecord = await setupStore.transition(setupRecord.setupId, "checking_extension");
    setupRecord = await setupStore.transition(setupRecord.setupId, "enrollment_created");
    setupRecord = await setupStore.transition(setupRecord.setupId, "waiting_for_extension");
    try {
      try {
        await server.start();
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        await setupStore.transition(setupRecord.setupId, "failed", {
          failureCode: code === "EADDRINUSE" ? "bridge_port_conflict" : "bridge_unavailable"
        });
        return fail("browser setup", code === "EADDRINUSE" ? "bridge_port_conflict" : "bridge_unavailable");
      }
      const enrollment = server.beginEnrollment(family);
      const waitMs = Math.max(5_000, Math.min(10 * 60_000, Number(flags.values.get("wait-ms") ?? 120_000)));
      let autoPid: number | undefined;
      if (auto && family === "chromium") {
        const probe = probes.find((item) => item.family === "chromium" && item.executableAvailable && item.executableName !== undefined);
        const names = [...(probe?.executableName === undefined ? [] : [probe.executableName]), "chromium", "chromium-browser", "google-chrome", "google-chrome-stable"];
        const executable = names.map(resolveExecutable).find((item) => item !== undefined);
        if (executable === undefined) {
          await setupStore.transition(setupRecord.setupId, "failed", { failureCode: "browser_not_detected" });
          await server.close();
          return fail("browser setup", "browser_executable_not_found");
        }
        const profileDir = path.join(agentHome, "browser-profile", "chromium");
        await safeMkdir(profileDir);
        const child = spawn(executable, [`--load-extension=${extensionPaths.root}`, `--user-data-dir=${profileDir}`, "--no-first-run", "--disable-default-apps", "--disable-features=Translate", "--disable-sync", "about:blank"], { detached: true, stdio: "ignore" });
        child.on("error", () => undefined);
        child.unref();
        autoPid = child.pid;
        if (!flags.flags.has("json")) {
          process.stdout.write(`\nAgentHost auto-pairing: launched ${executable} (pid ${autoPid ?? "unknown"}) with the extension pre-loaded.\nThe extension enrolls itself; approve the identity below (or rerun with --approve).\nWaiting up to ${Math.ceil(waitMs / 1000)} seconds for pairing...\n\n`);
        }
      } else {
        printBrowserSetupGuide(family, extensionPaths.root, extensionPaths.manifest, bridgeConfig.port, waitMs, artifactAvailable, flags.flags.has("json"));
      }
      if (!process.stdout.isTTY && !flags.flags.has("approve")) {
        return {
          ok: false,
          command: "browser setup",
          error: "browser_approval_required",
          data: {
            selectedBrowser: family,
            setupState: enrollment.state,
            instructions,
            extensionRoot: extensionDir,
            extensionDir: extensionPaths.root,
            manifestPath: extensionPaths.manifest,
            extensionArtifactAvailable: artifactAvailable,
            bridgePort: bridgeConfig.port,
            tokenReturned: false,
            next: "Rerun interactively or add --approve after reviewing selected browser."
          }
        };
      }
      const deadline = Date.now() + waitMs;
      let approved = false;
      while (Date.now() < deadline) {
        const state = server.enrollmentStatus(enrollment.enrollmentId);
        if (state.state === "waiting_for_approval" && !approved) {
          setupRecord = await setupStore.transition(setupRecord.setupId, "waiting_for_approval", {
            ...(state.extensionIdentitySuffix === undefined ? {} : {
              extensionIdentitySuffix: state.extensionIdentitySuffix
            }),
            recommendedNextAction: "Review extension identity, then explicitly approve enrollment."
          });
          let allow = flags.flags.has("approve");
          if (!allow && process.stdin.isTTY && process.stdout.isTTY) {
            const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
            try {
              const answer = await prompt.question(
                `Approve ${family} extension …${state.extensionIdentitySuffix ?? "unknown"}? [y/N] `
              );
              allow = answer.trim().toLowerCase() === "y";
            } finally {
              prompt.close();
            }
          }
          if (!allow) {
            server.cancelEnrollment(enrollment.enrollmentId);
            await setupStore.cancel(setupRecord.setupId);
            return fail("browser setup", "setup_cancelled");
          }
          if (typeof state.approvalFingerprint !== "string") {
            return fail("browser setup", "enrollment_expired");
          }
          await server.approveEnrollment(enrollment.enrollmentId, state.approvalFingerprint);
          setupRecord = await setupStore.transition(setupRecord.setupId, "pairing");
          approved = true;
        }
        if (server.status().connected) {
          if (setupRecord.state === "waiting_for_extension") {
            setupRecord = await setupStore.transition(setupRecord.setupId, "extension_connected");
            setupRecord = await setupStore.transition(setupRecord.setupId, "pairing");
          }
          setupRecord = await setupStore.transition(setupRecord.setupId, "paired");
          setupRecord = await setupStore.transition(setupRecord.setupId, "verifying_reconnect");
          await server.close();
          await server.start();
          const reconnectDeadline = Date.now() + Math.min(30_000, waitMs);
          while (Date.now() < reconnectDeadline && !server.status().connected) {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          if (!server.status().connected) {
            await setupStore.transition(setupRecord.setupId, "needs_repair", {
              failureCode: "reconnect_timeout"
            });
            return fail("browser setup", "reconnect_timeout");
          }
          setupRecord = await setupStore.transition(setupRecord.setupId, "ready", {
            reconnectVerified: true,
            recommendedNextAction: "Browser Bridge is ready."
          });
          return {
            ok: true,
            command: "browser setup",
            data: {
              selectedBrowser: family,
              setupId: setupRecord.setupId,
              state: "ready",
              reconnectVerified: true,
              pairingMode: autoPid !== undefined ? "assisted_auto" : "browser_side_approval",
              ...(autoPid === undefined ? {} : { launchedBrowserPid: autoPid }),
              extensionIdentitySuffix: state.extensionIdentitySuffix,
              extensionRoot: extensionDir,
              extensionDir: extensionPaths.root,
              manifestPath: extensionPaths.manifest,
              bridgeHost: "127.0.0.1",
              bridgePort: bridgeConfig.port,
              tokenReturned: false
            }
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await setupStore.transition(setupRecord.setupId, approved ? "needs_repair" : "failed", {
        failureCode: approved ? "reconnect_timeout" : "extension_not_installed"
      });
      return fail("browser setup", approved ? "reconnect_timeout" : "extension_not_installed");
    } finally {
      await server.close().catch(() => undefined);
    }
  }
  if (command === "reset") { if (!flags.flags.has("yes")) return fail("browser reset", "confirmation_required_use_--yes"); await rm(path.join(agentHome, "browser", "pairing-token"), { force: true }); await rm(path.join(agentHome, "browser", "paired-devices.json"), { force: true }); return { ok: true, command: "browser reset", data: { reset: true, tokenReturned: false } }; }
  const tokenFile = path.join(agentHome, "browser", "pairing-token");
  const persisted = await configObject().catch(() => ({} as Json));
  const bridge = persisted.browserBridge !== null && typeof persisted.browserBridge === "object"
    ? persisted.browserBridge as Json
    : {};
  const paired = existsSync(path.join(agentHome, "browser", "paired-devices.json"));
  return { ok: true, command: "browser status", data: { enabled: bridge.enabled === true || process.env.AGENTHOST_BROWSER_BRIDGE_ENABLED === "1", port: Number.isInteger(bridge.port) ? bridge.port : Number(process.env.AGENTHOST_BROWSER_BRIDGE_PORT ?? 43117), extensionPrepared: existsSync(extensionDir) || packagedBrowserArtifactsAvailable(), tokenExists: existsSync(tokenFile), paired, connection: "not_probed", state: paired ? "persisted_pairing" : "unpaired", next: paired ? "Use browser.verify_pairing through the running MCP session for live connection state." : "Load the extension and pair it with AgentHost." } };
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
async function uninstall(flags: ReturnType<typeof parseFlags>): Promise<Output> { const data = { preview: !flags.flags.has("yes"), removes: ["[installed-release]", "[agenthost-wrapper]"], preserves: flags.flags.has("remove-data") ? [] : ["[agenthost-home]", "[config]"], browserExtensionRemoval: "manual" }; if (!flags.flags.has("yes")) return { ok: true, command: "uninstall", data }; await stop(); await rm(path.join(home, ".local", "share", "agenthost"), { recursive: true, force: true }); await rm(path.join(home, ".local", "bin", "agenthost"), { force: true }); if (flags.flags.has("remove-data")) { await rm(agentHome, { recursive: true, force: true }); await rm(path.dirname(publicConfig), { recursive: true, force: true }); } return { ok: true, command: "uninstall", data: { ...data, preview: false } }; }
async function main(): Promise<number> {
  const args = parseFlags(process.argv.slice(2)); const json = args.flags.has("json"); const [top, sub] = args.positional; let result: Output;
  try {
    if (top === undefined || top === "help") result = { ok: true, command: "help", data: "agenthost version|doctor|setup|start|stop|status|task|capabilities|permissions|skills|sessions|control-room|browser|overlay|speech|integrations|config|update|uninstall" };
    else if (top === "version") result = { ok: true, command: "version", data: { version: AGENTHOST_VERSION, platform: process.platform, architecture: process.arch } };
    else if (top === "doctor") result = await doctor();
    else if (top === "setup") result = await setup(args);
    else if (top === "start") result = await start(args);
    else if (top === "stop") result = await stop();
    else if (top === "status") result = await status();
    else if (top === "task") result = await taskCommand(args);
    else if (top === "capabilities") result = await capabilitiesCommand();
    else if (top === "permissions") result = await permissionsCommand();
    else if (top === "skills") result = await skillsCommand();
    else if (top === "sessions") result = await sessionsCommand();
    else if (top === "browser") result = await browser(sub ?? "status", args);
    else if (top === "integrations" && sub === "codex") result = await codex(args.positional[2] ?? "status", args);
    else if (top === "config") result = sub === "validate" ? await configValidate() : await configShow();
    else if (top === "update") result = await update(args);
    else if (top === "uninstall") result = await uninstall(args);
    else if (top === "control-room") result = await start({ ...args, values: new Map([...args.values, ["control-room", "1"]]) });
    else if (top === "overlay" || top === "speech") result = await doctor();
    else result = fail(top, "unknown_command");
  } catch (error) { result = fail(top ?? "agenthost", error instanceof Error ? error.message : "command_failed"); }
  await print(result, json); return result.ok ? 0 : 1;
}
void main().then((code) => { process.exitCode = code; });
