import { clearAttention, readAttention, writeAttention, type DesktopWindowSummary } from "@agenthost/core";
import { findHostWindow, focusLinuxWindow, getLinuxActiveWindow, raiseLinuxWindow } from "@agenthost/os-linux";

export interface HostAttentionDeps {
  findHost(): Promise<DesktopWindowSummary | undefined>;
  activeWindowId(): Promise<string | undefined>;
  raise(windowId: string): Promise<boolean>;
  focus(windowId: string): Promise<boolean>;
}

const linuxDeps: HostAttentionDeps = {
  findHost: async () => await findHostWindow(process.pid),
  activeWindowId: async () => (await getLinuxActiveWindow()).activeWindow?.windowId,
  raise: async (windowId) => (await raiseLinuxWindow(windowId)).raised,
  focus: async (windowId) => (await focusLinuxWindow({ windowId })).focused === true
};

/**
 * Pulls the user to the agent's terminal when AgentHost needs a confirmation,
 * and hands focus back to the work window once the agent continues with the
 * approved token. Everything here is best effort: it must never fail a call.
 */
export class HostAttention {
  #host: DesktopWindowSummary | undefined;
  #hostResolved = false;

  constructor(private readonly agentHostDir: string, private readonly deps: HostAttentionDeps = linuxDeps) {}

  async #hostWindow(): Promise<DesktopWindowSummary | undefined> {
    if (!this.#hostResolved) {
      this.#hostResolved = true;
      this.#host = await this.deps.findHost().catch(() => undefined);
    }
    return this.#host;
  }

  async requestConfirmation(): Promise<{ raised: boolean }> {
    try {
      const [host, activeId, previous] = await Promise.all([this.#hostWindow(), this.deps.activeWindowId().catch(() => undefined), readAttention(this.agentHostDir)]);
      const returnWindowId = previous?.returnWindowId ?? (activeId !== undefined && activeId !== host?.windowId ? activeId : undefined);
      await writeAttention(this.agentHostDir, {
        schemaVersion: 1,
        source: "agenthost",
        reason: "confirmation",
        requestedAt: new Date().toISOString(),
        ...(host === undefined ? {} : { hostWindowId: host.windowId }),
        ...(returnWindowId === undefined ? {} : { returnWindowId })
      });
      return { raised: host === undefined ? false : await this.deps.raise(host.windowId).catch(() => false) };
    } catch {
      return { raised: false };
    }
  }

  /** Called when a call arrives carrying a confirmation token: the user has answered. */
  async resolveConfirmation(): Promise<{ restored: boolean }> {
    try {
      const record = await readAttention(this.agentHostDir);
      if (record === undefined || record.source !== "agenthost") return { restored: false };
      await clearAttention(this.agentHostDir);
      if (record.returnWindowId === undefined) return { restored: false };
      const activeId = await this.deps.activeWindowId().catch(() => undefined);
      // Respect a user who already switched elsewhere; only undo our own raise.
      if (activeId !== undefined && activeId !== record.hostWindowId) return { restored: false };
      return { restored: await this.deps.focus(record.returnWindowId).catch(() => false) };
    } catch {
      return { restored: false };
    }
  }
}
