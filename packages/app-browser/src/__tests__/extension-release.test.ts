import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const extension = path.join(root, "packages", "app-browser", "extension");

describe("browser extension release boundary", () => {
  it("uses stable identities, fixed loopback host, and no forbidden permissions", async () => {
    const firefox = JSON.parse(await readFile(path.join(extension, "manifest.firefox.json"), "utf8"));
    const chromium = JSON.parse(await readFile(path.join(extension, "manifest.chromium.json"), "utf8"));
    for (const manifest of [firefox, chromium]) {
      expect(manifest.host_permissions).toEqual(["http://127.0.0.1/*"]);
      expect(manifest.permissions).toEqual(expect.arrayContaining(["tabs", "storage", "scripting", "alarms"]));
      expect(["cookies", "debugger", "webRequest", "nativeMessaging", "history"].some((permission) => manifest.permissions.includes(permission))).toBe(false);
    }
    expect(firefox.browser_specific_settings.gecko.id).toBe("browser-bridge@agenthost.local");
    expect(chromium.key).toMatch(/^[A-Za-z0-9+/=]+$/);
    const server = await readFile(path.join(root, "packages", "app-browser", "src", "bridge-server.ts"), "utf8");
    expect(server).toContain('listen(this.config.port, "127.0.0.1"');
  });

  it("contains bounded reconnect and persistent device enrollment without logging credentials", async () => {
    const source = await readFile(path.join(extension, "background.js"), "utf8");
    expect(source).toContain("MAX_RECONNECT_MS=300000");
    expect(source).toContain("MAX_RETRY_DELAY=30000");
    expect(source).toContain('api.alarms.create("agenthostReconnect"');
    expect(source).toContain('"/v1/reconnect"');
    expect(source).toContain("agenthostRefreshSecret");
    expect(source).not.toContain("console.log");
    expect(source).not.toContain("setInterval(poll,1000)");
    const setup = await readFile(path.join(root, "scripts", "prepare-browser-extension.mjs"), "utf8");
    expect(setup).toContain("does not create, print, or preserve pairing credentials");
    expect(setup).not.toContain("randomBytes");
  });

  it("builds deterministic unsigned artifacts and reports external signing honestly", async () => {
    await exec(process.execPath, ["scripts/build-browser-extension.mjs"], { cwd: root });
    const first = await readFile(path.join(root, "release", "browser", "SHA256SUMS"), "utf8");
    const metadata = JSON.parse(await readFile(path.join(root, "release", "browser", "artifacts.json"), "utf8"));
    await exec(process.execPath, ["scripts/build-browser-extension.mjs"], { cwd: root });
    const second = await readFile(path.join(root, "release", "browser", "SHA256SUMS"), "utf8");
    expect(second).toBe(first);
    expect(metadata.artifacts).toHaveLength(2);
    expect(metadata.artifacts.every((item: any) => item.signed === false && item.publicInstallable === false)).toBe(true);
  });
});
