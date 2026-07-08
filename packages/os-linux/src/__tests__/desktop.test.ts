import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  captureLinuxScreenshot,
  clickLinuxDesktop,
  getLinuxActiveWindow,
  sendLinuxHotkey,
  typeLinuxText
} from "../index.js";

describe("Linux desktop helpers", () => {
  it("returns unsupported when no display session is available", async () => {
    await expect(getLinuxActiveWindow({ env: { PATH: "" } })).resolves.toMatchObject({
      supported: false,
      backend: "unavailable"
    });
  });

  it("returns unsupported screenshots when no backend is installed", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agenthost-desktop-shot-"));

    await expect(
      captureLinuxScreenshot(
        {
          path: path.join(dir, "screen.png")
        },
        {
          env: { PATH: "", DISPLAY: ":0", XDG_SESSION_TYPE: "x11" }
        }
      )
    ).resolves.toMatchObject({
      supported: false
    });
  });

  it("returns unsupported control actions without xdotool", async () => {
    const activeWindow = {
      appName: "Notes"
    };

    await expect(
      sendLinuxHotkey(
        {
          keys: ["ctrl+l"],
          activeWindow
        },
        {
          env: { PATH: "", DISPLAY: ":0", XDG_SESSION_TYPE: "x11" }
        }
      )
    ).resolves.toMatchObject({
      supported: false,
      sent: false
    });

    await expect(
      typeLinuxText(
        {
          text: "hello",
          activeWindow
        },
        {
          env: { PATH: "", DISPLAY: ":0", XDG_SESSION_TYPE: "x11" }
        }
      )
    ).resolves.toMatchObject({
      supported: false,
      typed: false
    });

    await expect(
      clickLinuxDesktop(
        {
          x: 10,
          y: 20,
          activeWindow
        },
        {
          env: { PATH: "", DISPLAY: ":0", XDG_SESSION_TYPE: "x11" }
        }
      )
    ).resolves.toMatchObject({
      supported: false,
      clicked: false
    });
  });

  it("preserves caller-provided screenshot paths", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agenthost-desktop-path-"));
    const screenshotPath = path.join(dir, "screen.png");
    await writeFile(screenshotPath, "fake", "utf8");

    await expect(
      captureLinuxScreenshot(
        {
          path: screenshotPath
        },
        {
          env: { PATH: "", DISPLAY: ":0", XDG_SESSION_TYPE: "x11" }
        }
      )
    ).resolves.toMatchObject({
      supported: false
    });
  });
});
