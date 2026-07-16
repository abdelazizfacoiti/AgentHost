import { mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BrowserBridgeServer } from "../bridge-server.js";

const firefoxOrigin = "moz-extension://agenthost-runtime-origin";
const identity = {
  browser: { family: "firefox" as const, version: "128.0" },
  extensionId: "browser-bridge@agenthost.local",
  extensionVersion: "0.1.0",
  protocolVersion: 1
};

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-browser-"));
  const config = {
    enabled: true,
    port: 0,
    pairingTokenFile: path.join(root, "pairing-token"),
    pairingStateFile: path.join(root, "paired-devices.json")
  };
  const bridge = new BrowserBridgeServer(config);
  await bridge.initializePersistentState();
  return { root, config, bridge };
}

async function request(bridge: BrowserBridgeServer, route: string, value: unknown, origin = firefoxOrigin) {
  return bridge.protocolRequest(route as "/v1/pair" | "/v1/reconnect", value as Record<string, unknown>, origin);
}

async function enroll(bridge: BrowserBridgeServer) {
  const generated = await bridge.generatePairingToken();
  const response = await request(bridge, "/v1/pair", { ...identity, pairingToken: generated.token });
  expect(response.status).toBe(200);
  return response.body as unknown as { sessionToken: string; deviceId: string; refreshSecret: string };
}

describe("BrowserBridgeServer", () => {
  it("stays disabled without opening a listener", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-browser-"));
    const bridge = new BrowserBridgeServer({ enabled: false, port: 43117, pairingTokenFile: path.join(root, "pairing-token") });
    await bridge.start();
    expect(bridge.status()).toMatchObject({ enabled: false, connected: false });
    await bridge.close();
  });

  it("persists enrolled device and reconnects after AgentHost restart", async () => {
    const { config, bridge } = await fixture();
    const enrolled = await enroll(bridge);
    expect(bridge.status()).toMatchObject({ connected: true, paired: true, enrolledDeviceCount: 1, tokenExists: false });
    await bridge.close();

    const restarted = new BrowserBridgeServer(config);
    await restarted.initializePersistentState();
    const response = await request(restarted, "/v1/reconnect", { ...identity, deviceId: enrolled.deviceId, refreshSecret: enrolled.refreshSecret });
    expect(response.status).toBe(200);
    expect(restarted.status()).toMatchObject({ connected: true, paired: true, extensionVersion: "0.1.0" });
    expect(JSON.stringify(restarted.status())).not.toContain(enrolled.refreshSecret);
    expect(await readFile(config.pairingStateFile, "utf8")).not.toContain(enrolled.refreshSecret);
    expect((await stat(config.pairingStateFile)).mode & 0o777).toBe(0o600);
    await restarted.close();
  });

  it("rejects revoked device and permits fresh explicit enrollment", async () => {
    const { bridge } = await fixture();
    const enrolled = await enroll(bridge);
    const rotated = await bridge.generatePairingToken();
    const rejected = await request(bridge, "/v1/reconnect", { ...identity, deviceId: enrolled.deviceId, refreshSecret: enrolled.refreshSecret });
    expect(rejected.status).toBe(401);
    expect(rejected.body).toMatchObject({ error: "pairing_revoked" });
    const fresh = await request(bridge, "/v1/pair", { ...identity, pairingToken: rotated.token });
    expect(fresh.status).toBe(200);
    await bridge.close();
  });

  it("rejects invalid origin, Chromium identity mismatch, and incompatible version", async () => {
    const { bridge } = await fixture();
    const generated = await bridge.generatePairingToken();
    const origin = await request(bridge, "/v1/pair", { ...identity, pairingToken: generated.token }, "http://127.0.0.1");
    expect(origin.status).toBe(403);
    const chromium = await request(bridge, "/v1/pair", {
      ...identity,
      browser: { family: "chromium" },
      extensionId: "different-extension",
      pairingToken: generated.token
    }, "chrome-extension://expected-extension");
    expect(chromium.status).toBe(403);
    const version = await request(bridge, "/v1/pair", { ...identity, extensionVersion: "1.0.0", pairingToken: generated.token });
    expect(version.status).toBe(409);
    expect(version.body).toMatchObject({ error: "version_mismatch" });
    await bridge.close();
  });

  it("accepts compatible extension upgrade for enrolled identity", async () => {
    const { bridge } = await fixture();
    const enrolled = await enroll(bridge);
    await bridge.close();
    const restarted = new BrowserBridgeServer(bridge.config);
    await restarted.initializePersistentState();
    const response = await request(restarted, "/v1/reconnect", {
      ...identity,
      extensionVersion: "0.2.0",
      deviceId: enrolled.deviceId,
      refreshSecret: enrolled.refreshSecret
    });
    expect(response.status).toBe(200);
    expect(restarted.status()).toMatchObject({ extensionVersion: "0.2.0" });
    await restarted.close();
  });

  it("fails closed on corrupted state and reset recovers it", async () => {
    const { config, bridge } = await fixture();
    await bridge.close();
    await writeFile(config.pairingStateFile, "{broken", "utf8");
    const restarted = new BrowserBridgeServer(config);
    await restarted.initializePersistentState();
    expect(restarted.status()).toMatchObject({ lastError: "device_state_corrupt", connected: false });
    await restarted.resetPairing();
    const parsed = JSON.parse(await readFile(config.pairingStateFile, "utf8"));
    expect(parsed).toEqual({ schemaVersion: 1, devices: [] });
    await restarted.close();
  });

  it("expires stale one-time bootstrap token and removes it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-browser-"));
    const tokenFile = path.join(root, "pairing-token");
    await writeFile(tokenFile, "AH-11111-22222-33333-44444-55555-66666\n", { mode: 0o600 });
    const old = new Date(Date.now() - 11 * 60_000);
    await utimes(tokenFile, old, old);
    const bridge = new BrowserBridgeServer({ enabled: true, port: 0, pairingTokenFile: tokenFile });
    await bridge.initializePersistentState();
    expect(bridge.status()).toMatchObject({ tokenExists: false });
    await expect(stat(tokenFile)).rejects.toMatchObject({ code: "ENOENT" });
    await bridge.close();
  });

  it("reset removes token and revokes persistent pairing without exposing credentials", async () => {
    const { config, bridge } = await fixture();
    const enrolled = await enroll(bridge);
    await bridge.resetPairing();
    expect(bridge.status()).toMatchObject({ connected: false, paired: false, tokenExists: false });
    expect(JSON.stringify(bridge.status())).not.toContain(enrolled.refreshSecret);
    await expect(stat(config.pairingTokenFile)).rejects.toMatchObject({ code: "ENOENT" });
    await bridge.close();
  });
});
