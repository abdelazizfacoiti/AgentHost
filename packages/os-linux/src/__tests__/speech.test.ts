import { describe, expect, it } from "vitest";
import { diagnoseLinuxSpeechRouting, discoverLinuxSpeechProviders, listLinuxSpeechDevices, listLinuxEspeakVoices } from "../speech.js";

describe("Linux speech discovery", () => {
  it("returns clean unavailable providers without attempting installation", async () => {
    const providers = await discoverLinuxSpeechProviders({ env: { PATH: "" } });
    expect(providers.map((item) => item.providerId)).toEqual(["espeak-ng", "piper", "speech-dispatcher"]);
    expect(providers.every((item) => item.local && item.offline)).toBe(true);
    expect(providers[0]).toMatchObject({ availability: "not_configured", installed: false, ready: false });
  });

  it("parses missing voices and routing as bounded unsupported results", async () => {
    expect(await listLinuxEspeakVoices({ env: { PATH: "" } })).toEqual([]);
    const routing = await diagnoseLinuxSpeechRouting({ env: { PATH: "" } });
    expect(routing).toMatchObject({ supported: false, existingVirtualRouteReady: false, redacted: true });
    expect(await listLinuxSpeechDevices({ env: { PATH: "" } })).toEqual([]);
  });
});
