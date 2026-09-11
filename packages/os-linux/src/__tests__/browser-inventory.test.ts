import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { backgroundBrowserProfileDir, backgroundChromiumArgs, detectLinuxBrowsers } from "../browser-inventory.js";

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
});
