import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getDefaultPolicy } from "@agenthost/core";
import type { AgentHostMcpContext } from "../context.js";
import { runTool } from "../tool-runner.js";
import { applyProductionExecutionMetadata } from "../tool-metadata.js";
import { createVisionTools } from "../tools/vision.js";
import { createDesktopTools } from "../tools/desktop.js";

const roots: string[] = [];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("screen vision tool", () => {
  it("captures fresh OCR and returns absolute screen-coordinate suggestions", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "agenthost-vision-tools-"));
    roots.push(home);
    const screenshotPath = path.join(home, "screenshots", "fresh.png");
    const context = {
      sessionId: "test-session",
      config: { agentHostDir: home, configPath: path.join(home, "config.json"), logFile: path.join(home, "logs", "audit.jsonl") },
      policy: getDefaultPolicy(),
      grants: { listActiveGrants: () => [] },
      logger: { log: async () => undefined },
      linux: {
        getActiveWindow: async () => ({ supported: true, backend: "test", activeWindow: { windowId: "10", appName: "Editor", title: "Draft" }, reason: "ok" }),
        screenshot: async () => { await mkdir(path.dirname(screenshotPath), { recursive: true }); await writeFile(screenshotPath, png); return { supported: true, backend: "test", path: screenshotPath, bytesWritten: png.byteLength, reason: "fresh" }; },
        analyzeImage: async () => ({ supported: true, backend: "tesseract", mode: "ocr", image: { width: 1920, height: 1080, source: "agenthost_screenshot", basename: "fresh.png", pathRedacted: true }, textItems: [{ id: "text_001", text: "Save", redactedText: "Save", bounds: { x: 100, y: 200, width: 40, height: 20 }, center: { x: 120, y: 210 }, confidence: 0.99, kind: "text", page: 1, block: 1, paragraph: 1, line: 1, redacted: false }], groups: [], targetCandidates: [], warnings: [], redactionCounts: {}, truncated: false, reason: "ok" })
      }
    } as unknown as AgentHostMcpContext;
    context.tools = new Map(applyProductionExecutionMetadata([...createDesktopTools(), ...createVisionTools()]).map((tool) => [tool.name, tool]));
    const tool = applyProductionExecutionMetadata(createVisionTools()).find((entry) => entry.name === "vision.find_text_on_screen")!;
    const result = await runTool(tool, { query: "Save" }, context);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ activeWindow: { windowId: "10" }, matches: [{ coordinateSpace: "screen", screenCenter: { x: 120, y: 210 } }] });
  });
});
