import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import {
  classifyAppSensitivity,
  normalizePathForPolicy,
  redactSensitiveText,
  type DesktopCapabilitiesResult,
  type DesktopCapabilitySupport,
  type DesktopClickResult,
  type DesktopPointerResult,
  type DesktopGetActiveWindowResult,
  type DesktopHotkeyResult,
  type DesktopMouseButton,
  type DesktopScreenshotResult,
  type DesktopSessionType,
  type DesktopTypeTextResult,
  type DesktopWindowBounds,
  type DesktopWindowContext,
  type DesktopWindowSummary,
  type WindowFocusResult,
  type WindowListResult
} from "@agenthost/core";
import { detectLinuxAccessibilitySupport, type LinuxAccessibilityContext } from "./accessibility.js";
import { findCommandPath, type LinuxLookupContext } from "./dependencies.js";
import { runSafeLinuxCommand } from "./shell.js";

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
export interface LinuxDesktopPointerInput { action: "move_mouse" | "scroll" | "double_click" | "right_click" | "drag"; activeWindow: DesktopWindowContext; x?: number; y?: number; direction?: "up" | "down" | "left" | "right"; amount?: number; startX?: number; startY?: number; endX?: number; endY?: number; durationMs?: number; }

export interface LinuxWindowListInput {
  limit?: number;
  includeTitles?: boolean;
}

export interface LinuxWindowFocusInput {
  windowId?: string;
  appName?: string;
  title?: string;
  pid?: number;
}

interface SessionInfo {
  sessionType: DesktopSessionType;
  displayAvailable: boolean;
  backend: string;
}

interface RawWindowSummary extends DesktopWindowSummary {
  title?: string;
}

function sessionInfo(context: LinuxDesktopContext = {}): SessionInfo {
  const env = context.env ?? process.env;
  const raw = (env.XDG_SESSION_TYPE ?? "").trim().toLowerCase();

  if (raw === "x11") {
    return {
      sessionType: "x11",
      displayAvailable: Boolean(env.DISPLAY),
      backend: "x11"
    };
  }

  if (raw === "wayland") {
    return {
      sessionType: "wayland",
      displayAvailable: Boolean(env.WAYLAND_DISPLAY),
      backend: "wayland"
    };
  }

  if (env.DISPLAY !== undefined && env.DISPLAY.length > 0) {
    return {
      sessionType: "x11",
      displayAvailable: true,
      backend: "x11"
    };
  }

  if (env.WAYLAND_DISPLAY !== undefined && env.WAYLAND_DISPLAY.length > 0) {
    return {
      sessionType: "wayland",
      displayAvailable: true,
      backend: "wayland"
    };
  }

  return {
    sessionType: "unknown",
    displayAvailable: false,
    backend: "unavailable"
  };
}

function support(backend: string, reason: string): DesktopCapabilitySupport {
  return {
    supported: true,
    backend,
    reason
  };
}

function unsupported(backend: string, reason: string): DesktopCapabilitySupport {
  return {
    supported: false,
    backend,
    reason
  };
}

function unsupportedResult<T extends { supported: boolean; backend: string; reason: string }>(
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
    maxOutputBytes: 128 * 1024
  };

  if (context.agentHostDir !== undefined) {
    input.cwd = context.agentHostDir;
  }

  return runSafeLinuxCommand(input);
}

function redactTitle(title: string | undefined): string | undefined {
  if (title === undefined) {
    return undefined;
  }

  return trimLine(redactSensitiveText(title));
}

