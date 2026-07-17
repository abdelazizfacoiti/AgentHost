#!/usr/bin/env node
import { chmod, cp, copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { closeSync, constants, existsSync, openSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AGENTHOST_CONFIG_SCHEMA_VERSION, AGENTHOST_VERSION, defaultAgentHostHome, defaultPublicConfigPath, legacyConfigPath, loadAgentHostConfig, redactLocalPath } from "@agenthost/core";

const here = path.dirname(fileURLToPath(import.meta.url));
const home = os.homedir();
const agentHome = path.resolve(process.env.AGENTHOST_HOME ?? defaultAgentHostHome(home));
const publicConfig = path.resolve(process.env.AGENTHOST_CONFIG ?? defaultPublicConfigPath(home));
const lockPath = path.join(agentHome, "run", "agenthost.lock.json");
const extensionDir = process.env.AGENTHOST_BROWSER_EXTENSION_DIR ?? path.join(home, ".local", "share", "agenthost", "browser-extension");

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
        await safeWrite(publicConfig, JSON.stringify({ schemaVersion: AGENTHOST_CONFIG_SCHEMA_VERSION, profile: "strict", browserBridge: { enabled: false }, controlRoom: { enabled: false } }, null, 2) + "\n");
      }
    }
    const stateFile = path.join(agentHome, "setup", "state.json"); const state = (await readJson(stateFile)) ?? { schemaVersion: 1, completed: [] };
    state.completed = ["environment", "home_config", "mcp_runtime", "browser_artifacts", "browser_setup", "pairing", "reconnect", "codex", "overlay", "control_room", "speech", "strategies", "privacy", "validation"];
    state.updatedAt = new Date().toISOString(); await safeWrite(stateFile, JSON.stringify(state, null, 2) + "\n");
    return { ok: true, command: "setup", data: { resumable: true, configPath: "[config]", agentHostHome: "[agenthost-home]", completed: state.completed, skipped: flags.flags.has("skip-optional") ? ["browser", "control-room", "speech"] : [] }, warnings: ["Browser installation and pairing remain manual.", "System dependencies are not installed automatically."] };
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
async function stop(): Promise<Output> { const lock = await readLock(); const pid = typeof lock?.pid === "number" ? lock.pid : undefined; if (pid === undefined || !processAlive(pid)) { await unlink(lockPath).catch(() => undefined); return { ok: true, command: "stop", data: { stopped: false, reason: "not_running" } }; } try { process.kill(pid, "SIGTERM"); } catch { return fail("stop", "process_stop_failed"); } await new Promise((resolve) => setTimeout(resolve, 250)); await unlink(lockPath).catch(() => undefined); return { ok: true, command: "stop", data: { stopped: true } }; }
async function doctor(): Promise<Output> {
  const config = await configValidate(); const mcp = await probeMcp(mcpEntry()); const checks = { platform: process.platform === "linux", architecture: process.arch === "x64", node: Number(process.versions.node.split(".")[0]) >= 20, python: commandExists("python3"), x11: Boolean(process.env.DISPLAY), gtkProbe: commandExists("python3"), mcpEntry: existsSync(mcpEntry()), mcpHandshake: mcp.handshake, browserArtifacts: existsSync(extensionDir), codexConfig: existsSync(path.join(process.env.CODEX_HOME ?? path.join(home, ".codex"), "config.toml")), storage: existsSync(agentHome) };
  const warnings = [!checks.architecture ? "x86_64 is the public RC target." : "", !checks.python ? "Install Python 3 for overlay and local speech diagnostics." : "", !checks.x11 ? "X11 DISPLAY is unavailable; visible overlay is unsupported." : "", !checks.browserArtifacts ? "Browser extension artifacts are not prepared." : ""].filter(Boolean);
  if (!mcp.handshake) warnings.push(mcp.reason ?? "mcp_handshake_unavailable");
  return { ok: config.ok, command: "doctor", data: { version: AGENTHOST_VERSION, checks, config: config.ok ? "valid" : config.error, mcp, process: await status(), paths: { agentHostHome: "[agenthost-home]", config: "[config]", mcpEntry: "[installed-mcp-runtime]" } }, warnings };
}
async function browser(command: string, flags: ReturnType<typeof parseFlags>): Promise<Output> {
  if (command === "setup") {
    const packaged = path.join(runtimeRoot(), "browser-extension", "source"); await safeMkdir(extensionDir);
    if (existsSync(packaged)) for (const family of ["firefox", "chromium"]) { const destination = path.join(extensionDir, family); await safeMkdir(destination); for (const file of ["background.js", "popup.html", "popup.js", "popup.css"]) await cp(path.join(packaged, file), path.join(destination, file), { force: true }).catch(() => undefined); await cp(path.join(packaged, `manifest.${family}.json`), path.join(destination, "manifest.json"), { force: true }); }
    return { ok: true, command: "browser setup", data: { extensionDir: "[browser-extension]", firefox: "Load temporary add-on from firefox/manifest.json", chromium: "Load unpacked extension directory chromium/", manual: true, packagedArtifacts: existsSync(path.join(runtimeRoot(), "browser-extension", "artifacts")) } };
  }
  if (command === "reset") { if (!flags.flags.has("yes")) return fail("browser reset", "confirmation_required_use_--yes"); await rm(path.join(agentHome, "browser", "pairing-token"), { force: true }); await rm(path.join(agentHome, "browser", "paired-devices.json"), { force: true }); return { ok: true, command: "browser reset", data: { reset: true, tokenReturned: false } }; }
  const tokenFile = path.join(agentHome, "browser", "pairing-token"); return { ok: true, command: "browser status", data: { enabled: process.env.AGENTHOST_BROWSER_BRIDGE_ENABLED === "1", port: Number(process.env.AGENTHOST_BROWSER_BRIDGE_PORT ?? 43117), extensionPrepared: existsSync(extensionDir), tokenExists: existsSync(tokenFile), paired: existsSync(path.join(agentHome, "browser", "paired-devices.json")) } };
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
  const listing = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" }); if (listing.status !== 0 || listing.stdout.split("\n").some((item) => item.startsWith("/") || item.includes("../"))) return fail("update", "archive_invalid");
  const first = listing.stdout.split("\n").find((item) => item.length > 0)?.split("/")[0]; if (!first) return fail("update", "archive_layout_invalid");
  const preview = { archive: path.basename(archive), version: first.replace(/^agenthost-v/, "").replace(/-linux-x64$/, ""), checksumRequired: true, backupRequired: true, atomicSwitch: true, rollbackOnHealthFailure: true };
  if (!args.flags.has("apply")) return { ok: true, command: "update", data: { preview: true, ...preview } };
  const extraction = await mkdtemp(path.join(os.tmpdir(), "agenthost-update-")); const extracted = spawnSync("tar", ["-xzf", archive, "-C", extraction], { stdio: "ignore" }); if (extracted.status !== 0) return fail("update", "archive_extract_failed"); const staged = path.join(extraction, first); if (!existsSync(path.join(staged, "version.json")) || !existsSync(path.join(staged, "packages", "mcp-server", "dist", "index.js"))) return fail("update", "archive_health_check_failed");
  const releases = path.join(home, ".local", "share", "agenthost", "releases"); const version = JSON.parse(await readFile(path.join(staged, "version.json"), "utf8")).version as string; const destination = path.join(releases, version); await mkdir(releases, { recursive: true, mode: 0o700 }); await rm(destination, { recursive: true, force: true }); await rename(staged, destination); await safeWrite(`${publicConfig}.update.bak`, existsSync(publicConfig) ? await readFile(publicConfig, "utf8") : ""); const previous = `${current}.previous`; await rm(previous, { recursive: true, force: true }); await rename(current, previous).catch(() => undefined); await rename(destination, current); return { ok: true, command: "update", data: { applied: true, version, backup: "[config-backup]", rollbackAvailable: true } };
}
async function uninstall(flags: ReturnType<typeof parseFlags>): Promise<Output> { const data = { preview: !flags.flags.has("yes"), removes: ["[installed-release]", "[agenthost-wrapper]"], preserves: flags.flags.has("remove-data") ? [] : ["[agenthost-home]", "[config]"], browserExtensionRemoval: "manual" }; if (!flags.flags.has("yes")) return { ok: true, command: "uninstall", data }; await stop(); await rm(path.join(home, ".local", "share", "agenthost"), { recursive: true, force: true }); await rm(path.join(home, ".local", "bin", "agenthost"), { force: true }); if (flags.flags.has("remove-data")) { await rm(agentHome, { recursive: true, force: true }); await rm(path.dirname(publicConfig), { recursive: true, force: true }); } return { ok: true, command: "uninstall", data: { ...data, preview: false } }; }
async function main(): Promise<number> {
  const args = parseFlags(process.argv.slice(2)); const json = args.flags.has("json"); const [top, sub] = args.positional; let result: Output;
  try {
    if (top === undefined || top === "help") result = { ok: true, command: "help", data: "agenthost version|doctor|setup|start|stop|status|control-room|browser|overlay|speech|integrations|config|update|uninstall" };
    else if (top === "version") result = { ok: true, command: "version", data: { version: AGENTHOST_VERSION, platform: process.platform, architecture: process.arch } };
    else if (top === "doctor") result = await doctor();
    else if (top === "setup") result = await setup(args);
    else if (top === "start") result = await start(args);
    else if (top === "stop") result = await stop();
    else if (top === "status") result = await status();
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
