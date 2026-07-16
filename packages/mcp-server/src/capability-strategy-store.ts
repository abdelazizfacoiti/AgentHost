import { chmod, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  CAPABILITY_STRATEGY_SCHEMA_VERSION,
  type CapabilityStrategyCheckpoint,
  type CapabilityStrategyDefinition,
  type CapabilityStrategyGoal,
  type CapabilityStrategyHealth,
  type CapabilityStrategyOutcome,
  type CapabilityStrategyReview,
  type CapabilityStrategySelection,
  type CapabilityStrategyStatus,
  isStrategyActive,
  strategyConfidence,
  shouldDegradeStrategy,
  validateCapabilityStrategy
} from "@agenthost/core";

const ROOT = "strategies";
const MAX_RECORDS = 200;
const MAX_OUTCOMES = 2_000;
const MAX_SELECTIONS = 500;
const PROFILES = ["strict", "dev", "gui-dev", "demo-unlocked-local", "private-data"] as const;
const timestamp = () => new Date().toISOString();
const safeId = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_");

async function saveJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, file);
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

function step(input: { stepId: string; operation: CapabilityStrategyDefinition["preferredSteps"][number]["operation"]; family: CapabilityStrategyDefinition["preferredSteps"][number]["capabilityFamily"]; trustedTool?: string; result: CapabilityStrategyDefinition["preferredSteps"][number]["expectedResult"]; verification?: CapabilityStrategyCheckpoint; stateChanging?: boolean }): CapabilityStrategyDefinition["preferredSteps"][number] {
  const stateChanging = input.stateChanging === true;
  return {
    stepId: input.stepId,
    operation: input.operation,
    capabilityFamily: input.family,
    ...(input.trustedTool === undefined ? {} : { trustedTool: input.trustedTool }),
    inputBinding: input.operation === "navigate" ? "normalized_url" : "none",
    expectedResult: input.result,
    ...(input.verification === undefined ? {} : { verification: input.verification }),
    timeoutMs: 10_000,
    retryLimit: 0,
    expectedExecutionClass: stateChanging ? "state_changing" : "read_only",
    expectedRiskLevel: stateChanging ? "medium" : "observe",
    requiresDryRun: stateChanging,
    requiresConfirmation: stateChanging
  };
}

function builtin(input: { id: string; name: string; description: string; goal: CapabilityStrategyGoal; family: CapabilityStrategyDefinition["preferredSteps"][number]["capabilityFamily"]; steps: CapabilityStrategyDefinition["preferredSteps"]; fallbacks?: string[]; checkpoints: CapabilityStrategyCheckpoint[]; available?: boolean }): CapabilityStrategyDefinition {
  const now = timestamp();
  return {
    strategyId: input.id,
    schemaVersion: CAPABILITY_STRATEGY_SCHEMA_VERSION,
    name: input.name,
    description: input.description,
    goalCategory: input.goal,
    goalVariants: [],
    supportedOperatingSystems: ["linux"],
    supportedApplications: input.family === "browser" ? ["browser"] : [],
    supportedAdapters: [],
    compatibleProfiles: [...PROFILES],
    compatibleAgentHostRange: ">=0.1.0 <1.0.0",
    compatibleAdapterRanges: {},
    requiredCapabilities: input.available === false ? ["future_capability_unavailable"] : [],
    prerequisiteChecks: input.family === "browser" ? ["browser_bridge_paired", "browser_extension_compatible"] : input.family === "speech" ? ["speech_provider_ready", "audio_route_ready"] : [],
    preferredSteps: input.steps,
    fallbackStrategyIds: input.fallbacks ?? [],
    verificationCheckpoints: input.checkpoints,
    expectedSafety: { executionClasses: [...new Set(input.steps.map((item) => item.expectedExecutionClass))], maxRiskLevel: input.steps.some((item) => item.expectedRiskLevel === "medium") ? "medium" : "observe", requiresDryRun: input.steps.some((item) => item.requiresDryRun), requiresConfirmation: input.steps.some((item) => item.requiresConfirmation), exactTarget: input.steps.some((item) => item.capabilityFamily !== "guide") },
    expectedConfirmationBoundary: input.steps.some((item) => item.requiresConfirmation) ? "before_state_change" : "never_automatic",
    knownFailureCodes: ["capability_unavailable", "policy_blocked", "verification_failed"],
    successCount: 0,
    failureCount: 0,
    consecutiveFailureCount: 0,
    confidence: 0.5,
    source: "built_in",
    createdAt: now,
    updatedAt: now,
    invalidationConditions: ["agenthost_version_incompatible", "required_capability_missing", "prerequisite_failed"],
    status: input.available === false ? "reviewed" : "active"
  };
}

