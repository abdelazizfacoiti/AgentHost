import { access, readdir, readFile } from "node:fs/promises";
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
