import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { backgroundBrowserProfileDir, backgroundChromiumArgs, backgroundWorkerStatus, detectLinuxBrowsers, spawnBackgroundChromium } from "../browser-inventory.js";

describe("Linux browser inventory", () => {
  it("detects supported executable names without exposing executable paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-browser-path-"));
    const executable = path.join(root, "firefox");
    await writeFile(executable, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(executable, 0o700);
    const inventory = await detectLinuxBrowsers({ PATH: root });
    expect(inventory).toEqual(expect.arrayContaining([
      expect.objectContaining({
        family: "firefox",
        installed: true,
        executableAvailable: true,
        executableName: "firefox"
      }),
      expect.objectContaining({
        family: "chromium",
        installed: false
      })
    ]));
    expect(JSON.stringify(inventory)).not.toContain(root);
  });

  it("builds an isolated headless background profile without executing anything", async () => {
    const profileDir = backgroundBrowserProfileDir("/home/test/.agenthost");
    expect(profileDir).toBe("/home/test/.agenthost/browser/profiles/background");
    const launch = backgroundChromiumArgs({ profileDir, extensionDir: "/home/test/.local/share/agenthost/browser-extension/chromium" });
    expect(launch.headless).toBe(true);
    expect(launch.args).toContain("--headless=new");
    expect(launch.args).toContain(`--user-data-dir=${profileDir}`);
    expect(launch.args).toContain("--load-extension=/home/test/.local/share/agenthost/browser-extension/chromium");
    expect(launch.args).not.toContain("firefox");
  });

  it("reports no background worker before any launch", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-browser-worker-absent-"));
    const status = await backgroundWorkerStatus(path.join(homeDir, ".agenthost"));
    expect(status).toMatchObject({ running: false, profileDir: path.join(homeDir, ".agenthost", "browser", "profiles", "background") });
  });

  it("spawns a detached background worker and tracks aliveness", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-browser-worker-"));
    const binDir = path.join(homeDir, "bin");
    await mkdir(binDir, { recursive: true });
    await writeFile(path.join(binDir, "chromium"), "#!/bin/sh\nsleep 30\n", "utf8");
    await chmod(path.join(binDir, "chromium"), 0o700);
    const agentHostDir = path.join(homeDir, ".agenthost");
    const launched = await spawnBackgroundChromium({ agentHostDir, env: { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` } });
    expect(launched.pid).toBeGreaterThan(0);
    expect(launched.profileDir).toBe(path.join(agentHostDir, "browser", "profiles", "background"));
    expect(launched.args).toContain("--headless=new");
    const alive = await backgroundWorkerStatus(agentHostDir);
    expect(alive).toMatchObject({ running: true, pid: launched.pid });
    spawnSync("kill", [String(launched.pid)]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const dead = await backgroundWorkerStatus(agentHostDir);
    expect(dead.running).toBe(false);
  });

  it("refuses to spawn without a Chromium executable", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-browser-worker-missing-"));
    await expect(spawnBackgroundChromium({ agentHostDir: path.join(homeDir, ".agenthost"), env: { PATH: "" } })).rejects.toThrow("chromium_not_installed");
  });
});
