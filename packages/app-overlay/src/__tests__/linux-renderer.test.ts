import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
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

interface FakeRendererBehavior { invalidHandshake?: boolean; unsupportedRenderer?: boolean; noHandshake?: boolean; noRenderAck?: boolean; wrongEpoch?: boolean; missingLiveRegistration?: boolean; rejectShow?: boolean; }

function fakeSpawnProcess(behavior: FakeRendererBehavior = {}): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as unknown as { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; killed: boolean; kill: () => boolean; };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; queueMicrotask(() => (child as unknown as EventEmitter).emit("exit", 0, null)); return true; };
  let buffer = "";
  child.stdin.on("data", (chunk: Buffer | string) => {
    buffer += chunk.toString();
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const request = JSON.parse(line) as { id: string; command: string; payload?: { rendererEpoch?: number } };
      const epoch = request.payload?.rendererEpoch ?? 1;
      if (request.command === "hello" && behavior.noHandshake === true) { newline = buffer.indexOf("\n"); continue; }
      if (request.command !== "hello" && behavior.noRenderAck === true) { newline = buffer.indexOf("\n"); continue; }
      if (request.command === "show" && behavior.rejectShow === true) {
        child.stdout.write(JSON.stringify({ version: 1, id: request.id, ok: false, error: "overlay_not_found" }) + "\n");
        newline = buffer.indexOf("\n");
        continue;
      }
      const data = request.command === "hello"
        ? behavior.invalidHandshake === true ? { invalid: true } : { protocolVersion: 1, rendererEpoch: behavior.wrongEpoch === true ? epoch + 1 : epoch, capabilities: behavior.unsupportedRenderer === true ? { supported: false, reason: "overlay_compositor_unavailable" } : { supported: true } }
        : ["show", "update", "dismiss", "clear", "emergency_hide"].includes(request.command)
          ? { command: request.command, acknowledgement: request.command === "show" ? "visible" : request.command === "update" ? "updated" : request.command === "dismiss" ? "dismissed" : request.command === "clear" ? "cleared" : "emergency_hidden", rendererEpoch: epoch, visibleWindowCount: 1, interactiveWindowCount: 0, requestId: request.id, ...(request.command === "show" || request.command === "update" ? { transparentWindowCount: 1, drawReadyCount: 1, visible: true, liveSurfaceRegistered: behavior.missingLiveRegistration !== true } : {}) }
          : request.command === "events"
            ? { events: [{ eventId: "event-1", overlayId: "overlay-1", event: "pause", createdAt: new Date().toISOString(), ownerSessionId: "overlay-session" }] }
            : { reason: "fake_renderer" };
      child.stdout.write(JSON.stringify({ version: 1, id: request.id, ok: true, data }) + "\n");
      newline = buffer.indexOf("\n");
    }
  });
  return child as unknown as ChildProcessWithoutNullStreams;
}

