import { describe, expect, it } from "vitest";
import { findLinuxAccessibilityElements, getLinuxAccessibilityTree, routeLinuxAppStrategy } from "../index.js";

describe("Linux accessibility helpers", () => {
  it("returns unsupported accessibility tree results when no display is available", async () => {
    await expect(
      getLinuxAccessibilityTree(
        {
          appName: "Notes",
          maxDepth: 2,
          maxNodes: 20
        },
        {
          env: { PATH: "" }
        }
      )
    ).resolves.toMatchObject({
      supported: false,
      backend: "unavailable",
      nodeCount: 0,
      truncated: false,
      redacted: false
    });
  });

  it("returns unsupported accessibility find results when no display is available", async () => {
    await expect(
      findLinuxAccessibilityElements(
        {
          appName: "Notes",
          query: "Save",
          limit: 5
        },
        {
          env: { PATH: "" }
        }
      )
    ).resolves.toMatchObject({
      supported: false,
      backend: "unavailable",
      candidates: []
    });
  });

  it("routes normal apps to accessibility before gui_control when accessibility is available", () => {
    expect(
      routeLinuxAppStrategy(
        {
          found: true,
          availableStrategies: ["accessibility", "gui_control", "guide_only"],
          appSensitivity: "normal",
          taskType: "automate"
        },
        {
          platform: "linux",
          sessionType: "x11",
          displayAvailable: true,
          backend: "x11",
          activeWindow: { supported: true, backend: "xdotool", reason: "ok" },
          screenshot: { supported: true, backend: "gnome-screenshot", reason: "ok" },
          windowList: { supported: true, backend: "wmctrl", reason: "ok" },
          windowFocus: { supported: true, backend: "wmctrl", reason: "ok" },
          accessibility: { supported: true, backend: "atspi", reason: "ok" },
          guiInput: { supported: true, backend: "xdotool", reason: "ok" }
        }
      )
    ).toBe("accessibility");
  });

  it("keeps sensitive apps on guide_only even if accessibility is available", () => {
    expect(
      routeLinuxAppStrategy(
        {
          found: true,
          availableStrategies: ["cli_or_script", "accessibility", "gui_control", "guide_only"],
          appSensitivity: "financial",
          taskType: "automate"
        },
        {
          platform: "linux",
          sessionType: "x11",
          displayAvailable: true,
          backend: "x11",
          activeWindow: { supported: true, backend: "xdotool", reason: "ok" },
          screenshot: { supported: true, backend: "gnome-screenshot", reason: "ok" },
          windowList: { supported: true, backend: "wmctrl", reason: "ok" },
          windowFocus: { supported: true, backend: "wmctrl", reason: "ok" },
          accessibility: { supported: true, backend: "atspi", reason: "ok" },
          guiInput: { supported: true, backend: "xdotool", reason: "ok" }
        }
      )
    ).toBe("guide_only");
  });
});
