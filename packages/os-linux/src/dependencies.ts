import { access, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { constants } from "node:fs";
import type { DependencyCheckResult, DependencyKind } from "@agenthost/core";

export interface DesktopEntry {
  appId: string;
  displayName: string;
  exec?: string;
  command?: string;
  desktopEntryPath: string;
  noDisplay: boolean;
  hidden: boolean;
}

export interface LinuxLookupContext {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

function splitPathEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.PATH ?? "").split(path.delimiter).filter((entry) => entry.length > 0);
}

function isExecutableModeError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EACCES";
}

export async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch (error) {
    return isExecutableModeError(error) ? false : false;
  }
}

export async function findCommandPath(command: string, context: LinuxLookupContext = {}): Promise<string | undefined> {
  if (command.trim().length === 0) {
    return undefined;
  }

  if (command.includes("/")) {
    const resolved = path.resolve(command);
    return (await isExecutable(resolved)) ? resolved : undefined;
  }

  for (const dir of splitPathEnv(context.env)) {
    const candidate = path.join(dir, command);

    if (await isExecutable(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export function desktopEntryDirs(context: LinuxLookupContext = {}): string[] {
  const homeDir = context.homeDir ?? os.homedir();
  return [
    path.join(homeDir, ".local", "share", "applications"),
    "/usr/local/share/applications",
    "/usr/share/applications",
    "/var/lib/snapd/desktop/applications"
  ];
}

function parseDesktopEntry(raw: string, desktopEntryPath: string): DesktopEntry | undefined {
  const values = new Map<string, string>();
  let inDesktopEntry = false;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed === "[Desktop Entry]") {
      inDesktopEntry = true;
      continue;
    }

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inDesktopEntry = false;
      continue;
    }

    if (!inDesktopEntry || trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");

    if (equalsIndex === -1) {
      continue;
    }

    values.set(trimmed.slice(0, equalsIndex), trimmed.slice(equalsIndex + 1));
  }

  if (values.get("Type") !== "Application") {
    return undefined;
  }

  const displayName = values.get("Name");

  if (displayName === undefined || displayName.length === 0) {
    return undefined;
  }

  const exec = values.get("Exec");
  const entry: DesktopEntry = {
    appId: path.basename(desktopEntryPath, ".desktop"),
    displayName,
    desktopEntryPath,
    noDisplay: values.get("NoDisplay")?.toLowerCase() === "true",
    hidden: values.get("Hidden")?.toLowerCase() === "true"
  };

  if (exec !== undefined) {
    entry.exec = exec;
    const command = parseDesktopExec(exec)[0];

    if (command !== undefined) {
      entry.command = command;
    }
  }

  return entry;
}

export function parseDesktopExec(exec: string): string[] {
  const cleaned = exec.replace(/%[fFuUdDnNickvm]/g, "").trim();
  const args: string[] = [];
  let current = "";
  let quote: "'" | "\"" | undefined;
  let escaping = false;

  for (const char of cleaned) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }

      continue;
    }

    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }

      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

export async function listDesktopEntries(context: LinuxLookupContext = {}): Promise<DesktopEntry[]> {
  const entries: DesktopEntry[] = [];

  for (const dir of desktopEntryDirs(context)) {
    let names: string[];

    try {
      names = await readdir(dir);
    } catch {
      continue;
    }

    for (const name of names) {
      if (!name.endsWith(".desktop")) {
        continue;
      }

      const desktopEntryPath = path.join(dir, name);

      try {
        const entry = parseDesktopEntry(await readFile(desktopEntryPath, "utf8"), desktopEntryPath);

        if (entry !== undefined && !entry.hidden) {
          entries.push(entry);
        }
      } catch {
        continue;
      }
    }
  }

  return entries;
}

export async function checkLinuxDependency(
  input: { name: string; kind?: DependencyKind },
  context: LinuxLookupContext = {}
): Promise<DependencyCheckResult> {
  const kind = input.kind ?? "any";
  const commandPath = kind === "desktop_app" ? undefined : await findCommandPath(input.name, context);

  if (commandPath !== undefined) {
    return {
      found: true,
      kind: "command",
      name: input.name,
      commandPath,
      reason: "Command found on PATH."
    };
  }

  if (kind !== "command") {
    const query = input.name.toLowerCase();
    const desktopEntry = (await listDesktopEntries(context)).find(
      (entry) =>
        entry.appId.toLowerCase() === query ||
        entry.displayName.toLowerCase() === query ||
        entry.displayName.toLowerCase().includes(query)
    );

    if (desktopEntry !== undefined) {
      return {
        found: true,
        kind: "desktop_app",
        name: input.name,
        desktopEntryPath: desktopEntry.desktopEntryPath,
        displayName: desktopEntry.displayName,
        reason: "Desktop entry found."
      };
    }
  }

  return {
    found: false,
    kind,
    name: input.name,
    reason: "No matching command or desktop entry found."
  };
}
