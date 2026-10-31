import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { getDefaultPolicy } from "@agenthost/core";
import { openLinuxUrl } from "@agenthost/os-linux";
import type { AgentHostMcpContext } from "../context.js";
import { createAppTools } from "../tools/app.js";

function makeContext(linux: Record<string, unknown>): AgentHostMcpContext {
  const home = "/tmp/agenthost-app-tools";
  return {
    sessionId: "app-tools",
    config: { agentHostDir: home, configPath: path.join(home, "config.json"), logFile: path.join(home, "logs", "audit.jsonl") },
    policy: getDefaultPolicy(),
    grants: { listActiveGrants: () => [] },
    linux
  } as unknown as AgentHostMcpContext;
}

describe("app tools", () => {
  it("opens URLs in a named browser and keeps query strings out of the result", async () => {
    const openUrl = vi.fn(async (input: { url: string; browser?: string }) => ({ opened: true, url: input.url, launcher: input.browser ?? "xdg-open", reason: "ok" }));
    const tool = createAppTools().find((entry) => entry.name === "app.open_url")!;
    const result = await tool.handler({ url: "https://www.avito.ma/fr/maroc/voitures?token=secret123", browser: "firefox" }, makeContext({ openUrl }));
    expect(result.ok).toBe(true);
    expect(openUrl).toHaveBeenCalledWith({ url: "https://www.avito.ma/fr/maroc/voitures?token=secret123", browser: "firefox" });
    expect(JSON.stringify(result.data)).not.toContain("secret123");
    expect(tool.auditInputSummary?.({ url: "https://example.com/a?token=secret123" })).not.toContain("secret123");
  });

  it("reports launcher failures as tool failures", async () => {
    const openUrl = vi.fn(async () => ({ opened: false, url: "https://example.com/", launcher: "firefox", reason: "firefox is not installed or not on PATH." }));
    const tool = createAppTools().find((entry) => entry.name === "app.open_url")!;
    const result = await tool.handler({ url: "https://example.com/", browser: "firefox" }, makeContext({ openUrl }));
    expect(result).toMatchObject({ ok: false, error: { code: "open_failed" } });
  });

  it("refuses non-web schemes before spawning anything", async () => {
    await expect(openLinuxUrl({ url: "javascript:alert(1)" })).resolves.toMatchObject({ opened: false, launcher: "none" });
    await expect(openLinuxUrl({ url: "not a url" })).resolves.toMatchObject({ opened: false, launcher: "none" });
  });
});
