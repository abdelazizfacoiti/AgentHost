import { describe, expect, it } from "vitest";
import {
  findLinuxAccessibilityElements,
  focusLinuxAccessibilityElement,
  getLinuxAccessibilityTree,
  inspectLinuxAccessibilityElement,
  invokeLinuxAccessibilityAction,
  routeLinuxAppStrategy,
  setLinuxAccessibilityValue
} from "../index.js";

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

  it("handles null candidate name safely in find results", async () => {
    const result = await findLinuxAccessibilityElements(
      {
        query: "File"
      },
      {
        env: { DISPLAY: ":0", XDG_SESSION_TYPE: "x11", PATH: "" },
        runAccessibilityQuery: async () => ({
          supported: true,
          backend: "atspi",
          reason: "Found accessibility element candidates through AT-SPI.",
          candidates: [
            {
              id: "1:0/1",
              role: "menu item",
              name: null,
              text: "File",
              confidence: 0.82,
              reason: "Matched accessibility query."
            }
          ]
        })
      }
    );

    expect(result).toMatchObject({
      supported: true,
      candidates: [
        {
          id: "1:0/1",
          role: "menu item",
          text: "File"
        }
      ]
    });
    expect(result.candidates[0]?.name).toBeUndefined();
  });

  it("handles null description safely in inspect results", async () => {
    const result = await inspectLinuxAccessibilityElement(
      {
        elementId: "1:0/1"
      },
      {
        env: { DISPLAY: ":0", XDG_SESSION_TYPE: "x11", PATH: "" },
        runAccessibilityQuery: async () => ({
          supported: true,
          backend: "atspi",
          matched: true,
          ambiguous: false,
          redacted: false,
          reason: "Resolved one accessibility element through AT-SPI.",
          element: {
            id: "1:0/1",
            role: "menu item",
            name: "File",
            description: null,
            states: ["enabled"],
            availableActions: ["click"]
          }
        })
      }
    );

    expect(result).toMatchObject({
      supported: true,
      element: {
        elementId: "1:0/1",
        role: "menu item",
        name: "File"
      }
    });
    expect(result.element?.description).toBeUndefined();
  });

  it("handles null role safely in find results", async () => {
    const result = await findLinuxAccessibilityElements(
      {
        query: "File"
      },
      {
        env: { DISPLAY: ":0", XDG_SESSION_TYPE: "x11", PATH: "" },
        runAccessibilityQuery: async () => ({
          supported: true,
          backend: "atspi",
          reason: "Found accessibility element candidates through AT-SPI.",
          candidates: [
            {
              id: "1:0/2",
              role: null,
              name: "File",
              text: null,
              confidence: 0.82,
              reason: null
            }
          ]
        })
      }
    );

    expect(result).toMatchObject({
      supported: true,
      candidates: [
        {
          id: "1:0/2",
          role: "unknown",
          name: "File",
          reason: "Matched accessibility query."
        }
      ]
    });
  });

  it("handles null value metadata safely in inspect results", async () => {
    const result = await inspectLinuxAccessibilityElement(
      {
        elementId: "1:0/2"
      },
      {
        env: { DISPLAY: ":0", XDG_SESSION_TYPE: "x11", PATH: "" },
        runAccessibilityQuery: async () => ({
          supported: true,
          backend: "atspi",
          matched: true,
          ambiguous: false,
          redacted: false,
          reason: "Resolved one accessibility element through AT-SPI.",
          element: {
            id: "1:0/2",
            role: "entry",
            name: "File name",
            description: "Editable field",
            states: ["enabled", "editable"],
            availableActions: ["focus"],
            valueMetadata: null
          }
        })
      }
    );

    expect(result).toMatchObject({
      supported: true,
      element: {
        elementId: "1:0/2",
        role: "entry",
        name: "File name"
      }
    });
    expect(result.element?.valueMetadata).toBeUndefined();
  });

  it("handles null text safely in find results", async () => {
    const result = await findLinuxAccessibilityElements(
      {
        query: "File"
      },
      {
        env: { DISPLAY: ":0", XDG_SESSION_TYPE: "x11", PATH: "" },
        runAccessibilityQuery: async () => ({
          supported: true,
          backend: "atspi",
          reason: "Found accessibility element candidates through AT-SPI.",
          candidates: [
            {
              id: "1:0/3",
              role: "menu item",
              name: "File",
              text: null,
              confidence: 0.82,
              reason: "Matched accessibility query."
            }
          ]
        })
      }
    );

    expect(result).toMatchObject({
      supported: true,
      candidates: [
        {
          id: "1:0/3",
          role: "menu item",
          name: "File"
        }
      ]
    });
    expect(result.candidates[0]?.text).toBeUndefined();
  });

  it("handles mixed valid and null candidate fields safely in find results", async () => {
    const result = await findLinuxAccessibilityElements(
      {
        query: "File",
        limit: 5
      },
      {
        env: { DISPLAY: ":0", XDG_SESSION_TYPE: "x11", PATH: "" },
        runAccessibilityQuery: async () => ({
          supported: true,
          backend: "atspi",
          reason: "Found accessibility element candidates through AT-SPI.",
          candidates: [
            {
              id: "1:0/4",
              role: null,
              name: null,
              text: null,
              confidence: 0.7,
              reason: null
            },
            {
              id: "1:0/5",
              role: "menu item",
              name: "File",
              text: "File",
              confidence: 0.9,
              reason: "Matched accessibility query."
            }
          ]
        })
      }
    );

    expect(result).toMatchObject({
      supported: true,
      candidates: [
        {
          id: "1:0/4",
          role: "unknown",
          reason: "Matched accessibility query."
        },
        {
          id: "1:0/5",
          role: "menu item",
          name: "File",
          text: "File"
        }
      ]
    });
  });

  it("returns unsupported inspect, invoke, set, and focus results when no display is available", async () => {
    await expect(
      inspectLinuxAccessibilityElement(
        {
          query: "Save"
        },
        {
          env: { PATH: "" }
        }
      )
    ).resolves.toMatchObject({
      supported: false,
      backend: "unavailable",
      matched: false
    });

    await expect(
      invokeLinuxAccessibilityAction(
        {
          query: "Save",
          actionName: "click"
        },
        {
          env: { PATH: "" }
        }
      )
    ).resolves.toMatchObject({
      supported: false,
      backend: "unavailable",
      performed: false
    });

    await expect(
      setLinuxAccessibilityValue(
        {
          query: "Name",
          value: "hello"
        },
        {
          env: { PATH: "" }
        }
      )
    ).resolves.toMatchObject({
      supported: false,
      backend: "unavailable",
      changed: false,
      redactedValue: true
    });

    await expect(
      focusLinuxAccessibilityElement(
        {
          query: "Save"
        },
        {
          env: { PATH: "" }
        }
      )
    ).resolves.toMatchObject({
      supported: false,
      backend: "unavailable",
      focused: false
    });
  });

  it("redacts secret accessibility metadata from mocked inspect results", async () => {
    const result = await inspectLinuxAccessibilityElement(
      {
        elementId: "123:0/1"
      },
      {
        env: { DISPLAY: ":0", XDG_SESSION_TYPE: "x11", PATH: "" },
        runAccessibilityQuery: async () => ({
          supported: true,
          backend: "atspi",
          matched: true,
          ambiguous: false,
          redacted: true,
          reason: "Resolved one accessibility element through AT-SPI.",
          element: {
            id: "123:0/1",
            role: "password text",
            name: "Password",
            description: "Secret field",
            states: ["enabled", "focusable"],
            availableActions: ["focus"],
            appName: "Keyring",
            pid: 123,
            sensitive: true,
            hidden: true,
            valueMetadata: {
              supportsText: true,
              supportsValue: false,
              editable: true,
              readOnly: false,
              textLength: 16
            }
          }
        })
      }
    );

    expect(result).toMatchObject({
      supported: true,
      matched: true,
      redacted: true,
      element: {
        elementId: "123:0/1",
        dataSensitivity: "secret",
        hidden: true,
        valueMetadata: {
          supportsText: true,
          editable: true
        }
      }
    });
    expect(JSON.stringify(result.element)).not.toContain("Secret field");
    expect(JSON.stringify(result.element)).not.toContain("16");
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
