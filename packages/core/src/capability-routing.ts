import type { RiskLevel } from "./types.js";

export const CAPABILITY_ROUTE_FAMILIES = ["browser_bridge", "structured_browser", "native_adapter", "accessibility", "local_ocr", "screenshot_vision", "desktop_input", "guide_only"] as const;
export type CapabilityRouteFamily = typeof CAPABILITY_ROUTE_FAMILIES[number];
export type CapabilityRouteVerificationStrength = "strong" | "medium" | "weak";
export type CapabilityRouteProbeTier = 0 | 1 | 2 | 3 | 4 | 5;
export type CapabilityRouteOutcome = "verified_success" | "verified_failure" | "prerequisite_failure" | "execution_failure" | "verification_failure" | "policy_block" | "cancelled" | "timeout" | "stale_target" | "incompatible_version" | "renderer_unavailable" | "protected_context";

export interface CapabilityRouteCandidate {
  routeFamily: CapabilityRouteFamily;
  goalCategory: string;
  appFamily?: string;
  prerequisites: string[];
  health: "healthy" | "degraded" | "unavailable" | "unknown";
  compatible: boolean;
  probeTier: CapabilityRouteProbeTier;
  estimatedProbeMs: number;
  estimatedSetupMs: number;
  estimatedExecutionMs: number;
  estimatedVerificationMs: number;
  verificationStrength: CapabilityRouteVerificationStrength;
  verifiedSuccesses: number;
  verifiedFailures: number;
  consecutiveVerifiedFailures: number;
  failureProbability: number;
  recoveryCostMs: number;
  contextTokens: number;
  riskLevel: RiskLevel;
  requiresConfirmation: boolean;
  unavailableReason?: string;
  scoreComponents?: CapabilityRouteScoreComponents;
  finalCost?: number;
  tieBreakKey: string;
}

export interface CapabilityRouteScoreComponents {
  probeMs: number;
  setupMs: number;
  executionMs: number;
  verificationMs: number;
  recoveryMs: number;
  confirmationCost: number;
  tokenCost: number;
  safetyPenalty: number;
  verificationPenalty: number;
}

export interface CapabilityRouteFallback { failedRoute: CapabilityRouteFamily; failureCode: string; verificationState: "not_started" | "failed" | "passed"; nextRoute?: CapabilityRouteFamily; remainingBudget: number; requiresNewConfirmation: boolean; }
export interface CapabilityRouteSelection {
  routeSelectionId: string;
  selectedRoute?: CapabilityRouteFamily;
  goalCategory: string;
  appFamily?: string;
  reasonCode: string;
  fallbackBudget: number;
  candidates: CapabilityRouteCandidate[];
  alternatives: Array<{ routeFamily: CapabilityRouteFamily; reasonCode: string }>;
  fallbacks: CapabilityRouteFallback[];
  selectedTargetBinding?: { kind: string; expiresAt: string; redacted: true };
  createdAt: string;
  expiresAt: string;
  executable: false;
  actionsExecuted: false;
  confirmationTokensCreated: false;
}

export interface CapabilityRouteMetricRecord {
  schemaVersion: 1;
  routeFamily: CapabilityRouteFamily;
  goalCategory: string;
  appFamily?: string;
  compatibilityFingerprint: string;
  attempts: number;
  verifiedSuccesses: number;
  verifiedFailures: number;
  consecutiveVerifiedFailures: number;
  medianProbeMs?: number;
  medianExecutionMs?: number;
  medianVerificationMs?: number;
  lastAttemptedAt?: string;
  lastVerifiedAt?: string;
  compatibilityVersion: string;
  status: "active" | "degraded" | "expired";
  redacted: true;
}

const SAFETY_PENALTY: Record<RiskLevel, number> = { observe: 0, low: 50, medium: 250, high: 500, blocked: Number.POSITIVE_INFINITY };
const VERIFICATION_PENALTY: Record<CapabilityRouteVerificationStrength, number> = { strong: 0, medium: 150, weak: 350 };

export function scoreCapabilityRoute(candidate: CapabilityRouteCandidate): number {
  if (!candidate.compatible || candidate.health === "unavailable" || candidate.riskLevel === "blocked") return Number.POSITIVE_INFINITY;
  const components: CapabilityRouteScoreComponents = {
    probeMs: Math.max(0, Math.round(candidate.estimatedProbeMs)),
    setupMs: Math.max(0, Math.round(candidate.estimatedSetupMs)),
    executionMs: Math.max(0, Math.round(candidate.estimatedExecutionMs)),
    verificationMs: Math.max(0, Math.round(candidate.estimatedVerificationMs)),
    recoveryMs: Math.round(Math.max(0, Math.min(1, candidate.failureProbability)) * Math.max(0, candidate.recoveryCostMs)),
    confirmationCost: candidate.requiresConfirmation ? 250 : 0,
    tokenCost: Math.ceil(Math.max(0, candidate.contextTokens) / 100),
    safetyPenalty: SAFETY_PENALTY[candidate.riskLevel],
    verificationPenalty: VERIFICATION_PENALTY[candidate.verificationStrength]
  };
  const finalCost = Object.values(components).reduce((sum, value) => sum + value, 0);
  candidate.scoreComponents = components;
  candidate.finalCost = finalCost;
  return finalCost;
}

export function compareCapabilityRoutes(a: CapabilityRouteCandidate, b: CapabilityRouteCandidate): number {
  const aCost = scoreCapabilityRoute(a);
  const bCost = scoreCapabilityRoute(b);
  const cost = aCost === bCost ? 0 : aCost === Number.POSITIVE_INFINITY ? 1 : bCost === Number.POSITIVE_INFINITY ? -1 : aCost - bCost;
  if (cost !== 0) return cost;
  const verification = ({ strong: 0, medium: 1, weak: 2 } as const)[a.verificationStrength] - ({ strong: 0, medium: 1, weak: 2 } as const)[b.verificationStrength];
  return verification || a.tieBreakKey.localeCompare(b.tieBreakKey);
}

export function validateCapabilityRouteCandidate(candidate: CapabilityRouteCandidate): string[] {
  const errors: string[] = [];
  if (!CAPABILITY_ROUTE_FAMILIES.includes(candidate.routeFamily)) errors.push("route_family_invalid");
  if (typeof candidate.goalCategory !== "string" || candidate.goalCategory.length < 1 || candidate.goalCategory.length > 100) errors.push("route_goal_invalid");
  if (!Number.isFinite(candidate.failureProbability) || candidate.failureProbability < 0 || candidate.failureProbability > 1) errors.push("route_failure_probability_invalid");
  for (const value of [candidate.estimatedProbeMs, candidate.estimatedSetupMs, candidate.estimatedExecutionMs, candidate.estimatedVerificationMs, candidate.recoveryCostMs, candidate.contextTokens]) if (!Number.isFinite(value) || value < 0 || value > 86_400_000) errors.push("route_estimate_invalid");
  if (candidate.riskLevel === "blocked" && candidate.health !== "unavailable") errors.push("route_blocked_health_invalid");
  return [...new Set(errors)];
}
