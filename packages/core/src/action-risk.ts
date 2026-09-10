import type { RiskLevel } from "./types.js";

/** Consequence-based tier. LOW/MEDIUM execute under policy; HIGH needs approval; CRITICAL needs explicit confirm. */
export type ActionConsequenceTier = "low" | "medium" | "high" | "critical";

export interface ConsequenceClassification {
  tier: ActionConsequenceTier;
  riskLevel: RiskLevel;
  reasons: string[];
}

/**
 * Map a classified risk level + effect flags onto a consequence tier.
 * Blocked stays blocked; high without exact grant escalates to critical only
 * for destructive/external/secret effects, otherwise high.
 */
export function classifyConsequenceTier(input: {
  riskLevel: RiskLevel;
  destructive?: boolean;
  externalEffect?: boolean;
  communicative?: boolean;
  secret?: boolean;
}): ConsequenceClassification {
  const reasons: string[] = [];
  if (input.riskLevel === "blocked") {
    reasons.push("Blocked effects remain blocked regardless of tier.");
    return { tier: "critical", riskLevel: "blocked", reasons };
  }
  if (input.secret === true || input.destructive === true) {
    reasons.push("Destructive or secret effects are critical and require explicit confirmation.");
    return { tier: "critical", riskLevel: input.riskLevel, reasons };
  }
  if (input.externalEffect === true || input.communicative === true || input.riskLevel === "high") {
    reasons.push("External, communicative, or high-risk effects require configured approval.");
    return { tier: "high", riskLevel: input.riskLevel, reasons };
  }
  if (input.riskLevel === "medium") {
    reasons.push("Medium-risk effects execute with logging and policy.");
    return { tier: "medium", riskLevel: input.riskLevel, reasons };
  }
  reasons.push("Low-risk and read-only effects execute automatically under policy.");
  return { tier: "low", riskLevel: input.riskLevel, reasons };
}

/** Temporary files, test runs, navigation, and form drafts never require confirmation by tier alone. */
export function tierRequiresConfirmation(tier: ActionConsequenceTier): boolean {
  return tier === "high" || tier === "critical";
}
