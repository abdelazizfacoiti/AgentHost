import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  captureLinuxScreenshot,
  clickLinuxDesktop,
  focusLinuxWindow,
  getLinuxActiveWindow,
  getLinuxDesktopCapabilities,
  listLinuxWindows,
  sendLinuxHotkey,
  typeLinuxText,
  xdotoolHotkeyArguments
} from "../index.js";

describe("Linux desktop helpers", () => {
  it("passes hotkey chords to xdotool as one key sequence", () => {
    expect(xdotoolHotkeyArguments(["CTRL", "L"])).toEqual(["key", "CTRL+L"]);
    expect(xdotoolHotkeyArguments(["CTRL+SHIFT", "P"])).toEqual(["key", "CTRL+SHIFT+P"]);
  });

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

  it("reports structured desktop capabilities for Wayland without safe backends", async () => {
    await expect(
      getLinuxDesktopCapabilities({
        env: { PATH: "", WAYLAND_DISPLAY: "wayland-0", XDG_SESSION_TYPE: "wayland" }
      })
    ).resolves.toMatchObject({
      platform: "linux",
      sessionType: "wayland",
      displayAvailable: true,
      backend: "wayland",
      activeWindow: {
        supported: false,
        backend: "wayland"
      },
      windowList: {
        supported: false,
        backend: "wayland"
      },
      accessibility: {
        supported: false
      }
    });
  });

  it("returns clean unsupported results for window listing on Wayland", async () => {
    await expect(
      listLinuxWindows(
        { includeTitles: true },
        {
          env: { PATH: "", WAYLAND_DISPLAY: "wayland-0", XDG_SESSION_TYPE: "wayland" }
        }
      )
    ).resolves.toMatchObject({
      supported: false,
      backend: "wayland",
      windows: [],
      reason: "Wayland window listing is unavailable with the current safe backends."
    });
  });

  it("returns clean unsupported results for window focus on Wayland", async () => {
    await expect(
      focusLinuxWindow(
        { appName: "Notes" },
        {
          env: { PATH: "", WAYLAND_DISPLAY: "wayland-0", XDG_SESSION_TYPE: "wayland" }
        }
      )
    ).resolves.toMatchObject({
      supported: false,
      backend: "wayland",
      focused: false,
      reason: "Wayland window listing is unavailable with the current safe backends."
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
