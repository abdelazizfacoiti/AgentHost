import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import {
  classifyAppSensitivity,
  normalizePathForPolicy,
  type DesktopClickResult,
  type DesktopGetActiveWindowResult,
  type DesktopHotkeyResult,
  type DesktopMouseButton,
  type DesktopScreenshotResult,
  type DesktopTypeTextResult,
  type DesktopWindowContext
} from "@agenthost/core";
import { findCommandPath, type LinuxLookupContext } from "./dependencies.js";
import { runSafeLinuxCommand } from "./shell.js";

type DesktopSessionType = "x11" | "wayland" | "unknown";

export interface LinuxDesktopContext extends LinuxLookupContext {
  agentHostDir?: string;
}

export interface LinuxDesktopScreenshotInput {
  path: string;
  includeActiveWindowOnly?: boolean;
}

export interface LinuxDesktopHotkeyInput {
  keys: string[];
  activeWindow: DesktopWindowContext;
}

export interface LinuxDesktopTypeTextInput {
  text: string;
  activeWindow: DesktopWindowContext;
}

export interface LinuxDesktopClickInput {
  x: number;
  y: number;
  button?: DesktopMouseButton;
  activeWindow: DesktopWindowContext;
}

interface SessionInfo {
  sessionType: DesktopSessionType;
  hasDisplay: boolean;
}

function sessionInfo(context: LinuxDesktopContext = {}): SessionInfo {
  const env = context.env ?? process.env;
  const raw = (env.XDG_SESSION_TYPE ?? "").trim().toLowerCase();

  if (raw === "x11") {
    return { sessionType: "x11", hasDisplay: Boolean(env.DISPLAY) };
  }

  if (raw === "wayland") {
    return { sessionType: "wayland", hasDisplay: Boolean(env.WAYLAND_DISPLAY) };
  }

  if (env.DISPLAY !== undefined && env.DISPLAY.length > 0) {
    return { sessionType: "x11", hasDisplay: true };
  }

  if (env.WAYLAND_DISPLAY !== undefined && env.WAYLAND_DISPLAY.length > 0) {
    return { sessionType: "wayland", hasDisplay: true };
  }

  return { sessionType: "unknown", hasDisplay: false };
}

function unsupported<T extends { supported: boolean; backend: string; reason: string }>(
  backend: string,
  reason: string,
  extra: Omit<T, "supported" | "backend" | "reason">
): T {
  return {
    ...extra,
    supported: false,
    backend,
    reason
  } as T;
}

