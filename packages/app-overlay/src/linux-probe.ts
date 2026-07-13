import type { OverlayCapabilityReport } from "@agenthost/core";

export interface OverlayEnvironment { XDG_SESSION_TYPE?: string; DISPLAY?: string; WAYLAND_DISPLAY?: string; }

export function probeLinuxOverlay(environment: OverlayEnvironment = process.env): OverlayCapabilityReport {
  const session = (environment.XDG_SESSION_TYPE ?? (environment.DISPLAY ? "x11" : environment.WAYLAND_DISPLAY ? "wayland" : "unknown")).toLowerCase();
  const displayAvailable = session === "x11" ? Boolean(environment.DISPLAY) : session === "wayland" ? Boolean(environment.WAYLAND_DISPLAY) : false;
  return { supported: false, renderer: "linux-unavailable", rendererStatus: "unavailable", sessionType: session === "x11" || session === "wayland" ? session : "unknown", displayAvailable, clickThrough: false, interactiveWidgets: false, multipleDisplays: false, reason: displayAvailable ? "No approved dependency-free click-through overlay backend is configured." : "No supported graphical display session is available.", limitations: session === "wayland" ? ["Wayland compositor-specific overlay support is not enabled."] : ["Visible rendering is unavailable; headless state remains safe and deterministic."] };
}
