import type { OverlayRendererMode } from "@agenthost/core";
import { HeadlessOverlayRenderer } from "./headless-renderer.js";
import { LinuxOverlayRenderer, type LinuxOverlayRendererOptions } from "./linux-renderer.js";
import { DisabledOverlayRenderer } from "./disabled-renderer.js";
import type { OverlayRenderer } from "./renderer.js";

export function createOverlayRenderer(mode: OverlayRendererMode = "auto", options: LinuxOverlayRendererOptions = {}): OverlayRenderer {
  if (mode === "headless") return new HeadlessOverlayRenderer();
  if (mode === "disabled") return new DisabledOverlayRenderer();
  // WebKit mode remains explicit and honest until a deterministic local bundle exists.
  if (mode === "webkit-gtk-react") return new DisabledOverlayRenderer();
  return new LinuxOverlayRenderer({ ...options, mode: mode === "gtk3-x11" ? "gtk3-native" : mode });
}
