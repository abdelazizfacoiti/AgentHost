import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHROMIUM_EXTENSION_PUBLIC_KEY } from "@agenthost/app-browser";
import { BrowserSetupService } from "../browser-setup-service.js";

async function extensionFixture(root: string): Promise<string> {
  const extensionRoot = path.join(root, "extensions");
  for (const family of ["firefox", "chromium"] as const) {
    const folder = path.join(extensionRoot, family);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "background.js"), "", "utf8");
    await writeFile(path.join(folder, "popup.html"), "", "utf8");
    await writeFile(path.join(folder, "manifest.json"), JSON.stringify({
      manifest_version: 3,
      version: "0.1.0",
      permissions: ["tabs", "storage", "scripting", "alarms"],
      host_permissions: ["http://127.0.0.1/*"],
      optional_host_permissions: ["https://*/*", "http://*/*"],
      background: family === "firefox"
        ? { scripts: ["background.js"] }
        : { service_worker: "background.js" },
      action: { default_popup: "popup.html" },
      ...(family === "firefox"
        ? { browser_specific_settings: { gecko: { id: "browser-bridge@agenthost.local" } } }
        : { key: CHROMIUM_EXTENSION_PUBLIC_KEY })
    }), "utf8");
  }
  return extensionRoot;
}

describe("BrowserSetupService", () => {
  it("auto-selects one browser, persists real state, and projects a trusted browser surface", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-browser-service-"));
    const extensionRoot = await extensionFixture(root);
    const surfaces: any[] = [];
    const bridge = {
      status: () => ({
        enabled: true,
        listening: true,
        connected: false,
        extensionSeen: false,
        enrolledDeviceCount: 0,
        state: "extension_not_seen"
      }),
      beginEnrollment: (browserFamily: string) => ({
        enrollmentId: "enrollment-1",
        browserFamily,
        state: "waiting_for_extension",
        expiresAt: new Date(Date.now() + 600_000).toISOString()
      })
    };
    const service = new BrowserSetupService(bridge as never, {
      ownerSessionId: "owner",
      agentHostDir: root,
      extensionRoot,
      releaseRoot: path.join(root, "release"),
      detectBrowsers: async () => [
        { family: "firefox", installed: true, executableAvailable: true, executableName: "firefox", running: true },
        { family: "chromium", installed: false, executableAvailable: false, running: false }
      ],
      visual: {
        surfaceSnapshot: () => [...surfaces],
        showSurface: async (surface: any) => {
          surfaces.push(surface);
          return { ok: true, surfaceId: surface.surfaceId, visible: false, errors: [] };
        },
        updateSurface: async () => ({ ok: true, visible: false, errors: [] }),
        dismissSurface: async () => ({ ok: true, reason: "dismissed" })
      }
    });
    const result = await service.start();
    expect(result.setup).toMatchObject({
      browserFamily: "firefox",
      state: "waiting_for_extension",
      redacted: true
    });
    expect(result.inventory.selectedBrowser).toBe("firefox");
    expect(surfaces[0]).toMatchObject({
      ownerSessionId: "owner",
      source: "browser_setup",
      type: "browser_connection",
      interactionMode: "click_through",
      approvedIntents: []
    });
    expect(JSON.stringify(surfaces)).not.toMatch(/token|secret|cookie/i);
  });

  it("requires explicit selection when multiple supported browsers are installed", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-browser-service-multi-"));
    const extensionRoot = await extensionFixture(root);
    const service = new BrowserSetupService({
      status: () => ({ listening: true, state: "extension_not_seen" })
    } as never, {
      ownerSessionId: "owner",
      agentHostDir: root,
      extensionRoot,
      releaseRoot: path.join(root, "release"),
      detectBrowsers: async () => [
        { family: "firefox", installed: true, executableAvailable: true, executableName: "firefox", running: false },
        { family: "chromium", installed: true, executableAvailable: true, executableName: "chromium", running: false }
      ]
    });
    await expect(service.start()).rejects.toThrow("browser_selection_required");
  });

  it("does not report reconnect readiness for protocol-incompatible paired state", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-browser-service-incompatible-"));
    const extensionRoot = await extensionFixture(root);
    const service = new BrowserSetupService({
      status: () => ({
        listening: true,
        state: "protocol_mismatch",
        connected: false,
        extensionSeen: true,
        enrolledDeviceCount: 1
      })
    } as never, {
      ownerSessionId: "owner",
      agentHostDir: root,
      extensionRoot,
      releaseRoot: path.join(root, "release"),
      detectBrowsers: async () => [
        { family: "firefox", installed: true, executableAvailable: true, executableName: "firefox", running: false },
        { family: "chromium", installed: false, executableAvailable: false, running: false }
      ]
    });
    const inventory = await service.inventory();
    expect(inventory.browsers[0]).toMatchObject({
      protocolCompatible: false,
      runtimeCompatible: false,
      reconnectReady: false,
      extensionConnectionState: "incompatible",
      safeFailureCode: "protocol_mismatch"
    });
  });

  it("keeps paired-device state scoped to the reported browser family", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-browser-service-family-state-"));
    const extensionRoot = await extensionFixture(root);
    const service = new BrowserSetupService({
      status: () => ({
        listening: true,
        state: "unpaired",
        connected: false,
        extensionSeen: true,
        enrolledDeviceCount: 1,
        enrolledDeviceCounts: { firefox: 0, chromium: 1 }
      })
    } as never, {
      ownerSessionId: "owner",
      agentHostDir: root,
      extensionRoot,
      releaseRoot: path.join(root, "release"),
      detectBrowsers: async () => [
        { family: "firefox", installed: true, executableAvailable: true, executableName: "firefox", running: false },
        { family: "chromium", installed: true, executableAvailable: true, executableName: "chromium", running: false }
      ]
    });
    const inventory = await service.inventory();
    expect(inventory.browsers.find((item) => item.family === "firefox")?.pairedDeviceState).toBe("none");
    expect(inventory.browsers.find((item) => item.family === "chromium")?.pairedDeviceState).toBe("paired");
  });

  it("rejects a Chromium artifact whose identity key does not match the approved build", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-browser-service-identity-"));
    const extensionRoot = await extensionFixture(root);
    await writeFile(path.join(extensionRoot, "chromium", "manifest.json"), JSON.stringify({
      manifest_version: 3,
      version: "0.1.0",
      key: "not-the-approved-extension-key",
      permissions: ["tabs", "storage", "scripting", "alarms"],
      host_permissions: ["http://127.0.0.1/*"],
      optional_host_permissions: ["https://*/*", "http://*/*"],
      background: { service_worker: "background.js" },
      action: { default_popup: "popup.html" }
    }), "utf8");
    const service = new BrowserSetupService({ status: () => ({ listening: true, state: "extension_not_seen" }) } as never, {
      ownerSessionId: "owner",
      agentHostDir: root,
      extensionRoot,
      releaseRoot: path.join(root, "release"),
      detectBrowsers: async () => [{ family: "chromium", installed: true, executableAvailable: true, executableName: "chromium", running: false }]
    });
    const inventory = await service.inventory("chromium");
    expect(inventory.browsers[0]).toMatchObject({
      extensionArtifactAvailable: false,
      safeFailureCode: "extension_identity_mismatch",
      reconnectReady: false
    });
  });

  it("rejects manifest asset traversal instead of reading outside the extension root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-browser-service-path-"));
    const extensionRoot = await extensionFixture(root);
    await writeFile(path.join(extensionRoot, "firefox", "manifest.json"), JSON.stringify({
      manifest_version: 3,
      version: "0.1.0",
      permissions: ["tabs", "storage", "scripting", "alarms"],
      host_permissions: ["http://127.0.0.1/*"],
      optional_host_permissions: ["https://*/*", "http://*/*"],
      background: { scripts: ["../outside.js"] },
      action: { default_popup: "popup.html" },
      browser_specific_settings: { gecko: { id: "browser-bridge@agenthost.local" } }
    }), "utf8");
    const service = new BrowserSetupService({ status: () => ({ listening: true, state: "extension_not_seen" }) } as never, {
      ownerSessionId: "owner",
      agentHostDir: root,
      extensionRoot,
      releaseRoot: path.join(root, "release"),
      detectBrowsers: async () => [{ family: "firefox", installed: true, executableAvailable: true, executableName: "firefox", running: false }]
    });
    const inventory = await service.inventory("firefox");
    expect(inventory.browsers[0]).toMatchObject({ extensionArtifactAvailable: false, safeFailureCode: "extension_artifact_missing" });
  });
});
