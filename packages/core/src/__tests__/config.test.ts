import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadAgentHostConfig } from "../index.js";

describe("loadAgentHostConfig", () => {
  it("uses safe defaults", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-config-default-"));
    const config = await loadAgentHostConfig({ env: {}, homeDir });

    expect(config.agentHostDir).toBe(path.join(homeDir, ".agenthost"));
    expect(config.schemaVersion).toBe(1);
    expect(config.profile).toBe("general");
    expect(config.policy.name).toBe("general");
    expect(config.forgeRuntimeSandboxMode).toBe("auto");
    expect(config.overlayRendererMode).toBe("auto");
    expect(config.runtimeActivityOverlay).toEqual(expect.objectContaining({ enabled: true, position: "top_left", interactiveControls: false, screenshotSuppression: true, multiTaskSummary: true }));
    expect(config.browserBridge).toEqual(expect.objectContaining({
      enabled: false,
      port: 43117,
      pairingTokenFile: path.join(homeDir, ".agenthost", "browser", "pairing-token"),
      pairingStateFile: path.join(homeDir, ".agenthost", "browser", "paired-devices.json")
    }));
    expect(config.controlRoom).toEqual(expect.objectContaining({ enabled: false, port: 43118 }));
    expect(config.speech).toEqual(expect.objectContaining({ enabled: true, providerPreference: ["espeak-ng", "piper", "speech-dispatcher"] }));
  });

  it("loads explicit browser pairing state path without broad defaults", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-config-browser-"));
    const agentHostDir = path.join(homeDir, ".agenthost");
    await mkdir(agentHostDir, { recursive: true });
    const configPath = path.join(agentHostDir, "config.json");
    await writeFile(configPath, JSON.stringify({
      browserBridge: {
        enabled: true,
        port: 43119,
        pairingTokenFile: "~/.agenthost/browser/enrollment-token",
        pairingStateFile: "~/.agenthost/browser/devices.json"
      }
    }), "utf8");
    const config = await loadAgentHostConfig({ env: {}, homeDir, configPath });
    expect(config.browserBridge).toEqual({
      enabled: true,
      port: 43119,
      pairingTokenFile: path.join(homeDir, ".agenthost", "browser", "enrollment-token"),
      pairingStateFile: path.join(homeDir, ".agenthost", "browser", "devices.json")
    });
  });

  it("accepts explicit AGENTHOST_CONFIG path and schema version", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-config-explicit-"));
    const configPath = path.join(homeDir, "public-config.json");
    await writeFile(configPath, JSON.stringify({ schemaVersion: 1, profile: "dev" }), "utf8");
    const config = await loadAgentHostConfig({ env: { AGENTHOST_CONFIG: configPath }, homeDir });
    expect(config.configPath).toBe(configPath);
    expect(config.schemaVersion).toBe(1);
  });

  it("rejects configurable browser bridge hosts", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-config-browser-host-"));
    const agentHostDir = path.join(homeDir, ".agenthost");
    await mkdir(agentHostDir, { recursive: true });
    const configPath = path.join(agentHostDir, "config.json");
    await writeFile(configPath, JSON.stringify({
      browserBridge: { enabled: true, host: "0.0.0.0" }
    }), "utf8");
    await expect(loadAgentHostConfig({ env: {}, homeDir, configPath })).rejects.toThrow();
  });

  it("loads profile and paths from a config file", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-config-file-"));
    const agentHostDir = path.join(homeDir, ".agenthost");
    await mkdir(agentHostDir, { recursive: true });
    const configPath = path.join(agentHostDir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        profile: "dev",
        forgeRuntimeSandboxMode: "none",
        logFile: "~/agenthost-test-log.jsonl"
      }),
      "utf8"
    );

    const config = await loadAgentHostConfig({ env: {}, homeDir, configPath });

    expect(config.profile).toBe("dev");
    expect(config.forgeRuntimeSandboxMode).toBe("none");
    expect(config.logFile).toBe(path.join(homeDir, "agenthost-test-log.jsonl"));
  });

  it("round-trips bounded speech configuration without enabling providers implicitly", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-config-speech-"));
    const agentHostDir = path.join(homeDir, ".agenthost");
    await mkdir(agentHostDir, { recursive: true });
    const configPath = path.join(agentHostDir, "config.json");
    await writeFile(configPath, JSON.stringify({ speech: { enabled: false, providerPreference: ["piper", "espeak-ng"], defaultProvider: "piper", artifactTtlMs: 60000, maxTextChars: 1000, maxDurationMs: 10000, maxArtifactBytes: 1000000, synthesisTimeoutMs: 5000, playbackTimeoutMs: 20000 } }), "utf8");
    const config = await loadAgentHostConfig({ env: {}, homeDir, configPath });
    expect(config.speech).toMatchObject({ enabled: false, providerPreference: ["piper", "espeak-ng"], defaultProvider: "piper", artifactTtlMs: 60000, maxTextChars: 1000 });
    await writeFile(configPath, JSON.stringify({ speech: { defaultProvider: "cloud" } }), "utf8");
    await expect(loadAgentHostConfig({ env: {}, homeDir, configPath })).rejects.toThrow();
  });

  it("loads persistent grants from config and applies richer profile names", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-config-grants-"));
    const agentHostDir = path.join(homeDir, ".agenthost");
    await mkdir(agentHostDir, { recursive: true });
    const configPath = path.join(agentHostDir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        profile: "gui-dev",
        grants: [
          {
            id: "allow-output-write",
            scope: "persistent",
            effect: "allow",
            match: {
              tools: ["file.write"],
              fileRoots: ["~/.agenthost/outputs"]
            },
            requirements: {
              requiresDryRun: true,
              requiresConfirmationToken: true
            }
          }
        ]
      }),
      "utf8"
    );

    const config = await loadAgentHostConfig({ env: {}, homeDir, configPath });

    expect(config.profile).toBe("gui-dev");
    expect(config.policy.name).toBe("gui-dev");
    expect(config.policy.grants).toHaveLength(1);
    expect(config.policy.grants[0]).toMatchObject({
      id: "allow-output-write",
      scope: "persistent",
      effect: "allow",
      match: {
        tools: ["file.write"],
        fileRoots: ["~/.agenthost/outputs"]
      },
      requirements: {
        requiresDryRun: true,
        requiresConfirmationToken: true
      }
    });
  });

  it("round-trips every supported runtime grant field without adding defaults", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-config-runtime-grant-"));
    const agentHostDir = path.join(homeDir, ".agenthost");
    await mkdir(agentHostDir, { recursive: true });
    const configPath = path.join(agentHostDir, "config.json");
    await writeFile(configPath, JSON.stringify({
      optionalAdapters: { blender: { enabled: false } },
      grants: [{
        id: "runtime-full",
        scope: "persistent",
        effect: "allow",
        match: {
          generatedToolIds: ["artifact-1"],
          registrationIds: ["registration-1"],
          runtimeToolNames: ["inspect"],
          runtimeCapabilities: ["pure_compute", "read_runtime_input"],
          operationFamilies: ["forge_runtime"],
          operations: ["run_bounded_json"],
          targetFingerprints: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
          recipientFingerprints: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
          contentFingerprints: ["cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"],
          artifactFingerprints: ["dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"],
          channels: ["local"],
          routes: ["bubblewrap"],
          ownerSessionIds: ["session_test"],
          tools: ["forge.run_sandboxed_tool"]
        },
        requirements: {
          sandboxRoots: ["run", "temp"],
          outputRoots: ["run"],
          maxInputBytes: 1024,
          maxOutputBytes: 2048,
          maxRuntimeMs: 3000,
          allowedOperations: ["const", "input", "object"]
        }
      }]
    }), "utf8");

    const config = await loadAgentHostConfig({ env: {}, homeDir, configPath });
    expect(config.optionalAdapters).toEqual({ blender: { enabled: false } });
    expect(config.policy.grants.find((grant) => grant.id === "runtime-full")).toMatchObject({
      match: {
        generatedToolIds: ["artifact-1"],
        registrationIds: ["registration-1"],
        runtimeToolNames: ["inspect"],
        runtimeCapabilities: ["pure_compute", "read_runtime_input"],
        operationFamilies: ["forge_runtime"],
        operations: ["run_bounded_json"],
        targetFingerprints: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
        recipientFingerprints: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
        contentFingerprints: ["cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"],
        artifactFingerprints: ["dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"],
        channels: ["local"],
        routes: ["bubblewrap"],
        ownerSessionIds: ["session_test"]
      },
      requirements: {
        sandboxRoots: ["run", "temp"],
        outputRoots: ["run"],
        maxInputBytes: 1024,
        maxOutputBytes: 2048,
        maxRuntimeMs: 3000,
        allowedOperations: ["const", "input", "object"]
      }
    });
  });

  it("rejects unknown and over-broad runtime grant fields", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-config-runtime-invalid-"));
    const agentHostDir = path.join(homeDir, ".agenthost");
    await mkdir(agentHostDir, { recursive: true });
    const configPath = path.join(agentHostDir, "config.json");
    await writeFile(configPath, JSON.stringify({ grants: [{ id: "bad", scope: "persistent", effect: "allow", match: { unknown: ["x"] } }] }), "utf8");
    await expect(loadAgentHostConfig({ env: {}, homeDir, configPath })).rejects.toThrow();
    await writeFile(configPath, JSON.stringify({ grants: [{ id: "bad", scope: "persistent", effect: "allow", match: { runtimeCapabilities: ["network_fetch"] } }] }), "utf8");
    await expect(loadAgentHostConfig({ env: {}, homeDir, configPath })).rejects.toThrow();
    await writeFile(configPath, JSON.stringify({ grants: [{ id: "bad", scope: "persistent", effect: "allow", match: { runtimeCapabilities: ["pure_compute"] }, requirements: { maxRuntimeMs: 5001 } }] }), "utf8");
    await expect(loadAgentHostConfig({ env: {}, homeDir, configPath })).rejects.toThrow();
    await writeFile(configPath, JSON.stringify({ grants: [{ id: "bad", scope: "persistent", effect: "allow", match: { targetFingerprints: ["not-a-fingerprint"] } }] }), "utf8");
    await expect(loadAgentHostConfig({ env: {}, homeDir, configPath })).rejects.toThrow();
  });

  it("loads local demo profile", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-config-demo-"));
    const config = await loadAgentHostConfig({ env: { AGENTHOST_PROFILE: "demo-unlocked-local" }, homeDir });
    expect(config.policy.name).toBe("demo-unlocked-local");
    expect(config.policy.allowFileWriteRoots).toContain("~/Desktop/agenthost-demo");
    expect(config.policy.grants.some((grant) => grant.id === "demo-unlocked-local.runtime-supported")).toBe(true);
  });

  it("allows environment to override Forge sandbox mode", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-config-sandbox-"));
    const config = await loadAgentHostConfig({ env: { AGENTHOST_FORGE_RUNTIME_SANDBOX_MODE: "bubblewrap" }, homeDir });
    expect(config.forgeRuntimeSandboxMode).toBe("bubblewrap");
  });

  it("allows explicitly selecting the local overlay renderer mode", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-config-overlay-"));
    const config = await loadAgentHostConfig({ env: { AGENTHOST_OVERLAY_MODE: "gtk3-x11" }, homeDir });
    expect(config.overlayRendererMode).toBe("gtk3-x11");
  });

  it("loads and validates Control Room configuration", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-config-control-room-"));
    const config = await loadAgentHostConfig({ env: { AGENTHOST_CONTROL_ROOM_ENABLED: "1", AGENTHOST_CONTROL_ROOM_PORT: "43119" }, homeDir });
    expect(config.controlRoom).toMatchObject({ enabled: true, port: 43119, accessTokenFile: path.join(homeDir, ".agenthost", "control-room", "access-token") });
  });

  it("rejects Control Room token paths outside AgentHost home", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-config-control-room-path-"));
    await expect(loadAgentHostConfig({ env: { AGENTHOST_CONTROL_ROOM_TOKEN_FILE: "/tmp/control-room-token" }, homeDir })).rejects.toThrow("control_room_token_path_outside_agenthost");
  });

  it("defaults execution placement to foreground", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-config-placement-"));
    const config = await loadAgentHostConfig({ env: {}, homeDir });
    expect(config.execution).toEqual({ placement: "foreground" });
  });

  it("allows background execution placement from file and environment", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-config-placement-bg-"));
    const agentHostDir = path.join(homeDir, ".agenthost");
    await mkdir(agentHostDir, { recursive: true });
    await writeFile(path.join(agentHostDir, "config.json"), JSON.stringify({ execution: { placement: "background" } }), "utf8");
    const fromFile = await loadAgentHostConfig({ env: {}, homeDir, configPath: path.join(agentHostDir, "config.json") });
    expect(fromFile.execution).toEqual({ placement: "background" });
    const fromEnv = await loadAgentHostConfig({ env: { AGENTHOST_EXECUTION_PLACEMENT: "foreground" }, homeDir, configPath: path.join(agentHostDir, "config.json") });
    expect(fromEnv.execution).toEqual({ placement: "foreground" });
  });
});
