import type { OverlayCapabilityReport, OverlayRendererMode, OverlayStateSnapshot, OverlayWidgetEvent } from "@agenthost/core";

export interface OverlayRenderRecord { overlayId: string; type: string; payload: unknown; }
export interface OverlayOperationResult { ok: boolean; reason: string; }
export type OverlayRendererChildState = "stopped" | "starting" | "running" | "failed" | "closed";
export type OverlayRendererHandshakeState = "not_attempted" | "pending" | "passed" | "failed";
export interface OverlayRendererDiagnostics { requestedMode: OverlayRendererMode; effectiveBackend: string; rendererStatus: OverlayCapabilityReport["rendererStatus"]; sessionType: OverlayCapabilityReport["sessionType"]; displayPresent: boolean; waylandDisplayPresent: boolean; pythonExecutable: string; gtk3Available?: boolean; rendererScriptPresent: boolean; childState: OverlayRendererChildState; handshake: OverlayRendererHandshakeState; capabilities: OverlayCapabilityReport; activeOverlayCount: number; restartCount: number; restartAllowed: boolean; fallbackReason?: string; lastFailure?: string; recommendedAction: string; }
export interface OverlayRendererRestartResult { ok: boolean; reason: string; diagnostics?: OverlayRendererDiagnostics; }

export interface OverlayRenderer {
  capabilities(): Promise<OverlayCapabilityReport> | OverlayCapabilityReport;
  show(record: OverlayRenderRecord): Promise<OverlayOperationResult> | OverlayOperationResult;
  update(record: OverlayRenderRecord): Promise<OverlayOperationResult> | OverlayOperationResult;
  dismiss(overlayId: string): Promise<OverlayOperationResult> | OverlayOperationResult;
  clear(): Promise<OverlayOperationResult> | OverlayOperationResult;
  emergencyHide(): Promise<OverlayOperationResult> | OverlayOperationResult;
  state(): Promise<OverlayStateSnapshot> | OverlayStateSnapshot;
  events(): Promise<OverlayWidgetEvent[]> | OverlayWidgetEvent[];
  diagnostics?(): Promise<OverlayRendererDiagnostics> | OverlayRendererDiagnostics;
  restart?(): Promise<OverlayRendererRestartResult> | OverlayRendererRestartResult;
  close?(): Promise<void> | void;
}
