import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import path from "node:path";

export interface LinuxBrowserProbe {
  family: "firefox" | "chromium";
  installed: boolean;
  executableAvailable: boolean;
  executableName?: string;
  running: boolean;
}

const CANDIDATES = {
  firefox: ["firefox", "firefox-esr"],
  chromium: ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]
} as const;
const RUNNING_NAMES = {
  firefox: ["firefox", "firefox-esr", "firefox-bin"],
  chromium: ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "chrome"]
} as const;

async function executableInPath(name: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  for (const directory of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    try {
      await access(path.join(directory, name), constants.X_OK);
      return true;
    } catch {
      // Continue bounded PATH scan.
    }
  }
  return false;
}

async function runningCommands(): Promise<Set<string>> {
  const commands = new Set<string>();
  try {
    const entries = (await readdir("/proc", { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .slice(0, 32_768);
    // Keep process inventory bounded on hosts with many processes. Browser
    // detection is diagnostic only; it must not create an unbounded read fanout.
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < entries.length) {
        const entry = entries[cursor++];
        if (entry === undefined) return;
        try {
          const command = (await readFile(`/proc/${entry.name}/comm`, "utf8")).trim();
          if (command.length > 0 && command.length <= 128) commands.add(command);
        } catch {
          // Process exited or is unreadable.
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(16, entries.length) }, () => worker()));
  } catch {
    // Process inventory is optional; installation detection remains useful.
  }
  return commands;
}

/**
 * Isolated background browser profile. Background automation must never reuse
 * the user's foreground profile: separate cookies, windows, and focus.
 */
export function backgroundBrowserProfileDir(agentHostDir: string): string {
  return path.join(agentHostDir, "browser", "profiles", "background");
}

export interface BackgroundChromiumLaunch {
  profileDir: string;
  headless: boolean;
  args: string[];
}

/**
 * Pure argument builder for an offscreen Chromium run. No process is spawned
 * here; the caller (or a future background worker) spawns it. Headless + a
 * dedicated user-data-dir keeps the user screen untouched.
 */
export function backgroundChromiumArgs(input: { profileDir: string; extensionDir?: string; headless?: boolean }): BackgroundChromiumLaunch {
  const headless = input.headless ?? true;
  const args = [
    ...(headless ? ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check"] : []),
    `--user-data-dir=${input.profileDir}`,
    "--no-first-run",
    "--disable-background-timer-throttling",
    ...(input.extensionDir === undefined ? [] : [`--load-extension=${input.extensionDir}`])
  ];
  return { profileDir: input.profileDir, headless, args };
}

export interface BackgroundWorkerRecord {
  pid: number;
  profileDir: string;
  executable: string;
  args: string[];
  startedAt: string;
}

export interface BackgroundWorkerStatus {
  running: boolean;
  profileDir: string;
  pid?: number;
  executable?: string;
  startedAt?: string;
  reason: string;
}

const CHROMIUM_EXECUTABLES = ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"] as const;

async function firstExecutable(names: readonly string[], env: NodeJS.ProcessEnv): Promise<string | undefined> {
  for (const name of names) {
    for (const directory of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
      try {
        await access(path.join(directory, name), constants.X_OK);
        return name;
      } catch {
        // Keep scanning PATH.
      }
    }
  }
  return undefined;
}

function workerFile(profileDir: string): string {
  return path.join(profileDir, "worker.json");
}

/**
 * Spawns a detached headless Chromium bound to the isolated background
 * profile. Pairing is completed once, headful, in this same profile; the
 * extension reconnect secret persists there so later headless launches
 * reconnect without touching the user's screen. Records the worker pid under
 * the profile dir for status checks. Never touches the foreground profile.
 */
export async function spawnBackgroundChromium(input: {
  agentHostDir: string;
  profileDir?: string;
  extensionDir?: string;
  headless?: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<{ pid: number; profileDir: string; executable: string; args: string[] }> {
  const env = input.env ?? process.env;
  const executable = await firstExecutable(CHROMIUM_EXECUTABLES, env);
  if (executable === undefined) throw new Error("chromium_not_installed:No Chromium executable was found on PATH.");
  const profileDir = input.profileDir ?? backgroundBrowserProfileDir(input.agentHostDir);
  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  const launch = backgroundChromiumArgs({ profileDir, ...(input.extensionDir === undefined ? {} : { extensionDir: input.extensionDir }), headless: input.headless ?? true });
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(executable, launch.args, { detached: true, stdio: "ignore", env });
  } catch {
    throw new Error("background_worker_spawn_failed:Chromium could not be started.");
  }
  if (child.pid === undefined) throw new Error("background_worker_spawn_failed:Chromium did not report a pid.");
  child.unref();
  const record: BackgroundWorkerRecord = { pid: child.pid, profileDir, executable, args: launch.args, startedAt: new Date().toISOString() };
  await writeFile(workerFile(profileDir), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  return { pid: record.pid, profileDir, executable, args: record.args };
}

/** Reads the recorded background worker and checks pid aliveness via /proc. */
export async function backgroundWorkerStatus(
  agentHostDir: string,
  procfsRoot = "/proc"
): Promise<BackgroundWorkerStatus> {
  const profileDir = backgroundBrowserProfileDir(agentHostDir);
  let record: BackgroundWorkerRecord;
  try {
    record = JSON.parse(await readFile(workerFile(profileDir), "utf8")) as BackgroundWorkerRecord;
  } catch {
    return { running: false, profileDir, reason: "No background worker has been launched in this profile." };
  }
  if (!Number.isInteger(record.pid) || record.pid <= 0) {
    return { running: false, profileDir, reason: "Recorded background worker pid is invalid." };
  }
  try {
    await access(path.join(procfsRoot, String(record.pid), "comm"), constants.R_OK);
  } catch {
    return { running: false, profileDir, pid: record.pid, ...(record.executable === undefined ? {} : { executable: record.executable }), reason: "Recorded background worker process is no longer running." };
  }
  return { running: true, profileDir, pid: record.pid, ...(record.executable === undefined ? {} : { executable: record.executable }), ...(record.startedAt === undefined ? {} : { startedAt: record.startedAt }), reason: "Background worker process is alive." };
}

export async function detectLinuxBrowsers(
  env: NodeJS.ProcessEnv = process.env
): Promise<LinuxBrowserProbe[]> {
  const running = await runningCommands();
  const output: LinuxBrowserProbe[] = [];
  for (const family of ["firefox", "chromium"] as const) {
    let executableName: string | undefined;
    for (const candidate of CANDIDATES[family]) {
      if (await executableInPath(candidate, env)) {
        executableName = candidate;
        break;
      }
    }
    output.push({
      family,
      installed: executableName !== undefined,
      executableAvailable: executableName !== undefined,
      ...(executableName === undefined ? {} : { executableName }),
      running: RUNNING_NAMES[family].some((candidate) => running.has(candidate))
    });
  }
  return output;
}
