import type { ToolResult, RuntimeActivityLabelKey, RuntimeActivityRecord, RuntimeActivitySource, RuntimeActivityState, RuntimeActivityProgress, RuntimeActivityControlKey } from "@agenthost/core";
import { runtimeActivityPriority, type RuntimeActivityProjection, type RuntimeActivityScreenshotSuppression, type RuntimeActivityTerminalVerification } from "@agenthost/core";
import type { RuntimeActivityBeginInput, RuntimeActivityPatch, RuntimeActivityStore } from "./runtime-activity-store.js";

export interface RuntimeActivityRendererProjection { visible: boolean; status: "available" | "degraded" | "headless" | "unavailable"; suppression: RuntimeActivityScreenshotSuppression; }
export interface RuntimeActivityDirectStart { activityId: string; taskId: string; }
type Listener = (record: RuntimeActivityRecord) => void;

const sourceForTool = (tool: string): RuntimeActivitySource => {
  if (tool.startsWith("browser.")) return "browser";
  if (tool === "desktop.screenshot") return "screenshot";
  if (tool.startsWith("desktop.") || tool.startsWith("window.")) return "desktop";
  if (tool.startsWith("accessibility.")) return "accessibility";
  if (tool.startsWith("vision.")) return "vision";
  if (tool.startsWith("checkpoint.")) return "checkpoint";
  if (tool.startsWith("workflow.")) return "workflow";
  if (tool.startsWith("overlay.assistance") || tool.startsWith("overlay.control_surface")) return "assistance";
  if (tool.startsWith("forge.")) return "forge";
  if (tool.startsWith("scheduler.")) return "scheduler";
  if (tool.startsWith("speech.")) return "speech";
  if (tool.startsWith("strategy.")) return "strategy";
  if (tool.startsWith("policy.")) return "policy";
  return "direct_tool";
};

const labelForTool = (tool: string): RuntimeActivityLabelKey => {
  if (tool === "browser.open_url") return "opening_browser";
  if (tool === "browser.background_status") return "checking_strategy";
  if (tool === "browser.background_launch") return "background_work";
  if (tool === "browser.release_session") return "background_work";
  if (tool.startsWith("browser.")) return tool.includes("wait") ? "waiting_for_page" : "inspecting_page";
  if (tool === "desktop.screenshot") return "preparing_screenshot";
  if (tool === "desktop.click" || tool === "desktop.double_click" || tool === "desktop.right_click"
    || tool === "desktop.move_mouse" || tool === "desktop.scroll" || tool === "desktop.drag") return "clicking_target";
  if (tool === "desktop.type_text") return "typing_text";
  if (tool === "desktop.hotkey") return "pressing_hotkey";
  if (tool === "window.focus") return "focusing_window";
  if (tool.startsWith("vision.")) return "analyzing_screenshot";
  if (tool.startsWith("workflow.")) return "running_workflow";
  if (tool === "task.execute_plan") return "running_workflow";
  if (tool.startsWith("overlay.assistance") || tool.startsWith("overlay.control_surface")) return "visual_assistance";
  if (tool.startsWith("forge.")) return tool.includes("run") || tool.includes("dispatch") ? "validating_generated_tool" : "background_work";
  if (tool.startsWith("scheduler.")) return "checking_scheduler";
  if (tool.startsWith("strategy.")) return "checking_strategy";
  if (tool.startsWith("policy.")) return "checking_permissions";
  if (tool === "speech.synthesize") return "synthesizing_speech";
  if (tool === "speech.play") return "playing_speech";
  if (tool === "speech.transmission_prepare") return "preparing_transmission";
  if (tool === "speech.transmission_execute") return "transmitting_speech";
  if (tool.startsWith("ssh.")) return "background_work";
  if (tool.startsWith("speech.")) return "checking_permissions";
  return "agenthost_working";
};

function isBlockedCode(code: string | undefined): boolean { return code !== undefined && /blocked|protected|grant_denied|unsupported|forbidden/i.test(code); }
function isApprovalCode(code: string | undefined): boolean { return code !== undefined && /confirmation|required|approval|dry_run_required/i.test(code); }

function boundedDetail(value: string): string { return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 120); }
function safeInt(value: unknown): number | undefined { return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100_000 ? value : undefined; }
function safeName(value: unknown): string | undefined { return typeof value === "string" && value.trim().length > 0 ? boundedDetail(value.trim().slice(0, 60)) : undefined; }

/**
 * Human-readable one-line summary for the working widget. Coordinates, app
 * names, and counts are safe; typed text, titles, and tokens are never
 * included (only lengths), so secrets can't leak into overlay/control-room.
 */
