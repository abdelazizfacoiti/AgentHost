import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
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
    expect(source).toContain("const r=await timedFetch(`${await base()}${url}`");
    expect(source).toContain("const r=await timedFetch(`${await base()}/v1/commands`");
    expect(source).not.toContain("const r=await fetch(`${await base()}${url}`");
    expect(source).not.toContain("const r=await fetch(`${await base()}/v1/commands`");
    expect(source).toContain('api.alarms.create("agenthostReconnect"');
    expect(source).toContain('"/v1/reconnect"');
    expect(source).toContain("agenthostRefreshSecret");
    expect(source).toContain("/v1/enrollment/request");
    expect(source).toContain("/v1/enrollment/status");
    expect(source).toContain('message?.type==="agenthost_enroll"');
    expect(source).toContain('alarm.name==="agenthostReconnect"&&!sessionToken){retryStartedAt=0;retryDelay=1000;schedule(0);');
    expect(source).not.toContain("console.log");
    expect(source).not.toContain("setInterval(poll,1000)");
    const setup = await readFile(path.join(root, "scripts", "prepare-browser-extension.mjs"), "utf8");
    expect(setup).toContain("No pairing token is required for a fresh setup");
    expect(setup).toContain("npm run browser:pair");
    expect(setup).not.toContain("randomBytes");
    const popup = await readFile(path.join(extension, "popup.html"), "utf8");
    expect(popup).toContain('id="enroll"');
    expect(popup).toContain("leave the AgentHost browser setup command running");
    const popupScript = await readFile(path.join(extension, "popup.js"), "utf8");
    expect(popupScript).toContain("No active pairing session");
    expect(popup).toContain("<details>");
  });

  it("reports and requests per-origin site access explicitly", async () => {
    const background = await readFile(path.join(extension, "background.js"), "utf8");
    const popup = await readFile(path.join(extension, "popup.js"), "utf8");
    const popupHtml = await readFile(path.join(extension, "popup.html"), "utf8");
    expect(background).toContain("api.permissions?.contains");
    expect(background).toContain('site_permission_required');
    expect(background).toContain('command==="get_page_context"');
    expect(background).toContain('command==="extract_text"');
    expect(popup).toContain("api.permissions.request");
    expect(popupHtml).toContain('id="grant"');
    expect(background).not.toContain('api.permissions.request');
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

  it("prints the browser-side pairing flow and creates a fresh config parent", async () => {
    const temporaryHome = await mkdtemp(path.join(os.tmpdir(), "agenthost-browser-setup-"));
    const extensionDir = path.join(temporaryHome, "extensions");
    const configPath = path.join(temporaryHome, "config", "config.json");
    try {
      await exec(process.execPath, ["scripts/prepare-browser-extension.mjs", "--setup", "--browser", "firefox"], {
        cwd: root,
        env: {
          ...process.env,
          HOME: temporaryHome,
          AGENTHOST_HOME: path.join(temporaryHome, "agenthost"),
          AGENTHOST_CONFIG: configPath,
          AGENTHOST_BROWSER_EXTENSION_DIR: extensionDir
        }
      });
      const setup = await readFile(path.join(root, "scripts", "prepare-browser-extension.mjs"), "utf8");
      expect(setup).toContain("npm run browser:pair -- --browser firefox --apply --approve");
      expect(setup).toContain("No pairing token is required for a fresh setup");
      expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({ browserBridge: { enabled: true, port: 43117 } });
      expect(await readFile(path.join(extensionDir, "firefox", "manifest.json"), "utf8")).toContain("browser-bridge@agenthost.local");
    } finally {
      await rm(temporaryHome, { recursive: true, force: true });
    }
  });
});
