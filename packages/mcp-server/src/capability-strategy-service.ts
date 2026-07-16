import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import type { BrowserBridgeAdapter } from "@agenthost/app-browser";
import {
  strategyScore,
  type CapabilityStrategyDefinition,
  type CapabilityStrategyFailure,
  type CapabilityStrategyGoal,
  type CapabilityStrategyHealth,
  type CapabilityStrategyOutcome,
  type CapabilityStrategySelection,
  type CapabilityStrategySummary,
  type ToolResultReceipt
} from "@agenthost/core";
import type { AdapterRegistrySnapshot } from "@agenthost/core";
import type { CapabilityRegistrySnapshot, PolicyProfileName } from "@agenthost/core";
import type { ToolReceiptManager } from "./tool-receipts.js";
import { CapabilityStrategyStore } from "./capability-strategy-store.js";
import type { OverlayManager } from "@agenthost/app-overlay";
import type { OverlayAssistanceStore } from "./overlay-assistance-store.js";
import type { SpeechService } from "./speech-service.js";

type Binding = { selection: CapabilityStrategySelection; strategy?: CapabilityStrategyDefinition; destination?: string; assistanceSessionId?: string; createdAt: number };
type Verification = { verificationId: string; selectionId: string; strategyId: string; checkpoint: CapabilityStrategyDefinition["verificationCheckpoints"][number]; status: "verified_success" | "verified_failure"; toolFamily: CapabilityStrategyOutcome["toolFamily"]; expiresAt: number };

function hash(value: string): string { return createHash("sha256").update(value).digest("hex").slice(0, 24); }
function now(): string { return new Date().toISOString(); }
function strategyFamily(tool: string): CapabilityStrategyOutcome["toolFamily"] {
  if (tool.startsWith("browser.")) return "browser";
  if (tool.startsWith("accessibility.")) return "accessibility";
  if (tool.startsWith("vision.")) return "vision";
  if (tool.startsWith("desktop.") || tool.startsWith("window.")) return "desktop";
  if (tool.startsWith("overlay.")) return "overlay";
  if (tool.startsWith("speech.")) return "speech";
  if (tool.startsWith("adapter.") || tool.startsWith("app.")) return "adapter";
  return "guide";
}

export interface StrategyServiceContext {
  sessionId: string;
  profile: PolicyProfileName;
  registry: CapabilityRegistrySnapshot;
  adapters: AdapterRegistrySnapshot;
  browser?: BrowserBridgeAdapter;
  browserBridge?: { status(): Record<string, unknown> };
  overlay?: Pick<OverlayManager, "state" | "diagnostics">;
  overlayAssistance?: Pick<OverlayAssistanceStore, "explain">;
  speech?: Pick<SpeechService, "capabilities">;
  receipts?: Pick<ToolReceiptManager, "verify">;
}

