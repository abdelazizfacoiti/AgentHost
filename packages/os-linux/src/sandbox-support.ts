import { readFile } from "node:fs/promises";
import type {
  SandboxBackendId,
  SandboxBackendSupport,
  SandboxBackendUnavailable,
  SandboxFeatureStatus,
  SandboxSupportProbeResult
} from "@agenthost/core";
import { findCommandPath, type LinuxLookupContext } from "./dependencies.js";

export interface SandboxProbeContext extends LinuxLookupContext {
  /** Test seam; production only resolves a command on PATH and never executes it. */
  findCommand?: (command: string) => Promise<string | undefined>;
  /** Test seam for bounded, read-only kernel feature probes. */
  readText?: (filePath: string) => Promise<string>;
  platform?: string;
}

interface BackendCandidate {
  id: SandboxBackendId;
  commandNames: string[];
  usability: SandboxBackendSupport["usability"];
  reason: string;
  limitations: string[];
}

const BACKEND_CANDIDATES: BackendCandidate[] = [
  {
    id: "bubblewrap",
    commandNames: ["bwrap", "bubblewrap"],
    usability: "candidate",
    reason: "Bubblewrap is a small, purpose-built userspace sandbox candidate.",
    limitations: ["A later phase must choose a safe profile and verify user-namespace support."]
  },
  {
    id: "firejail",
    commandNames: ["firejail"],
    usability: "limited",
    reason: "Firejail is present but requires a reviewed, narrowly scoped profile before use.",
    limitations: ["No Firejail profile is selected or executed by this probe."]
  },
  {
    id: "unshare",
    commandNames: ["unshare"],
    usability: "limited",
    reason: "The util-linux namespace helper is present.",
    limitations: ["Unshare alone is not an AgentHost sandbox policy or filesystem boundary."]
  },
  {
    id: "flatpak-spawn",
    commandNames: ["flatpak-spawn"],
    usability: "informational",
    reason: "Flatpak's host spawn helper is present.",
    limitations: ["It is only an informational backend until an explicit Flatpak app/container exists."]
  },
  {
    id: "nsjail",
    commandNames: ["nsjail"],
    usability: "candidate",
    reason: "NsJail is present and may provide reviewed namespace and resource limits.",
    limitations: ["No NsJail policy is selected or executed by this probe."]
  },
  {
    id: "systemd-run",
    commandNames: ["systemd-run"],
    usability: "limited",
    reason: "systemd-run is present and can be useful for resource accounting.",
    limitations: ["It is not by itself a complete filesystem or network sandbox."]
  }
];

const USERNS_CLONE_PATH = "/proc/sys/kernel/unprivileged_userns_clone";
const MAX_USERNS_PATH = "/proc/sys/user/max_user_namespaces";
const SECCOMP_PATH = "/proc/self/status";
const APPARMOR_ENABLED_PATH = "/sys/module/apparmor/parameters/enabled";
const APPARMOR_PROFILE_PATH = "/proc/self/attr/current";
const FLATPAK_INFO_PATH = "/.flatpak-info";

