import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DesktopWindowSummary } from "@agenthost/core";
import { findCommandPath } from "./dependencies.js";
import { focusLinuxWindow, getLinuxActiveWindow, listLinuxWindows, type LinuxDesktopContext } from "./desktop.js";
import { runSafeLinuxCommand } from "./shell.js";

/*
 * The "host window" is the terminal or IDE window running the agent client
 * (Claude Code, Codex, opencode, ...). It is found by walking the process tree
 * from a process the client spawned (the MCP server, or a hook command) up to
 * an ancestor that owns an X11 window, e.g. gnome-terminal-server or code.
 */

const MAX_ANCESTORS = 40;

export interface HostWindowContext extends LinuxDesktopContext {
  procRoot?: string;
}

export async function readParentPid(pid: number, procRoot = "/proc"): Promise<number | undefined> {
  try {
    const stat = await readFile(path.join(procRoot, String(pid), "stat"), "utf8");
    // The command name is parenthesised and may contain spaces or ')', so parse after the last ')'.
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const parent = Number(fields[1]);
    return Number.isInteger(parent) && parent > 0 ? parent : undefined;
  } catch {
    return undefined;
  }
}

export async function ancestorPids(pid: number, procRoot = "/proc"): Promise<number[]> {
  const chain: number[] = [];
  let current: number | undefined = pid;
  while (current !== undefined && current > 1 && chain.length < MAX_ANCESTORS && !chain.includes(current)) {
    chain.push(current);
    current = await readParentPid(current, procRoot);
  }
  return chain;
}

/**
 * Picks the window owned by the nearest ancestor. A terminal server often owns
 * several windows; the active one wins when it matches (the user was typing to
 * the agent), otherwise the first listed one.
 */
export function selectHostWindow(
  chain: number[],
  windows: DesktopWindowSummary[],
  activeWindowId?: string
): DesktopWindowSummary | undefined {
  for (const pid of chain) {
    const owned = windows.filter((window) => window.pid === pid);
    if (owned.length === 0) continue;
    return owned.find((window) => window.windowId === activeWindowId) ?? owned[0];
  }
  return undefined;
}

export async function findHostWindow(startPid: number, context: HostWindowContext = {}): Promise<DesktopWindowSummary | undefined> {
  const env = context.env ?? process.env;
  const [chain, listing, active] = await Promise.all([
    ancestorPids(startPid, context.procRoot),
    listLinuxWindows({ limit: 100, includeTitles: true }, context).catch(() => undefined),
    getLinuxActiveWindow(context).catch(() => undefined)
  ]);
  const windows = listing?.windows ?? [];
  const declared = env.WINDOWID === undefined ? undefined : windows.find((window) => Number(window.windowId) === Number(env.WINDOWID));
  return declared ?? selectHostWindow(chain, windows, active?.activeWindow?.windowId);
}

export interface RaiseResult {
  raised: boolean;
  method: "focus" | "demands_attention" | "none";
  reason: string;
}

/**
 * Brings a window to the front. Window managers with focus-stealing prevention
 * may refuse a background process; the window is then flagged urgent so the
 * taskbar/dock highlights it instead.
 */
export async function raiseLinuxWindow(windowId: string, context: LinuxDesktopContext = {}): Promise<RaiseResult> {
  const focused = await focusLinuxWindow({ windowId }, context).catch(() => undefined);
  if (focused?.focused === true) return { raised: true, method: "focus", reason: "Raised and focused the window." };
  const wmctrl = await findCommandPath("wmctrl", context);
  if (wmctrl === undefined) return { raised: false, method: "none", reason: "The window manager refused focus and wmctrl is unavailable." };
  const urgent = await runSafeLinuxCommand({ command: wmctrl, args: ["-i", "-r", windowId, "-b", "add,demands_attention"], timeoutMs: 2_000 });
  return urgent.exitCode === 0
    ? { raised: false, method: "demands_attention", reason: "The window manager refused focus; flagged the window as needing attention." }
    : { raised: false, method: "none", reason: "Could not raise or flag the window." };
}