function failingSpawnProcess(): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as unknown as { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; killed: boolean; kill: () => boolean; };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; return true; };
  queueMicrotask(() => (child as unknown as EventEmitter).emit("exit", 78, null));
  return child as unknown as ChildProcessWithoutNullStreams;
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
    const renderer = new LinuxOverlayRenderer({ mode: "gtk3-x11", probe: () => supported, spawnProcess: () => fakeSpawnProcess(), environment: { XDG_SESSION_TYPE: "x11", DISPLAY: ":99" } });
    try {
      const shown = await renderer.show({ overlayId: "overlay-1", type: "pointer", payload: { type: "pointer", sensitivity: "public" } });
      expect(shown.ok).toBe(true);
      expect(shown.acknowledged).toBe(true);
      expect(shown.rendererEpoch).toBeGreaterThan(0);
      expect(shown.visibleWindowCount).toBeGreaterThan(0);
      expect((await renderer.update({ overlayId: "overlay-1", type: "pointer", payload: { type: "pointer", sensitivity: "public" } })).ok).toBe(true);
      expect((await renderer.dismiss("overlay-1")).ok).toBe(true);
      expect((await renderer.clear()).ok).toBe(true);
      expect((await renderer.emergencyHide()).ok).toBe(true);
      const drained = await renderer.drainEvents();
      expect(drained).toHaveLength(1);
      expect(drained[0]).toMatchObject({ overlayId: "overlay-1", event: "pause" });
    } finally {
      await renderer.close();
    }
  });

  it("falls back safely when the renderer process fails", async () => {
    const renderer = new LinuxOverlayRenderer({ probe: () => supported, spawnProcess: failingSpawnProcess, maxRestarts: 0, environment: { XDG_SESSION_TYPE: "x11", DISPLAY: ":99" } });
    try {
      const result = await renderer.show({ overlayId: "overlay-fallback", type: "status_toast", payload: { type: "status_toast", text: "safe", sensitivity: "public" } });
      expect(result.ok).toBe(true);
      expect((await renderer.state()).renderer.fallbackRenderer).toBe("headless");
      expect((await renderer.capabilities()).rendererStatus).toBe("degraded");
      expect((await renderer.diagnostics()).lastFailure).toBe("renderer_process_exited");
    } finally { await renderer.close(); }
  });

  it("reports diagnostics and supports one explicit bounded restart", async () => {
    const renderer = new LinuxOverlayRenderer({ mode: "gtk3-x11", probe: () => supported, spawnProcess: () => fakeSpawnProcess(), environment: { XDG_SESSION_TYPE: "x11", DISPLAY: ":99" } });
    try {
      const shown = await renderer.show({ overlayId: "overlay-1", type: "pointer", payload: { type: "pointer", sensitivity: "public" } });
      expect(shown.ok).toBe(true);
      const before = await renderer.diagnostics();
      expect(["running", "failed"]).toContain(before.childState);
      const restarted = await renderer.restart();
      expect(typeof restarted.ok).toBe("boolean");
      expect((await renderer.diagnostics()).restartCount).toBeLessThanOrEqual(1);
    } finally { await renderer.close(); }
  });

  it("fails closed on invalid handshake without an endless restart loop", async () => {
    const renderer = new LinuxOverlayRenderer({ pythonCommand: process.execPath, scriptPath: "unused", probe: () => supported, maxRestarts: 0, spawnProcess: () => fakeSpawnProcess({ invalidHandshake: true }), environment: { XDG_SESSION_TYPE: "x11", DISPLAY: ":99" } });
    try {
      expect((await renderer.show({ overlayId: "overlay-invalid", type: "pointer", payload: { type: "pointer", sensitivity: "public" } })).ok).toBe(true);
      const diagnostics = await renderer.diagnostics();
      expect(diagnostics.handshake).toBe("failed");
      expect(diagnostics.fallbackReason).toBeDefined();
      expect((await renderer.show({ overlayId: "overlay-invalid-2", type: "pointer", payload: { type: "pointer", sensitivity: "public" } })).ok).toBe(true);
    } finally { await renderer.close(); }
  });

  it("never uses fallback to satisfy strict visible mode", async () => {
    const renderer = new LinuxOverlayRenderer({ mode: "gtk3-x11", probe: () => supported, maxRestarts: 0, spawnProcess: () => fakeSpawnProcess({ invalidHandshake: true }), environment: { XDG_SESSION_TYPE: "x11", DISPLAY: ":99" } });
    try {
      const result = await renderer.show({ overlayId: "overlay-strict", type: "pointer", payload: { type: "pointer", sensitivity: "public" } });
      expect(result.ok).toBe(false);
      expect(["renderer_protocol_error", "renderer_handshake_timeout", "renderer_process_exited"]).toContain(result.reason);
      expect((await renderer.diagnostics()).fallbackReason).toBeDefined();
    } finally { await renderer.close(); }
  });

  it("fails closed on handshake timeout, render acknowledgement timeout, and epoch mismatch", async () => {
    const handshakeTimeout = new LinuxOverlayRenderer({ mode: "gtk3-x11", startupTimeoutMs: 250, probe: () => supported, spawnProcess: () => fakeSpawnProcess({ noHandshake: true }), environment: { XDG_SESSION_TYPE: "x11", DISPLAY: ":99" } });
    const renderTimeout = new LinuxOverlayRenderer({ mode: "gtk3-x11", renderAckTimeoutMs: 250, probe: () => supported, spawnProcess: () => fakeSpawnProcess({ noRenderAck: true }), environment: { XDG_SESSION_TYPE: "x11", DISPLAY: ":99" } });
    const epochMismatch = new LinuxOverlayRenderer({ mode: "gtk3-x11", probe: () => supported, spawnProcess: () => fakeSpawnProcess({ wrongEpoch: true }), environment: { XDG_SESSION_TYPE: "x11", DISPLAY: ":99" } });
    try {
      expect((await handshakeTimeout.show({ overlayId: "timeout-handshake", type: "pointer", payload: {} })).reason).toBe("renderer_handshake_timeout");
      expect((await renderTimeout.show({ overlayId: "timeout-render", type: "pointer", payload: {} })).reason).toBe("overlay_render_not_acknowledged");
      expect((await epochMismatch.show({ overlayId: "mismatch", type: "pointer", payload: {} })).reason).toBe("renderer_epoch_mismatch");
    } finally {
      await handshakeTimeout.close();
      await renderTimeout.close();
      await epochMismatch.close();
    }
  });

  it("rejects a child that cannot provide transparent compositor-backed windows", async () => {
    const renderer = new LinuxOverlayRenderer({ mode: "gtk3-x11", probe: () => supported, maxRestarts: 0, spawnProcess: () => fakeSpawnProcess({ unsupportedRenderer: true }), environment: { XDG_SESSION_TYPE: "x11", DISPLAY: ":99" } });
    try {
      const result = await renderer.show({ overlayId: "opaque-window", type: "pointer", payload: {} });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("overlay_compositor_unavailable");
      expect((await renderer.diagnostics()).fallbackReason).toBe("overlay_compositor_unavailable");
    } finally { await renderer.close(); }
  });

  it("never kills a healthy renderer for a logical rejection", async () => {
    const renderer = new LinuxOverlayRenderer({ mode: "gtk3-x11", probe: () => supported, spawnProcess: () => fakeSpawnProcess({ rejectShow: true }), environment: { XDG_SESSION_TYPE: "x11", DISPLAY: ":99" } });
    try {
      const result = await renderer.show({ overlayId: "missing", type: "pointer", payload: {} });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("overlay_not_found");
      const diagnostics = await renderer.diagnostics();
      expect(diagnostics.childState).toBe("running");
      expect(diagnostics.lastFailure).toBe("overlay_not_found");
    } finally { await renderer.close(); }
  });

  it("requires live registration acknowledgement in explicit native mode", async () => {
    const renderer = new LinuxOverlayRenderer({ mode: "gtk3-native", probe: () => supported, maxRestarts: 0, spawnProcess: () => fakeSpawnProcess({ missingLiveRegistration: true }), environment: { XDG_SESSION_TYPE: "x11", DISPLAY: ":99" } });
    try {
      const result = await renderer.show({ overlayId: "missing-live-registration", type: "pointer", payload: {} });
      expect(result.reason).toBe("overlay_live_registration_missing");
    } finally { await renderer.close(); }
  });
});