function defaultReadText(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

function unavailable(id: SandboxBackendId, reason: string): SandboxBackendUnavailable {
  return { id, detected: false, reason };
}

async function readOptional(path: string, context: SandboxProbeContext): Promise<{ ok: true; value: string } | { ok: false; reason: string }> {
  try {
    return { ok: true, value: await (context.readText ?? defaultReadText)(path) };
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unavailable";
    return { ok: false, reason: code === "ENOENT" ? "Not present." : "Not readable." };
  }
}

function feature(status: SandboxFeatureStatus["status"], reason: string): SandboxFeatureStatus {
  return { status, reason };
}

async function detectUserNamespaces(context: SandboxProbeContext): Promise<SandboxFeatureStatus> {
  const [clone, maximum] = await Promise.all([
    readOptional(USERNS_CLONE_PATH, context),
    readOptional(MAX_USERNS_PATH, context)
  ]);

  const cloneValue = clone.ok ? clone.value.trim() : undefined;
  const maxValue = maximum.ok ? Number.parseInt(maximum.value.trim(), 10) : undefined;

  if (cloneValue === "0" || maxValue === 0) {
    return feature("unavailable", "The kernel explicitly disables unprivileged user namespaces.");
  }

  if (cloneValue === "1" || (maxValue !== undefined && Number.isFinite(maxValue) && maxValue > 0)) {
    if (clone.ok && maximum.ok) {
      return feature("available", "Kernel user-namespace controls permit unprivileged namespaces.");
    }

    return feature("unknown", "One user-namespace control is readable, but the other is unavailable.");
  }

  return feature("unknown", "Kernel user-namespace settings could not be safely determined.");
}

async function detectSeccomp(context: SandboxProbeContext): Promise<SandboxFeatureStatus> {
  const status = await readOptional(SECCOMP_PATH, context);

  if (!status.ok) {
    return feature("unknown", "The current process status is not readable.");
  }

  const seccomp = status.value.split(/\r?\n/).find((line) => line.startsWith("Seccomp:"));
  const filters = status.value.split(/\r?\n/).find((line) => line.startsWith("Seccomp_filters:"));

  if (seccomp === undefined && filters === undefined) {
    return feature("unknown", "This kernel does not expose a recognizable seccomp status field.");
  }

  const seccompMode = Number.parseInt(seccomp?.split(":")[1]?.trim() ?? "0", 10);
  const filterCount = Number.parseInt(filters?.split(":")[1]?.trim() ?? "0", 10);

  return seccompMode > 0 || filterCount > 0
    ? feature("available", "The current AgentHost process reports seccomp support or an active filter.")
    : feature("available", "The kernel exposes seccomp status for the current process.");
}

async function detectAppArmor(context: SandboxProbeContext): Promise<SandboxFeatureStatus> {
  const enabled = await readOptional(APPARMOR_ENABLED_PATH, context);

  if (enabled.ok) {
    const value = enabled.value.trim().toLowerCase();
    if (value === "y" || value === "yes" || value === "1") {
      return feature("available", "The kernel AppArmor module reports enabled.");
    }
    if (value === "n" || value === "no" || value === "0") {
      return feature("unavailable", "The kernel AppArmor module reports disabled.");
    }
  }

  const profile = await readOptional(APPARMOR_PROFILE_PATH, context);
  return profile.ok
    ? feature("unknown", "An AppArmor process label is visible, but module state is not confirmed.")
    : feature("unknown", "AppArmor state could not be safely determined.");
}

async function detectFlatpakContainer(context: SandboxProbeContext): Promise<SandboxFeatureStatus> {
  const marker = await readOptional(FLATPAK_INFO_PATH, context);
  return marker.ok
    ? feature("available", "This process appears to run inside a Flatpak container.")
    : marker.reason === "Not present."
      ? feature("unavailable", "No Flatpak container marker is present.")
      : feature("unknown", "The Flatpak container marker is not readable.");
}

function chooseRecommendation(
  available: SandboxBackendSupport[],
  userNamespaces: SandboxFeatureStatus
): SandboxBackendId | null {
  const rank: SandboxBackendId[] = ["bubblewrap", "nsjail", "firejail", "unshare", "systemd-run", "flatpak-spawn"];
  return rank.find((id) => {
    const candidate = available.find((entry) => entry.id === id);
    if (candidate === undefined) return false;
    return !(id === "bubblewrap" || id === "unshare") || userNamespaces.status !== "unavailable";
  }) ?? null;
}

export async function probeLinuxSandboxSupport(context: SandboxProbeContext = {}): Promise<SandboxSupportProbeResult> {
  const findCommand = context.findCommand ?? ((command: string) => findCommandPath(command, context));
  const availableBackends: SandboxBackendSupport[] = [];
  const unavailableBackends: SandboxBackendUnavailable[] = [];

  for (const candidate of BACKEND_CANDIDATES) {
    let commandPath: string | undefined;
    let commandName: string | undefined;
    for (const name of candidate.commandNames) {
      commandPath = await findCommand(name);
      if (commandPath !== undefined) {
        commandName = name;
        break;
      }
    }

    if (commandPath === undefined || commandName === undefined) {
      unavailableBackends.push(unavailable(candidate.id, `No ${candidate.commandNames.join(" or ")} executable was found on PATH.`));
      continue;
    }

    availableBackends.push({
      id: candidate.id,
      commandName,
      commandPath,
      detected: true,
      usability: candidate.usability,
      reason: candidate.reason,
      limitations: candidate.limitations
    });
  }

  const [userNamespaces, seccomp, appArmor, flatpakContainer] = await Promise.all([
    detectUserNamespaces(context),
    detectSeccomp(context),
    detectAppArmor(context),
    detectFlatpakContainer(context)
  ]);
  const recommendedBackend = chooseRecommendation(availableBackends, userNamespaces);
  const onlyNamespaceBackends = availableBackends.every((backend) => backend.id === "bubblewrap" || backend.id === "unshare");
  const supported = availableBackends.length > 0 && !(onlyNamespaceBackends && userNamespaces.status === "unavailable");

  return {
    platform: context.platform ?? process.platform,
    supported,
    availableBackends,
    unavailableBackends,
    recommendedBackend,
    kernelFeatures: {
      userNamespaces,
      seccomp,
      appArmor,
      flatpakContainer
    },
    limitations: [
      "This is a read-only availability probe; no backend command is executed.",
      "Availability does not prove a complete AgentHost sandbox policy or safe configuration.",
      "AgentHost does not enable OS-level sandbox execution in this phase."
    ],
    requiresInstall: availableBackends.length === 0,
    requiresSudo: false,
    safeForAgentHostUse: false,
    notes: [
      "Command detection resolves fixed executable names on PATH using filesystem checks only.",
      "No sudo, package manager, network, generated code, or system setting was used."
    ]
  };
}
