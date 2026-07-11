import { describe, expect, it } from "vitest";
import type { SandboxSupportProbeResult } from "@agenthost/core";
import { buildBubblewrapLaunchPlan, selectForgeRuntimeSandbox } from "../forge-os-sandbox.js";

const probe: SandboxSupportProbeResult = {
  platform: "linux", supported: true,
  availableBackends: [{ id: "bubblewrap", commandName: "bwrap", commandPath: "/usr/bin/bwrap", detected: true, usability: "candidate", reason: "available", limitations: [] }],
  unavailableBackends: [], recommendedBackend: "bubblewrap",
  kernelFeatures: { userNamespaces: { status: "available", reason: "available" }, seccomp: { status: "available", reason: "available" }, appArmor: { status: "unknown", reason: "unknown" }, flatpakContainer: { status: "unavailable", reason: "unavailable" } },
  limitations: [], requiresInstall: false, requiresSudo: false, safeForAgentHostUse: true, notes: []
};

describe("Forge OS sandbox selection", () => {
  it("auto selects Bubblewrap only with confirmed user namespaces", () => {
    expect(selectForgeRuntimeSandbox({ mode: "auto", probe })).toMatchObject({ backend: "bubblewrap", commandPath: "/usr/bin/bwrap", fallbackUsed: false });
  });

  it("auto falls back to fixed runner and explicit unavailable backend fails cleanly", () => {
    expect(selectForgeRuntimeSandbox({ mode: "auto", probe: undefined })).toMatchObject({ backend: "none", fallbackUsed: true });
    expect(selectForgeRuntimeSandbox({ mode: "bubblewrap", probe: undefined })).toMatchObject({ backend: "bubblewrap", fallbackUsed: false });
  });

  it("builds Bubblewrap arguments without shell, network, GUI, or host home", async () => {
    const plan = await buildBubblewrapLaunchPlan({
      commandPath: "/usr/bin/bwrap", nodePath: "/usr/bin/node", runnerPath: "/work/packages/mcp-server/dist/runtime/forge-runner.js",
      projectPath: "/work/project", manifestPath: "/work/project/agenthost.manifest.json", handlerPath: "/work/project/runtime/handler.json",
      toolName: "inspect", inputPath: "/work/run/input.json", outputPath: "/work/run/output.json", runDirectory: "/work/run", allowedOperations: ["input"]
    });
    expect(plan.command).toBe("/usr/bin/bwrap");
    expect(plan.args).toContain("--unshare-net");
    expect(plan.args).toContain("--clearenv");
    expect(plan.args).toContain("--ro-bind");
    expect(plan.args).toContain("/work/project");
    expect(plan.args).toContain("/project");
    expect(plan.args).toContain("/work/run");
    expect(plan.args).not.toContain("sudo");
    expect(plan.args.join(" ")).not.toMatch(/DISPLAY|WAYLAND|DBUS|OPENAI_API_KEY|HOME\/zfc/);
    expect(plan.envKeys).toEqual(["HOME", "TMPDIR", "LANG", "LC_ALL", "TZ", "NODE_ENV"]);
  });
});
