import { spawn } from "node:child_process";
import { LINUX_DESKTOP_REQUIREMENTS, aptPackagesFor, type LinuxDesktopRequirement } from "@agenthost/core";
import { findCommandPath, type LinuxLookupContext } from "./dependencies.js";

export interface RequirementStatus {
  name: string;
  aptPackage: string;
  required: boolean;
  impact: string;
  installed: boolean;
}

async function pythonImports(module: string): Promise<boolean> {
  return await new Promise((resolve) => {
    const child = spawn("python3", ["-I", "-c", `import ${module}`], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function satisfied(requirement: LinuxDesktopRequirement, context: LinuxLookupContext): Promise<boolean> {
  if ("command" in requirement.check) {
    // xsel is an equivalent clipboard backend.
    if (requirement.name === "xclip" && (await findCommandPath("xsel", context)) !== undefined) return true;
    return (await findCommandPath(requirement.check.command, context)) !== undefined;
  }
  return await pythonImports(requirement.check.pythonImport);
}

export async function checkLinuxRequirements(context: LinuxLookupContext = {}): Promise<RequirementStatus[]> {
  return await Promise.all(LINUX_DESKTOP_REQUIREMENTS.map(async (requirement) => ({
    name: requirement.name,
    aptPackage: requirement.aptPackage,
    required: requirement.required,
    impact: requirement.impact,
    installed: await satisfied(requirement, context)
  })));
}

export function missingAptPackages(statuses: RequirementStatus[]): string[] {
  return aptPackagesFor(LINUX_DESKTOP_REQUIREMENTS.filter((requirement) => statuses.some((status) => status.name === requirement.name && !status.installed)));
}

export interface InstallPlan {
  /** Executable plus arguments; never run through a shell. */
  command: string[];
  elevation: "pkexec" | "sudo";
}

/**
 * Builds an apt install that asks the user for permission: pkexec shows the
 * desktop password dialog, sudo prompts in a terminal. Undefined when apt or
 * an elevation helper is missing, in which case only advice is shown.
 */
export async function planAptInstall(packages: string[], interactiveTerminal: boolean, context: LinuxLookupContext = {}): Promise<InstallPlan | undefined> {
  if (packages.length === 0 || packages.some((name) => !/^[a-z0-9][a-z0-9.+-]+$/.test(name))) return undefined;
  const apt = await findCommandPath("apt-get", context);
  if (apt === undefined) return undefined;
  const sudo = interactiveTerminal ? await findCommandPath("sudo", context) : undefined;
  if (sudo !== undefined) return { command: [sudo, apt, "install", "-y", ...packages], elevation: "sudo" };
  const pkexec = await findCommandPath("pkexec", context);
  return pkexec === undefined ? undefined : { command: [pkexec, apt, "install", "-y", ...packages], elevation: "pkexec" };
}
