import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  classifyAppSensitivity,
  type AppDetectionResult,
  type AppOpenResult,
  type AppStrategyResult,
  type AppStrategyTaskType,
  type AutomationStrategy,
  type InstalledAppSummary,
  type PolicyProfile
} from "@agenthost/core";
import {
  findCommandPath,
  listDesktopEntries,
  parseDesktopExec,
  type DesktopEntry,
  type LinuxLookupContext
} from "./dependencies.js";

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug : "unknown";
}

function strategiesFor(found: boolean, policy: PolicyProfile): AutomationStrategy[] {
  if (!found) {
    return ["guide_only"];
  }

  const strategies: AutomationStrategy[] = ["cli_or_script"];

  if (policy.allowGenericClick || policy.allowGenericType) {
    strategies.push("gui_control");
  }

  strategies.push("guide_only");
  return strategies;
}

function detectionFromDesktopEntry(
  appName: string,
  entry: DesktopEntry,
  policy: PolicyProfile,
  executablePath?: string
): AppDetectionResult {
  const result: AppDetectionResult = {
    found: true,
    appId: slugify(entry.appId),
    displayName: entry.displayName,
    desktopEntryPath: entry.desktopEntryPath,
    adapterAvailable: false,
    availableStrategies: strategiesFor(true, policy),
    recommendedStrategy: "guide_only",
    appSensitivity: classifyAppSensitivity({ appId: entry.appId, appName: entry.displayName }),
    reason: `Found generic Linux desktop entry for ${appName}.`
  };

  if (executablePath !== undefined) {
    result.executablePath = executablePath;
  }

  return result;
}

async function executableForDesktopEntry(entry: DesktopEntry, context: LinuxLookupContext): Promise<string | undefined> {
  if (entry.command === undefined) {
    return undefined;
  }

  return findCommandPath(entry.command, context);
}

async function findDesktopEntry(appName: string, context: LinuxLookupContext): Promise<DesktopEntry | undefined> {
  const query = appName.trim().toLowerCase();
  const entries = await listDesktopEntries(context);

  return (
    entries.find((entry) => entry.appId.toLowerCase() === query || entry.displayName.toLowerCase() === query) ??
    entries.find((entry) => entry.appId.toLowerCase().includes(query) || entry.displayName.toLowerCase().includes(query))
  );
}

export async function detectLinuxApp(
  input: { appName: string },
  policy: PolicyProfile,
  context: LinuxLookupContext = {}
): Promise<AppDetectionResult> {
  const commandPath = await findCommandPath(input.appName, context);

  if (commandPath !== undefined) {
    return {
      found: true,
      appId: slugify(input.appName),
      displayName: input.appName,
      executablePath: commandPath,
      adapterAvailable: false,
      availableStrategies: strategiesFor(true, policy),
      recommendedStrategy: "guide_only",
      appSensitivity: classifyAppSensitivity({ appId: input.appName, appName: input.appName }),
      reason: "Found command on PATH."
    };
  }

  const desktopEntry = await findDesktopEntry(input.appName, context);

  if (desktopEntry !== undefined) {
    return detectionFromDesktopEntry(
      input.appName,
      desktopEntry,
      policy,
      await executableForDesktopEntry(desktopEntry, context)
    );
  }

  return {
    found: false,
    appId: `unknown:${slugify(input.appName)}`,
    adapterAvailable: false,
    availableStrategies: ["guide_only"],
    recommendedStrategy: "guide_only",
    appSensitivity: classifyAppSensitivity({ appName: input.appName }),
    reason: "No adapter, CLI, API, browser, accessibility, or GUI method is available yet."
  };
}

async function listPathCommands(context: LinuxLookupContext): Promise<InstalledAppSummary[]> {
  const seen = new Set<string>();
  const apps: InstalledAppSummary[] = [];
  const pathDirs = (context.env?.PATH ?? process.env.PATH ?? "").split(path.delimiter).filter(Boolean);

  for (const dir of pathDirs) {
    let names: string[];

    try {
      names = await readdir(dir);
    } catch {
      continue;
    }

    for (const name of names) {
      if (seen.has(name)) {
        continue;
      }

      const executablePath = await findCommandPath(name, context);

      if (executablePath === undefined) {
        continue;
      }

      seen.add(name);
      apps.push({
        appId: slugify(name),
        displayName: name,
        command: name,
        executablePath
      });
    }
  }

  return apps;
}

export async function listInstalledLinuxApps(
  input: { query?: string; limit?: number },
  context: LinuxLookupContext = {}
): Promise<{ apps: InstalledAppSummary[]; truncated: boolean }> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const query = input.query?.trim().toLowerCase();
  const byId = new Map<string, InstalledAppSummary>();

  for (const entry of await listDesktopEntries(context)) {
    if (entry.noDisplay) {
      continue;
    }

    const summary: InstalledAppSummary = {
      appId: slugify(entry.appId),
      displayName: entry.displayName,
      desktopEntryPath: entry.desktopEntryPath
    };
    const executablePath = await executableForDesktopEntry(entry, context);

    if (entry.command !== undefined) {
      summary.command = entry.command;
    }

    if (executablePath !== undefined) {
      summary.executablePath = executablePath;
    }

    byId.set(`desktop:${entry.appId}`, summary);
  }

  for (const command of await listPathCommands(context)) {
    byId.set(`command:${command.displayName}`, command);
  }

  let apps = [...byId.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));

  if (query !== undefined && query.length > 0) {
    apps = apps.filter(
      (app) => app.displayName.toLowerCase().includes(query) || app.appId.toLowerCase().includes(query)
    );
  }

  return {
    apps: apps.slice(0, limit),
    truncated: apps.length > limit
  };
}

export async function getLinuxAppStrategy(
  input: { appName: string; taskType?: AppStrategyTaskType },
  policy: PolicyProfile,
  context: LinuxLookupContext = {}
): Promise<AppStrategyResult> {
  const detection = await detectLinuxApp({ appName: input.appName }, policy, context);

  return {
    ...detection,
    taskType: input.taskType ?? "unknown"
  };
}

export async function openLinuxApp(
  input: { appName: string },
  policy: PolicyProfile,
  context: LinuxLookupContext = {}
): Promise<AppOpenResult> {
  const detection = await detectLinuxApp({ appName: input.appName }, policy, context);

  if (!detection.found) {
    return {
      opened: false,
      appId: detection.appId,
      strategy: "guide_only",
      reason: "App was not found; guide mode is recommended."
    };
  }

  const desktopEntry = await findDesktopEntry(input.appName, context);
  const commandArgs =
    desktopEntry?.exec === undefined ? [detection.executablePath ?? input.appName] : parseDesktopExec(desktopEntry.exec);
  const command = commandArgs[0];
  const args = commandArgs.slice(1);

  if (command === undefined) {
    const result: AppOpenResult = {
      opened: false,
      appId: detection.appId,
      strategy: "guide_only",
      reason: "Detected app has no generic command to launch."
    };

    if (detection.displayName !== undefined) {
      result.displayName = detection.displayName;
    }

    return result;
  }

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    shell: false
  });
  child.unref();

  const result: AppOpenResult = {
    opened: true,
    appId: detection.appId,
    strategy: "cli_or_script",
    command: [command, ...args].join(" "),
    reason: "Launched app through a generic Linux command or desktop entry."
  };

  if (detection.displayName !== undefined) {
    result.displayName = detection.displayName;
  }

  if (child.pid !== undefined) {
    result.pid = child.pid;
  }

  return result;
}
