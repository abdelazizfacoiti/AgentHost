import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  captureLinuxScreenshot,
  clearDesktopCapabilitiesCache,
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
    await writeFile(bin + "/xdotool", "#!/bin/sh\nSTATE=\"$(dirname \"$0\")/active-window\"\nif [ \"$1\" = \"getactivewindow\" ]; then\n  if [ -f \"$STATE\" ]; then cat \"$STATE\"; else echo \"99999\"; fi\n  exit 0\nfi\nif [ \"$1\" = \"windowactivate\" ]; then\n  shift\n  [ \"$1\" = \"--sync\" ] && shift\n  echo \"$1\" > \"$STATE\"\n  exit 0\nfi\nif [ \"$1\" = \"getwindowpid\" ]; then\n  echo \"$$\"\n  exit 0\nfi\nif [ \"$1\" = \"getwindowname\" ]; then\n  echo \"Test Window\"\n  exit 0\nfi\nexit 0\n", "utf8");
    await writeFile(bin + "/wmctrl", "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(bin + "/xdotool", 0o700);
    await chmod(bin + "/wmctrl", 0o700);
    const env = { PATH: bin, DISPLAY: ":0", XDG_SESSION_TYPE: "x11" };

    await expect(
      typeLinuxText({ text: "hello", activeWindow: { windowId: "99999" } }, { env })
    ).resolves.toMatchObject({ supported: true, typed: true, method: "direct" });

    await expect(
      focusLinuxWindow({ windowId: "12345" }, { env })
    ).resolves.toMatchObject({ supported: true, focused: true, backend: "xdotool", previousWindow: { windowId: "99999" } });
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
      "#!/bin/sh\nSTATE=\"$(dirname \"$0\")/active-window\"\nif [ \"$1\" = \"getactivewindow\" ]; then\n  if [ -f \"$STATE\" ]; then cat \"$STATE\"; else echo \"77777\"; fi\n  exit 0\nfi\nif [ \"$1\" = \"windowactivate\" ]; then\n  shift\n  [ \"$1\" = \"--sync\" ] && shift\n  echo \"$1\" > \"$STATE\"\n  exit 0\nfi\nif [ \"$1\" = \"getwindowpid\" ]; then\n  echo \"4242\"\n  if [ \"$3\" = \"getwindowname\" ]; then\n    echo \"Some Title\"\n  fi\n  exit 0\nfi\nexit 0\n",
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

  it("creates screenshot output directories before capture", async () => {
    const bin = await mkdtemp(path.join(os.tmpdir(), "agenthost-desktop-shot-bin-"));
    await writeFile(bin + "/scrot", "#!/bin/sh\nprintf 'png' > \"$1\"\n", "utf8");
    await chmod(bin + "/scrot", 0o700);
    const dir = await mkdtemp(path.join(os.tmpdir(), "agenthost-desktop-shot-parent-"));
    const outputPath = path.join(dir, "nested", "screen.png");

    await expect(
      captureLinuxScreenshot(
        { path: outputPath },
        { env: { PATH: bin, DISPLAY: ":0", XDG_SESSION_TYPE: "x11" } }
      )
    ).resolves.toMatchObject({
      supported: true,
      backend: "scrot",
      path: outputPath,
      bytesWritten: 3
    });
  });

  it("does not treat a stale screenshot file as a successful capture", async () => {
    const bin = await mkdtemp(path.join(os.tmpdir(), "agenthost-desktop-shot-fail-bin-"));
    await writeFile(bin + "/scrot", "#!/bin/sh\nexit 1\n", "utf8");
    await chmod(bin + "/scrot", 0o700);
    const dir = await mkdtemp(path.join(os.tmpdir(), "agenthost-desktop-shot-fail-"));
    const outputPath = path.join(dir, "screen.png");
    await writeFile(outputPath, "stale", "utf8");

    await expect(
      captureLinuxScreenshot(
        { path: outputPath },
        { env: { PATH: bin, DISPLAY: ":0", XDG_SESSION_TYPE: "x11" } }
      )
    ).resolves.toMatchObject({
      supported: false,
      backend: "scrot",
      reason: "The screenshot backend did not produce a non-empty image file."
    });
  });

  it("reports focus failure when neither backend changes the active window", async () => {
    const bin = await mkdtemp(path.join(os.tmpdir(), "agenthost-desktop-focus-fail-"));
    await writeFile(bin + "/xdotool", "#!/bin/sh\nif [ \"$1\" = \"getactivewindow\" ]; then echo \"99999\"; fi\nexit 0\n", "utf8");
    await writeFile(bin + "/wmctrl", "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(bin + "/xdotool", 0o700);
    await chmod(bin + "/wmctrl", 0o700);

    await expect(
      focusLinuxWindow(
        { windowId: "12345" },
        { env: { PATH: bin, DISPLAY: ":0", XDG_SESSION_TYPE: "x11" } }
      )
    ).resolves.toMatchObject({
      supported: true,
      focused: false,
      reason: "The window manager reported success, but the requested window did not become active."
    });
  });

  it("caches desktop capability probes between repeated observations", async () => {
    clearDesktopCapabilitiesCache();
    const bin = await mkdtemp(path.join(os.tmpdir(), "agenthost-desktop-cache-"));
    const counter = path.join(bin, "python-count");
    await writeFile(
      bin + "/python3",
      `#!/bin/sh\necho x >> "${counter}"\nprintf '%s\\n' '{"supported":false,"backend":"atspi","reason":"test"}'\n`,
      "utf8"
    );
    await chmod(bin + "/python3", 0o700);
    const env = { PATH: bin, DISPLAY: ":0", XDG_SESSION_TYPE: "x11" };

    await getLinuxDesktopCapabilities({ env });
    await getLinuxDesktopCapabilities({ env });
    await expect(readFile(counter, "utf8")).resolves.toBe("x\n");

    clearDesktopCapabilitiesCache();
    await getLinuxDesktopCapabilities({ env });
    await expect(readFile(counter, "utf8")).resolves.toBe("x\nx\n");
  });
  it("captures a scrot region natively and post-processes JPEG scale with ffmpeg", async () => {
    const bin = await mkdtemp(path.join(os.tmpdir(), "agenthost-desktop-shot-options-"));
    await writeFile(
      bin + "/scrot",
      "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$(dirname \"$0\")/scrot-args\"\nfor last; do :; done\nprintf 'png' > \"$last\"\n",
      "utf8"
    );
    await writeFile(
      bin + "/ffmpeg",
      "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$(dirname \"$0\")/ffmpeg-args\"\nfor last; do :; done\nprintf 'jpg' > \"$last\"\n",
      "utf8"
    );
    await chmod(bin + "/scrot", 0o700);
    await chmod(bin + "/ffmpeg", 0o700);
    const env = { PATH: bin, DISPLAY: ":0", XDG_SESSION_TYPE: "x11" };

    const native = await captureLinuxScreenshot(
      { path: path.join(bin, "region.png"), region: { x: 1, y: 2, width: 30, height: 40 } },
      { env }
    );
    expect(native).toMatchObject({ supported: true, backend: "scrot", path: path.join(bin, "region.png") });
    expect(await readFile(bin + "/scrot-args", "utf8")).toContain("-a\n1,2,30,40");

    const jpeg = await captureLinuxScreenshot(
      {
        path: path.join(bin, "region.jpg"),
        format: "jpeg",
        quality: 80,
        scale: 0.5,
        region: { x: 1, y: 2, width: 30, height: 40 }
      },
      { env }
    );
    expect(jpeg).toMatchObject({ supported: true, backend: "scrot+ffmpeg", path: path.join(bin, "region.jpg"), bytesWritten: 3 });
    const ffmpegArgs = await readFile(bin + "/ffmpeg-args", "utf8");
    expect(ffmpegArgs).toContain("-q:v");
    expect(ffmpegArgs).toContain("scale=");
  });

  it("rejects incompatible screenshot capture options before invoking a backend", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agenthost-desktop-shot-invalid-"));
    await expect(
      captureLinuxScreenshot(
        { path: path.join(dir, "screen.png"), includeActiveWindowOnly: true, region: { x: 0, y: 0, width: 10, height: 10 } },
        { env: { PATH: "", DISPLAY: ":0", XDG_SESSION_TYPE: "x11" } }
      )
    ).resolves.toMatchObject({ supported: false, reason: "Region capture cannot be combined with active-window capture." });
  });

});
