import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expectedExtensionId } from "../extension-identity.js";
import { BrowserSetupStore } from "../setup-store.js";
import {
  browserSetupRecovery,
  canTransitionBrowserSetup,
  selectBrowserFromInventory,
  type BrowserInventoryEntry
} from "../setup.js";

function entry(family: "firefox" | "chromium", installed = true): BrowserInventoryEntry {
  return {
    family,
    supported: true,
    installed,
    executableAvailable: installed,
    running: false,
    expectedExtensionId: expectedExtensionId(family),
    extensionArtifactAvailable: true,
    extensionConnectionState: "missing",
    pairedDeviceState: "none",
    protocolCompatible: true,
    runtimeCompatible: true,
    reconnectReady: false,
    lastHealthStatus: installed ? "degraded" : "unavailable",
    recommendedNextAction: "Pair browser."
  };
}

describe("browser setup model", () => {
  it("uses stable identities for both supported browser families", () => {
    expect(expectedExtensionId("firefox")).toBe("browser-bridge@agenthost.local");
    expect(expectedExtensionId("chromium")).toBe("iglhiehdlonfffmediflnoepfpfiacaj");
  });

  it("auto-selects exactly one browser and requires selection for multiple", () => {
    expect(selectBrowserFromInventory([entry("firefox"), entry("chromium", false)])).toEqual({
      selected: "firefox"
    });
    expect(selectBrowserFromInventory([entry("firefox"), entry("chromium")])).toEqual({
      failureCode: "browser_selection_required"
    });
    expect(selectBrowserFromInventory([entry("firefox"), entry("chromium")], "chromium")).toEqual({
      selected: "chromium"
    });
    expect(selectBrowserFromInventory([{ ...entry("firefox"), executableAvailable: false }])).toEqual({
      failureCode: "browser_not_detected"
    });
  });

  it("rejects illegal transitions and returns deterministic recovery", () => {
    expect(canTransitionBrowserSetup("detecting_browser", "browser_selected")).toBe(true);
    expect(canTransitionBrowserSetup("ready", "pairing")).toBe(false);
    expect(browserSetupRecovery("extension_identity_mismatch")).toMatchObject({
      retryAllowed: false,
      browserApprovalRequired: true
    });
  });

  it("persists only bounded redacted owner-scoped setup metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-browser-setup-store-"));
    const store = new BrowserSetupStore(root, "owner-a");
    const created = await store.create("firefox");
    await store.transition(created.setupId, "browser_selected");
    await store.transition(created.setupId, "checking_extension");
    await store.transition(created.setupId, "enrollment_created");
    const waiting = await store.transition(created.setupId, "waiting_for_extension", {
      extensionIdentitySuffix: "browser-bridge@agenthost.local",
      recommendedNextAction: "Await browser-side enrollment."
    });
    expect(waiting.extensionIdentitySuffix).toBe("nthost.local");
    await expect(store.transition(created.setupId, "ready")).rejects.toThrow("setup_transition_invalid");
    await expect(new BrowserSetupStore(root, "owner-b").get(created.setupId)).rejects.toThrow(
      "browser_setup_not_found"
    );
    const raw = await readFile(path.join(root, "browser", "setup", "history.json"), "utf8");
    expect(raw).not.toMatch(/token|refreshSecret|sessionToken|pairingToken/i);
    expect(raw).toContain('"redacted": true');
  });
});
