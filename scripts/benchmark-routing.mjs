#!/usr/bin/env node

/*
 * Deterministic, local-only planning/routing benchmark. It exercises bounded
 * metadata scorers against fixtures; it never probes applications, captures
 * screenshots, invokes MCP tools, or persists task content.
 */
import { performance } from "node:perf_hooks";
import { compareCapabilityRoutes, determineGoalDecisionLevel, scoreCapabilityRoute } from "../packages/core/dist/index.js";

const ITERATIONS = 31;
const common = { goalCategory: "fixture_goal", appFamily: "fixture_app", riskLevel: "observe", requiresConfirmation: false, contextTokens: 500, verificationStrength: "strong", verifiedSuccesses: 0, verifiedFailures: 0, consecutiveVerifiedFailures: 0, failureProbability: 0.1, recoveryCostMs: 3000 };
const fixture = (fixtureName, routeFamily, values = {}) => ({ fixtureName, routeFamily, ...common, health: "healthy", compatible: true, estimatedProbeMs: 20, estimatedSetupMs: 20, estimatedExecutionMs: 100, estimatedVerificationMs: 100, tieBreakKey: routeFamily, ...values });

const cases = [
  { name: "simple_browser_bridge", candidates: [fixture("simple_browser_bridge", "browser_bridge", { verificationStrength: "strong" }), fixture("simple_browser_bridge", "accessibility", { estimatedExecutionMs: 160, verificationStrength: "medium" })], expected: "browser_bridge", decision: { knownOperationCount: 1, healthyRouteCount: 2, decompositionRequired: false, directVerificationAvailable: true, activeVerifiedStrategy: false, materiallyAmbiguous: false, sensitiveExternalEffect: false, guideModeRequired: false } },
  { name: "bridge_unavailable_accessibility", candidates: [fixture("bridge_unavailable_accessibility", "browser_bridge", { health: "unavailable", compatible: false, unavailableReason: "browser_extension_disconnected" }), fixture("bridge_unavailable_accessibility", "accessibility", { verificationStrength: "medium" })], expected: "accessibility", decision: { knownOperationCount: 1, healthyRouteCount: 1, decompositionRequired: false, directVerificationAvailable: true, activeVerifiedStrategy: false, materiallyAmbiguous: false, sensitiveExternalEffect: false, guideModeRequired: false } },
  { name: "ocr_sufficient", candidates: [fixture("ocr_sufficient", "local_ocr", { verificationStrength: "medium" }), fixture("ocr_sufficient", "screenshot_vision", { estimatedExecutionMs: 400, verificationStrength: "weak" })], expected: "local_ocr", decision: { knownOperationCount: 2, healthyRouteCount: 2, decompositionRequired: true, directVerificationAvailable: false, activeVerifiedStrategy: false, materiallyAmbiguous: false, sensitiveExternalEffect: false, guideModeRequired: false } },
  { name: "screenshot_required", candidates: [fixture("screenshot_required", "screenshot_vision", { verificationStrength: "medium" }), fixture("screenshot_required", "desktop_input", { riskLevel: "medium", requiresConfirmation: true, verificationStrength: "weak" })], expected: "screenshot_vision", decision: { knownOperationCount: 2, healthyRouteCount: 2, decompositionRequired: true, directVerificationAvailable: false, activeVerifiedStrategy: false, materiallyAmbiguous: false, sensitiveExternalEffect: false, guideModeRequired: false } },
  { name: "protected_context_guide", candidates: [fixture("protected_context_guide", "guide_only", { verificationStrength: "strong" }), fixture("protected_context_guide", "desktop_input", { riskLevel: "blocked", health: "unavailable", compatible: false })], expected: "guide_only", decision: { knownOperationCount: 1, healthyRouteCount: 1, decompositionRequired: false, directVerificationAvailable: false, activeVerifiedStrategy: false, materiallyAmbiguous: false, sensitiveExternalEffect: true, guideModeRequired: true } },
  { name: "failed_route_replan", candidates: [fixture("failed_route_replan", "browser_bridge", { health: "unavailable", compatible: false, unavailableReason: "route_timeout" }), fixture("failed_route_replan", "accessibility", { verificationStrength: "medium" })], expected: "accessibility", replanCount: 1, fallbackCount: 1, decision: { knownOperationCount: 2, healthyRouteCount: 1, decompositionRequired: true, directVerificationAvailable: false, activeVerifiedStrategy: false, materiallyAmbiguous: false, sensitiveExternalEffect: false, guideModeRequired: false } },
  { name: "deterministic_direct", candidates: [fixture("deterministic_direct", "native_adapter", { verificationStrength: "strong", estimatedExecutionMs: 60 }), fixture("deterministic_direct", "desktop_input", { riskLevel: "medium", requiresConfirmation: true, verificationStrength: "weak" })], expected: "native_adapter", decision: { knownOperationCount: 1, healthyRouteCount: 2, decompositionRequired: false, directVerificationAvailable: true, activeVerifiedStrategy: true, materiallyAmbiguous: false, sensitiveExternalEffect: false, guideModeRequired: false } },
  { name: "multistep_strategy", candidates: [fixture("multistep_strategy", "browser_bridge", { estimatedVerificationMs: 160 }), fixture("multistep_strategy", "accessibility", { verificationStrength: "medium", estimatedExecutionMs: 140 })], expected: "browser_bridge", decision: { knownOperationCount: 3, healthyRouteCount: 2, decompositionRequired: true, directVerificationAvailable: false, activeVerifiedStrategy: true, materiallyAmbiguous: false, sensitiveExternalEffect: false, guideModeRequired: false } }
];

