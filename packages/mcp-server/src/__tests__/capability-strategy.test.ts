import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAdapterRegistry, createBaseCapabilityRegistry, type ToolResult } from "@agenthost/core";
import { CapabilityStrategyStore, createBuiltinCapabilityStrategies } from "../capability-strategy-store.js";
import { CapabilityStrategyService } from "../capability-strategy-service.js";
import { ToolReceiptManager } from "../tool-receipts.js";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-strategy-"));
  const store = new CapabilityStrategyStore(root);
  await store.ensureStructure();
  const browser = {
    detect: async () => ({ enabled: true, connected: true, paired: true, reason: "paired" }),
    currentUrl: async () => ({ url: "https://example.test/ready", rawUrl: "https://example.test/ready" }),
    pageContext: async () => ({})
  } as never;
  const service = new CapabilityStrategyService(store);
  const context = { sessionId: "session_strategy", profile: "dev" as const, registry: createBaseCapabilityRegistry(), adapters: createAdapterRegistry(), browser };
  return { root, store, service, context };
}

describe("persistent capability strategies", () => {
  it("seeds trusted built-ins and selects browser bridge before fallback", async () => {
    const { service, store, context } = await fixture();
    const all = await store.list({ limit: 100 });
    expect(all.map((item) => item.strategyId)).toContain("builtin.browser-navigation");
    const selected = await service.select(context, { goalCategory: "browser_navigation", destination: "https://example.test/start", mode: "normal" });
    expect(selected.strategyId).toBe("builtin.browser-navigation");
    expect(selected.fallbackStrategyIds.length).toBeLessThanOrEqual(3);
    expect(selected.executable).toBe(false);
    expect(selected.confirmationTokensCreated).toBe(false);
  });

  it("reuses selection only through bounded verification and signed receipt", async () => {
    const { service, store, context } = await fixture();
    const receipts = new ToolReceiptManager();
    const selected = await service.select({ ...context, receipts }, { goalCategory: "browser_navigation", destination: "https://example.test/ready", mode: "normal" });
    const verification = await service.verifyOutcome({ ...context, receipts }, selected.selectionId);
    expect(verification.status).toBe("verified_success");
    const result: ToolResult = { ok: true, tool: "browser.open_url", riskLevel: "medium", approval: { required: false, status: "not_required" }, data: null, observations: [], error: null };
    const receipt = receipts.issue({ sessionId: context.sessionId, tool: "browser.open_url", rawInput: { url: "https://example.test/ready" }, result, riskLevel: "medium" });
    const outcome = await service.recordOutcome({ ...context, receipts }, { selectionId: selected.selectionId, verificationId: verification.verificationId, receipt });
    expect(outcome.status).toBe("verified_success");
    expect((await store.get("builtin.browser-navigation")).successCount).toBe(1);
  });

  it("rejects unsafe proposal content and persists no private destination", async () => {
    const { root, store } = await fixture();
    const base = createBuiltinCapabilityStrategies().find((item) => item.strategyId === "builtin.visual-assistance")!;
    await expect(store.propose({ ...base, strategyId: "local.unsafe", source: "reviewed_local", status: "proposed", name: "Password strategy" })).rejects.toThrow("strategy_text_invalid");
    const selectionFiles = await readdir(path.join(root, "strategies", "selections"));
    expect(selectionFiles.length).toBe(0);
    const definition = await readFile(path.join(root, "strategies", "definitions", "builtin_visual-assistance.json"), "utf8");
    expect(definition).not.toContain("https://");
  });

  it("rejects unknown strategy fields", async () => {
    const { store } = await fixture();
    const base = createBuiltinCapabilityStrategies().find((item) => item.strategyId === "builtin.visual-assistance")!;
    await expect(store.propose({ ...base, strategyId: "local.extra", source: "reviewed_local", status: "proposed", extra: true } as never)).rejects.toThrow("strategy_unknown_field");
  });

  it("requires a live assistance projection before visual success is recorded", async () => {
    const { service, context } = await fixture();
    const missing = await service.select(context, { goalCategory: "visual_assistance", mode: "normal", assistanceSessionId: "assist_missing" });
    const missingVerification = await service.verifyOutcome(context, missing.selectionId);
    expect(missingVerification.status).toBe("verified_failure");

    const liveContext = {
      ...context,
      overlayAssistance: { explain: async () => ({ status: "active", renderer: { healthy: true } }) },
      overlay: {
        diagnostics: async () => ({}),
        state: async () => ({ emergencyHidden: false, overlays: [{ visible: true }] })
      }
    } as never;
    const live = await service.select(liveContext, { goalCategory: "visual_assistance", mode: "normal", assistanceSessionId: "assist_live" });
    const liveVerification = await service.verifyOutcome(liveContext, live.selectionId);
    expect(liveVerification.status).toBe("verified_success");
  });

  it("adjusts selection with recorded episodic memory", async () => {
    const { service, context } = await fixture();
    const plain = await service.select(context, { goalCategory: "browser_navigation", mode: "normal" });
    expect(plain.explanation.join(" ")).toContain("No recorded episodes");
    const remembered = await service.select({
      ...context,
      episodicMemory: {
        list: async () => [
          { outcome: "verified_failure", strategyId: plain.strategyId },
          { outcome: "verified_success", strategyId: plain.strategyId }
        ]
      }
    } as never, { goalCategory: "browser_navigation", mode: "normal" });
    expect(remembered.explanation.join(" ")).toContain("Episodic memory: 1 success / 1 failure");
  });

  it("reuses the persisted strategy from a new service/session without persisting destination input", async () => {
    const first = await fixture();
    const firstSelection = await first.service.select(first.context, { goalCategory: "browser_navigation", destination: "https://example.test/private-path", mode: "normal" });
    const secondStore = new CapabilityStrategyStore(first.root);
    await secondStore.ensureStructure();
    const secondService = new CapabilityStrategyService(secondStore);
    const secondSelection = await secondService.select({ ...first.context, sessionId: "session_strategy_2" }, { goalCategory: "browser_navigation", destination: "https://example.test/other-path", mode: "normal" });
    expect(secondSelection.strategyId).toBe(firstSelection.strategyId);
    const saved = await readFile(path.join(first.root, "strategies", "selections", `${firstSelection.selectionId}.json`), "utf8");
    expect(saved).not.toContain("private-path");
  });
});