function builtins(): CapabilityStrategyDefinition[] {
  const nav = [
    step({ stepId: "bridge", operation: "inspect_bridge", family: "browser", trustedTool: "browser.detect", result: "bridge_status", verification: "bridge_paired" }),
    step({ stepId: "tab", operation: "reuse_tab", family: "browser", trustedTool: "browser.get_active_tab", result: "browser_tab" }),
    step({ stepId: "navigate", operation: "navigate", family: "browser", trustedTool: "browser.open_url", result: "browser_tab", verification: "browser_url_verified", stateChanging: true }),
    step({ stepId: "ready", operation: "wait_ready", family: "browser", trustedTool: "browser.wait_for_state", result: "checkpoint_passed", verification: "page_ready" }),
    step({ stepId: "verify", operation: "verify_url", family: "browser", trustedTool: "browser.current_url", result: "checkpoint_passed", verification: "browser_url_verified" }),
    step({ stepId: "context", operation: "inspect_page", family: "browser", trustedTool: "browser.get_page_context", result: "page_context", verification: "safe_structure_observed" })
  ];
  return [
    builtin({ id: "builtin.browser-navigation", name: "Browser navigation", description: "Structured browser navigation with bridge health and URL verification.", goal: "browser_navigation", family: "browser", steps: nav, fallbacks: ["builtin.browser-bridge-recovery", "builtin.visual-target-recovery"], checkpoints: ["bridge_paired", "browser_url_verified", "page_ready"] }),
    builtin({ id: "builtin.webpage-inspection", name: "Webpage inspection", description: "Read-only structured page inspection through healthy browser capabilities.", goal: "webpage_inspection", family: "browser", steps: [step({ stepId: "bridge", operation: "inspect_bridge", family: "browser", trustedTool: "browser.detect", result: "bridge_status", verification: "bridge_paired" }), step({ stepId: "context", operation: "inspect_page", family: "browser", trustedTool: "browser.get_page_context", result: "page_context", verification: "safe_structure_observed" })], fallbacks: ["builtin.visual-target-recovery"], checkpoints: ["bridge_paired", "safe_structure_observed"] }),
    builtin({ id: "builtin.form-preparation", name: "Form preparation", description: "Prepares safe form fields without submitting or sending.", goal: "form_preparation", family: "browser", steps: [step({ stepId: "bridge", operation: "inspect_bridge", family: "browser", trustedTool: "browser.detect", result: "bridge_status", verification: "bridge_paired" }), step({ stepId: "field", operation: "prepare_field", family: "browser", trustedTool: "browser.fill_text", result: "field_metadata", verification: "field_prepared_without_submit", stateChanging: true })], fallbacks: ["builtin.visual-assistance"], checkpoints: ["bridge_paired", "field_prepared_without_submit"] }),
    builtin({ id: "builtin.form-submission-boundary", name: "Form submission boundary", description: "Stops before submission and exposes separate confirmation boundaries.", goal: "form_submission_boundary", family: "browser", steps: [step({ stepId: "inspect", operation: "submission_boundary", family: "browser", trustedTool: "browser.get_form_state", result: "field_metadata", verification: "field_prepared_without_submit" })], checkpoints: ["field_prepared_without_submit"] }),
    builtin({ id: "builtin.visual-target-recovery", name: "Screenshot target recovery", description: "Uses bounded visual evidence to recover target guidance without automatic clicking.", goal: "screenshot_target_recovery", family: "vision", steps: [step({ stepId: "recover", operation: "recover_target", family: "vision", trustedTool: "vision.find_target", result: "checkpoint_passed", verification: "target_revalidated" })], fallbacks: ["builtin.visual-assistance"], checkpoints: ["target_revalidated"] }),
    builtin({ id: "builtin.visual-assistance", name: "Visual assistance", description: "Shows visual-only guidance while leaving target applications unchanged.", goal: "visual_assistance", family: "overlay", steps: [step({ stepId: "show", operation: "show_visual_guidance", family: "overlay", trustedTool: "overlay.assistance_step_show", result: "visual_session", verification: "visual_session_state" })], checkpoints: ["visual_session_state"] }),
    builtin({ id: "builtin.browser-bridge-recovery", name: "Browser Bridge recovery", description: "Diagnoses local browser pairing and reports bounded recovery guidance.", goal: "browser_bridge_recovery", family: "browser", steps: [step({ stepId: "diagnose", operation: "inspect_bridge", family: "browser", trustedTool: "browser.diagnose_bridge", result: "bridge_status", verification: "bridge_paired" })], checkpoints: ["bridge_paired"] }),
    builtin({ id: "builtin.meeting-observation", name: "Meeting observation", description: "Reports bounded meeting capability readiness without content extraction.", goal: "meeting_observation", family: "guide", steps: [step({ stepId: "guide", operation: "inspect_meeting_state", family: "guide", trustedTool: "guide.explain_strategy", result: "operator_guidance", verification: "manual_operator_check" })], checkpoints: ["manual_operator_check"] }),
    builtin({ id: "builtin.meeting-recap", name: "Meeting recap boundary", description: "Describes authorized recap prerequisites without storing meeting content.", goal: "meeting_recap", family: "guide", steps: [step({ stepId: "guide", operation: "prepare_recap", family: "guide", trustedTool: "guide.create_steps", result: "operator_guidance", verification: "meeting_source_authorized" })], checkpoints: ["meeting_source_authorized"] }),
    builtin({ id: "builtin.local-tts", name: "Local TTS", description: "Selects local offline speech synthesis after provider health checks.", goal: "local_tts", family: "speech", steps: [step({ stepId: "providers", operation: "list_speech_providers", family: "speech", trustedTool: "speech.list_providers", result: "provider_status", verification: "provider_ready" }), step({ stepId: "voices", operation: "list_speech_voices", family: "speech", trustedTool: "speech.list_voices", result: "voice_list" }), step({ stepId: "tts", operation: "synthesize_local_audio", family: "speech", trustedTool: "speech.synthesize", result: "audio_artifact", verification: "audio_ready", stateChanging: true })], checkpoints: ["provider_ready", "audio_ready"] }),
    builtin({ id: "builtin.speech-output", name: "Governed speech output", description: "Prepares and executes governed local audio transmission only after routing and confirmation checks.", goal: "speech_output", family: "speech", steps: [step({ stepId: "route", operation: "diagnose_audio_routing", family: "speech", trustedTool: "speech.routing_diagnose", result: "routing_status", verification: "routing_ready" }), step({ stepId: "prepare", operation: "prepare_audio_transmission", family: "speech", trustedTool: "speech.transmission_prepare", result: "transmission_preparation", verification: "transmission_prepared" }), step({ stepId: "execute", operation: "execute_audio_transmission", family: "speech", trustedTool: "speech.transmission_execute", result: "operator_guidance", stateChanging: true })], checkpoints: ["routing_ready", "transmission_prepared"] })
  ];
}

