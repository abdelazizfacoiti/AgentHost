import type {
  AppSensitivity,
  PathAccessMode,
  PolicyProfile,
  RiskLevel,
  SafetyDecision,
  SafetyEvaluationContext,
  SafetyInput
} from "../types.js";
import { evaluateGrantDecision, isStateChangingAction } from "../grants.js";
import { evaluateApprovalRequirement, isApprovalSatisfied } from "./approval.js";
import { classifyAppSensitivity } from "./app-sensitivity.js";
import { classifyPath } from "./path-policy.js";
import { classifyShellCommand } from "./shell-classifier.js";

const RISK_ORDER: RiskLevel[] = ["observe", "low", "medium", "high", "blocked"];

function maxRiskLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;
}

function baseRiskForAction(actionType: SafetyInput["actionType"]): RiskLevel {
  switch (actionType) {
    case "observe":
      return "observe";
    case "inspect":
    case "file_read":
      return "low";
    case "app_launch":
    case "shell_command":
    case "file_write":
    case "gui_click":
    case "gui_type":
    case "accessibility_action":
    case "accessibility_set_value":
    case "accessibility_focus":
    case "browser_action":
      return "medium";
    case "file_delete":
    case "communication_send":
    case "upload":
    case "system_change":
      return "high";
    case "unknown":
      return "medium";
  }
}

function accessForAction(actionType: SafetyInput["actionType"]): PathAccessMode {
  switch (actionType) {
    case "file_write":
      return "write";
    case "file_delete":
      return "delete";
    default:
      return "read";
  }
}

function applyAppSensitivityRisk(
  riskLevel: RiskLevel,
  appSensitivity: AppSensitivity,
  input: SafetyInput,
  reasons: string[],
  matchedRules: string[]
): RiskLevel {
  if (appSensitivity === "credential_or_security") {
    if (input.actionType !== "observe" && input.actionType !== "inspect") {
      reasons.push("Credential or security apps are blocked for state-changing or data-moving actions.");
      matchedRules.push("app.credential_or_security.blocked");
      return "blocked";
    }

    reasons.push("Credential or security app inspection is sensitive.");
    matchedRules.push("app.credential_or_security.inspect");
    return maxRiskLevel(riskLevel, "high");
  }

  if (appSensitivity === "financial") {
    if (input.actionType !== "observe" && input.actionType !== "inspect") {
      reasons.push("Financial/payment apps default to guide-only for autonomous actions.");
      matchedRules.push("app.financial.blocked");
      return "blocked";
    }

    reasons.push("Financial/payment app inspection is high-risk.");
    matchedRules.push("app.financial.inspect");
    return maxRiskLevel(riskLevel, "high");
  }

  if (appSensitivity === "communication") {
    if (
      input.communicative ||
      input.externalEffect ||
      input.actionType === "communication_send" ||
      input.actionType === "gui_type" ||
      input.actionType === "gui_click" ||
      input.actionType === "accessibility_action" ||
      input.actionType === "accessibility_set_value" ||
      input.actionType === "accessibility_focus"
    ) {
      reasons.push("Communication actions that type, send, post, or affect external recipients are high-risk.");
      matchedRules.push("app.communication.high_risk");
      return maxRiskLevel(riskLevel, "high");
    }
  }

  if (appSensitivity === "system_settings" && input.actionType !== "observe" && input.actionType !== "inspect") {
    reasons.push("Changing system settings is high-risk.");
    matchedRules.push("app.system_settings.high_risk");
    return maxRiskLevel(riskLevel, "high");
  }

  return riskLevel;
}

