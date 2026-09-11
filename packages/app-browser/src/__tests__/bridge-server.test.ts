import { mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer, type AddressInfo } from "node:net";
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
  return bridge.protocolRequest(
    route as "/v1/pair" | "/v1/reconnect" | "/v1/enrollment/request" | "/v1/enrollment/status",
    value as Record<string, unknown>,
    origin
  );
}

async function httpGet(bridge: BrowserBridgeServer, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  const port = bridge.status().port;
  return await new Promise((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port, path: "/v1/commands", method: "GET", headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end();
  });
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

  it("degrades cleanly when the configured loopback port is occupied", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-browser-"));
    const blocker = createServer();
    const bindError = await new Promise<NodeJS.ErrnoException | undefined>((resolve) => {
      blocker.once("error", (error: NodeJS.ErrnoException) => resolve(error));
      blocker.listen(0, "127.0.0.1", () => resolve(undefined));
    });
    if (bindError?.code === "EPERM") {
      // Managed CI sandboxes may forbid loopback binds. This case is covered
      // from a normal desktop terminal in the release verification checklist.
      expect(bindError.code).toBe("EPERM");
      return;
    }
    expect(bindError).toBeUndefined();
    const address = blocker.address() as AddressInfo;
    const bridge = new BrowserBridgeServer({
      enabled: true,
      port: address.port,
      pairingTokenFile: path.join(root, "pairing-token"),
      pairingStateFile: path.join(root, "paired-devices.json")
    });

    await expect(bridge.start()).resolves.toBeUndefined();
    expect(bridge.status()).toMatchObject({
      listening: false,
      connected: false,
      state: "port_mismatch",
      lastError: "port_mismatch"
    });

    await bridge.close();
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
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

  it("accepts originless authenticated command polling but rejects a mismatched origin", async () => {
    const { bridge } = await fixture();
    await bridge.start();
    const enrolled = await enroll(bridge);
    const originless = await httpGet(bridge, { authorization: `Bearer ${enrolled.sessionToken}` });
    expect(originless.status).toBe(200);
    expect(JSON.parse(originless.body)).toEqual({ commands: [] });
    const mismatched = await httpGet(bridge, { authorization: `Bearer ${enrolled.sessionToken}`, origin: "moz-extension://different-extension" });
    expect(mismatched.status).toBe(401);
    await bridge.close();
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

  it("enrolls browser-side without returning a token through AgentHost state", async () => {
    const { bridge } = await fixture();
    const enrollment = bridge.beginEnrollment("firefox");
    const requested = await request(bridge, "/v1/enrollment/request", identity);
    expect(requested).toMatchObject({
      status: 202,
      body: { enrollmentId: enrollment.enrollmentId, state: "waiting_for_approval" }
    });
    const requestToken = (requested.body as { requestToken: string }).requestToken;
    expect(requestToken).toHaveLength(43);
    expect(JSON.stringify(bridge.status())).not.toContain(requestToken);

    const waiting = await request(bridge, "/v1/enrollment/status", { requestToken });
    expect(waiting).toMatchObject({ status: 202, body: { state: "waiting_for_approval" } });
    const approval = bridge.enrollmentStatus(enrollment.enrollmentId).approvalFingerprint;
    expect(approval).toBeTypeOf("string");
    await bridge.approveEnrollment(enrollment.enrollmentId, approval as string);
    expect(bridge.status()).toMatchObject({ connected: false, enrollment: { state: "approved" } });

    const delivered = await request(bridge, "/v1/enrollment/status", { requestToken });
    expect(delivered).toMatchObject({ status: 200, body: { state: "paired" } });
    expect(delivered.body).toHaveProperty("sessionToken");
    expect(delivered.body).toHaveProperty("refreshSecret");
    expect(bridge.status()).toMatchObject({ connected: true, paired: true });
    expect(JSON.stringify(bridge.status())).not.toContain(requestToken);
    const replayed = await request(bridge, "/v1/enrollment/status", { requestToken });
    expect(replayed.status).toBe(403);
    await bridge.close();
  });

  it("rejects mismatched identity, origin, protocol, and browser selection in enrollment", async () => {
    const { bridge } = await fixture();
    bridge.beginEnrollment("firefox");
    const identityMismatch = await request(bridge, "/v1/enrollment/request", {
      ...identity,
      extensionId: "unapproved@example.invalid"
    });
    expect(identityMismatch).toMatchObject({ status: 403, body: { error: "extension_identity_mismatch" } });
    const originMismatch = await request(
      bridge,
      "/v1/enrollment/request",
      identity,
      "chrome-extension://iglhiehdlonfffmediflnoepfpfiacaj"
    );
    expect(originMismatch.status).toBe(403);
    const protocol = await request(bridge, "/v1/enrollment/request", {
      ...identity,
      protocolVersion: 99
    });
    expect(protocol).toMatchObject({ status: 409, body: { error: "protocol_mismatch" } });
    const browserMismatch = await request(bridge, "/v1/enrollment/request", {
      ...identity,
      browser: { family: "chromium" },
      extensionId: "iglhiehdlonfffmediflnoepfpfiacaj"
    }, "chrome-extension://iglhiehdlonfffmediflnoepfpfiacaj");
    expect(browserMismatch).toMatchObject({ status: 409, body: { error: "browser_selection_mismatch" } });
    await bridge.close();
  });

  it("legacy pairing also enforces approved Firefox identity", async () => {
    const { bridge } = await fixture();
    const generated = await bridge.generatePairingToken();
    const rejected = await request(bridge, "/v1/pair", {
      ...identity,
      extensionId: "unapproved@example.invalid",
      pairingToken: generated.token
    });
    expect(rejected).toMatchObject({ status: 403, body: { error: "extension_identity_mismatch" } });
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

  it("releases the active session so another paired device can connect next", async () => {
    const { bridge } = await fixture();
    const enrolled = await enroll(bridge);
    expect(bridge.status()).toMatchObject({ connected: true });
    const released = bridge.releaseSession();
    expect(released).toMatchObject({ released: true, previousDeviceSuffix: enrolled.deviceId.slice(-8) });
    expect(JSON.stringify(released)).not.toContain(enrolled.deviceId);
    expect(JSON.stringify(released)).not.toContain(enrolled.refreshSecret);
    expect(bridge.status()).toMatchObject({ connected: false });
    await expect(bridge.command("list_tabs", {})).rejects.toThrow("browser_pairing_required");
    const idle = bridge.releaseSession();
    expect(idle).toEqual({ released: true });
    await bridge.close();
  });
});
