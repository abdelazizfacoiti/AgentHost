#!/usr/bin/env node
/* Explicit opt-in visual-only demo. It never invokes desktop/browser actions. */
import { createOverlayRenderer, OverlayManager } from "../packages/app-overlay/dist/index.js";

const renderer = createOverlayRenderer("gtk3-x11", { environment: process.env });
const capabilities = await renderer.capabilities();
if (!capabilities.supported) {
  console.log(JSON.stringify({ ok: false, supported: false, reason: capabilities.reason, limitations: capabilities.limitations }));
  await renderer.close?.();
  process.exit(0);
}

const manager = new OverlayManager(renderer, { sessionId: "overlay-demo" });
const expiresAt = new Date(Date.now() + 12_000).toISOString();
const target = { kind: "screen_point", point: { x: 140, y: 140 }, trusted: true, expiresAt };
const results = [];
results.push(await manager.showPrimitive({ type: "pointer", target, label: "Pointer", sensitivity: "public", ttlMs: 10_000 }));
results.push(await manager.showPrimitive({ type: "highlight", target, label: "Highlight", sensitivity: "public", ttlMs: 10_000 }));
results.push(await manager.showPrimitive({ type: "tooltip", target, text: "AgentHost visual-only overlay demo", sensitivity: "public", ttlMs: 10_000 }));
results.push(await manager.showWidget({
  title: "Overlay demo",
  sensitivity: "public",
  ttlMs: 10_000,
  target,
  interaction: { interactive: true, focus: "never", dismissible: true, allowedEvents: ["dismissed", "emergency_stop_requested"] },
  components: [
    { type: "heading", text: "Safe local preview" },
    { type: "text", text: "No clicks, typing, navigation, or target-app actions." },
    { type: "status_badge", text: "visual only", status: "info" },
    { type: "button", label: "Dismiss", event: "dismissed" }
  ]
}));
console.log(JSON.stringify({ ok: results.every((result) => result.ok), supported: true, renderer: capabilities.renderer, shown: results.filter((result) => result.ok).length }));
await new Promise((resolve) => setTimeout(resolve, 4_000));
await manager.emergencyHide();
await manager.close();
