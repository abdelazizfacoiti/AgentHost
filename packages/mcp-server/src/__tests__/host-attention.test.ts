import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readAttention } from "@agenthost/core";
import { selectHostWindow } from "@agenthost/os-linux";
import { HostAttention, type HostAttentionDeps } from "../host-attention.js";

const roots: string[] = [];
async function tempHome(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-attention-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function fakeDesktop(initialActive: string) {
  let active = initialActive;
  const deps: HostAttentionDeps = {
    findHost: vi.fn(async () => ({ windowId: "100", appName: "gnome-terminal-", pid: 42 })),
    activeWindowId: vi.fn(async () => active),
    raise: vi.fn(async (windowId: string) => { active = windowId; return true; }),
    focus: vi.fn(async (windowId: string) => { active = windowId; return true; })
  };
  return { deps, active: () => active, setActive: (id: string) => { active = id; } };
}

describe("host attention", () => {
  it("raises the agent terminal on confirmation and returns focus once the token arrives", async () => {
    const home = await tempHome();
    const desktop = fakeDesktop("200");
    const attention = new HostAttention(home, desktop.deps);
    expect(await attention.requestConfirmation()).toEqual({ raised: true });
    expect(desktop.active()).toBe("100");
    expect(await readAttention(home)).toMatchObject({ source: "agenthost", hostWindowId: "100", returnWindowId: "200" });

    expect(await attention.resolveConfirmation()).toEqual({ restored: true });
    expect(desktop.active()).toBe("200");
    expect(await readAttention(home)).toBeUndefined();
  });

  it("keeps the first return window across repeated prompts and respects a user who moved on", async () => {
    const home = await tempHome();
    const desktop = fakeDesktop("200");
    const attention = new HostAttention(home, desktop.deps);
    await attention.requestConfirmation();
    await attention.requestConfirmation();
    expect((await readAttention(home))?.returnWindowId).toBe("200");
    desktop.setActive("300");
    expect(await attention.resolveConfirmation()).toEqual({ restored: false });
    expect(desktop.active()).toBe("300");
  });

  it("picks the window of the nearest ancestor, preferring the active one", () => {
    const windows = [
      { windowId: "1", pid: 10 },
      { windowId: "2", pid: 20 },
      { windowId: "3", pid: 20 }
    ];
    expect(selectHostWindow([99, 20, 10], windows)?.windowId).toBe("2");
    expect(selectHostWindow([99, 20, 10], windows, "3")?.windowId).toBe("3");
    expect(selectHostWindow([99], windows)).toBeUndefined();
  });
});
