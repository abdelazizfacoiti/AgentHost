import type { OverlayRendererMode } from "@agenthost/core";
import { HeadlessOverlayRenderer } from "./headless-renderer.js";
import { LinuxOverlayRenderer, type LinuxOverlayRendererOptions } from "./linux-renderer.js";
import type { OverlayRenderer } from "./renderer.js";

export function createOverlayRenderer(mode: OverlayRendererMode = "headless", options: LinuxOverlayRendererOptions = {}): OverlayRenderer {
  return mode === "headless" ? new HeadlessOverlayRenderer() : new LinuxOverlayRenderer(options);
}
