import { ATTENTION_REASONS, ATTENTION_SOURCES, clearAttention, readAttention, writeAttention, type AttentionReason, type AttentionSource } from "@agenthost/core";
import { findHostWindow, focusLinuxWindow, getLinuxActiveWindow, raiseLinuxWindow } from "@agenthost/os-linux";

/*
 * `agenthost attention` is invoked by agent-client hooks (Claude Code
 * Notification/PermissionRequest, Codex notify, ...). It must stay fast and
 * never block the client: every desktop step is best effort and the command
 * reports what it managed to do instead of failing the hook.
 */

export interface AttentionCommandResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export async function attentionRequest(agentHome: string, source: string | undefined, reason: string | undefined, startPid = process.pid): Promise<AttentionCommandResult> {
  const safeSource = (ATTENTION_SOURCES as readonly string[]).includes(source ?? "") ? source as AttentionSource : "other";
  const safeReason = (ATTENTION_REASONS as readonly string[]).includes(reason ?? "") ? reason as AttentionReason : "permission";
  const [host, active, previous] = await Promise.all([
    findHostWindow(startPid).catch(() => undefined),
    getLinuxActiveWindow().catch(() => undefined),
    readAttention(agentHome)
  ]);
  const activeId = active?.activeWindow?.windowId;
  // Keep the original return target across repeated prompts so focus goes back
  // to the app the agent was working in, not to the terminal raised last time.
  const returnWindowId = previous?.returnWindowId ?? (activeId !== undefined && activeId !== host?.windowId ? activeId : undefined);
  await writeAttention(agentHome, {
    schemaVersion: 1,
    source: safeSource,
    reason: safeReason,
    requestedAt: new Date().toISOString(),
    ...(host === undefined ? {} : { hostWindowId: host.windowId }),
    ...(returnWindowId === undefined ? {} : { returnWindowId })
  });
  // "done"/"idle" only mark the state; raising on every finished turn would steal focus constantly.
  const raise = host !== undefined && (safeReason === "permission" || safeReason === "confirmation")
    ? await raiseLinuxWindow(host.windowId).catch(() => undefined)
    : undefined;
  return {
    ok: true,
    data: {
      source: safeSource,
      reason: safeReason,
      hostWindowFound: host !== undefined,
      raised: raise?.raised ?? false,
      method: raise?.method ?? "none",
      returnWindowRecorded: returnWindowId !== undefined
    }
  };
}

export async function attentionClear(agentHome: string, restore: boolean): Promise<AttentionCommandResult> {
  const record = await readAttention(agentHome);
  await clearAttention(agentHome);
  if (record === undefined) return { ok: true, data: { cleared: false, restored: false } };
  let restored = false;
  if (restore && record.returnWindowId !== undefined) {
    // Only take focus back while the user is still looking at the raised
    // terminal; if they already moved elsewhere, respect that choice.
    const active = await getLinuxActiveWindow().catch(() => undefined);
    const activeId = active?.activeWindow?.windowId;
    if (activeId === undefined || activeId === record.hostWindowId) {
      const focused = await focusLinuxWindow({ windowId: record.returnWindowId }).catch(() => undefined);
      restored = focused?.focused === true;
    }
  }
  return { ok: true, data: { cleared: true, restored, source: record.source } };
}

export async function attentionStatus(agentHome: string): Promise<AttentionCommandResult> {
  const record = await readAttention(agentHome);
  return { ok: true, data: record === undefined ? { pending: false } : { pending: true, source: record.source, reason: record.reason, requestedAt: record.requestedAt } };
}
