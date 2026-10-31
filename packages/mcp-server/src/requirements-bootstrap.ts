import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkLinuxRequirements, missingAptPackages, planAptInstall, type InstallPlan, type RequirementStatus } from "@agenthost/os-linux";

export interface RequirementsBootstrapDeps {
  check(): Promise<RequirementStatus[]>;
  plan(packages: string[]): Promise<InstallPlan | undefined>;
  launch(plan: InstallPlan): void;
  notify(summary: string, body: string): void;
}

export interface RequirementsBootstrapResult {
  missing: string[];
  action: "none" | "already_offered" | "install_prompted" | "advice_only" | "disabled";
}

function detached(command: string, args: string[]): void {
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    /* Best effort. */
  }
}

const linuxDeps: RequirementsBootstrapDeps = {
  check: async () => await checkLinuxRequirements(),
  plan: async (packages) => await planAptInstall(packages, false),
  launch: (plan) => detached(plan.command[0]!, plan.command.slice(1)),
  notify: (summary, body) => detached("notify-send", ["-a", "AgentHost", summary, body])
};

/**
 * First-start dependency check. Installing system packages needs root, so it
 * is never silent: pkexec shows the desktop password dialog and the user
 * decides. The offer is recorded per missing-package set, so declining does
 * not re-prompt on every start; `agenthost setup deps --apply` retries.
 */
export async function bootstrapRequirements(agentHostDir: string, enabled: boolean, deps: RequirementsBootstrapDeps = linuxDeps): Promise<RequirementsBootstrapResult> {
  const marker = path.join(agentHostDir, "run", "requirements.json");
  const missing = missingAptPackages(await deps.check());
  if (missing.length === 0) return { missing, action: "none" };
  if (!enabled) return { missing, action: "disabled" };
  const key = [...missing].sort().join(" ");
  const previous = await readFile(marker, "utf8").then((text) => JSON.parse(text) as { offered?: string }).catch(() => undefined);
  if (previous?.offered === key) return { missing, action: "already_offered" };
  await mkdir(path.dirname(marker), { recursive: true, mode: 0o700 });
  await writeFile(marker, `${JSON.stringify({ offered: key, at: new Date().toISOString() })}\n`, { mode: 0o600 });
  const plan = await deps.plan(missing);
  if (plan === undefined) {
    deps.notify("AgentHost needs desktop packages", `Install with: sudo apt install ${missing.join(" ")}`);
    return { missing, action: "advice_only" };
  }
  deps.notify("AgentHost is installing desktop packages", `Approve the password prompt to install: ${missing.join(" ")}`);
  deps.launch(plan);
  return { missing, action: "install_prompted" };
}
