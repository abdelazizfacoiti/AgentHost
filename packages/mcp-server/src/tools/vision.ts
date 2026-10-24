import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { classifyAppSensitivity, evaluateSafety, rankVisionTargets, toolFailure, toolSuccess, type DesktopWindowContext, type VisionGroundingResult } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";

const activeWindow = z.object({ windowId: z.string().trim().min(1).max(200).optional(), appName: z.string().trim().min(1).max(200).optional(), title: z.string().trim().min(1).max(500).optional(), pid: z.number().int().min(1).optional() }).strict();
const base = { imagePath: z.string().trim().min(1).max(1000), activeWindow: activeWindow.optional() };
const analyzeInput = z.object({ ...base, maxItems: z.number().int().min(1).max(1000).optional(), redactionMode: z.enum(["standard", "strict"]).optional() }).strict();
const findInput = z.object({ ...base, query: z.string().trim().min(1).max(500), match: z.enum(["exact", "contains", "fuzzy"]).optional(), limit: z.number().int().min(1).max(100).optional() }).strict();
const targetInput = z.object({ ...base, query: z.string().trim().min(1).max(500), targetType: z.enum(["text", "button", "input", "region"]).optional(), limit: z.number().int().min(1).max(20).optional() }).strict();
type Base = z.infer<typeof analyzeInput>;

function visionSafetyInput(input: Base): { filePath: string; appName?: string; dataSensitivity?: "sensitive" } {
  const appName = input.activeWindow?.appName;
  const sensitivity = classifyAppSensitivity(appName === undefined ? {} : { appName });
  return {
    filePath: input.imagePath,
    ...(appName === undefined ? {} : { appName }),
    ...(sensitivity === "communication" ? { dataSensitivity: "sensitive" as const } : {})
  };
}

function inside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function matches(expected: DesktopWindowContext, actual: DesktopWindowContext): boolean {
  return (expected.windowId === undefined || expected.windowId === actual.windowId) && (expected.appName === undefined || expected.appName === actual.appName) && (expected.pid === undefined || expected.pid === actual.pid) && (expected.title === undefined || expected.title === actual.title);
}

async function prepare(input: Base, context: AgentHostMcpContext, mode: "ocr" | "layout" | "target_search" = "ocr"): Promise<VisionGroundingResult | { imagePath: string; source: "agenthost_screenshot" | "agenthost_output" | "granted_path"; basename: string; sensitivity: ReturnType<typeof classifyAppSensitivity> }> {
  let actual: DesktopWindowContext | undefined;
  if (input.activeWindow !== undefined) {
    const expected: DesktopWindowContext = {
      ...(input.activeWindow.windowId === undefined ? {} : { windowId: input.activeWindow.windowId }),
      ...(input.activeWindow.appName === undefined ? {} : { appName: input.activeWindow.appName }),
      ...(input.activeWindow.title === undefined ? {} : { title: input.activeWindow.title }),
      ...(input.activeWindow.pid === undefined ? {} : { pid: input.activeWindow.pid })
    };
    const current = await context.linux.getActiveWindow();
    if (!current.supported || current.activeWindow === undefined) return failResult("active_window_unavailable");
    if (!matches(expected, current.activeWindow)) return failResult("active_window_mismatch");
    actual = current.activeWindow;
  }
  const candidateAppName = actual?.appName ?? input.activeWindow?.appName;
  const sensitivity = classifyAppSensitivity(candidateAppName === undefined ? {} : { appName: candidateAppName });
  if (sensitivity === "credential_or_security") return failResult("protected_window_unsupported");
  const safety = evaluateSafety(
    {
      tool: "vision.analyze_image",
      actionType: "file_read",
      filePath: input.imagePath,
      ...(actual?.appName === undefined ? {} : { appName: actual.appName }),
      ...(sensitivity === "communication" ? { dataSensitivity: "sensitive" as const } : {})
    },
    context.policy,
    { agentHostDir: context.config.agentHostDir, grants: context.grants.listActiveGrants() }
  );
  if (!safety.allowed) return failResult(safety.blocked ? "safety_blocked" : "approval_required");
  let resolved: string;
  try {
    resolved = await realpath(input.imagePath);
    const stats = await lstat(resolved);
    if (!stats.isFile() || stats.size > 20 * 1024 * 1024) return failResult("image_path_invalid");
    const header = await readFile(resolved, { encoding: null, flag: "r" });
    const png = header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpg = header[0] === 0xff && header[1] === 0xd8;
    const webp = header.subarray(0, 4).toString() === "RIFF" && header.subarray(8, 12).toString() === "WEBP";
    const bmp = header.subarray(0, 2).toString() === "BM";
    const tiff = header.subarray(0, 4).toString() === "II*\u0000" || header.subarray(0, 4).toString() === "MM\u0000*";
    if (!(png || jpg || webp || bmp || tiff)) return failResult("unsupported_image_format");
  } catch {
    return failResult("image_path_invalid");
  }
  const screenshots = path.join(context.config.agentHostDir, "screenshots");
  const outputs = path.join(context.config.agentHostDir, "outputs");
  const granted = safety.grantDecision.allowedByGrantIds.length > 0;
  const source = inside(resolved, screenshots) ? "agenthost_screenshot" : inside(resolved, outputs) ? "agenthost_output" : granted ? "granted_path" : undefined;
  if (source === undefined) return failResult("image_path_not_approved");
  return { imagePath: resolved, source, basename: path.basename(resolved), sensitivity };
}

