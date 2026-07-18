import type { OverlayCapabilityReport } from "@agenthost/core";
import { spawn } from "node:child_process";

export interface OverlayEnvironment { XDG_SESSION_TYPE?: string; DISPLAY?: string; WAYLAND_DISPLAY?: string; XAUTHORITY?: string; PATH?: string; }
export interface OverlayProbeOptions { gtk3Available?: boolean; }

export function probeLinuxOverlay(environment: OverlayEnvironment = process.env, options: OverlayProbeOptions = {}): OverlayCapabilityReport {
  const session = (environment.XDG_SESSION_TYPE ?? (environment.DISPLAY ? "x11" : environment.WAYLAND_DISPLAY ? "wayland" : "unknown")).toLowerCase();
  const displayAvailable = session === "x11" ? Boolean(environment.DISPLAY) : session === "wayland" ? Boolean(environment.WAYLAND_DISPLAY) : false;
  const sessionType = session === "x11" || session === "wayland" ? session : "unknown";
  if (sessionType === "x11" && displayAvailable && options.gtk3Available === true) return { supported: true, available: true, visible: true, renderer: "gtk3-x11", rendererStatus: "available", sessionType, displayAvailable, clickThrough: true, interactiveWidgets: true, multipleDisplays: true, globalOverlayAvailable: true, clickThroughAvailable: true, multiDisplayAvailable: true, animationAvailable: true, interactiveWidgetsAvailable: true, reason: "GTK3 X11 overlay backend is available.", limitations: ["Compositor and window-manager z-order behavior may vary."] };
  const limitations = sessionType === "wayland" ? ["Wayland compositor-specific overlay support is not enabled.", "Global coordinates, layer-shell, and guaranteed click-through are unavailable."] : ["Visible rendering is unavailable; headless state remains safe and deterministic."];
  const reason = sessionType === "x11" && displayAvailable && options.gtk3Available === false ? "GTK3 PyGObject backend is unavailable." : displayAvailable ? "No supported Linux overlay backend is available for this session." : "No supported graphical display session is available.";
  return { supported: false, available: false, visible: false, renderer: "linux-unavailable", rendererStatus: "unavailable", sessionType, displayAvailable, clickThrough: false, interactiveWidgets: false, multipleDisplays: false, globalOverlayAvailable: false, clickThroughAvailable: false, multiDisplayAvailable: false, animationAvailable: false, interactiveWidgetsAvailable: false, reason, limitations };
}

export async function probeGtk3(environment: OverlayEnvironment = process.env, timeoutMs = 2_000): Promise<boolean> {
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    const child = spawn("python3", ["-c", "import gi; gi.require_version('Gtk','3.0'); gi.require_version('Gdk','3.0'); from gi.repository import Gdk, Gtk; ok, _argv = Gtk.init_check(); raise SystemExit(0 if ok else 78)"], { stdio: ["ignore", "ignore", "ignore"], env: { PATH: environment.PATH ?? process.env.PATH ?? "/usr/bin:/bin", ...(environment.DISPLAY === undefined ? {} : { DISPLAY: environment.DISPLAY }), ...(environment.XAUTHORITY === undefined ? {} : { XAUTHORITY: environment.XAUTHORITY }), ...(environment.XDG_SESSION_TYPE === undefined ? {} : { XDG_SESSION_TYPE: environment.XDG_SESSION_TYPE }) } });
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(false); }, timeoutMs);
    child.once("error", () => finish(false));
    child.once("exit", (code) => finish(code === 0));
  });
}
