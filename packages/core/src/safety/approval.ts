import type { ApprovalInfo, PolicyProfile, RiskLevel } from "../types.js";

export function evaluateApprovalRequirement(
  riskLevel: RiskLevel,
  policy: PolicyProfile,
  reasons: string[] = [],
  exactGrantPresent = false
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
      reason: reason.length > 0 ? reason : "High-risk actions are blocked by this policy profile."
    };
  }

  // Exact scoped grants make high-risk effect eligible for governed execution;
  // confirmation remains enforced by central runner/handler.
  if (riskLevel === "high" && exactGrantPresent) {
    return {
      required: false,
      status: "not_required"
    };
  }

  if (riskLevel === "high") {
    return {
      required: true,
      status: "required",
      reason: reason.length > 0 ? reason : "High-risk action requires approval."
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
