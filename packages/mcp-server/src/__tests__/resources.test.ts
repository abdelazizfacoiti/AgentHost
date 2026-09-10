import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAdapterRegistry, createBaseCapabilityRegistry, getPolicyProfile, type AgentHostConfig } from "@agenthost/core";
import { describe, expect, it } from "vitest";
import { listResourceEntries, readResource } from "../resources.js";

async function deps() {
  const agentHostDir = await mkdtemp(path.join(os.tmpdir(), "agenthost-resources-"));
  const policy = getPolicyProfile("dev");
  const config: AgentHostConfig = { agentHostDir, configPath: `${agentHostDir}/config.json`, logFile: `${agentHostDir}/log`, profile: "dev", policy };
  return { registry: createBaseCapabilityRegistry(), adapters: createAdapterRegistry(), policy, config };
}

describe("MCP resources for fast discovery", () => {
  it("lists capabilities, brief, skills, and status resources", () => {
    const uris = listResourceEntries().map((entry) => entry.uri);
    expect(uris).toEqual(["agenthost://capabilities", "agenthost://capabilities.md", "agenthost://skills", "agenthost://status"]);
  });

  it("serves live capabilities and markdown brief", async () => {
    const context = await deps();
    const json = JSON.parse((await readResource(context, "agenthost://capabilities")).text) as { toolCount: number; families: Record<string, unknown> };
    expect(json.toolCount).toBeGreaterThan(200);
    expect(Object.keys(json.families)).toContain("browser");
    const markdown = (await readResource(context, "agenthost://capabilities.md")).text;
    expect(markdown).toContain("computer-use");
    expect(markdown).toContain("skills.list");
  });

  it("serves skills and live status, and rejects unknown resources", async () => {
    const context = await deps();
    const skills = JSON.parse((await readResource(context, "agenthost://skills")).text) as { skills: Array<{ name: string }> };
    expect(skills.skills.map((skill) => skill.name)).toContain("file-management");
    const status = JSON.parse((await readResource(context, "agenthost://status")).text) as { stopped: boolean; toolCount: number };
    expect(status.stopped).toBe(false);
    expect(status.toolCount).toBeGreaterThan(200);
    await expect(readResource(context, "agenthost://nope")).rejects.toThrow("unknown_resource");
  });
});