function percentile(values, fraction) { return values[Math.min(values.length - 1, Math.floor(values.length * fraction))] ?? 0; }
function summary(samples) { const ordered = [...samples].sort((a, b) => a - b); return { medianUs: percentile(ordered, 0.5), p95Us: percentile(ordered, 0.95) }; }
const rows = [];
for (const testCase of cases) {
  const samples = [];
  const goalSamples = [];
  const strategySamples = [];
  const planSamples = [];
  let selected;
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const candidates = testCase.candidates.map((candidate) => ({ ...candidate }));
    let started = performance.now();
    determineGoalDecisionLevel(testCase.decision);
    goalSamples.push(Math.round((performance.now() - started) * 1000));
    started = performance.now();
    const compatible = candidates.filter((candidate) => candidate.compatible && candidate.health !== "unavailable");
    strategySamples.push(Math.round((performance.now() - started) * 1000));
    started = performance.now();
    JSON.stringify({ decision: testCase.decision, candidates: compatible.map((candidate) => candidate.routeFamily) });
    planSamples.push(Math.round((performance.now() - started) * 1000));
    started = performance.now();
    candidates.sort(compareCapabilityRoutes);
    selected = candidates[0];
    samples.push(Math.round((performance.now() - started) * 1000));
  }
  const selectedCost = selected === undefined ? null : scoreCapabilityRoute(selected);
  const selectedRoute = selected?.routeFamily;
  const selectedCandidate = testCase.candidates.find((candidate) => candidate.routeFamily === selectedRoute);
  const probeMs = selectedCandidate?.estimatedProbeMs ?? 0;
  const setupMs = selectedCandidate?.estimatedSetupMs ?? 0;
  const executionMs = selectedCandidate?.estimatedExecutionMs ?? 0;
  const verificationMs = selectedCandidate?.estimatedVerificationMs ?? 0;
  const contextBytes = JSON.stringify(testCase.candidates.map(({ routeFamily, health, compatible, verificationStrength }) => ({ routeFamily, health, compatible, verificationStrength }))).length;
  rows.push({
    fixture: testCase.name,
    iterations: ITERATIONS,
    decisionLevel: determineGoalDecisionLevel(testCase.decision),
    selectedRoute,
    expectedRoute: testCase.expected,
    matchesExpectation: selectedRoute === testCase.expected,
    routeSelection: summary(samples),
    goalClassification: summary(goalSamples),
    strategyRetrieval: summary(strategySamples),
    planPreview: summary(planSamples),
    scoreCost: selectedCost,
    estimatedCompletionMs: probeMs + setupMs + executionMs + verificationMs,
    timeToFirstUsefulActionMs: selectedCandidate === undefined ? null : probeMs + setupMs + executionMs,
    verificationDurationMs: selectedCandidate === undefined ? null : verificationMs,
    totalVerifiedCompletionMs: selectedCandidate === undefined ? null : probeMs + setupMs + executionMs + verificationMs,
    approximateTokenUsage: Math.ceil(contextBytes / 4),
    userInterruptions: 0,
    replanCount: testCase.replanCount ?? 0,
    fallbackCount: testCase.fallbackCount ?? 0,
    retries: 0,
    ocrCalls: selectedRoute === "local_ocr" ? 1 : 0,
    screenshotCalls: selectedRoute === "screenshot_vision" ? 1 : 0,
    desktopFallbacks: selectedRoute === "desktop_input" ? 1 : 0,
    modelCalls: 0,
    contextBytes,
    candidates: testCase.candidates.map((candidate) => ({ routeFamily: candidate.routeFamily, health: candidate.health, compatible: candidate.compatible, verificationStrength: candidate.verificationStrength }))
  });
}
console.log(JSON.stringify({ schemaVersion: 2, benchmark: "goal-routing-fixtures", deterministic: true, generatedAt: "fixture-only", rows, safeguards: { maxIterations: ITERATIONS, maxCandidates: 4, probesExecuted: false, actionsExecuted: false, screenshotsCaptured: false, modelCalls: false }, redacted: true }, null, 2));
