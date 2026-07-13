import type { OverlayCapabilityReport, OverlayStateSnapshot, OverlayWidgetEvent } from "@agenthost/core";

export interface OverlayRenderRecord { overlayId: string; type: string; payload: unknown; }
export interface OverlayOperationResult { ok: boolean; reason: string; }

export interface OverlayRenderer {
  capabilities(): Promise<OverlayCapabilityReport> | OverlayCapabilityReport;
  show(record: OverlayRenderRecord): Promise<OverlayOperationResult> | OverlayOperationResult;
  update(record: OverlayRenderRecord): Promise<OverlayOperationResult> | OverlayOperationResult;
  dismiss(overlayId: string): Promise<OverlayOperationResult> | OverlayOperationResult;
  clear(): Promise<OverlayOperationResult> | OverlayOperationResult;
  emergencyHide(): Promise<OverlayOperationResult> | OverlayOperationResult;
  state(): Promise<OverlayStateSnapshot> | OverlayStateSnapshot;
  events(): Promise<OverlayWidgetEvent[]> | OverlayWidgetEvent[];
  close?(): Promise<void> | void;
}
