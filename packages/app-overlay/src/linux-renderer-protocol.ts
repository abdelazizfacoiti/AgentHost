import type { OverlayCapabilityReport } from "@agenthost/core";

export const OVERLAY_IPC_VERSION = 1 as const;
export const OVERLAY_IPC_MAX_BYTES = 256 * 1024;
export const OVERLAY_IPC_MAX_IN_FLIGHT = 32;

export type OverlayRendererCommand = "hello" | "capabilities" | "show" | "update" | "dismiss" | "clear" | "emergency_hide" | "state" | "close";

export interface OverlayRendererRequest {
  version: typeof OVERLAY_IPC_VERSION;
  id: string;
  token: string;
  command: OverlayRendererCommand;
  payload?: unknown;
}

export interface OverlayRendererReply {
  version: typeof OVERLAY_IPC_VERSION;
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface OverlayRendererHandshakeData {
  protocolVersion: typeof OVERLAY_IPC_VERSION;
  capabilities: OverlayCapabilityReport;
  rendererEpoch: number;
}

export type OverlayRendererAcknowledgement = "visible" | "updated" | "dismissed" | "cleared" | "emergency_hidden";
export interface OverlayRendererOperationData {
  command: Exclude<OverlayRendererCommand, "hello" | "capabilities" | "state" | "close">;
  acknowledgement: OverlayRendererAcknowledgement;
  rendererEpoch: number;
  requestId?: string;
  overlayId?: string;
  visibleWindowCount: number;
  interactiveWindowCount: number;
  transparentWindowCount?: number;
  drawReadyCount?: number;
  liveSurfaceRegistered?: boolean;
  visible?: boolean;
  reason?: string;
}

const commands = new Set<OverlayRendererCommand>(["hello", "capabilities", "show", "update", "dismiss", "clear", "emergency_hide", "state", "close"]);

export function serializeRendererMessage(value: unknown): string | undefined {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined || Buffer.byteLength(encoded, "utf8") > OVERLAY_IPC_MAX_BYTES) return undefined;
    return encoded;
  } catch {
    return undefined;
  }
}

export function validateRendererRequest(value: unknown): value is OverlayRendererRequest {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  let size = 0;
  try { size = Buffer.byteLength(JSON.stringify(value), "utf8"); } catch { return false; }
  if (size > OVERLAY_IPC_MAX_BYTES) return false;
  const keys = Object.keys(record);
  if (keys.some((key) => !["version", "id", "token", "command", "payload"].includes(key))) return false;
  return record.version === OVERLAY_IPC_VERSION && typeof record.id === "string" && record.id.length > 0 && record.id.length <= 100 && typeof record.token === "string" && record.token.length >= 32 && record.token.length <= 200 && typeof record.command === "string" && commands.has(record.command as OverlayRendererCommand);
}

export function validateRendererReply(value: unknown): value is OverlayRendererReply {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => !["version", "id", "ok", "data", "error"].includes(key))) return false;
  return record.version === OVERLAY_IPC_VERSION && typeof record.id === "string" && record.id.length > 0 && record.id.length <= 100 && typeof record.ok === "boolean" && (record.error === undefined || (typeof record.error === "string" && record.error.length <= 500));
}

export function validateRendererCommand(command: string): command is OverlayRendererCommand {
  return commands.has(command as OverlayRendererCommand);
}

export function validateRendererHandshake(value: unknown): value is OverlayRendererHandshakeData {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.protocolVersion === OVERLAY_IPC_VERSION && Number.isInteger(record.rendererEpoch) && Number(record.rendererEpoch) >= 1 && record.capabilities !== null && typeof record.capabilities === "object";
}

export function validateRendererOperationData(value: unknown, expectedCommand?: OverlayRendererOperationData["command"]): value is OverlayRendererOperationData {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (expectedCommand !== undefined && record.command !== expectedCommand) return false;
  if (typeof record.command !== "string" || !["show", "update", "dismiss", "clear", "emergency_hide"].includes(record.command)) return false;
  if (!["visible", "updated", "dismissed", "cleared", "emergency_hidden"].includes(String(record.acknowledgement))) return false;
  if (!Number.isInteger(record.rendererEpoch) || Number(record.rendererEpoch) < 1) return false;
  if (!Number.isInteger(record.visibleWindowCount) || Number(record.visibleWindowCount) < 0 || Number(record.visibleWindowCount) > 100) return false;
  if (!Number.isInteger(record.interactiveWindowCount) || Number(record.interactiveWindowCount) < 0 || Number(record.interactiveWindowCount) > 100) return false;
  if (record.transparentWindowCount !== undefined && (!Number.isInteger(record.transparentWindowCount) || Number(record.transparentWindowCount) < 0 || Number(record.transparentWindowCount) > 100)) return false;
  if (record.drawReadyCount !== undefined && (!Number.isInteger(record.drawReadyCount) || Number(record.drawReadyCount) < 0 || Number(record.drawReadyCount) > 100)) return false;
  if (record.liveSurfaceRegistered !== undefined && typeof record.liveSurfaceRegistered !== "boolean") return false;
  if (record.visible !== undefined && typeof record.visible !== "boolean") return false;
  if (record.overlayId !== undefined && (typeof record.overlayId !== "string" || record.overlayId.length < 1 || record.overlayId.length > 200)) return false;
  if (record.requestId !== undefined && (typeof record.requestId !== "string" || record.requestId.length < 1 || record.requestId.length > 100)) return false;
  if (record.reason !== undefined && (typeof record.reason !== "string" || record.reason.length > 200)) return false;
  const expectedAcknowledgement: Record<string, OverlayRendererAcknowledgement> = { show: "visible", update: "updated", dismiss: "dismissed", clear: "cleared", emergency_hide: "emergency_hidden" };
  if (expectedCommand !== undefined && record.acknowledgement !== expectedAcknowledgement[expectedCommand]) return false;
  if (record.command === "show" || record.command === "update") {
    if (record.acknowledgement === "visible" || record.acknowledgement === "updated") return Number(record.visibleWindowCount) > 0;
  }
  return true;
}
