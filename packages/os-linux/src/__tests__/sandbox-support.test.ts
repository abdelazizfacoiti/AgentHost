import { describe, expect, it } from "vitest";
import { probeLinuxSandboxSupport } from "../sandbox-support.js";

const paths = {
  "/proc/sys/kernel/unprivileged_userns_clone": "1\n",
  "/proc/sys/user/max_user_namespaces": "15000\n",
  "/proc/self/status": "Name:\tnode\nSeccomp:\t0\nSeccomp_filters:\t0\n",
  "/sys/module/apparmor/parameters/enabled": "Y\n",
  "/proc/self/attr/current": "unconfined\n"
};

function readText(filePath: string): Promise<string> {
  const value = paths[filePath as keyof typeof paths];
  return value === undefined ? Promise.reject({ code: "ENOENT" }) : Promise.resolve(value);
}

describe("Linux sandbox support probe", () => {
  it("returns available fixed backends and kernel feature statuses without running commands", async () => {
    const requested: string[] = [];
    const result = await probeLinuxSandboxSupport({
      platform: "linux",
      findCommand: async (command) => {
        requested.push(command);
        return command === "bwrap" || command === "unshare" ? `/usr/bin/${command}` : undefined;
      },
      readText
    });

    expect(result).toMatchObject({
      platform: "linux",
      supported: true,
      recommendedBackend: "bubblewrap",
      requiresInstall: false,
      requiresSudo: false,
      safeForAgentHostUse: false,
      kernelFeatures: {
        userNamespaces: { status: "available" },
        seccomp: { status: "available" },
        appArmor: { status: "available" },
        flatpakContainer: { status: "unavailable" }
      }
    });
    expect(result.availableBackends.map((backend) => backend.id)).toEqual(["bubblewrap", "unshare"]);
    expect(result.unavailableBackends.map((backend) => backend.id)).toEqual([
      "firejail",
      "flatpak-spawn",
      "nsjail",
      "systemd-run"
    ]);
    expect(requested).not.toContain("sudo");
    expect(requested).not.toContain("apt");
    expect(requested).not.toContain("npm");
  });

  it("returns a stable unavailable result when no backend is installed", async () => {
    const result = await probeLinuxSandboxSupport({
      platform: "linux",
      findCommand: async () => undefined,
      readText
    });

    expect(result.supported).toBe(false);
    expect(result.availableBackends).toEqual([]);
    expect(result.recommendedBackend).toBeNull();
    expect(result.requiresInstall).toBe(true);
    expect(result.requiresSudo).toBe(false);
    expect(result.unavailableBackends).toHaveLength(6);
    expect(Object.keys(result)).toEqual([
      "platform",
      "supported",
      "availableBackends",
      "unavailableBackends",
      "recommendedBackend",
      "kernelFeatures",
      "limitations",
      "requiresInstall",
      "requiresSudo",
      "safeForAgentHostUse",
      "notes"
    ]);
  });

  it("does not claim namespace-only support when the kernel explicitly disables user namespaces", async () => {
    const result = await probeLinuxSandboxSupport({
      platform: "linux",
      findCommand: async (command) => (command === "bwrap" ? "/usr/bin/bwrap" : undefined),
      readText: async (filePath) => {
        if (filePath === "/proc/sys/kernel/unprivileged_userns_clone") return "0\n";
        if (filePath === "/proc/sys/user/max_user_namespaces") return "0\n";
        return readText(filePath);
      }
    });

    expect(result.supported).toBe(false);
    expect(result.recommendedBackend).toBeNull();
    expect(result.kernelFeatures.userNamespaces.status).toBe("unavailable");
  });
});