function summarizeWindow(raw: RawWindowSummary, includeTitles: boolean): DesktopWindowSummary {
  const summary: DesktopWindowSummary = {
    windowId: raw.windowId
  };

  if (raw.appName !== undefined) {
    summary.appName = raw.appName;
    summary.appSensitivity = raw.appSensitivity ?? classifyAppSensitivity({ appName: raw.appName });
  }

  if (includeTitles) {
    const title = redactTitle(raw.title);

    if (title !== undefined) {
      summary.title = title;
    }
  }

  if (raw.pid !== undefined) {
    summary.pid = raw.pid;
  }

  if (raw.bounds !== undefined) {
    summary.bounds = raw.bounds;
  }

  return summary;
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

async function detectActiveWindowSupport(context: LinuxDesktopContext = {}): Promise<DesktopCapabilitySupport> {
  const session = sessionInfo(context);

  if (!session.displayAvailable) {
    return unsupported("unavailable", "No Linux desktop display session is available.");
  }

  if (session.sessionType === "wayland") {
    return unsupported("wayland", "Wayland active-window inspection is unavailable with the current safe backends.");
  }

  const xdotoolPath = await findCommandPath("xdotool", context);

  if (xdotoolPath === undefined) {
    return unsupported("unavailable", "Active-window inspection requires xdotool on X11.");
  }

  return support("xdotool", "Active-window inspection is available through xdotool.");
}

async function detectScreenshotSupport(context: LinuxDesktopContext = {}): Promise<DesktopCapabilitySupport> {
  const session = sessionInfo(context);

  if (!session.displayAvailable) {
    return unsupported("unavailable", "No Linux desktop display session is available.");
  }

  const gnomeScreenshotPath = await findCommandPath("gnome-screenshot", context);

  if (gnomeScreenshotPath !== undefined) {
    return support("gnome-screenshot", "Screenshot capture is available through gnome-screenshot.");
  }

  if (session.sessionType === "x11") {
    const scrotPath = await findCommandPath("scrot", context);

    if (scrotPath !== undefined) {
      return support("scrot", "Screenshot capture is available through scrot.");
    }

    const importPath = await findCommandPath("import", context);

    if (importPath !== undefined) {
      return support("imagemagick-import", "Screenshot capture is available through ImageMagick import.");
    }
  }

  return unsupported(session.sessionType === "wayland" ? "wayland" : "unavailable", "No safe screenshot backend is available in this session.");
}

async function detectWindowListSupport(context: LinuxDesktopContext = {}): Promise<DesktopCapabilitySupport> {
  const session = sessionInfo(context);

  if (!session.displayAvailable) {
    return unsupported("unavailable", "No Linux desktop display session is available.");
  }

  if (session.sessionType === "wayland") {
    return unsupported("wayland", "Wayland window listing is unavailable with the current safe backends.");
  }

  const wmctrlPath = await findCommandPath("wmctrl", context);

  if (wmctrlPath === undefined) {
    return unsupported("unavailable", "Window listing requires wmctrl on X11.");
  }

  return support("wmctrl", "Window listing is available through wmctrl.");
}

async function detectWindowFocusSupport(context: LinuxDesktopContext = {}): Promise<DesktopCapabilitySupport> {
  const supportStatus = await detectWindowListSupport(context);

  if (!supportStatus.supported) {
    return supportStatus;
  }

  return support("wmctrl", "Window focus is available through wmctrl.");
}

async function detectGuiInputSupport(context: LinuxDesktopContext = {}): Promise<DesktopCapabilitySupport> {
  const session = sessionInfo(context);

  if (!session.displayAvailable) {
    return unsupported("unavailable", "No Linux desktop display session is available.");
  }

  if (session.sessionType !== "x11") {
    return unsupported(session.backend, "Safe generic GUI input is only supported on X11 in this phase.");
  }

  const xdotoolPath = await findCommandPath("xdotool", context);

  if (xdotoolPath === undefined) {
    return unsupported("unavailable", "Generic GUI input requires xdotool on X11.");
  }

  return support("xdotool", "Generic GUI input is available through xdotool.");
}

export async function getLinuxDesktopCapabilities(
  context: LinuxAccessibilityContext = {}
): Promise<DesktopCapabilitiesResult> {
  const session = sessionInfo(context);
  const [activeWindow, screenshot, windowList, windowFocus, accessibility, guiInput] = await Promise.all([
    detectActiveWindowSupport(context),
    detectScreenshotSupport(context),
    detectWindowListSupport(context),
    detectWindowFocusSupport(context),
    detectLinuxAccessibilitySupport(context),
    detectGuiInputSupport(context)
  ]);

  return {
    platform: "linux",
    sessionType: session.sessionType,
    displayAvailable: session.displayAvailable,
    backend: session.backend,
    activeWindow,
    screenshot,
    windowList,
    windowFocus,
    accessibility,
    guiInput
  };
}

async function activeWindowViaXdotool(
  xdotoolPath: string,
  context: LinuxDesktopContext = {}
): Promise<DesktopGetActiveWindowResult> {
  // One spawn instead of three: xdotool chains subcommands against the window
  // stack, so getactivewindow feeds getwindowpid/getwindowname directly. The
  // numeric pid stays in the middle; the title (which may span lines) is last.
  const combined = await runDesktopCommand(xdotoolPath, ["getactivewindow", "getwindowpid", "getwindowname"], context);
  const lines = combined.stdout.split(/\r?\n/);
  const windowId = (lines[0] ?? "").trim();

  if (combined.exitCode !== 0 || lines.length < 2 || windowId.length === 0) {
    return unsupportedResult("xdotool", "Unable to determine the active window on X11.", {});
  }

  const pidValue = (lines[1] ?? "").trim();
  const pid = /^\d+$/.test(pidValue) ? Number(pidValue) : undefined;
  const appName = pid !== undefined ? await readProcessName(pid) : undefined;
  const title = redactTitle(lines.slice(2).join("\n").trim() || undefined);
  const activeWindow: DesktopWindowContext = {
    windowId
  };

  if (title !== undefined) {
    activeWindow.title = title;
  }

  if (pid !== undefined) {
    activeWindow.pid = pid;
  }

  if (appName !== undefined) {
    activeWindow.appName = appName;
    activeWindow.appSensitivity = classifyAppSensitivity({ appName });
  }

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
  const supportStatus = await detectActiveWindowSupport(context);

  if (!supportStatus.supported) {
    return unsupportedResult(supportStatus.backend, supportStatus.reason, {});
  }

  const xdotoolPath = await findCommandPath("xdotool", context);

  if (xdotoolPath === undefined) {
    return unsupportedResult("unavailable", "Active-window inspection requires xdotool on X11.", {});
  }

  return activeWindowViaXdotool(xdotoolPath, context);
}

export async function getLinuxScreenGeometry(context: LinuxDesktopContext = {}): Promise<{ supported: boolean; bounds?: DesktopWindowBounds; reason: string }> { const xdotool = await findCommandPath("xdotool", context); if (xdotool === undefined) return { supported: false, reason: "Screen geometry requires xdotool on X11." }; const values = resultValues((await runDesktopCommand(xdotool, ["getdisplaygeometry"], context)).stdout); const width = values[0], height = values[1]; if (width === undefined || height === undefined || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return { supported: false, reason: "Unable to read X11 display geometry." }; return { supported: true, bounds: { x: 0, y: 0, width, height }, reason: "Read X11 display geometry." }; }
function resultValues(value: string): number[] { return value.trim().split(/\s+/).map(Number); }
export async function getLinuxActiveWindowBounds(context: LinuxDesktopContext = {}): Promise<{ supported: boolean; bounds?: DesktopWindowBounds; reason: string }> { const xdotool = await findCommandPath("xdotool", context); if (xdotool === undefined) return { supported: false, reason: "Window geometry requires xdotool on X11." }; const id = (await runDesktopCommand(xdotool, ["getactivewindow"], context)).stdout.trim(); if (!id) return { supported: false, reason: "No active window." }; const result = await runDesktopCommand(xdotool, ["getwindowgeometry", "--shell", id], context); const values = Object.fromEntries(result.stdout.trim().split(/\r?\n/).map((line) => line.split("=", 2)).filter(([key, value]) => key !== undefined && value !== undefined)); const x = Number(values.X), y = Number(values.Y), width = Number(values.WIDTH), height = Number(values.HEIGHT); return [x,y,width,height].every(Number.isInteger) && width > 0 && height > 0 ? { supported: true, bounds: { x, y, width, height }, reason: "Read active X11 window geometry." } : { supported: false, reason: "Unable to read active window geometry." }; }

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
  const supportStatus = await detectScreenshotSupport(context);

  if (!supportStatus.supported) {
    return unsupportedResult(supportStatus.backend, supportStatus.reason, {});
  }

  if (supportStatus.backend === "gnome-screenshot") {
    const command = await findCommandPath("gnome-screenshot", context);

    if (command === undefined) {
      return unsupportedResult("unavailable", "gnome-screenshot is no longer available on PATH.", {});
    }

    const args = input.includeActiveWindowOnly ? ["-w", "-f", outputPath] : ["-f", outputPath];
    return runAndValidateScreenshot("gnome-screenshot", command, args, outputPath, undefined, context);
  }

  if (supportStatus.backend === "scrot") {
    const scrotPath = await findCommandPath("scrot", context);

    if (scrotPath === undefined) {
      return unsupportedResult("unavailable", "scrot is no longer available on PATH.", {});
    }

    const activeWindow = input.includeActiveWindowOnly ? await getLinuxActiveWindow(context) : undefined;

    if (input.includeActiveWindowOnly && (activeWindow?.supported !== true || activeWindow.activeWindow === undefined)) {
      return unsupportedResult("scrot", "Active-window screenshots require active-window inspection support.", {});
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

  if (importPath === undefined) {
    return unsupportedResult("unavailable", "ImageMagick import is no longer available on PATH.", {});
  }

  let activeWindow: DesktopWindowContext | undefined;
  let args = ["-window", "root", outputPath];

  if (input.includeActiveWindowOnly) {
    const activeWindowResult = await getLinuxActiveWindow(context);

    if (!activeWindowResult.supported || activeWindowResult.activeWindow?.windowId === undefined) {
      return unsupportedResult(
        "imagemagick-import",
        "Active-window screenshots require active-window inspection support.",
        {}
      );
    }

    activeWindow = activeWindowResult.activeWindow;
    args = ["-window", activeWindowResult.activeWindow.windowId, outputPath];
  }

  return runAndValidateScreenshot("imagemagick-import", importPath, args, outputPath, activeWindow, context);
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
  const supportStatus = await detectGuiInputSupport(context);

  if (!supportStatus.supported) {
    return { ok: false, backend: supportStatus.backend, reason: supportStatus.reason };
  }

  const xdotoolPath = await findCommandPath("xdotool", context);

  if (xdotoolPath === undefined) {
    return { ok: false, backend: "unavailable", reason: "Generic GUI input requires xdotool on X11." };
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

/**
 * xdotool expects a hotkey chord as one key-sequence argument, for example
 * `ctrl+l`. Passing the keys as separate arguments (`CTRL`, `L`) releases the
 * modifier before sending the letter, which turns Ctrl+L into a literal L.
 */
export function xdotoolHotkeyArguments(keys: string[]): string[] {
  return ["key", keys.join("+")];
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

  const result = await runDesktopCommand(verification.xdotoolPath, xdotoolHotkeyArguments(input.keys), context);

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

  const result = await runDesktopCommand(verification.xdotoolPath, ["type", "--delay", "1", "--", input.text], context);

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

async function x11Geometry(xdotoolPath: string, context: LinuxDesktopContext): Promise<{ width: number; height: number } | undefined> {
  const result = await runDesktopCommand(xdotoolPath, ["getdisplaygeometry"], context);
  const [width, height] = result.stdout.trim().split(/\s+/).map(Number);
  return width !== undefined && height !== undefined && Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 ? { width, height } : undefined;
}

function inside(x: number, y: number, geometry: { width: number; height: number }): boolean { return x >= 0 && y >= 0 && x < geometry.width && y < geometry.height; }

export async function performLinuxPointerAction(input: LinuxDesktopPointerInput, context: LinuxDesktopContext = {}): Promise<DesktopPointerResult> {
  const verification = await verifyX11ActionContext(input.activeWindow, context);
  if (!verification.ok) return { supported: false, backend: verification.backend, performed: false, action: input.action, activeWindow: input.activeWindow, reason: verification.reason };
  const geometry = await x11Geometry(verification.xdotoolPath, context);
  if (geometry === undefined) return { supported: false, backend: verification.backend, performed: false, action: input.action, activeWindow: verification.activeWindow, reason: "Unable to determine safe X11 screen bounds." };
  const points = input.action === "drag" ? [[input.startX, input.startY], [input.endX, input.endY]] : input.x === undefined ? [] : [[input.x, input.y]];
  if (points.some(([x, y]) => x === undefined || y === undefined || !inside(x, y, geometry))) return { supported: false, backend: verification.backend, performed: false, action: input.action, activeWindow: verification.activeWindow, reason: "Pointer coordinates are outside safe X11 screen bounds." };
  let args: string[];
  if (input.action === "move_mouse") args = ["mousemove", "--sync", String(input.x), String(input.y)];
  else if (input.action === "scroll") { const button = input.direction === "up" ? "4" : input.direction === "down" ? "5" : input.direction === "left" ? "6" : "7"; args = ["click", "--repeat", String(input.amount), button]; }
  else if (input.action === "double_click") args = input.x === undefined ? ["click", "--repeat", "2", "--delay", "100", "1"] : ["mousemove", "--sync", String(input.x), String(input.y), "click", "--repeat", "2", "--delay", "100", "1"];
  else if (input.action === "right_click") args = input.x === undefined ? ["click", "3"] : ["mousemove", "--sync", String(input.x), String(input.y), "click", "3"];
  else args = ["mousemove", "--sync", String(input.startX), String(input.startY), "mousedown", "1", "mousemove", "--sync", String(input.endX), String(input.endY), "mouseup", "1"];
  const result = await runDesktopCommand(verification.xdotoolPath, args, context);
  return { supported: result.exitCode === 0, backend: verification.backend, performed: result.exitCode === 0, action: input.action, activeWindow: verification.activeWindow, reason: result.exitCode === 0 ? "Performed bounded X11 pointer action." : "Pointer backend did not complete successfully." };
}

function parseWmctrlLine(line: string): RawWindowSummary | undefined {
  const match = line.match(/^(\S+)\s+\S+\s+(\d+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+\S+\s*(.*)$/);

  if (match === null) {
    return undefined;
  }

  const windowId = match[1] ?? "";
  const pidRaw = match[2];
  const xRaw = match[3];
  const yRaw = match[4];
  const widthRaw = match[5];
  const heightRaw = match[6];
  const titleRaw = match[7] ?? "";
  const pid = Number(pidRaw);
  const x = Number(xRaw);
  const y = Number(yRaw);
  const width = Number(widthRaw);
  const height = Number(heightRaw);
  const title = trimLine(titleRaw);

  return {
    windowId,
    ...(Number.isFinite(pid) && pid > 0 ? { pid } : {}),
    ...(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(width) && Number.isFinite(height)
      ? {
          bounds: {
            x,
            y,
            width,
            height
          }
        }
      : {}),
    ...(title === undefined ? {} : { title })
  };
}

const WINDOW_LIST_CACHE_TTL_MS = 2_000;
const windowListCache = new Map<string, { at: number; windows: RawWindowSummary[] }>();

export function clearWindowListCache(): void {
  windowListCache.clear();
}

async function listRawWindows(context: LinuxDesktopContext = {}): Promise<  | { supported: false; backend: string; reason: string }
  | { supported: true; backend: string; windows: RawWindowSummary[]; reason: string }
> {
  const supportStatus = await detectWindowListSupport(context);

  if (!supportStatus.supported) {
    return {
      supported: false,
      backend: supportStatus.backend,
      reason: supportStatus.reason
    };
  }

  // Window enumeration spawns wmctrl plus one /proc read per window. Cache the
  // raw listing briefly: focus-by-name and observe flows poll it in bursts,
  // and a 2s window keeps app switching snappy without going stale.
  const cacheKey = (context.env?.DISPLAY ?? process.env.DISPLAY ?? "") + "\0" + (context.env?.XAUTHORITY ?? process.env.XAUTHORITY ?? "");
  const cached = windowListCache.get(cacheKey);

  if (cached !== undefined && Date.now() - cached.at < WINDOW_LIST_CACHE_TTL_MS) {
    return {
      supported: true,
      backend: "wmctrl",
      windows: cached.windows,
      reason: "Listed visible X11 windows through wmctrl."
    };
  }

  const wmctrlPath = await findCommandPath("wmctrl", context);

  if (wmctrlPath === undefined) {
    return {
      supported: false,
      backend: "unavailable",
      reason: "Window listing requires wmctrl on X11."
    };
  }

  const result = await runDesktopCommand(wmctrlPath, ["-lpG"], context);

  if (result.exitCode !== 0) {
    return {
      supported: false,
      backend: "wmctrl",
      reason: "wmctrl did not return a window list."
    };
  }

  const windows: RawWindowSummary[] = [];

  for (const line of result.stdout.split(/\r?\n/)) {
    const parsed = parseWmctrlLine(line);

    if (parsed === undefined) {
      continue;
    }

    if (parsed.pid !== undefined) {
      const appName = await readProcessName(parsed.pid);

      if (appName !== undefined) {
        parsed.appName = appName;
        parsed.appSensitivity = classifyAppSensitivity({ appName });
      }
    }

    windows.push(parsed);
  }

  windowListCache.set(cacheKey, { at: Date.now(), windows });

  return {
    supported: true,
    backend: "wmctrl",
    windows,
    reason: "Listed visible X11 windows through wmctrl."
  };
}

export async function listLinuxWindows(
  input: LinuxWindowListInput = {},
  context: LinuxDesktopContext = {}
): Promise<WindowListResult> {
  const rawResult = await listRawWindows(context);

  if (!rawResult.supported) {
    return {
      supported: false,
      backend: rawResult.backend,
      windows: [],
      truncated: false,
      reason: rawResult.reason
    };
  }

  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const includeTitles = input.includeTitles ?? false;
  const windows = rawResult.windows.slice(0, limit).map((window) => summarizeWindow(window, includeTitles));

  return {
    supported: true,
    backend: rawResult.backend,
    windows,
    truncated: rawResult.windows.length > limit,
    reason: rawResult.reason
  };
}

function matchesWindowIdentity(window: RawWindowSummary, input: LinuxWindowFocusInput): boolean {
  if (input.windowId !== undefined && window.windowId !== input.windowId) {
    return false;
  }

  if (input.pid !== undefined && window.pid !== input.pid) {
    return false;
  }

  if (input.appName !== undefined && window.appName?.toLowerCase() !== input.appName.toLowerCase()) {
    return false;
  }

  if (input.title !== undefined && window.title?.toLowerCase() !== input.title.toLowerCase()) {
    return false;
  }

  return true;
}

export async function focusLinuxWindow(
  input: LinuxWindowFocusInput,
  context: LinuxDesktopContext = {}
): Promise<WindowFocusResult> {
  const requestedWindow: DesktopWindowContext = {};

  if (input.windowId !== undefined) {
    requestedWindow.windowId = input.windowId;
  }

  if (input.appName !== undefined) {
    requestedWindow.appName = input.appName;
  }

  if (input.title !== undefined) {
    requestedWindow.title = redactTitle(input.title) ?? input.title;
  }

  if (input.pid !== undefined) {
    requestedWindow.pid = input.pid;
  }

  // Fast path: a windowId is already unique. Activating it directly skips the
  // full wmctrl listing plus one /proc read per window, which is the
  // dominant cost of app switching. wmctrl itself fails on unknown ids.
  if (input.windowId !== undefined && input.appName === undefined && input.title === undefined && input.pid === undefined) {
    const focusSupport = await detectWindowFocusSupport(context);
    if (!focusSupport.supported) {
      return { supported: false, backend: focusSupport.backend, focused: false, window: requestedWindow, reason: focusSupport.reason };
    }
    const directPath = await findCommandPath("wmctrl", context);
    if (directPath === undefined) {
      return { supported: false, backend: "unavailable", focused: false, window: requestedWindow, reason: "Window focus requires wmctrl on X11." };
    }
    const direct = await runDesktopCommand(directPath, ["-i", "-a", input.windowId], context);
    return {
      supported: true,
      backend: "wmctrl",
      focused: direct.exitCode === 0,
      window: summarizeWindow({ windowId: input.windowId }, true),
      reason: direct.exitCode === 0 ? "Focused the requested X11 window through wmctrl." : "wmctrl could not focus the requested window."
    };
  }

  const rawResult = await listRawWindows(context);

  if (!rawResult.supported) {
    return {
      supported: false,
      backend: rawResult.backend,
      focused: false,
      window: requestedWindow,
      reason: rawResult.reason
    };
  }

  const matches = rawResult.windows.filter((window) => matchesWindowIdentity(window, input));

  if (matches.length === 0) {
    return {
      supported: true,
      backend: rawResult.backend,
      focused: false,
      window: requestedWindow,
      reason: "No visible window matched the requested identity."
    };
  }

  if (matches.length > 1) {
    return {
      supported: true,
      backend: rawResult.backend,
      focused: false,
      window: requestedWindow,
      reason: "The requested window identity matched multiple visible windows."
    };
  }

  const wmctrlPath = await findCommandPath("wmctrl", context);

  if (wmctrlPath === undefined) {
    return {
      supported: false,
      backend: "unavailable",
      focused: false,
      window: requestedWindow,
      reason: "Window focus requires wmctrl on X11."
    };
  }

  const target = matches[0];

  if (target === undefined) {
    return {
      supported: true,
      backend: rawResult.backend,
      focused: false,
      window: requestedWindow,
      reason: "No visible window matched the requested identity."
    };
  }

  const result = await runDesktopCommand(wmctrlPath, ["-i", "-a", target.windowId], context);
  const summarized = summarizeWindow(target, true);

  return {
    supported: true,
    backend: "wmctrl",
    focused: result.exitCode === 0,
    window: summarized,
    reason: result.exitCode === 0 ? "Focused the requested X11 window through wmctrl." : "wmctrl could not focus the requested window."
  };
}
