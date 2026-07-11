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
});