export function describeToolDetail(tool: string, rawInput: unknown): string | undefined {
  if (typeof rawInput !== "object" || rawInput === null) return undefined;
  const input = rawInput as Record<string, unknown>;
  if (tool === "desktop.click" || tool === "desktop.double_click" || tool === "desktop.right_click" || tool === "desktop.move_mouse") {
    const x = safeInt(input.x);
    const y = safeInt(input.y);
    if (x !== undefined && y !== undefined) return boundedDetail(`(${x}, ${y})`);
    return undefined;
  }
  if (tool === "desktop.scroll") {
    const direction = typeof input.direction === "string" ? input.direction.slice(0, 10) : undefined;
    const amount = safeInt(input.amount);
    if (direction !== undefined || amount !== undefined) return boundedDetail(`scroll ${direction ?? "?"}${amount === undefined ? "" : ` x${amount}`}`);
    return undefined;
  }
  if (tool === "desktop.drag") {
    const sx = safeInt(input.startX);
    const sy = safeInt(input.startY);
    const ex = safeInt(input.endX);
    const ey = safeInt(input.endY);
    if (sx !== undefined && sy !== undefined && ex !== undefined && ey !== undefined) return boundedDetail(`(${sx}, ${sy}) → (${ex}, ${ey})`);
    return undefined;
  }
  if (tool === "desktop.type_text") {
    const text = typeof input.text === "string" ? input.text : undefined;
    if (text !== undefined) return boundedDetail(`typing ${text.length} char${text.length === 1 ? "" : "s"}`);
    return undefined;
  }
  if (tool === "desktop.hotkey") {
    const keys = Array.isArray(input.keys) ? input.keys.filter((key): key is string => typeof key === "string").slice(0, 4).map((key) => key.slice(0, 20)) : [];
    if (keys.length > 0) return boundedDetail(keys.join("+"));
    return undefined;
  }
  if (tool === "window.focus") {
    const app = safeName(input.appName);
    if (app !== undefined) return boundedDetail(`focusing ${app}`);
    const windowId = safeName(input.windowId);
    if (windowId !== undefined) return boundedDetail(`focusing window ${windowId.slice(0, 12)}`);
    return undefined;
  }
  return undefined;
}

export class RuntimeActivityService {
  readonly #store: RuntimeActivityStore;
  readonly #listeners = new Set<Listener>();
  constructor(store: RuntimeActivityStore) { this.#store = store; }
  store(): RuntimeActivityStore { return this.#store; }
  subscribe(listener: Listener): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  begin(input: RuntimeActivityBeginInput): RuntimeActivityRecord { const record = this.#store.begin(input); this.#publish(record); return record; }
  update(id: string, patch: RuntimeActivityPatch): RuntimeActivityRecord { const record = this.#store.update(id, patch); this.#publish(record); return record; }
  finish(id: string, state: "completed" | "failed" | "blocked" | "cancelled", verification?: RuntimeActivityTerminalVerification): RuntimeActivityRecord { const record = this.#store.finish(id, state, verification); this.#publish(record); return record; }
  startDirectTool(tool: string, sessionId: string, rawInput?: unknown): RuntimeActivityDirectStart {
    const taskId = `task_${sessionId}_${tool}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 200);
    const detail = describeToolDetail(tool, rawInput);
    const label = labelForTool(tool);
    const record = this.begin({ taskId, source: sourceForTool(tool), labelKey: label, actionKey: label, ...(detail === undefined ? {} : { detail }), state: "preparing", operation: detail === undefined ? tool : `${tool} ${detail}` });
    return { activityId: record.activityId, taskId };
  }
  finishDirectTool(activityId: string, result: Pick<ToolResult, "ok" | "preview" | "error" | "riskLevel">): RuntimeActivityRecord {
    const code = result.error?.code;
    if (isApprovalCode(code)) return this.update(activityId, { state: "waiting_for_approval", labelKey: "waiting_for_approval", actionKey: "waiting_for_approval", ...(code === undefined ? {} : { warningCode: code }) });
    if (!result.ok && isBlockedCode(code)) return this.update(activityId, { state: "blocked", labelKey: "blocked_by_policy", actionKey: "blocked_by_policy", ...(code === undefined ? {} : { blockerCode: code }) });
    if (result.preview === true) return this.update(activityId, { state: "inspecting" });
    if (!result.ok) return this.finish(activityId, "failed", { verified: false, source: "tool_result" });
    return this.finish(activityId, "completed", { verified: true, source: "tool_result", verifiedAt: new Date().toISOString() });
  }
  setRendererBinding(activityId: string, binding: RuntimeActivityRecord["rendererBinding"]): RuntimeActivityRecord { return this.#store.update(activityId, { rendererBinding: binding }); }
  setSuppression(state: RuntimeActivityScreenshotSuppression): void { for (const record of this.#store.list({ limit: 200 })) this.#store.update(record.activityId, { screenshotSuppression: state }); this.#publishAll(); }
  projection(renderer: RuntimeActivityRendererProjection = { visible: false, status: "headless", suppression: "none" }): RuntimeActivityProjection {
    const activities = this.#store.list({ includeTerminal: true, limit: 100 });
    const active = activities.find((record) => !["completed", "failed", "cancelled"].includes(record.state));
    return { activities, ...(active === undefined ? {} : { active }), activeCount: activities.filter((record) => !["completed", "failed", "cancelled"].includes(record.state)).length, rendererVisible: renderer.visible, rendererStatus: renderer.status, screenshotSuppression: renderer.suppression, redacted: true };
  }
  #publish(record: RuntimeActivityRecord): void { for (const listener of this.#listeners) { try { listener(record); } catch { /* projection failure never changes activity */ } } }
  #publishAll(): void { for (const record of this.#store.list({ limit: 200 })) this.#publish(record); }
}

export { sourceForTool, labelForTool };
