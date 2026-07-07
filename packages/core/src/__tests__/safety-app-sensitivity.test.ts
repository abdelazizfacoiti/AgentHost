import { describe, expect, it } from "vitest";
import { classifyAppSensitivity } from "../index.js";

describe("classifyAppSensitivity", () => {
  it("classifies communication apps and sites", () => {
    expect(classifyAppSensitivity({ appName: "Gmail" })).toBe("communication");
    expect(classifyAppSensitivity({ url: "https://slack.com/app" })).toBe("communication");
    expect(classifyAppSensitivity({ appName: "Discord" })).toBe("communication");
  });

  it("classifies financial/payment apps and sites", () => {
    expect(classifyAppSensitivity({ appName: "banking portal" })).toBe("financial");
    expect(classifyAppSensitivity({ url: "https://checkout.example.test" })).toBe("financial");
    expect(classifyAppSensitivity({ appName: "crypto wallet" })).toBe("financial");
  });

  it("classifies credential and security apps", () => {
    expect(classifyAppSensitivity({ appName: "Bitwarden" })).toBe("credential_or_security");
    expect(classifyAppSensitivity({ appName: "SSH key manager" })).toBe("credential_or_security");
    expect(classifyAppSensitivity({ appName: "Keyring" })).toBe("credential_or_security");
  });

  it("classifies system settings and normal apps", () => {
    expect(classifyAppSensitivity({ appName: "GNOME Settings" })).toBe("system_settings");
    expect(classifyAppSensitivity({ appName: "GIMP" })).toBe("normal");
    expect(classifyAppSensitivity({ appName: "LibreOffice Writer" })).toBe("normal");
  });

  it("defaults missing or unrecognized app context to unknown", () => {
    expect(classifyAppSensitivity({})).toBe("unknown");
    expect(classifyAppSensitivity({ appName: "Mystery App" })).toBe("unknown");
  });
});