function trimLine(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function statBytes(filePath: string): Promise<number | undefined> {
  try {
    const stats = await lstat(filePath);
    return stats.isFile() ? stats.size : undefined;
  } catch {
    return undefined;
  }
}

async function readProcessName(pid: number): Promise<string | undefined> {
  try {
    return trimLine(await readFile(path.join("/proc", String(pid), "comm"), "utf8"));
  } catch {
    return undefined;
  }
}

async function runDesktopCommand(
  command: string,
  args: string[],
  context: LinuxDesktopContext = {}
): Promise<Awaited<ReturnType<typeof runSafeLinuxCommand>>> {
  const input: {
    command: string;
    args: string[];
    timeoutMs: number;
    maxOutputBytes: number;
    cwd?: string;
  } = {
    command,
    args,
    timeoutMs: 5_000,
    maxOutputBytes: 32 * 1024
  };

  if (context.agentHostDir !== undefined) {
    input.cwd = context.agentHostDir;
  }

  return runSafeLinuxCommand(input);
}

function contextMatches(current: DesktopWindowContext | undefined, expected: DesktopWindowContext): boolean {
  if (current === undefined) {
    return false;
  }

  if (expected.windowId !== undefined && current.windowId !== expected.windowId) {
    return false;
  }

  if (expected.pid !== undefined && current.pid !== expected.pid) {
    return false;
  }

  if (expected.appName !== undefined && current.appName !== expected.appName) {
    return false;
  }

  if (expected.title !== undefined && current.title !== expected.title) {
    return false;
  }

  return true;
}

async function activeWindowViaXdotool(
  xdotoolPath: string,
  context: LinuxDesktopContext = {}
): Promise<DesktopGetActiveWindowResult> {
  const idResult = await runDesktopCommand(xdotoolPath, ["getactivewindow"], context);
  const windowId = trimLine(idResult.stdout);

  if (idResult.exitCode !== 0 || windowId === undefined) {
    return unsupported("xdotool", "Unable to determine the active window on X11.", {});
  }

  const titleResult = await runDesktopCommand(xdotoolPath, ["getwindowname", windowId], context);
  const pidResult = await runDesktopCommand(xdotoolPath, ["getwindowpid", windowId], context);
  const pidValue = trimLine(pidResult.stdout);
  const pid = pidValue !== undefined && /^\d+$/.test(pidValue) ? Number(pidValue) : undefined;
  const appName = pid !== undefined ? await readProcessName(pid) : undefined;
  const title = trimLine(titleResult.stdout);
  const activeWindow: DesktopWindowContext = {
    windowId,
    ...(title === undefined ? {} : { title }),
    ...(pid === undefined ? {} : { pid }),
    ...(appName === undefined ? {} : { appName, appSensitivity: classifyAppSensitivity({ appName }) })
  };

  return {
    supported: true,
    backend: "xdotool",
    activeWindow,
    reason: "Read the active X11 window through xdotool."
  };
}

export async function getLinuxActiveWindow(
  context: LinuxDesktopContext = {}
): Promise<DesktopGetActiveWindowResult> {
  const session = sessionInfo(context);

  if (!session.hasDisplay) {
    return unsupported("unavailable", "No Linux desktop display session is available.", {});
  }

  if (session.sessionType === "wayland") {
    return unsupported("wayland", "Wayland active-window inspection is unavailable with the current safe backends.", {});
  }

  const xdotoolPath = await findCommandPath("xdotool", context);

  if (xdotoolPath === undefined) {
    return unsupported("unavailable", "Active-window inspection requires xdotool on X11.", {});
  }

  return activeWindowViaXdotool(xdotoolPath, context);
}

async function runAndValidateScreenshot(
  backend: string,
  command: string,
  args: string[],
  outputPath: string,
  activeWindow: DesktopWindowContext | undefined,
  context: LinuxDesktopContext = {}
): Promise<DesktopScreenshotResult> {
  const result = await runDesktopCommand(command, args, context);
  const bytesWritten = await statBytes(outputPath);

  if (result.exitCode !== 0 || bytesWritten === undefined) {
    return {
      supported: false,
      backend,
      ...(activeWindow === undefined ? {} : { activeWindow }),
      reason: "The screenshot backend did not produce an image file."
    };
  }

  return {
    supported: true,
    backend,
    path: outputPath,
    bytesWritten,
    ...(activeWindow === undefined ? {} : { activeWindow }),
    reason: "Captured a desktop screenshot locally."
  };
}

export async function captureLinuxScreenshot(
  input: LinuxDesktopScreenshotInput,
  context: LinuxDesktopContext = {}
): Promise<DesktopScreenshotResult> {
  const outputPath = normalizePathForPolicy(
    input.path,
    context.agentHostDir === undefined ? {} : { agentHostDir: context.agentHostDir }
  );
  const session = sessionInfo(context);

  if (!session.hasDisplay) {
    return unsupported("unavailable", "No Linux desktop display session is available.", {});
  }

  const gnomeScreenshotPath = await findCommandPath("gnome-screenshot", context);

  if (gnomeScreenshotPath !== undefined) {
    const args = input.includeActiveWindowOnly ? ["-w", "-f", outputPath] : ["-f", outputPath];
    return runAndValidateScreenshot("gnome-screenshot", gnomeScreenshotPath, args, outputPath, undefined, context);
  }

  if (session.sessionType !== "x11") {
    return unsupported("wayland", "No safe screenshot backend is available for this Wayland session.", {});
  }

  const scrotPath = await findCommandPath("scrot", context);

  if (scrotPath !== undefined) {
    const activeWindow = input.includeActiveWindowOnly ? await getLinuxActiveWindow(context) : undefined;

    if (input.includeActiveWindowOnly && (activeWindow?.supported !== true || activeWindow.activeWindow === undefined)) {
      return unsupported(
        "scrot",
        "Active-window screenshots require active-window inspection support.",
        {}
      );
    }

    const args = input.includeActiveWindowOnly ? ["-u", outputPath] : [outputPath];
    return runAndValidateScreenshot(
      "scrot",
      scrotPath,
      args,
      outputPath,
      activeWindow?.supported ? activeWindow.activeWindow : undefined,
      context
    );
  }

  const importPath = await findCommandPath("import", context);

  if (importPath !== undefined) {
    let activeWindow: DesktopWindowContext | undefined;
    let args = ["-window", "root", outputPath];

    if (input.includeActiveWindowOnly) {
      const activeWindowResult = await getLinuxActiveWindow(context);

      if (!activeWindowResult.supported || activeWindowResult.activeWindow?.windowId === undefined) {
        return unsupported(
          "imagemagick-import",
          "Active-window screenshots require active-window inspection support.",
          {}
        );
      }

      activeWindow = activeWindowResult.activeWindow;
      const windowId = activeWindowResult.activeWindow.windowId;
      args = ["-window", windowId, outputPath];
    }

    return runAndValidateScreenshot("imagemagick-import", importPath, args, outputPath, activeWindow, context);
  }

  return unsupported(
    "unavailable",
    "No supported screenshot backend is installed. Checked gnome-screenshot, scrot, and ImageMagick import.",
    {}
  );
}

function xdotoolButton(button: DesktopMouseButton): string {
  switch (button) {
    case "left":
      return "1";
    case "middle":
      return "2";
    case "right":
      return "3";
  }
}

async function verifyX11ActionContext(
  expected: DesktopWindowContext,
  context: LinuxDesktopContext = {}
): Promise<
  | { ok: false; backend: string; reason: string }
  | { ok: true; backend: string; xdotoolPath: string; activeWindow: DesktopWindowContext }
> {
  const session = sessionInfo(context);

  if (!session.hasDisplay) {
    return { ok: false, backend: "unavailable", reason: "No Linux desktop display session is available." };
  }

  if (session.sessionType !== "x11") {
    return {
      ok: false,
      backend: session.sessionType,
      reason: "Safe generic GUI control is only supported on X11 in this phase."
    };
  }

  const xdotoolPath = await findCommandPath("xdotool", context);

  if (xdotoolPath === undefined) {
    return { ok: false, backend: "unavailable", reason: "Generic GUI control requires xdotool on X11." };
  }

  const current = await activeWindowViaXdotool(xdotoolPath, context);

  if (!current.supported || current.activeWindow === undefined) {
    return { ok: false, backend: "xdotool", reason: "Unable to verify the current active window." };
  }

  if (!contextMatches(current.activeWindow, expected)) {
    return { ok: false, backend: "xdotool", reason: "The active window no longer matches the required context." };
  }

  return {
    ok: true,
    backend: "xdotool",
    xdotoolPath,
    activeWindow: current.activeWindow
  };
}

export async function sendLinuxHotkey(
  input: LinuxDesktopHotkeyInput,
  context: LinuxDesktopContext = {}
): Promise<DesktopHotkeyResult> {
  const verification = await verifyX11ActionContext(input.activeWindow, context);

  if (!verification.ok) {
    return {
      supported: false,
      backend: verification.backend,
      sent: false,
      keys: input.keys,
      activeWindow: input.activeWindow,
      reason: verification.reason
    };
  }

  const result = await runDesktopCommand(verification.xdotoolPath, ["key", ...input.keys], context);

  return {
    supported: result.exitCode === 0,
    backend: verification.backend,
    sent: result.exitCode === 0,
    keys: input.keys,
    activeWindow: verification.activeWindow,
    reason: result.exitCode === 0 ? "Sent a hotkey to the active X11 window." : "The hotkey backend did not complete successfully."
  };
}

export async function typeLinuxText(
  input: LinuxDesktopTypeTextInput,
  context: LinuxDesktopContext = {}
): Promise<DesktopTypeTextResult> {
  const verification = await verifyX11ActionContext(input.activeWindow, context);

  if (!verification.ok) {
    return {
      supported: false,
      backend: verification.backend,
      typed: false,
      characterCount: input.text.length,
      activeWindow: input.activeWindow,
      reason: verification.reason
    };
  }

  const result = await runDesktopCommand(
    verification.xdotoolPath,
    ["type", "--delay", "1", "--", input.text],
    context
  );

  return {
    supported: result.exitCode === 0,
    backend: verification.backend,
    typed: result.exitCode === 0,
    characterCount: input.text.length,
    activeWindow: verification.activeWindow,
    reason: result.exitCode === 0 ? "Typed text into the active X11 window." : "The type-text backend did not complete successfully."
  };
}

export async function clickLinuxDesktop(
  input: LinuxDesktopClickInput,
  context: LinuxDesktopContext = {}
): Promise<DesktopClickResult> {
  const verification = await verifyX11ActionContext(input.activeWindow, context);
  const button = input.button ?? "left";

  if (!verification.ok) {
    return {
      supported: false,
      backend: verification.backend,
      clicked: false,
      x: input.x,
      y: input.y,
      button,
      activeWindow: input.activeWindow,
      reason: verification.reason
    };
  }

  const result = await runDesktopCommand(
    verification.xdotoolPath,
    ["mousemove", "--sync", String(input.x), String(input.y), "click", xdotoolButton(button)],
    context
  );

  return {
    supported: result.exitCode === 0,
    backend: verification.backend,
    clicked: result.exitCode === 0,
    x: input.x,
    y: input.y,
    button,
    activeWindow: verification.activeWindow,
    reason: result.exitCode === 0 ? "Clicked the active X11 window at the requested coordinates." : "The click backend did not complete successfully."
  };
}
