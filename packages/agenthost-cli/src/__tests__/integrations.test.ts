import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { integrationAdd, integrationConfigPath, integrationRemove, integrationStatus, type IntegrationPaths } from "../integrations.js";

const roots: string[] = [];

async function makePaths(): Promise<IntegrationPaths> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-integrations-"));
  roots.push(root);
  return {
    home: root,
    project: path.join(root, "project"),
    xdgConfigHome: path.join(root, "xdg"),
    codexHome: path.join(root, "codex"),
    copilotHome: path.join(root, "copilot")
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("MCP integrations", () => {
  it("previews, applies, and removes a Copilot entry", async () => {
    const paths = await makePaths();
    const preview = await integrationAdd("copilot", paths, false);
    expect(preview.configLabel).toBe("[copilot-config]");
    expect(preview.applied).toBe(false);
    expect(preview.changed).toBe(true);
    expect(existsSync(preview.configPath)).toBe(false);

    const applied = await integrationAdd("copilot", paths, true);
    expect(applied.applied).toBe(true);
    expect(applied.backup).toBe(false);
    expect(JSON.parse(await readFile(applied.configPath, "utf8"))).toEqual({
      servers: { agenthost: { type: "stdio", command: "agenthost", args: ["start"] } }
    });

    const status = await integrationStatus("copilot", paths);
    expect(status.configured).toBe(true);
    expect(status.matches).toBe(true);

    const removed = await integrationRemove("copilot", paths, true);
    expect(removed.applied).toBe(true);
    expect(JSON.parse(await readFile(removed.configPath, "utf8"))).toEqual({ servers: {} });
  });

  it("creates a Copilot CLI user config", async () => {
    const paths = await makePaths();
    const report = await integrationAdd("copilot-cli", paths, true);
    expect(report.configPath).toBe(path.join(paths.copilotHome!, "mcp-config.json"));
    expect(JSON.parse(await readFile(report.configPath, "utf8"))).toEqual({
      mcpServers: { agenthost: { type: "local", command: "agenthost", args: ["start"], tools: ["*"] } }
    });
  });

  it("preserves existing VS Code servers", async () => {
    const paths = await makePaths();
    const file = integrationConfigPath("copilot", paths);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ servers: { other: { type: "stdio", command: "other" } } }), "utf8");

    const report = await integrationAdd("copilot", paths, true);
    expect(report.backup).toBe(true);
    const config = JSON.parse(await readFile(file, "utf8")) as { servers: Record<string, unknown> };
    expect(config.servers.other).toEqual({ type: "stdio", command: "other" });
    expect(config.servers.agenthost).toEqual({ type: "stdio", command: "agenthost", args: ["start"] });
  });

  it("merges Claude user config without touching other keys", async () => {
    const paths = await makePaths();
    const file = integrationConfigPath("claude", paths);
    await writeFile(file, JSON.stringify({ theme: "dark", mcpServers: { other: { command: "other" } } }), "utf8");

    await integrationAdd("claude", paths, true);
    const config = JSON.parse(await readFile(file, "utf8")) as { theme: string; mcpServers: Record<string, unknown> };
    expect(config.theme).toBe("dark");
    expect(config.mcpServers.other).toEqual({ command: "other" });
    expect(config.mcpServers.agenthost).toEqual({ command: "agenthost", args: ["start"] });
  });

  it("creates a Cursor project config", async () => {
    const paths = await makePaths();
    const report = await integrationAdd("cursor", paths, true);
    expect(report.configPath).toBe(path.join(paths.project, ".cursor", "mcp.json"));
    expect(JSON.parse(await readFile(report.configPath, "utf8"))).toEqual({
      mcpServers: { agenthost: { command: "agenthost", args: ["start"] } }
    });
  });

  it("preserves JSONC comments when the opencode entry already matches", async () => {
    const paths = await makePaths();
    const file = integrationConfigPath("opencode", paths);
    await mkdir(path.dirname(file), { recursive: true });
    const original = `{\n  // keep this comment\n  "$schema": "https://opencode.ai/config.json",\n  "mcp": {\n    "agenthost": { "type": "local", "command": ["/home/user/.local/bin/agenthost", "start"] }\n  }\n}\n`;
    await writeFile(file, original, "utf8");

    const status = await integrationStatus("opencode", paths);
    expect(status.configured).toBe(true);
    expect(status.matches).toBe(true);

    const report = await integrationAdd("opencode", paths, true);
    expect(report.changed).toBe(false);
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("re-enables a disabled opencode entry", async () => {
    const paths = await makePaths();
    const file = integrationConfigPath("opencode", paths);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ mcp: { agenthost: { type: "local", command: ["agenthost", "start"], enabled: false } } }), "utf8");

    const status = await integrationStatus("opencode", paths);
    expect(status.configured).toBe(true);
    expect(status.matches).toBe(false);
    await integrationAdd("opencode", paths, true);
    const config = JSON.parse(await readFile(file, "utf8")) as { mcp: { agenthost: { enabled?: boolean } } };
    expect(config.mcp.agenthost.enabled).not.toBe(false);
  });

  it("preserves other opencode mcp entries and unrelated settings", async () => {
    const paths = await makePaths();
    const file = integrationConfigPath("opencode", paths);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ theme: "dark", mcp: { other: { type: "local", command: ["other"] } } }), "utf8");

    await integrationAdd("opencode", paths, true);
    const config = JSON.parse(await readFile(file, "utf8")) as { theme: string; mcp: Record<string, unknown> };
    expect(config.theme).toBe("dark");
    expect(config.mcp.other).toEqual({ type: "local", command: ["other"] });
    expect(config.mcp.agenthost).toEqual({ type: "local", command: ["agenthost", "start"] });
  });

  it("rejects invalid JSON without overwriting", async () => {
    const paths = await makePaths();
    const file = integrationConfigPath("copilot", paths);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "{ not json", "utf8");

    const report = await integrationAdd("copilot", paths, true);
    expect(report.error).toBe("config_invalid_json");
    expect(report.applied).toBe(false);
    expect(await readFile(file, "utf8")).toBe("{ not json");
  });

  it("rejects an incompatible top-level section without overwriting", async () => {
    const paths = await makePaths();
    const file = integrationConfigPath("claude", paths);
    await mkdir(path.dirname(file), { recursive: true });
    const original = JSON.stringify({ theme: "dark", mcpServers: ["not-an-object"] });
    await writeFile(file, original, "utf8");

    const status = await integrationStatus("claude", paths);
    expect(status.error).toBe("config_unsupported");
    const report = await integrationAdd("claude", paths, true);
    expect(report.error).toBe("config_unsupported");
    expect(report.applied).toBe(false);
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("does not mistake a commented Codex header for the real entry", async () => {
    const paths = await makePaths();
    const file = integrationConfigPath("codex", paths);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "# [mcp_servers.agenthost]\nmodel = \"gpt-5\"\n", "utf8");

    const status = await integrationStatus("codex", paths);
    expect(status.configured).toBe(false);
    const added = await integrationAdd("codex", paths, true);
    expect(added.applied).toBe(true);
    const text = await readFile(file, "utf8");
    expect(text).toContain("# [mcp_servers.agenthost]");
    expect(text).toMatch(/^\[mcp_servers\.agenthost\]$/m);
    expect(text).toContain('model = "gpt-5"');
  });

  it("creates, updates, and removes the Codex TOML entry", async () => {
    const paths = await makePaths();
    const created = await integrationAdd("codex", paths, true);
    expect(created.applied).toBe(true);
    const text = await readFile(created.configPath, "utf8");
    expect(text).toContain("[mcp_servers.agenthost]");
    expect(text).toContain('command = "agenthost"');
    expect(text).toContain('args = ["start"]');

    const second = await integrationAdd("codex", paths, true);
    expect(second.changed).toBe(false);

    const status = await integrationStatus("codex", paths);
    expect(status.configured).toBe(true);
    expect(status.matches).toBe(true);

    const removed = await integrationRemove("codex", paths, true);
    expect(removed.applied).toBe(true);
    expect(await readFile(removed.configPath, "utf8")).not.toContain("[mcp_servers.agenthost]");
  });
});
