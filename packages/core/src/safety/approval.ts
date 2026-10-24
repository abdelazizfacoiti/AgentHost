import type { ApprovalInfo, RuntimePolicy, RiskLevel } from "../types.js";

export function evaluateApprovalRequirement(
  riskLevel: RiskLevel,
  policy: RuntimePolicy,
  reasons: string[] = [],
  exactGrantPresent = false,
  confirmationSatisfied = false
): ApprovalInfo {
  const reason = reasons.join(" ");

  if (riskLevel === "blocked") {
    return {
      required: false,
      status: "denied",
      reason: reason.length > 0 ? reason : "Action is blocked by safety policy."
    };
  }

  if (riskLevel === "high" && policy.blockHighRiskByDefault && !exactGrantPresent) {
    return {
      required: false,
      status: "denied",
      reason: reason.length > 0 ? reason : "High-risk actions are blocked by this policy."
    };
  }

  if (confirmationSatisfied) {
    return {
      required: false,
      status: "approved",
      reason: "An exact single-use confirmation was accepted for this action."
    };
  }

  // Exact scoped grants make a high-risk effect eligible for governed
  // execution; the runner still requires an exact single-use confirmation.
  if (riskLevel === "high" && exactGrantPresent) {
    return {
      required: true,
      status: "required",
      reason: reason.length > 0 ? reason : "High-risk action requires exact confirmation."
    };
  }

  if (riskLevel === "high") {
    return {
      required: true,
      status: "required",
      reason: reason.length > 0 ? reason : "High-risk action requires exact confirmation."
    };
  }

  if (riskLevel === "medium" && policy.requireApprovalForMediumRisk && !exactGrantPresent) {
    return {
      required: true,
      status: "required",
      reason: reason.length > 0 ? reason : "Medium-risk action requires approval."
    };
  }

  return {
    required: false,
    status: "not_required"
  };
}

export function isApprovalSatisfied(approval: ApprovalInfo): boolean {
  return approval.status === "not_required" || approval.status === "approved";
}
