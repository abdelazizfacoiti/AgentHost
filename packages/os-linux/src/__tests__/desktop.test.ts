import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  captureLinuxScreenshot,
  clickLinuxDesktop,
  describeTypingStrategy,
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

  it("routes layout-unsafe characters to clipboard paste instead of xdotool type", () => {
    expect(describeTypingStrategy("hello world 123")).toBe("direct");
    expect(describeTypingStrategy("https://excalidraw.com/#room")).toBe("clipboard");
    expect(describeTypingStrategy("café :/")).toBe("clipboard");
  });

  it("types ASCII directly and reports the previous window on focus", async () => {
    const bin = await mkdtemp(path.join(os.tmpdir(), "agenthost-desktop-bin-"));
    // Emulates real xdotool: getactivewindow prints the wid on its own, while
    // getwindowpid/getwindowname print with an explicit wid. (Chained
    // `getactivewindow getwindowpid getwindowname` prints pid/title only.)
    await writeFile(bin + "/xdotool", "#!/bin/sh\nif [ \"$1\" = \"getactivewindow\" ]; then\n  echo \"99999\"\n  exit 0\nfi\nif [ \"$1\" = \"getwindowpid\" ]; then\n  echo \"$$\"\n  exit 0\nfi\nif [ \"$1\" = \"getwindowname\" ]; then\n  echo \"Test Window\"\n  exit 0\nfi\nexit 0\n", "utf8");
    await writeFile(bin + "/wmctrl", "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(bin + "/xdotool", 0o700);
    await chmod(bin + "/wmctrl", 0o700);
    const env = { PATH: bin, DISPLAY: ":0", XDG_SESSION_TYPE: "x11" };

    await expect(
      typeLinuxText({ text: "hello", activeWindow: { windowId: "99999" } }, { env })
    ).resolves.toMatchObject({ supported: true, typed: true, method: "direct" });

    await expect(
      focusLinuxWindow({ windowId: "12345" }, { env })
    ).resolves.toMatchObject({ supported: true, focused: true, previousWindow: { windowId: "99999" } });
  });

  it("refuses layout-unsafe typing without a clipboard backend", async () => {
    const bin = await mkdtemp(path.join(os.tmpdir(), "agenthost-desktop-bin-clip-"));
    await writeFile(bin + "/xdotool", "#!/bin/sh\necho \"99999\"\nexit 0\n", "utf8");
    await chmod(bin + "/xdotool", 0o700);
    const result = await typeLinuxText(
      { text: "a:b/c", activeWindow: { windowId: "99999" } },
      { env: { PATH: bin, DISPLAY: ":0", XDG_SESSION_TYPE: "x11" } }
    );
    expect(result).toMatchObject({ supported: false, typed: false, method: "clipboard" });
    expect(result.reason).toContain("xclip");
  });

  it("reads wid/pid/title from separate spawns and normalizes wmctrl hex ids", async () => {
    const bin = await mkdtemp(path.join(os.tmpdir(), "agenthost-desktop-ids-"));
    await writeFile(
      bin + "/xdotool",
      "#!/bin/sh\nif [ \"$1\" = \"getactivewindow\" ]; then\n  echo \"77777\"\n  exit 0\nfi\nif [ \"$1\" = \"getwindowpid\" ]; then\n  echo \"4242\"\n  if [ \"$3\" = \"getwindowname\" ]; then\n    echo \"Some Title\"\n  fi\n  exit 0\nfi\nexit 0\n",
      "utf8"
    );
    // 0x1234 == 4660: wmctrl hex ids must fold to the decimal xdotool form.
    await writeFile(bin + "/wmctrl", "#!/bin/sh\necho \"0x0001234 0 4242 0 0 800 600 N Some Title\"\nexit 0\n", "utf8");
    await chmod(bin + "/xdotool", 0o700);
    await chmod(bin + "/wmctrl", 0o700);
    const env = { PATH: bin, DISPLAY: ":0", XDG_SESSION_TYPE: "x11" };

    await expect(getLinuxActiveWindow({ env })).resolves.toMatchObject({
      supported: true,
      backend: "xdotool",
      activeWindow: { windowId: "77777", pid: 4242, title: "Some Title" }
    });

    const listed = await listLinuxWindows({ includeTitles: true }, { env });
    expect(listed.windows).toHaveLength(1);
    expect(listed.windows[0]).toMatchObject({ windowId: "4660", pid: 4242 });

    // Hex input focuses the same decimal window without a mismatch.
    await expect(focusLinuxWindow({ windowId: "0x0001234" }, { env })).resolves.toMatchObject({
      supported: true,
      focused: true,
      window: { windowId: "4660" }
    });
  });
});
