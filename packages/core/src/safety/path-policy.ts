import os from "node:os";
import path from "node:path";
import type {
  PathAccessMode,
  PathSafetyResult,
  PolicyProfile,
  RiskLevel,
  SafetyEvaluationContext
} from "../types.js";

const SYSTEM_ROOTS = ["/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/proc", "/root", "/run", "/sbin", "/sys", "/usr", "/var"];

const CREDENTIAL_ROOT_TEMPLATES = ["~/.ssh", "~/.gnupg", "~/.local/share/keyrings"];

const BROWSER_PROFILE_ROOT_TEMPLATES = [
  "~/.mozilla",
  "~/.config/google-chrome",
  "~/.config/chromium",
  "~/.config/BraveSoftware",
  "~/.config/microsoft-edge",
  "~/.config/opera",
  "~/.config/vivaldi",
  "~/snap/firefox/common/.mozilla",
  "~/Library/Application Support/Firefox",
  "~/Library/Application Support/Google/Chrome"
];

function expandHome(input: string, homeDir: string): string {
  if (input === "~") {
    return homeDir;
  }

  if (input.startsWith("~/")) {
    return path.join(homeDir, input.slice(2));
  }

  return input;
}

export function normalizePathForPolicy(inputPath: string, context: SafetyEvaluationContext = {}): string {
  const homeDir = context.homeDir ?? os.homedir();
  const cwd = context.cwd ?? process.cwd();
  const expanded = expandHome(inputPath, homeDir);
  return path.resolve(cwd, expanded);
}

function isInsideOrEqual(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function resolveAllowedWriteRoots(
  policy: PolicyProfile,
  context: SafetyEvaluationContext = {}
): string[] {
  const roots = policy.allowFileWriteRoots.map((root) => normalizePathForPolicy(root, context));

  if (context.agentHostDir !== undefined) {
    roots.push(normalizePathForPolicy(context.agentHostDir, context));
  }

  return unique(roots);
}

function controlPlaneRoots(agentHostDir: string | undefined, protectedPaths: string[] | undefined): string[] {
  const roots = [
    ...(agentHostDir === undefined
      ? []
      : [
          path.join(agentHostDir, "run"),
          path.join(agentHostDir, "tasks", "approvals"),
          path.join(agentHostDir, "logs"),
          path.join(agentHostDir, "setup"),
          path.join(agentHostDir, "config.json")
        ]),
    ...(protectedPaths ?? [])
  ];
  return unique(roots.map((root) => path.resolve(root)));
}

export function isAgentHostControlPath(inputPath: string, context: SafetyEvaluationContext = {}): boolean {
  const normalized = normalizePathForPolicy(inputPath, context);
  return controlPlaneRoots(context.agentHostDir, context.protectedPaths).some((root) => isInsideOrEqual(normalized, root));
}

function protectionForPath(
  normalizedPath: string,
  homeDir: string,
  agentHostDir: string | undefined,
  protectedPaths: string[] | undefined
): PathSafetyResult["protectionKind"] {
  if (normalizedPath === path.parse(normalizedPath).root) {
    return "root";
  }

  if (controlPlaneRoots(agentHostDir, protectedPaths).some((root) => isInsideOrEqual(normalizedPath, root))) {
    return "agenthost_control";
  }

  const credentialRoots = CREDENTIAL_ROOT_TEMPLATES.map((root) => normalizePathForPolicy(root, { homeDir }));

  if (credentialRoots.some((root) => isInsideOrEqual(normalizedPath, root))) {
    return "credential";
  }

  const browserRoots = BROWSER_PROFILE_ROOT_TEMPLATES.map((root) => normalizePathForPolicy(root, { homeDir }));

  if (browserRoots.some((root) => isInsideOrEqual(normalizedPath, root))) {
    return "browser_profile";
  }

  if (SYSTEM_ROOTS.some((root) => isInsideOrEqual(normalizedPath, root))) {
    return "system";
  }

  if (isInsideOrEqual(normalizedPath, homeDir)) {
    return "home";
  }

  return "none";
}

function pathRisk(
  access: PathAccessMode,
  protectionKind: PathSafetyResult["protectionKind"],
  isAllowedWriteRoot: boolean
): RiskLevel {
  if (protectionKind === "root" || protectionKind === "credential" || protectionKind === "browser_profile") {
    return "blocked";
  }

  if (protectionKind === "agenthost_control") {
    return access === "read" ? "medium" : "blocked";
  }

  if (protectionKind === "system") {
    return access === "read" ? "high" : "blocked";
  }

  if (access === "delete") {
    return protectionKind === "none" ? "high" : "blocked";
  }

  if (access === "write") {
    return isAllowedWriteRoot ? "medium" : "high";
  }

  if (protectionKind === "home" && isAllowedWriteRoot) {
    return "low";
  }

  return protectionKind === "none" ? "low" : "high";
}

export function classifyPath(
  inputPath: string,
  policy: PolicyProfile,
  context: SafetyEvaluationContext & { access?: PathAccessMode } = {}
): PathSafetyResult {
  const homeDir = context.homeDir ?? os.homedir();
  const access = context.access ?? "read";
  const normalizedPath = normalizePathForPolicy(inputPath, { ...context, homeDir });
  const allowedWriteRoots = resolveAllowedWriteRoots(policy, { ...context, homeDir });
  const isAllowedWriteRoot = allowedWriteRoots.some((root) => isInsideOrEqual(normalizedPath, root));
  const protectionKind = protectionForPath(normalizedPath, homeDir, context.agentHostDir, context.protectedPaths);
  const riskLevel = pathRisk(access, protectionKind, isAllowedWriteRoot);
  const reasons: string[] = [];
  const matchedRules: string[] = [];

  if (protectionKind !== "none") {
    reasons.push(`Path is protected as ${protectionKind}.`);
    matchedRules.push(`path.protected.${protectionKind}`);
  }

  if (access === "write" && isAllowedWriteRoot) {
    reasons.push("Path is inside an allowed write root.");
    matchedRules.push("path.write.allowed_root");
  }

  if (access === "write" && !isAllowedWriteRoot) {
    reasons.push("Path is outside allowed write roots.");
    matchedRules.push("path.write.outside_allowed_roots");
  }

  if (access === "delete") {
    reasons.push("Deleting files is high-risk by default.");
    matchedRules.push("path.delete");
  }

  return {
    inputPath,
    normalizedPath,
    access,
    isProtectedPath: protectionKind !== "none",
    protectionKind,
    isAllowedWriteRoot,
    allowedWriteRoots,
    riskLevel,
    reasons,
    matchedRules
  };
}
