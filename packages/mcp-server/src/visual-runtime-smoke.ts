import type { OverlayManager } from "@agenthost/app-overlay";
import type { RuntimeActivityRecord } from "@agenthost/core";
import type { RuntimeActivityService } from "./runtime-activity-service.js";

export interface VisualRuntimeSmokeOptions {
  requireVisible: boolean;
  timeoutMs?: number;
}

export interface VisualRuntimeSmokeResult {
  activityId: string;
  taskId: string;
  status: RuntimeActivityRecord["state"];
  rendererStatus: "available" | "degraded" | "headless" | "unavailable";
  visible: boolean;
  rendererEpoch: number;
  verified: boolean;
  actionsExecuted: false;
  confirmationTokensCreated: false;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  code: string
): Promise<void> {
  const deadline = Date.now() + Math.max(100, Math.min(10_000, timeoutMs));
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(code);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * Real visual smoke driven only by authoritative runtime activity.
 * It never creates an assistance fixture or invokes a target-application tool.
 */
export async function runVisualRuntimeSmoke(
  activity: RuntimeActivityService,
  overlay: OverlayManager,
  options: VisualRuntimeSmokeOptions
): Promise<VisualRuntimeSmokeResult> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const taskId = `visual_runtime_smoke_${Date.now()}`;
  const started = activity.begin({
    taskId,
    source: "strategy",
    labelKey: "checking_available_methods",
    actionKey: "checking_available_methods",
    state: "preparing",
    operation: "visual_runtime_smoke",
    progress: { kind: "exact", completed: 0, total: 2, percent: 0 }
  });

  try {
    const initialDiagnostics = await overlay.diagnostics();
    if (options.requireVisible) {
      if (initialDiagnostics.rendererStatus !== "available") {
        throw new Error("visual_renderer_unavailable");
      }
      await waitFor(() => {
        const record = activity.store().get(started.activityId);
        return record?.rendererBinding?.acknowledged === true
          && record.rendererBinding.visible
          && overlay.isOverlayLive(record.rendererBinding.overlayId);
      }, timeoutMs, "visual_runtime_smoke_not_visible");
    }

    activity.update(started.activityId, {
      state: "inspecting",
      labelKey: "verifying_result",
      actionKey: "verifying_result",
      progress: { kind: "exact", completed: 1, total: 2, percent: 50 }
    });

    if (options.requireVisible) {
      await waitFor(() => {
        const record = activity.store().get(started.activityId);
        return record?.rendererBinding?.acknowledged === true
          && record.rendererBinding.visible
          && overlay.isOverlayLive(record.rendererBinding.overlayId);
      }, timeoutMs, "visual_runtime_smoke_update_not_visible");
    }

    const completed = activity.finish(started.activityId, "completed", {
      verified: true,
      source: "manual",
      verifiedAt: new Date().toISOString(),
      summary: "Runtime activity reached its verified terminal state."
    });
    const diagnostics = await overlay.diagnostics();
    const binding = completed.rendererBinding;
    const visible = binding !== undefined
      && binding.acknowledged
      && binding.visible
      && overlay.isOverlayLive(binding.overlayId)
      && diagnostics.capabilities.visible === true;
    if (options.requireVisible && !visible) {
      await waitFor(() => {
        const record = activity.store().get(started.activityId);
        return record?.rendererBinding?.acknowledged === true
          && record.rendererBinding.visible
          && overlay.isOverlayLive(record.rendererBinding.overlayId);
      }, timeoutMs, "visual_runtime_smoke_completion_not_visible");
    }
    const final = activity.store().get(started.activityId) ?? completed;
    const finalBinding = final.rendererBinding;
    return {
      activityId: final.activityId,
      taskId: final.taskId,
      status: final.state,
      rendererStatus: diagnostics.rendererStatus,
      visible: finalBinding !== undefined
        && finalBinding.acknowledged
        && finalBinding.visible
        && overlay.isOverlayLive(finalBinding.overlayId)
        && diagnostics.capabilities.visible === true,
      rendererEpoch: finalBinding?.rendererEpoch ?? diagnostics.rendererEpoch ?? 0,
      verified: final.terminalVerification?.verified === true,
      actionsExecuted: false,
      confirmationTokensCreated: false
    };
  } catch (error) {
    const current = activity.store().get(started.activityId);
    if (current !== undefined && !["completed", "failed", "cancelled"].includes(current.state)) {
      activity.finish(started.activityId, "failed", {
        verified: false,
        source: "manual",
        verifiedAt: new Date().toISOString()
      });
    }
    throw error;
  }
}
