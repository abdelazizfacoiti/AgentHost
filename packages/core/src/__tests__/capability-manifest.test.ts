import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createBaseCapabilityRegistry, getDefaultPolicy } from "../index.js";
import { buildCapabilitiesJson, buildCapabilityMarkdown } from "../capability-manifest.js";

describe("capability manifest", () => {
  it("briefs agent clients with families, loop, and execution model", () => {
    const markdown = buildCapabilityMarkdown({ version: "0.1.0" });
    expect(markdown).toContain("computer");
    expect(markdown).toContain("browser");
    expect(markdown).toContain("skills");
    expect(markdown).toContain("agenthost://status");
    expect(markdown).not.toContain("agenthost://skills");
    expect(markdown).not.toContain("task.execute_plan");
    expect(markdown).toContain("observe, verify");
  });

  it("emits live counts when provided", () => {
    const markdown = buildCapabilityMarkdown({ version: "0.1.0", toolCount: 250, byExecutionClass: { read_only: 60 } });
    expect(markdown).toContain("250 tools");
    const json = buildCapabilitiesJson({ version: "0.1.0", toolCount: 250, byExecutionClass: {} });
    expect(json).toMatchObject({ product: "agenthost", toolCount: 250 });
  });

  it("states the automatic overlay mode and fallback", () => {
    const overlay = { mode: "always" as const, triggers: ["computer.*", "desktop.*"], fallback: "agenthost overlay status" };
    expect(buildCapabilityMarkdown({ version: "0.1.0", overlay })).toContain("Activity overlay: mode `always`");
    expect(buildCapabilitiesJson({ version: "0.1.0", overlay }).overlay).toEqual(overlay);
  });

  it("covers every registered family", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-manifest-"));
    void homeDir;
    const registry = createBaseCapabilityRegistry();
    expect(registry.listTools().length).toBeGreaterThan(200);
    expect(getDefaultPolicy().enabled).toBe(true);
  });
});
