import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BrowserBridgeServer } from "../bridge-server.js";

describe("BrowserBridgeServer", () => {
  it("stays disabled without opening a listener", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-browser-"));
    const bridge = new BrowserBridgeServer({ enabled: false, port: 43117, pairingTokenFile: path.join(root, "pairing-token") });
    await bridge.start();
    expect(bridge.status()).toMatchObject({ enabled: false, connected: false });
    await bridge.close();
  });

  it("reports setup state and rotates pairing without exposing it in status", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-browser-"));
    const bridge = new BrowserBridgeServer({ enabled: true, port: 0, pairingTokenFile: path.join(root, "pairing-token") });
    expect(bridge.status()).toMatchObject({ enabled: true, state: "bridge_unavailable", tokenExists: false });
    expect(JSON.stringify(bridge.status())).not.toContain("AH-");
    const first = await bridge.resetPairing(); const second = await bridge.resetPairing();
    expect(first).not.toBe(second);
    await bridge.close();
  });
});
