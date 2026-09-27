import { spawn } from "node:child_process";
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

/**
 * Canonical window-id form is the decimal string. xdotool prints decimal
 * ids while wmctrl prints `0x...` hex for the same window; comparing or
 * echoing raw values across backends never matches, so hex is folded to
 * decimal at every boundary. `wmctrl -i -a` accepts decimal ids.
 */
function normalizeWindowId(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
    return String(parseInt(trimmed, 16));
  }
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

  const currentId = normalizeWindowId(current.windowId);
  const expectedId = normalizeWindowId(expected.windowId);
  if (expectedId !== undefined && currentId !== expectedId) {
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
  // getactivewindow only seeds the window stack when chained and prints
  // nothing, so the wid needs its own spawn: a chained
  // `getactivewindow getwindowpid getwindowname` yields `pid/title` and the
  // pid is then misread as the window id. pid+title share a second spawn
  // with an explicit wid (both print reliably with explicit args).
  const widResult = await runDesktopCommand(xdotoolPath, ["getactivewindow"], context);
  const windowId = normalizeWindowId(widResult.stdout.split(/\r?\n/)[0] ?? "");

  if (widResult.exitCode !== 0 || windowId === undefined) {
    return unsupportedResult("xdotool", "Unable to determine the active window on X11.", {});
  }

  const rest = await runDesktopCommand(xdotoolPath, ["getwindowpid", windowId, "getwindowname", windowId], context);
  const lines = rest.stdout.split(/\r?\n/);
  const pidValue = (lines[0] ?? "").trim();
  const pid = /^\d+$/.test(pidValue) ? Number(pidValue) : undefined;
  const appName = pid !== undefined ? await readProcessName(pid) : undefined;
  const title = redactTitle(lines.slice(1).join("\n").trim() || undefined);
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

export type TypingMethod = "direct" | "clipboard";

/**
 * xdotool `type` maps keysyms through the active layout: letters, digits and
 * space are safe, but layout-dependent characters (`:/#` and other AltGr or
 * dead-key characters on AZERTY) mistype. Those go through clipboard paste,
 * which is layout-independent.
 */
export function describeTypingStrategy(text: string): TypingMethod {
  return /^[A-Za-z0-9 ]*$/.test(text) ? "direct" : "clipboard";
}

async function feedClipboard(command: string, args: string[], text: string, context: LinuxDesktopContext): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { env: context.env ?? process.env });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* best effort */ }
      resolve(false);
    }, 5_000);
    child.on("error", () => { clearTimeout(timer); resolve(false); });
    child.on("close", (code) => { clearTimeout(timer); resolve(code === 0); });
    try {
      if (child.stdin === null) {
        clearTimeout(timer);
        resolve(false);
        return;
      }
      child.stdin.write(text);
      child.stdin.end();
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
}

async function pasteViaClipboard(
  xdotoolPath: string,
  text: string,
  context: LinuxDesktopContext
): Promise<{ ok: boolean; reason: string }> {
  const xclip = await findCommandPath("xclip", context);
  const xsel = xclip === undefined ? await findCommandPath("xsel", context) : undefined;
  if (xclip === undefined && xsel === undefined) {
    return { ok: false, reason: "Layout-unsafe characters require a clipboard backend; install xclip or xsel for non-ASCII typing." };
  }
  const fed = xclip !== undefined
    ? await feedClipboard(xclip, ["-selection", "clipboard", "-i"], text, context)
    : await feedClipboard(xsel!, ["--clipboard", "--input"], text, context);
  if (!fed) return { ok: false, reason: "The clipboard backend did not accept the text." };
  const paste = await runDesktopCommand(xdotoolPath, ["key", "ctrl+v"], context);
  return paste.exitCode === 0
    ? { ok: true, reason: "Pasted text via the clipboard (layout-independent); window clipboard now holds the typed text." }
    : { ok: false, reason: "The clipboard paste hotkey did not complete successfully." };
}

/** Best-effort read of the currently active window id for focus restoration. */
async function previousActiveWindowId(
  xdotoolPath: string | undefined,
  context: LinuxDesktopContext
): Promise<string | undefined> {
  if (xdotoolPath === undefined) return undefined;
  try {
    const id = normalizeWindowId((await runDesktopCommand(xdotoolPath, ["getactivewindow"], context)).stdout.trim());
    return id !== undefined && /^[0-9]+$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
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
  const method = describeTypingStrategy(input.text);
  const verification = await verifyX11ActionContext(input.activeWindow, context);

  if (!verification.ok) {
    return {
      supported: false,
      backend: verification.backend,
      typed: false,
      characterCount: input.text.length,
      activeWindow: input.activeWindow,
      method,
      reason: verification.reason
    };
  }

  if (method === "clipboard") {
    const paste = await pasteViaClipboard(verification.xdotoolPath, input.text, context);
    return {
      supported: paste.ok,
      backend: verification.backend,
      typed: paste.ok,
      characterCount: input.text.length,
      activeWindow: verification.activeWindow,
      method,
      reason: paste.reason
    };
  }

  const result = await runDesktopCommand(verification.xdotoolPath, ["type", "--delay", "1", "--", input.text], context);

  return {
    supported: result.exitCode === 0,
    backend: verification.backend,
    typed: result.exitCode === 0,
    characterCount: input.text.length,
    activeWindow: verification.activeWindow,
    method,
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

  const windowId = normalizeWindowId(match[1] ?? "");
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

  if (windowId === undefined) {
    return undefined;
  }

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
  const wantedId = normalizeWindowId(input.windowId);
  if (wantedId !== undefined && normalizeWindowId(window.windowId) !== wantedId) {
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
  const normalizedWindowId = normalizeWindowId(input.windowId);
  const requestedWindow: DesktopWindowContext = {};

  if (normalizedWindowId !== undefined) {
    requestedWindow.windowId = normalizedWindowId;
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
  // Ids are canonical decimal strings; wmctrl -i accepts decimal ids.
  if (normalizedWindowId !== undefined && input.appName === undefined && input.title === undefined && input.pid === undefined) {
    const focusSupport = await detectWindowFocusSupport(context);
    if (!focusSupport.supported) {
      return { supported: false, backend: focusSupport.backend, focused: false, window: requestedWindow, reason: focusSupport.reason };
    }
    const directPath = await findCommandPath("wmctrl", context);
    if (directPath === undefined) {
      return { supported: false, backend: "unavailable", focused: false, window: requestedWindow, reason: "Window focus requires wmctrl on X11." };
    }
    const previousId = await previousActiveWindowId(await findCommandPath("xdotool", context), context);
    const direct = await runDesktopCommand(directPath, ["-i", "-a", normalizedWindowId], context);
    return {
      supported: true,
      backend: "wmctrl",
      focused: direct.exitCode === 0,
      window: summarizeWindow({ windowId: normalizedWindowId }, true),
      ...(previousId === undefined ? {} : { previousWindow: { windowId: previousId } }),
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

  const previousId = await previousActiveWindowId(await findCommandPath("xdotool", context), context);
  const result = await runDesktopCommand(wmctrlPath, ["-i", "-a", target.windowId], context);
  const summarized = summarizeWindow(target, true);

  return {
    supported: true,
    backend: "wmctrl",
    focused: result.exitCode === 0,
    window: summarized,
    ...(previousId === undefined ? {} : { previousWindow: { windowId: previousId } }),
    reason: result.exitCode === 0 ? "Focused the requested X11 window through wmctrl." : "wmctrl could not focus the requested window."
  };
}
