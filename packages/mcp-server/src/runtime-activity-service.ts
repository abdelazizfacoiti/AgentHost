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
  if (tool.startsWith("speech.")) return "checking_permissions";
  return "agenthost_working";
};

function isBlockedCode(code: string | undefined): boolean { return code !== undefined && /blocked|protected|grant_denied|unsupported|forbidden/i.test(code); }
function isApprovalCode(code: string | undefined): boolean { return code !== undefined && /confirmation|required|approval|dry_run_required/i.test(code); }

export class RuntimeActivityService {
  readonly #store: RuntimeActivityStore;
  readonly #listeners = new Set<Listener>();
  constructor(store: RuntimeActivityStore) { this.#store = store; }
  store(): RuntimeActivityStore { return this.#store; }
  subscribe(listener: Listener): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  begin(input: RuntimeActivityBeginInput): RuntimeActivityRecord { const record = this.#store.begin(input); this.#publish(record); return record; }
  update(id: string, patch: RuntimeActivityPatch): RuntimeActivityRecord { const record = this.#store.update(id, patch); this.#publish(record); return record; }
  finish(id: string, state: "completed" | "failed" | "blocked" | "cancelled", verification?: RuntimeActivityTerminalVerification): RuntimeActivityRecord { const record = this.#store.finish(id, state, verification); this.#publish(record); return record; }
  startDirectTool(tool: string, sessionId: string, operation?: string): RuntimeActivityDirectStart {
    const taskId = `task_${sessionId}_${tool}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 200);
    const record = this.begin({ taskId, source: sourceForTool(tool), labelKey: labelForTool(tool), actionKey: labelForTool(tool), state: "preparing", operation: operation ?? tool });
    return { activityId: record.activityId, taskId };
  }
  finishDirectTool(activityId: string, result: Pick<ToolResult, "ok" | "preview" | "error" | "riskLevel">): RuntimeActivityRecord {
    const code = result.error?.code;
    if (isApprovalCode(code)) return this.update(activityId, { state: "waiting_for_approval", labelKey: "waiting_for_approval", actionKey: "waiting_for_approval", ...(code === undefined ? {} : { warningCode: code }) });
    if (!result.ok && isBlockedCode(code)) return this.update(activityId, { state: "blocked", labelKey: "blocked_by_policy", actionKey: "blocked_by_policy", ...(code === undefined ? {} : { blockerCode: code }) });
    if (result.preview === true) return this.update(activityId, { state: "inspecting", actionKey: "checking_permissions" });
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
