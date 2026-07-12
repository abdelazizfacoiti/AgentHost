import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAdapterRegistry, createBaseCapabilityRegistry, getPolicyProfile, type AgentHostConfig, type AuditLogger } from "@agenthost/core";
import { describe, expect, it } from "vitest";
import { ConfirmationManager } from "../confirmation.js";
import type { AgentHostMcpContext } from "../context.js";
import { ForgeStore } from "../forge-store.js";
import { GrantStore } from "../grants.js";
import { runTool } from "../tool-runner.js";
import { createVisionTools } from "../tools/vision.js";
class Logger implements AuditLogger { entries: any[] = []; async log(entry: any) { this.entries.push(entry); } }
async function setup() { const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-vision-")); const screenshots = path.join(root, "screenshots"); await mkdir(screenshots); const imagePath = path.join(screenshots, "test.png"); await writeFile(imagePath, Buffer.from([137,80,78,71,13,10,26,10])); const policy = getPolicyProfile("dev"); const config: AgentHostConfig = { agentHostDir: root, configPath: `${root}/config.json`, logFile: `${root}/log`, profile: "dev", policy }; const logger = new Logger(); const context: AgentHostMcpContext = { sessionId: "vision", config, policy, registry: createBaseCapabilityRegistry(), adapters: createAdapterRegistry(), logger, confirmations: new ConfirmationManager(), grants: new GrantStore({ persistentGrants: [] }), forge: new ForgeStore(root), linux: { getActiveWindow: async () => ({ supported: true, backend: "test", activeWindow: { appName: "Notes" }, reason: "ok" }), analyzeImage: async () => ({ supported: true, backend: "tesseract", mode: "ocr", image: { width: 100, height: 50, source: "agenthost_screenshot", basename: "test.png", pathRedacted: true }, textItems: [{ id: "text_001", text: "[redacted-email]", redactedText: "[redacted-email]", bounds: { x: 1, y: 2, width: 20, height: 10 }, center: { x: 11, y: 7 }, confidence: .9, kind: "text", page: 1, block: 1, paragraph: 1, line: 1, redacted: true }], groups: [], targetCandidates: [], warnings: [], redactionCounts: { email: 1 }, truncated: false, reason: "ok" }) } as any }; return { context, logger, imagePath }; }
describe("vision tools", () => {
  it("returns OCR bounds without logging content or clicking", async () => { const { context, logger, imagePath } = await setup(); const tool = createVisionTools().find((item) => item.name === "vision.analyze_image")!; const result = await runTool(tool, { imagePath }, context); expect(result.ok).toBe(true); expect(JSON.stringify(logger.entries)).not.toContain("[redacted-email]"); expect(context.linux).not.toHaveProperty("click"); });
  it("blocks credential windows and exposes fixed tools", async () => { const { context, imagePath } = await setup(); const tools = createVisionTools(); expect(tools.map((tool) => tool.name)).toEqual(["vision.analyze_image", "vision.find_text", "vision.find_target"]); const result = await runTool(tools[0]!, { imagePath, activeWindow: { appName: "Bitwarden" } }, context); expect(result).toMatchObject({ ok: false, error: { code: "safety_blocked" } }); });
});
