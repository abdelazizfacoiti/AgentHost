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
  return record.protocolVersion === OVERLAY_IPC_VERSION && record.capabilities !== null && typeof record.capabilities === "object";
}