export class CapabilityStrategyService {
  readonly #store: CapabilityStrategyStore;
  readonly #bindings = new Map<string, Binding>();
  readonly #verifications = new Map<string, Verification>();
  #lastSelection: CapabilityStrategySelection | undefined;
  constructor(store: CapabilityStrategyStore) { this.#store = store; }
  store(): CapabilityStrategyStore { return this.#store; }

  async health(context: StrategyServiceContext, strategy?: CapabilityStrategyDefinition): Promise<CapabilityStrategyHealth> {
    const available = context.registry.listTools().map((item) => item.name);
    const required = strategy?.requiredCapabilities ?? [];
    const missing = required.filter((item) => !available.includes(item));
    const checks: CapabilityStrategyHealth["checks"] = [];
    let bridge: CapabilityStrategyHealth["browserBridge"];
    if (strategy?.prerequisiteChecks.includes("browser_bridge_paired") || strategy?.prerequisiteChecks.includes("browser_extension_compatible")) {
      try {
        const detected = context.browser === undefined ? { enabled: false, connected: false, paired: false, reason: "Browser bridge unavailable." } : await context.browser.detect();
        const raw = context.browserBridge?.status();
        const compatible = detected.connected && (raw?.state === undefined || raw.state === "paired");
        bridge = { enabled: detected.enabled, paired: detected.paired, connected: detected.connected, compatible, reason: detected.reason };
        checks.push({ check: "browser_bridge_paired", status: compatible ? "passed" : "failed", reason: detected.reason });
        if (strategy?.prerequisiteChecks.includes("browser_extension_compatible")) checks.push({ check: "browser_extension_compatible", status: compatible ? "passed" : "failed", reason: detected.reason });
      } catch { bridge = { enabled: false, paired: false, connected: false, compatible: false, reason: "Browser bridge health unavailable." }; checks.push({ check: "browser_bridge_paired", status: "unknown", reason: "Browser bridge health unavailable." }); }
    }
    for (const check of strategy?.prerequisiteChecks ?? []) {
      if (check === "browser_bridge_paired" || check === "browser_extension_compatible") continue;
      if (check === "speech_provider_ready" || check === "audio_route_ready") {
        try {
          const capabilities = context.speech === undefined ? undefined : await context.speech.capabilities();
          const status = check === "speech_provider_ready" ? (capabilities?.synthesisSupported === true ? "passed" : "failed") : (capabilities?.playbackSupported === true ? "passed" : "failed");
          checks.push({ check, status, reason: status === "passed" ? "Local speech capability is ready." : "Local speech capability is unavailable." });
        } catch { checks.push({ check, status: "unknown", reason: "Local speech health unavailable." }); }
        continue;
      }
      const status = check === "adapter_available" ? (context.adapters.listAdapters().length > 0 ? "passed" : "failed") : "unknown";
      checks.push({ check, status, reason: status === "passed" ? "Available." : "No safe live probe is registered." });
    }
    const blockers = [...(missing.length > 0 ? ["strategy_required_capability_missing"] : []), ...checks.filter((item) => item.status === "failed").map((item) => item.check === "browser_extension_compatible" ? "extension_version_mismatch_or_unavailable" : "strategy_prerequisite_failed")];
    return { ...(strategy?.strategyId === undefined ? {} : { strategyId: strategy.strategyId }), compatible: blockers.length === 0 && (strategy === undefined || strategy.compatibleProfiles.includes(context.profile)), availableCapabilities: available.slice(0, 200), missingCapabilities: missing, checks, ...(bridge === undefined ? {} : { browserBridge: bridge }), blockers, warnings: strategy?.status === "degraded" ? ["Strategy is degraded and cannot be selected normally."] : [], evaluatedAt: now() };
  }

  async select(context: StrategyServiceContext, input: { goalCategory: CapabilityStrategyGoal; appId?: string; adapterId?: string; mode: "normal" | "validation"; strategyId?: string; destination?: string; assistanceSessionId?: string }): Promise<CapabilityStrategySelection> {
    let destination: string | undefined;
    if (input.destination !== undefined) {
      try { const url = new URL(input.destination); if (!(url.protocol === "http:" || url.protocol === "https:") || url.username || url.password) throw new Error("invalid_url"); destination = `${url.origin}${url.pathname}`; } catch { throw new Error("strategy_destination_invalid"); }
    }
    const candidates = await this.#store.list({ goalCategory: input.goalCategory, limit: 100 });
    const eligible = candidates.filter((strategy) => (input.mode === "validation" ? strategy.strategyId === input.strategyId && (strategy.status === "reviewed" || strategy.status === "active") : strategy.status === "active") && strategy.compatibleProfiles.includes(context.profile));
    const evaluated = await Promise.all(eligible.map(async (strategy) => ({ strategy, health: await this.health(context, strategy) })));
    const healthy = evaluated.filter((item) => item.health.compatible && item.health.blockers.length === 0 && item.strategy.status !== "degraded");
    healthy.sort((a, b) => strategyScore({ strategy: b.strategy, goalCategory: input.goalCategory, ...(input.appId === undefined ? {} : { appId: input.appId }), ...(input.adapterId === undefined ? {} : { adapterId: input.adapterId }), verifiedCheckpoint: b.strategy.verificationCheckpoints.length > 0, recent: b.strategy.lastVerifiedAt !== undefined && Date.now() - Date.parse(b.strategy.lastVerifiedAt) < 30 * 86_400_000 }) - strategyScore({ strategy: a.strategy, goalCategory: input.goalCategory, ...(input.appId === undefined ? {} : { appId: input.appId }), ...(input.adapterId === undefined ? {} : { adapterId: input.adapterId }), verifiedCheckpoint: a.strategy.verificationCheckpoints.length > 0, recent: a.strategy.lastVerifiedAt !== undefined && Date.now() - Date.parse(a.strategy.lastVerifiedAt) < 30 * 86_400_000 }) || a.strategy.strategyId.localeCompare(b.strategy.strategyId));
    const best = healthy[0];
    const fallbackIds = best?.strategy.fallbackStrategyIds ?? candidates.filter((item) => item.strategyId !== best?.strategy.strategyId).slice(0, 3).map((item) => item.strategyId);
    const health = best?.health ?? (evaluated[0]?.health ?? await this.health(context));
    const selection: CapabilityStrategySelection = { selectionId: `strategy_selection_${randomUUID()}`, ...(best === undefined ? {} : { strategyId: best.strategy.strategyId, preferredStrategyId: best.strategy.strategyId, score: strategyScore({ strategy: best.strategy, goalCategory: input.goalCategory, ...(input.appId === undefined ? {} : { appId: input.appId }), ...(input.adapterId === undefined ? {} : { adapterId: input.adapterId }), verifiedCheckpoint: true, recent: false }) }), goalCategory: input.goalCategory, selectedAt: now(), expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), mode: input.mode, fallbackStrategyIds: fallbackIds.slice(0, 3), operationSummaries: best?.strategy.preferredSteps.map((item) => ({ stepId: item.stepId, operation: item.operation, capabilityFamily: item.capabilityFamily, ...(item.verification === undefined ? {} : { verification: item.verification }), requiresDryRun: item.requiresDryRun, requiresConfirmation: item.requiresConfirmation })) ?? [], requiredCapabilities: best?.strategy.requiredCapabilities ?? [], requiredGrantSummary: best === undefined ? [] : ["Recheck current grants before each governed tool call."], expectedConfirmationBoundary: best?.strategy.expectedConfirmationBoundary ?? "never_automatic", health, explanation: best === undefined ? ["No compatible healthy active strategy found.", "Use listed fallback or guide mode after current capability checks."] : ["Selected highest deterministic score after status, profile, capability, prerequisite, and safety filtering.", "Original tools remain responsible for policy, grants, dry-run, confirmation, and target verification."], blockers: best === undefined ? [...health.blockers, "strategy_no_compatible_candidate"] : [], warnings: ["Selection is advisory; no underlying tool was called.", ...(input.mode === "validation" ? ["Validation selection requires two independently verified outcomes before activation."] : [])], executable: false, actionsExecuted: false, confirmationTokensCreated: false };
    this.#bindings.set(selection.selectionId, { selection, ...(best === undefined ? {} : { strategy: best.strategy }), ...(destination === undefined ? {} : { destination }), ...(input.assistanceSessionId === undefined ? {} : { assistanceSessionId: input.assistanceSessionId }), createdAt: Date.now() });
    this.#lastSelection = selection;
    await this.#store.saveSelection(selection);
    return selection;
  }

  async explain(selectionId: string): Promise<CapabilityStrategySelection> { const binding = this.#bindings.get(selectionId); if (binding === undefined || Date.now() - binding.createdAt > 10 * 60_000) throw new Error("strategy_selection_expired"); return binding.selection; }

  async verifyOutcome(context: StrategyServiceContext, selectionId: string): Promise<{ verificationId: string; status: "verified_success" | "verified_failure"; checkpoint: string; reason: string }> {
    const binding = this.#bindings.get(selectionId);
    if (binding === undefined || Date.now() - binding.createdAt > 10 * 60_000) throw new Error("strategy_selection_expired");
    if (binding.strategy === undefined || binding.selection.blockers.length > 0) throw new Error("strategy_selection_blocked");
    const checkpoint = binding.strategy.verificationCheckpoints[0];
    if (checkpoint === undefined) throw new Error("strategy_verifier_unavailable");
    let passed = false;
    if (binding.strategy.goalCategory === "browser_navigation" && binding.destination !== undefined && context.browser !== undefined) {
      try { const current = await context.browser.currentUrl(); const currentUrl = current.rawUrl ?? current.url; passed = currentUrl.startsWith(binding.destination); } catch { passed = false; }
    } else if (binding.strategy.goalCategory === "webpage_inspection" && context.browser !== undefined) {
      try { await context.browser.pageContext({ maxElements: 1 }); passed = true; } catch { passed = false; }
    } else if (binding.strategy.goalCategory === "form_preparation" && context.browser !== undefined) {
      try { await context.browser.formState({ maxFields: 1 }); passed = true; } catch { passed = false; }
    } else if (binding.strategy.goalCategory === "visual_assistance" && binding.assistanceSessionId !== undefined && context.overlayAssistance !== undefined && context.overlay !== undefined) {
      try {
        const diagnostics = await context.overlay.diagnostics();
        const explanation = await context.overlayAssistance.explain(binding.assistanceSessionId, diagnostics);
        const state = await context.overlay.state();
        passed = (explanation.status === "active" || explanation.status === "waiting_for_operator") && explanation.renderer.healthy && !state.emergencyHidden && state.overlays.some((overlay) => overlay.visible === true);
      } catch { passed = false; }
    }
    const verificationId = `strategy_verification_${randomUUID()}`;
    this.#verifications.set(verificationId, { verificationId, selectionId, strategyId: binding.strategy.strategyId, checkpoint, status: passed ? "verified_success" : "verified_failure", toolFamily: binding.strategy.preferredSteps[0]?.capabilityFamily ?? "guide", expiresAt: Date.now() + 5 * 60_000 });
    return { verificationId, status: passed ? "verified_success" : "verified_failure", checkpoint, reason: passed ? "Bounded verification checkpoint passed." : "Bounded verification checkpoint did not pass." };
  }

  async recordOutcome(context: StrategyServiceContext, input: { selectionId: string; verificationId: string; receipt: ToolResultReceipt }): Promise<CapabilityStrategyOutcome> {
    const binding = this.#bindings.get(input.selectionId);
    const verification = this.#verifications.get(input.verificationId);
    if (binding === undefined || verification === undefined || verification.selectionId !== input.selectionId || verification.expiresAt < Date.now()) throw new Error("strategy_verification_invalid");
    if (context.receipts === undefined) throw new Error("strategy_receipts_unavailable");
    if (binding.strategy === undefined) throw new Error("strategy_selection_blocked");
    const receipt = context.receipts.verify(input.receipt);
    if (!receipt.ok || receipt.receipt === undefined || receipt.receipt.sessionId !== context.sessionId) throw new Error("strategy_receipt_invalid");
    if (receipt.receipt.preview || receipt.receipt.executionStatus === "preview") throw new Error("strategy_receipt_preview_only");
    if (strategyFamily(receipt.receipt.tool) !== verification.toolFamily && verification.toolFamily !== "guide") throw new Error("strategy_receipt_family_mismatch");
    const result = await this.#store.updateOutcome({ strategyId: binding.strategy.strategyId, selectionId: input.selectionId, status: verification.status, toolFamily: verification.toolFamily, verification: verification.checkpoint, ...(verification.status === "verified_failure" ? { failureCode: "verification_failed" as const } : {}) });
    this.#verifications.delete(input.verificationId);
    return result.outcome;
  }

  async revalidate(context: StrategyServiceContext, strategyId: string): Promise<CapabilityStrategyHealth> {
    const strategy = await this.#store.get(strategyId);
    const health = await this.health(context, strategy);
    if (!health.compatible || health.blockers.length > 0) await this.#store.degrade(strategyId);
    return health;
  }
  async summary(): Promise<Record<string, unknown>> { const summary = await this.#store.summary(); if (this.#lastSelection === undefined) return summary as unknown as Record<string, unknown>; return { ...summary, lastSelection: { ...(this.#lastSelection.strategyId === undefined ? {} : { strategyId: this.#lastSelection.strategyId }), goalCategory: this.#lastSelection.goalCategory, selectedAt: this.#lastSelection.selectedAt, status: this.#lastSelection.blockers.length === 0 ? "selected" : "blocked", redacted: true } }; }
}
