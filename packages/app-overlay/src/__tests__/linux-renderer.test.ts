import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OverlayCapabilityReport } from "@agenthost/core";
import { LinuxOverlayRenderer } from "../linux-renderer.js";
import { probeLinuxOverlay } from "../linux-probe.js";

const supported: OverlayCapabilityReport = {
  supported: true,
  renderer: "gtk3-x11",
  rendererStatus: "available",
  sessionType: "x11",
  displayAvailable: true,
  clickThrough: true,
  interactiveWidgets: true,
  multipleDisplays: true,
  globalOverlayAvailable: true,
  clickThroughAvailable: true,
  multiDisplayAvailable: true,
  animationAvailable: true,
  interactiveWidgetsAvailable: true,
  reason: "test",
  limitations: []
};

async function fakeRendererScript(exitImmediately = false): Promise<{ dir: string; script: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agenthost-overlay-renderer-"));
  const script = path.join(dir, "fake-renderer.mjs");
  const source = exitImmediately
    ? "process.exit(78);\n"
    : [
        "import readline from 'node:readline';",
        "const rl = readline.createInterface({ input: process.stdin });",
        "rl.on('line', (line) => { try { const request = JSON.parse(line); const data = request.command === 'hello' ? { protocolVersion: 1, capabilities: { supported: true } } : { reason: 'fake_renderer' }; process.stdout.write(JSON.stringify({ version: 1, id: request.id, ok: true, data }) + '\\n'); } catch {} });"
      ].join("\n");
  await writeFile(script, source, "utf8");
  return { dir, script };
}

describe("GTK renderer controller", () => {
  it("reports supported X11 and honest Wayland/headless probe results", () => {
    expect(probeLinuxOverlay({ XDG_SESSION_TYPE: "x11", DISPLAY: ":0" }, { gtk3Available: true }).supported).toBe(true);
    const wayland = probeLinuxOverlay({ XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" }, { gtk3Available: true });
    expect(wayland.supported).toBe(false);
    expect(wayland.limitations.join(" ")).toMatch(/Wayland/);
    expect(probeLinuxOverlay({}).displayAvailable).toBe(false);
  });

  it("uses authenticated fixed IPC for show/update/dismiss/clear/emergency-hide", async () => {
    const fixture = await fakeRendererScript();
    const renderer = new LinuxOverlayRenderer({ pythonCommand: process.execPath, scriptPath: fixture.script, probe: () => supported, environment: { XDG_SESSION_TYPE: "x11", DISPLAY: ":99" } });
    try {
      expect((await renderer.show({ overlayId: "overlay-1", type: "pointer", payload: { type: "pointer", sensitivity: "public" } })).ok).toBe(true);
      expect((await renderer.update({ overlayId: "overlay-1", type: "pointer", payload: { type: "pointer", sensitivity: "public" } })).ok).toBe(true);
      expect((await renderer.dismiss("overlay-1")).ok).toBe(true);
      expect((await renderer.clear()).ok).toBe(true);
      expect((await renderer.emergencyHide()).ok).toBe(true);
    } finally {
      await renderer.close();
      await rm(fixture.dir, { recursive: true, force: true });
    }
  });

  it("falls back safely when the renderer process fails", async () => {
    const fixture = await fakeRendererScript(true);
    const renderer = new LinuxOverlayRenderer({ pythonCommand: process.execPath, scriptPath: fixture.script, probe: () => supported, maxRestarts: 0, environment: { XDG_SESSION_TYPE: "x11", DISPLAY: ":99" } });
    try {
      const result = await renderer.show({ overlayId: "overlay-fallback", type: "status_toast", payload: { type: "status_toast", text: "safe", sensitivity: "public" } });
      expect(result.ok).toBe(true);
      expect((await renderer.state()).renderer.fallbackRenderer).toBe("headless");
      expect((await renderer.capabilities()).rendererStatus).toBe("degraded");
    } finally {
      await renderer.close();
      await rm(fixture.dir, { recursive: true, force: true });
    }
  });
});
