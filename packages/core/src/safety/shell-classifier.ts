import type { PolicyProfile, RiskLevel, SafetyDecision, SafetyEvaluationContext } from "../types.js";
import { evaluateApprovalRequirement, isApprovalSatisfied } from "./approval.js";
import { classifyAppSensitivity } from "./app-sensitivity.js";
import { classifyPath } from "./path-policy.js";

interface ShellRule {
  id: string;
  pattern: RegExp;
  riskLevel: RiskLevel;
  reason: string;
}

const SHELL_RULES: ShellRule[] = [
  {
    id: "shell.rm_rf",
    pattern: /\brm\s+(?:-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)\b/i,
    riskLevel: "high",
    reason: "Recursive forced deletion is dangerous."
  },
  {
    id: "shell.sudo",
    pattern: /(^|\s)sudo(\s|$)/i,
    riskLevel: "blocked",
    reason: "sudo is not allowed."
  },
  {
    id: "shell.dd_if",
    pattern: /(^|\s)dd\s+[^|;&]*\bif=/i,
    riskLevel: "high",
    reason: "dd can overwrite disks or copy sensitive device data."
  },
  {
    id: "shell.mkfs",
    pattern: /(^|\s)mkfs(?:\.[a-z0-9]+)?(\s|$)/i,
    riskLevel: "blocked",
    reason: "Filesystem formatting is destructive."
  },
  {
    id: "shell.chmod_777_root",
    pattern: /\bchmod\s+-R\s+777\s+\/(?:\s|$)/i,
    riskLevel: "blocked",
    reason: "Changing root permissions recursively is unsafe."
  },
  {
    id: "shell.chown_recursive",
    pattern: /\bchown\s+-R\b/i,
    riskLevel: "high",
    reason: "Recursive ownership changes can damage system or user files."
  },
  {
    id: "shell.curl_pipe_bash",
    pattern: /\bcurl\b[\s\S]*\|[\s\S]*\b(?:bash|sh)\b/i,
    riskLevel: "high",
    reason: "Piping downloaded content into a shell is dangerous."
  },
  {
    id: "shell.wget_pipe_sh",
    pattern: /\bwget\b[\s\S]*\|[\s\S]*\b(?:bash|sh)\b/i,
    riskLevel: "high",
    reason: "Piping downloaded content into a shell is dangerous."
  },
  {
    id: "shell.kill_all",
    pattern: /\bkill\s+-9\s+-1\b/i,
    riskLevel: "blocked",
    reason: "Killing all accessible processes is destructive."
  },
  {
    id: "shell.shell_wrapper",
    pattern: /(^|\s)(?:bash|dash|fish|sh|zsh)\s+-c(\s|$)/i,
    riskLevel: "blocked",
    reason: "Shell wrapper execution is not allowed."
  },
  {
    id: "shell.metacharacter",
    pattern: /[`$][(]|[;&|<>]/,
    riskLevel: "blocked",
    reason: "Shell metacharacters require a shell and are not allowed."
  },
  {
    id: "shell.destructive_file_command",
    pattern: /(^|\s)(?:rm|rmdir|shred|truncate|unlink)(\s|$)/i,
    riskLevel: "blocked",
    reason: "Destructive file commands are not allowed."
  },
  {
    id: "shell.package_or_system_change",
    pattern: /(^|\s)(?:apt|apt-get|dnf|yum|pacman|zypper|snap|flatpak|systemctl|service)\s+(?:install|remove|purge|upgrade|dist-upgrade|update|start|stop|restart|enable|disable)\b/i,
    riskLevel: "blocked",
    reason: "Package installation or system service changes are not allowed in Phase 3."
  }
];

const PATH_FRAGMENT_PATTERN = /(?:~\/[^\s'"|;&]+|\/[A-Za-z0-9._~+/@:-]+)/g;

const RISK_ORDER: RiskLevel[] = ["observe", "low", "medium", "high", "blocked"];

function maxRiskLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;
}

export function classifyShellCommand(
  command: string,
  policy: PolicyProfile,
  context: SafetyEvaluationContext = {}
): SafetyDecision {
  let riskLevel: RiskLevel = "medium";
  const reasons = ["Shell commands can change local state and must be classified before execution."];
  const matchedRules = ["shell.command"];

  if (!policy.allowShell) {
    riskLevel = maxRiskLevel(riskLevel, "high");
    reasons.push("Shell is disabled by this policy profile.");
    matchedRules.push("policy.shell.disabled");
  }

  for (const rule of SHELL_RULES) {
    if (rule.pattern.test(command)) {
      riskLevel = maxRiskLevel(riskLevel, rule.riskLevel);
      reasons.push(rule.reason);
      matchedRules.push(rule.id);
    }
  }

  for (const match of command.matchAll(PATH_FRAGMENT_PATTERN)) {
    const candidate = match[0];
    const pathDecision = classifyPath(candidate, policy, { ...context, access: "read" });

    if (pathDecision.riskLevel === "blocked") {
      riskLevel = "blocked";
      reasons.push(`Command touches blocked path: ${candidate}.`);
      matchedRules.push(...pathDecision.matchedRules);
    } else if (pathDecision.protectionKind === "credential" || pathDecision.protectionKind === "browser_profile") {
      riskLevel = "blocked";
      reasons.push(`Command touches credential or browser profile path: ${candidate}.`);
      matchedRules.push(...pathDecision.matchedRules);
    } else {
      riskLevel = maxRiskLevel(riskLevel, pathDecision.riskLevel);
      matchedRules.push(...pathDecision.matchedRules);
    }
  }

  const approval = evaluateApprovalRequirement(riskLevel, policy, reasons);
  const blocked = riskLevel === "blocked" || approval.status === "denied";

  return {
    riskLevel,
    appSensitivity: classifyAppSensitivity({}),
    approval,
    allowed: !blocked && isApprovalSatisfied(approval),
    blocked,
    reasons,
    matchedRules: [...new Set(matchedRules)]
  };
}