function failResult(reason: string): VisionGroundingResult {
  return { supported: false, backend: "unavailable", mode: "ocr", textItems: [], groups: [], targetCandidates: [], warnings: [], redactionCounts: {}, truncated: false, reason };
}

function recoveryHint(reason: string): string | undefined {
  if (reason === "ocr_timeout" || reason === "ocr_failed") return "Recovery: capture a fresh active-window-only screenshot (smaller image, faster OCR) and retry; full-screen images are slower to analyze.";
  if (reason === "active_window_mismatch" || reason === "active_window_unavailable") return "Recovery: re-observe with computer.observe_state, then capture a fresh screenshot before retrying.";
  return undefined;
}

function failure(tool: string, result: VisionGroundingResult) {
  const hint = recoveryHint(result.reason);
  return toolFailure({ tool, riskLevel: result.reason.includes("protected") ? "blocked" : "low", error: { code: result.reason, message: "Vision analysis was not performed." }, observations: hint === undefined ? [result.reason] : [result.reason, hint] });
}

async function analyze(input: Base, context: AgentHostMcpContext, mode: "ocr" | "layout" | "target_search" = "ocr"): Promise<VisionGroundingResult> {
  const prepared = await prepare(input, context, mode);
  if ("supported" in prepared) return prepared;
  if (context.linux.analyzeImage === undefined) return failResult("ocr_backend_unavailable");
  return context.linux.analyzeImage({ imagePath: prepared.imagePath, source: prepared.source, basename: prepared.basename, mode, maxItems: input.maxItems ?? 500 });
}