export function classifyRisk(
  input: SafetyInput,
  policy: PolicyProfile,
  context: SafetyEvaluationContext = {}
): SafetyDecision {
  let riskLevel = baseRiskForAction(input.actionType);
  const appSensitivity = classifyAppSensitivity(input);
  const reasons: string[] = [];
  const matchedRules: string[] = [`action.${input.actionType}`];

  riskLevel = applyAppSensitivityRisk(riskLevel, appSensitivity, input, reasons, matchedRules);

  if (input.filePath !== undefined) {
    const pathDecision = classifyPath(input.filePath, policy, { ...context, access: accessForAction(input.actionType) });
    riskLevel = maxRiskLevel(riskLevel, pathDecision.riskLevel);
    reasons.push(...pathDecision.reasons);
    matchedRules.push(...pathDecision.matchedRules);
  }

  if (input.shellCommand !== undefined) {
    const shellDecision = classifyShellCommand(input.shellCommand, policy, context);
    riskLevel = maxRiskLevel(riskLevel, shellDecision.riskLevel);
    reasons.push(...shellDecision.reasons);
    matchedRules.push(...shellDecision.matchedRules);
  }

  if (input.dataSensitivity === "secret") {
    riskLevel = "blocked";
    reasons.push("Secret data must not be accessed, typed, uploaded, or sent by default.");
    matchedRules.push("data.secret.blocked");
  } else if (input.dataSensitivity === "sensitive") {
    const readOnlySensitive =
      input.actionType === "observe" || input.actionType === "inspect" || input.actionType === "file_read";
    riskLevel = maxRiskLevel(riskLevel, readOnlySensitive ? "medium" : "high");
    reasons.push(
      readOnlySensitive
        ? "Sensitive data inspection requires elevated controls."
        : "Sensitive data makes the action high-risk."
    );
    matchedRules.push(readOnlySensitive ? "data.sensitive.read_requires_controls" : "data.sensitive.high_risk");
  }

  if (input.destructive) {
    riskLevel = maxRiskLevel(riskLevel, "high");
    reasons.push("Destructive actions are high-risk.");
    matchedRules.push("action.destructive.high_risk");
  }

  if (input.externalEffect) {
    riskLevel = maxRiskLevel(riskLevel, "high");
    reasons.push("Actions with external effects are high-risk.");
    matchedRules.push("action.external_effect.high_risk");
  }

  if (input.communicative) {
    riskLevel = maxRiskLevel(riskLevel, "high");
    reasons.push("Communicative actions are high-risk.");
    matchedRules.push("action.communicative.high_risk");
  }

  if (input.actionType === "shell_command" && !policy.allowShell) {
    riskLevel = maxRiskLevel(riskLevel, "high");
    reasons.push("Shell is disabled by this policy profile.");
    matchedRules.push("policy.shell.disabled");
  }

  if (input.actionType === "gui_click" && !policy.allowGenericClick) {
    riskLevel = "blocked";
    reasons.push("Generic GUI clicking is disabled by this policy profile.");
    matchedRules.push("policy.gui_click.disabled");
  }

  if (input.actionType === "gui_type" && !policy.allowGenericType) {
    riskLevel = "blocked";
    reasons.push("Generic GUI typing is disabled by this policy profile.");
    matchedRules.push("policy.gui_type.disabled");
  }

  if (input.tool === "desktop.screenshot" && !policy.allowScreenshots) {
    riskLevel = "blocked";
    reasons.push("Screenshots are disabled by this policy profile.");
    matchedRules.push("policy.screenshot.disabled");
  }

  if (input.actionType === "communication_send" && !policy.allowEmailSend) {
    riskLevel = "blocked";
    reasons.push("Sending communications is disabled by this policy profile.");
    matchedRules.push("policy.communication_send.disabled");
  }

  if (input.actionType === "upload" && !policy.allowUploads) {
    riskLevel = "blocked";
    reasons.push("Uploads are disabled by this policy profile.");
    matchedRules.push("policy.upload.disabled");
  }

  if (input.actionType === "app_launch" && !policy.allowAppLaunch) {
    riskLevel = maxRiskLevel(riskLevel, "high");
    reasons.push("App launch is disabled by this policy profile.");
    matchedRules.push("policy.app_launch.disabled");
  }

  if (input.actionType === "unknown") {
    reasons.push("Unknown actions default to a conservative risk level.");
    matchedRules.push("action.unknown.conservative");
  }

  if (!policy.enabled && isStateChangingAction(input.actionType)) {
    riskLevel = "blocked";
    reasons.push(`Profile ${policy.name} is disabled for state-changing execution.`);
    matchedRules.push(`policy.profile.${policy.name}.disabled`);
  }

  const grantEvaluation = evaluateGrantDecision(input, policy, context.grants ?? policy.grants, appSensitivity, context);
  reasons.push(...grantEvaluation.reasons);
  matchedRules.push(...grantEvaluation.matchedRules);

  if (
    appSensitivity === "communication" &&
    (input.actionType === "observe" || input.actionType === "inspect" || input.actionType === "file_read") &&
    input.dataSensitivity !== undefined &&
    input.dataSensitivity !== "none" &&
    grantEvaluation.decision.allowedByGrantIds.length === 0
  ) {
    riskLevel = "blocked";
    reasons.push("Communication app private-data reads require an explicit grant.");
    matchedRules.push("app.communication.private_data_requires_grant");
  }

  let approval = evaluateApprovalRequirement(riskLevel, policy, reasons);

  if (
    grantEvaluation.decision.requiresApproval &&
    approval.status !== "denied" &&
    approval.status !== "required"
  ) {
    approval = {
      required: true,
      status: "required",
      reason: "A matching capability grant requires approval before execution."
    };
  }

  const blocked = riskLevel === "blocked" || approval.status === "denied" || grantEvaluation.blocked || grantEvaluation.guideOnly;

  if (blocked && approval.status !== "denied") {
    approval = {
      required: false,
      status: "denied",
      reason: reasons.join(" ")
    };
  }

  return {
    riskLevel,
    appSensitivity,
    approval,
    allowed: !blocked && isApprovalSatisfied(approval),
    blocked,
    guideOnly: grantEvaluation.guideOnly,
    reasons,
    matchedRules: [...new Set(matchedRules)],
    grantDecision: grantEvaluation.decision
  };
}

export const evaluateSafety = classifyRisk;
