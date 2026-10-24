import type {
  AppSensitivity,
  PathAccessMode,
  RuntimePolicy,
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
import { actionEffectFromSafetyInput, decideGovernedAction } from "../action-policy.js";

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
      reasons.push("Financial/payment actions require a dedicated governed route, strong confirmation, and independent verification.");
      matchedRules.push("app.financial.governed_required");
      return maxRiskLevel(riskLevel, "high");
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
      input.actionType === "accessibility_focus" ||
      input.actionType === "browser_action" ||
      input.effect?.sensitivity === "communication"
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
  policy: RuntimePolicy,
  context: SafetyEvaluationContext = {}
): SafetyDecision {
  let riskLevel = baseRiskForAction(input.actionType);
  const classifiedSensitivity = classifyAppSensitivity(input);
  const appSensitivity = input.effect?.sensitivity !== undefined && input.effect.sensitivity !== "normal"
    ? input.effect.sensitivity
    : classifiedSensitivity;
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
    reasons.push("Shell is disabled by policy.");
    matchedRules.push("policy.shell.disabled");
  }

  if (input.tool === "desktop.screenshot" && !policy.allowScreenshots) {
    riskLevel = "blocked";
    reasons.push("Screenshots are disabled by policy.");
    matchedRules.push("policy.screenshot.disabled");
  }


  if (input.actionType === "unknown") {
    reasons.push("Unknown actions default to a conservative risk level.");
    matchedRules.push("action.unknown.conservative");
  }

  if (!policy.enabled && isStateChangingAction(input.actionType)) {
    riskLevel = "blocked";
    reasons.push("State-changing execution is disabled by policy.");
    matchedRules.push("policy.disabled");
  }

  const grantEvaluation = evaluateGrantDecision(input, policy, context.grants ?? policy.grants, appSensitivity, context);
  reasons.push(...grantEvaluation.reasons);
  matchedRules.push(...grantEvaluation.matchedRules);

  // A matching scoped allow grant can make this exact effect eligible even
  // when its category is normally high-risk. It never removes the tool's
  // dry-run, confirmation, target, or verification requirements.
  const exactGovernedGrant = riskLevel === "high"
    && grantEvaluation.decision.allowedByGrantIds.length > 0
    && (appSensitivity !== "financial" || input.effect?.bindings?.route !== undefined);
  let approval = evaluateApprovalRequirement(riskLevel, policy, reasons, exactGovernedGrant, context.confirmationSatisfied === true);

  if (
    grantEvaluation.decision.requiresApproval &&
    context.confirmationSatisfied !== true &&
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

  const actionDecision = input.effect === undefined ? undefined : decideGovernedAction({
    effect: actionEffectFromSafetyInput(input, context.ownerSessionId ?? "unknown-session", "state_changing"),
    safety: { allowed: !blocked, blocked, guideOnly: grantEvaluation.guideOnly, riskLevel, appSensitivity },
    grantDecision: grantEvaluation.decision,
    policy
  });

  return {
    riskLevel,
    appSensitivity,
    approval,
    allowed: !blocked && isApprovalSatisfied(approval),
    blocked,
    guideOnly: grantEvaluation.guideOnly,
    reasons,
    matchedRules: [...new Set(matchedRules)],
    grantDecision: grantEvaluation.decision,
    ...(actionDecision === undefined ? {} : { actionDecision })
  };
}

export const evaluateSafety = classifyRisk;