export class CapabilityStrategyStore {
  readonly #root: string;
  readonly #definitions: string;
  readonly #reviews: string;
  readonly #outcomes: string;
  readonly #selections: string;
  constructor(agentHostDir: string) {
    this.#root = path.join(agentHostDir, ROOT);
    this.#definitions = path.join(this.#root, "definitions");
    this.#reviews = path.join(this.#root, "reviews");
    this.#outcomes = path.join(this.#root, "outcomes");
    this.#selections = path.join(this.#root, "selections");
  }
  async ensureStructure(): Promise<void> {
    await Promise.all([this.#definitions, this.#reviews, this.#outcomes, this.#selections].map((item) => mkdir(item, { recursive: true, mode: 0o700 })));
    for (const strategy of builtins()) {
      const existingPath = this.#definitionPath(strategy.strategyId);
      if (await this.#exists(existingPath)) {
        try {
          const existing = await readJson<CapabilityStrategyDefinition>(existingPath);
          const legacySpeech = (existing.strategyId === "builtin.local-tts" || existing.strategyId === "builtin.speech-output") && existing.source === "built_in" && existing.preferredSteps.every((step) => step.capabilityFamily === "speech_unavailable");
          if (!legacySpeech) continue;
          validateCapabilityStrategy(strategy);
          await saveJson(existingPath, strategy);
        } catch { /* Leave corrupt or user-owned records untouched. */ }
        continue;
      }
      validateCapabilityStrategy(strategy);
      await saveJson(this.#definitionPath(strategy.strategyId), strategy);
    }
  }
  async list(input: { status?: CapabilityStrategyStatus; goalCategory?: CapabilityStrategyGoal; limit?: number } = {}): Promise<CapabilityStrategyDefinition[]> {
    const entries = await readdir(this.#definitions, { withFileTypes: true }).catch(() => []);
    const values: CapabilityStrategyDefinition[] = [];
    for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json")).slice(0, MAX_RECORDS)) {
      try {
        const value = await readJson<CapabilityStrategyDefinition>(path.join(this.#definitions, entry.name));
        validateCapabilityStrategy(value);
        if ((input.status === undefined || value.status === input.status) && (input.goalCategory === undefined || value.goalCategory === input.goalCategory)) values.push(value);
      } catch { /* Corrupt records are ignored and surfaced by health diagnostics. */ }
    }
    return values.sort((a, b) => a.strategyId.localeCompare(b.strategyId)).slice(0, Math.min(input.limit ?? 100, 100));
  }
  async get(strategyId: string): Promise<CapabilityStrategyDefinition> {
    const value = await readJson<CapabilityStrategyDefinition>(this.#definitionPath(strategyId));
    validateCapabilityStrategy(value);
    return value;
  }
  async propose(strategy: CapabilityStrategyDefinition): Promise<CapabilityStrategyDefinition> {
    validateCapabilityStrategy(strategy);
    if (strategy.source !== "reviewed_local" || strategy.status !== "proposed" || strategy.successCount !== 0 || strategy.failureCount !== 0) throw new Error("strategy_proposal_invalid");
    await saveJson(this.#definitionPath(strategy.strategyId), strategy);
    return strategy;
  }
  async review(strategyId: string, decision: "approve" | "reject"): Promise<CapabilityStrategyReview> {
    const strategy = await this.get(strategyId);
    if (!(strategy.status === "proposed" || strategy.status === "degraded" || strategy.status === "disabled")) throw new Error("strategy_review_transition_invalid");
    const now = timestamp();
    const review: CapabilityStrategyReview = { reviewId: `strategy_review_${randomUUID()}`, strategyId, decision, status: decision === "approve" ? "approved" : "rejected", createdAt: now, updatedAt: now, reviewerSummary: "redacted", safetyFindings: [], compatibilityFindings: [], requiredOutcomeCount: strategy.source === "built_in" ? 0 : 2 };
    const next: CapabilityStrategyDefinition = { ...strategy, status: decision === "approve" ? "reviewed" : "disabled", reviewId: review.reviewId, updatedAt: now };
    await saveJson(this.#definitionPath(strategyId), next);
    await saveJson(this.#reviewPath(review.reviewId), review);
    return review;
  }
  async activate(strategyId: string): Promise<CapabilityStrategyDefinition> {
    const strategy = await this.get(strategyId);
    if (strategy.source !== "built_in" && (strategy.status !== "reviewed" || strategy.successCount < 2)) throw new Error("strategy_activation_evidence_missing");
    const next = { ...strategy, status: "active" as const, updatedAt: timestamp() };
    validateCapabilityStrategy(next);
    await saveJson(this.#definitionPath(strategyId), next);
    return next;
  }
  async updateOutcome(input: Omit<CapabilityStrategyOutcome, "outcomeId" | "createdAt" | "redacted">): Promise<{ strategy: CapabilityStrategyDefinition; outcome: CapabilityStrategyOutcome }> {
    const strategy = await this.get(input.strategyId);
    if (!isStrategyActive(strategy) && strategy.status !== "reviewed") throw new Error("strategy_outcome_transition_invalid");
    const prior = await readdir(this.#outcomes, { withFileTypes: true }).catch(() => []);
    for (const entry of prior.filter((item) => item.isFile() && item.name.endsWith(".json"))) {
      try { const saved = await readJson<CapabilityStrategyOutcome>(path.join(this.#outcomes, entry.name)); if (saved.selectionId === input.selectionId) throw new Error("strategy_outcome_duplicate_selection"); } catch (error) { if (error instanceof Error && error.message === "strategy_outcome_duplicate_selection") throw error; }
    }
    const now = timestamp();
    const outcome: CapabilityStrategyOutcome = { ...input, outcomeId: `strategy_outcome_${randomUUID()}`, createdAt: now, redacted: true };
    let successCount = strategy.successCount;
    let failureCount = strategy.failureCount;
    const consecutiveFailureCount = input.status === "verified_success" ? 0 : strategy.consecutiveFailureCount + 1;
    if (input.status === "verified_success") successCount += 1; else if (input.status === "verified_failure") failureCount += 1;
    const next: CapabilityStrategyDefinition = { ...strategy, successCount, failureCount, consecutiveFailureCount, confidence: strategyConfidence(successCount, failureCount), lastUsedAt: now, lastVerifiedAt: now, ...(input.failureCode === undefined ? {} : { lastFailureCode: input.failureCode }), status: shouldDegradeStrategy({ ...strategy, successCount, failureCount, consecutiveFailureCount, confidence: strategyConfidence(successCount, failureCount) }) ? "degraded" : strategy.status, updatedAt: now };
    await saveJson(this.#definitionPath(strategy.strategyId), next);
    await saveJson(path.join(this.#outcomes, `${safeId(outcome.outcomeId)}.json`), outcome);
    return { strategy: next, outcome };
  }
  async disable(strategyId: string): Promise<CapabilityStrategyDefinition> { return this.#setStatus(strategyId, "disabled"); }
  async degrade(strategyId: string): Promise<CapabilityStrategyDefinition> { return this.#setStatus(strategyId, "degraded"); }
  async archive(strategyId: string): Promise<CapabilityStrategyDefinition> { const strategy = await this.get(strategyId); if (strategy.status === "active" || strategy.status === "proposed" || strategy.status === "reviewed") throw new Error("strategy_archive_requires_terminal"); return this.#setStatus(strategyId, "archived"); }
  async saveSelection(selection: CapabilityStrategySelection): Promise<void> { await saveJson(path.join(this.#selections, `${safeId(selection.selectionId)}.json`), selection); const entries = await readdir(this.#selections).catch(() => []); for (const item of entries.sort().slice(0, Math.max(0, entries.length - MAX_SELECTIONS))) await rename(path.join(this.#selections, item), `${path.join(this.#selections, item)}.archived`).catch(() => undefined); }
  async summary(): Promise<import("@agenthost/core").CapabilityStrategySummary> {
    const values = await this.list({ limit: MAX_RECORDS });
    const counts = { proposed: 0, reviewed: 0, active: 0, degraded: 0, disabled: 0, archived: 0 };
    for (const item of values) counts[item.status] += 1;
    return { counts, active: values.filter((item) => item.status === "active").slice(0, 20).map((item) => ({ strategyId: item.strategyId, goalCategory: item.goalCategory, status: item.status, confidence: item.confidence, successCount: item.successCount, failureCount: item.failureCount, ...(item.lastVerifiedAt === undefined ? {} : { lastVerifiedAt: item.lastVerifiedAt }), source: item.source, redacted: true as const })), degraded: values.filter((item) => item.status === "degraded").slice(0, 20).map((item) => ({ strategyId: item.strategyId, goalCategory: item.goalCategory, ...(item.lastFailureCode === undefined ? {} : { lastFailureCode: item.lastFailureCode }), redacted: true as const })), redacted: true };
  }
  async #setStatus(strategyId: string, status: CapabilityStrategyStatus): Promise<CapabilityStrategyDefinition> { const strategy = await this.get(strategyId); const next = { ...strategy, status, updatedAt: timestamp() }; await saveJson(this.#definitionPath(strategyId), next); return next; }
  async #exists(file: string): Promise<boolean> { try { await readFile(file); return true; } catch { return false; } }
  #definitionPath(id: string): string { return path.join(this.#definitions, `${safeId(id)}.json`); }
  #reviewPath(id: string): string { return path.join(this.#reviews, `${safeId(id)}.json`); }
}

export { builtins as createBuiltinCapabilityStrategies, step as createCapabilityStrategyStep };