export function createVisionTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const analyzeTool: AgentHostToolDefinition<z.infer<typeof analyzeInput>, VisionGroundingResult, AgentHostMcpContext> = {
    name: "vision.analyze_image",
    description: "Runs bounded local OCR on an approved screenshot or output image; never clicks. Repeat queries on the same image reuse cached OCR; prefer active-window-only screenshots for faster OCR.",
    riskLevel: "low",
    inputSchema: analyzeInput,
    mcpInputSchema: {
      type: "object",
      properties: { imagePath: { type: "string" }, activeWindow: { type: "object" }, maxItems: { type: "integer", minimum: 1, maximum: 1000 }, redactionMode: { type: "string", enum: ["standard", "strict"] } },
      required: ["imagePath"],
      additionalProperties: false
    },
    inputSummary: "Analyze approved local image",
    auditInputSummary: () => "Analyze local image; path omitted.",
    auditOutputSummary: (result) => result.ok ? `Vision OCR returned ${result.data?.textItems.length ?? 0} redacted items.` : result.error?.code ?? "Vision failed.",
    safety: { actionType: "file_read", getInput: visionSafetyInput },
    async handler(input, context) {
      const started = Date.now();
      const data = await analyze(input, context);
      const ocrMs = Date.now() - started;
      return data.supported
        ? toolSuccess({ tool: "vision.analyze_image", riskLevel: "low", data, observations: [`Local OCR only; no click or upload occurred (OCR took ${ocrMs}ms; repeat queries on this image reuse the cached result).`] })
        : failure("vision.analyze_image", data);
    }
  };

  const findText: AgentHostToolDefinition<z.infer<typeof findInput>, unknown, AgentHostMcpContext> = {
    name: "vision.find_text",
    description: "Finds bounded redacted OCR text and image-relative centers; never clicks. Shares cached OCR with analyze/find_target on the same image.",
    riskLevel: "low",
    inputSchema: findInput,
    mcpInputSchema: {
      type: "object",
      properties: { imagePath: { type: "string" }, query: { type: "string" }, match: { type: "string", enum: ["exact", "contains", "fuzzy"] }, activeWindow: { type: "object" }, limit: { type: "integer", minimum: 1, maximum: 100 } },
      required: ["imagePath", "query"],
      additionalProperties: false
    },
    inputSummary: "Find OCR text",
    auditInputSummary: () => "Find OCR text; query and path omitted.",
    auditOutputSummary: (result) => result.ok ? "Vision text matches returned without logging OCR text." : result.error?.code ?? "Vision failed.",
    safety: { actionType: "file_read", getInput: visionSafetyInput },
    async handler(input, context) {
      const started = Date.now();
      const data = await analyze({ ...input, maxItems: 1000 }, context);
      const ocrMs = Date.now() - started;
      if (!data.supported) return failure("vision.find_text", data);
      const query = input.query.toLowerCase();
      const matched = data.textItems.filter((item) => input.match === "exact" ? item.text.toLowerCase() === query : item.text.toLowerCase().includes(query)).slice(0, input.limit ?? 20);
      return toolSuccess({ tool: "vision.find_text", riskLevel: "low", data: { image: data.image, matches: matched, warnings: data.warnings, truncated: data.truncated }, observations: [`Returned image-relative text bounds only; no click occurred (OCR took ${ocrMs}ms).`] });
    }
  };

  const findTarget: AgentHostToolDefinition<z.infer<typeof targetInput>, unknown, AgentHostMcpContext> = {
    name: "vision.find_target",
    description: "Ranks visible OCR target candidates with image-relative coordinates; never clicks or types. Shares cached OCR with analyze/find_text on the same image.",
    riskLevel: "low",
    inputSchema: targetInput,
    mcpInputSchema: {
      type: "object",
      properties: { imagePath: { type: "string" }, query: { type: "string" }, targetType: { type: "string", enum: ["text", "button", "input", "region"] }, activeWindow: { type: "object" }, limit: { type: "integer", minimum: 1, maximum: 20 } },
      required: ["imagePath", "query"],
      additionalProperties: false
    },
    inputSummary: "Find OCR target",
    auditInputSummary: () => "Find OCR target; query and path omitted.",
    auditOutputSummary: (result) => result.ok ? "Vision candidates returned without logging OCR labels." : result.error?.code ?? "Vision failed.",
    safety: { actionType: "file_read", getInput: visionSafetyInput },
    async handler(input, context) {
      const started = Date.now();
      const data = await analyze({ ...input, maxItems: 1000 }, context, "target_search");
      const ocrMs = Date.now() - started;
      if (!data.supported) return failure("vision.find_target", data);
      const candidates = rankVisionTargets(data.textItems, `${input.query} ${input.targetType ?? ""}`, input.limit ?? 5);
      return toolSuccess({ tool: "vision.find_target", riskLevel: "low", data: { image: data.image, candidates, warnings: [...data.warnings, "Coordinates are image-relative. Use desktop.click dryRun separately after active-window validation."], truncated: data.truncated }, observations: [`Returned suggestions only; no desktop action occurred (OCR took ${ocrMs}ms).`] });
    }
  };

  return [analyzeTool, findText, findTarget];
}
