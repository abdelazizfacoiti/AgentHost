import { access } from "node:fs/promises";
import path from "node:path";
import type { ForgeRuntimeSandboxMode, SandboxSupportProbeResult } from "@agenthost/core";

export type ForgeRuntimeSandboxBackend = "none" | "bubblewrap" | "firejail" | "unshare";

export interface ForgeRuntimeSandboxSelection {
  requestedMode: ForgeRuntimeSandboxMode;
  backend: ForgeRuntimeSandboxBackend;
  commandPath?: string;
  fallbackUsed: boolean;
  limitations: string[];
}

export interface ForgeRuntimeLaunchPlan {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  envKeys: string[];
  commandSummary: string;
}

const SAFE_ENV = {
  HOME: "/home/sandbox",
  TMPDIR: "/tmp",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  TZ: "UTC",
  NODE_ENV: "production"
} as const;

function bwrapSupport(probe: SandboxSupportProbeResult | undefined) {
  const backend = probe?.availableBackends.find((candidate) => candidate.id === "bubblewrap");
  const userNamespaces = probe?.kernelFeatures.userNamespaces.status;
  return backend !== undefined && userNamespaces === "available" ? backend : undefined;
}

export function selectForgeRuntimeSandbox(input: {
  mode: ForgeRuntimeSandboxMode | undefined;
  probe: SandboxSupportProbeResult | undefined;
}): ForgeRuntimeSandboxSelection {
  const requestedMode = input.mode ?? "auto";
  const bubblewrap = bwrapSupport(input.probe);

  if (requestedMode === "none") {
    return { requestedMode, backend: "none", fallbackUsed: false, limitations: ["OS-level sandbox disabled by explicit local configuration; fixed runner limits remain active."] };
  }
  if (requestedMode === "bubblewrap" && bubblewrap !== undefined) {
    return { requestedMode, backend: "bubblewrap", commandPath: bubblewrap.commandPath, fallbackUsed: false, limitations: ["Bubblewrap isolates the fixed JSON runner; it does not authorize generated source execution."] };
  }
  if (requestedMode === "auto" && bubblewrap !== undefined) {
    return { requestedMode, backend: "bubblewrap", commandPath: bubblewrap.commandPath, fallbackUsed: false, limitations: ["Bubblewrap isolates the fixed JSON runner; it does not authorize generated source execution."] };
  }
  if (requestedMode === "auto") {
    return { requestedMode, backend: "none", fallbackUsed: true, limitations: ["No verified Bubblewrap backend is available; using existing fixed child runner without OS-level isolation."] };
  }
  if (requestedMode === "firejail" || requestedMode === "unshare") {
    return { requestedMode, backend: requestedMode, fallbackUsed: false, limitations: [`${requestedMode} is detected-only and is not enabled until AgentHost has a reviewed allow-only filesystem profile.`] };
  }
  return { requestedMode, backend: "bubblewrap", fallbackUsed: false, limitations: ["Bubblewrap is unavailable or user namespaces are not safely available."] };
}

function virtualPath(root: string, source: string, destination: string): string {
  const relative = path.relative(root, source);
  if (relative === "" || relative === ".") return destination;
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Sandbox path is outside its approved root.");
  return path.posix.join(destination, ...relative.split(path.sep));
}

export async function buildBubblewrapLaunchPlan(input: {
  commandPath: string;
  nodePath: string;
  runnerPath: string;
  projectPath: string;
  manifestPath: string;
  handlerPath: string;
  inputPath: string;
  outputPath: string;
  toolName: string;
  runDirectory: string;
  allowedOperations?: string[];
}): Promise<ForgeRuntimeLaunchPlan> {
  const runtimeDirectory = path.dirname(input.runnerPath);
  const project = path.resolve(input.projectPath);
  const run = path.resolve(input.runDirectory);
  const systemMounts = ["/usr", "/lib", "/lib64"];
  const readableSystemMounts: string[] = [];
  for (const mount of systemMounts) {
    try { await access(mount); readableSystemMounts.push(mount); } catch { /* Optional host runtime directory. */ }
  }
  if (!readableSystemMounts.includes("/usr")) throw new Error("Bubblewrap sandbox requires readable host /usr for fixed Node runner.");
  const args = [
    "--die-with-parent", "--new-session", "--unshare-user", "--uid", "0", "--gid", "0", "--unshare-pid", "--unshare-ipc", "--unshare-uts", "--unshare-net",
    "--clearenv",
    ...Object.entries(SAFE_ENV).flatMap(([key, value]) => ["--setenv", key, value]),
    "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
    "--dir", "/run", "--dir", "/run/agenthost", "--dir", "/home", "--dir", "/home/sandbox",
    "--dir", "/project", "--dir", "/agenthost", "--dir", "/agenthost/runtime",
    ...readableSystemMounts.flatMap((mount) => ["--ro-bind", mount, mount]),
    "--ro-bind", project, "/project",
    "--ro-bind", runtimeDirectory, "/agenthost/runtime",
    "--bind", run, "/run/agenthost",
    "--chdir", "/project",
    input.nodePath, "--no-addons", "--disable-proto=delete", "/agenthost/runtime/forge-runner.js",
    "--manifest", virtualPath(project, input.manifestPath, "/project"),
    "--project", "/project",
    "--tool", input.toolName,
    "--input", virtualPath(run, input.inputPath, "/run/agenthost"),
    "--output", virtualPath(run, input.outputPath, "/run/agenthost"),
    "--handler", virtualPath(project, input.handlerPath, "/project"),
    ...(input.allowedOperations === undefined ? [] : ["--allowed-operations", JSON.stringify(input.allowedOperations)])
  ];
  return { command: input.commandPath, args, cwd: project, env: {}, envKeys: Object.keys(SAFE_ENV), commandSummary: "bwrap fixed forge-runner with read-only project/runtime, writable per-run folder, and isolated network namespace" };
}
