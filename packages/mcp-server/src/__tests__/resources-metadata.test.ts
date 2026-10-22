import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { activeTaskApprovalPath, readActiveTaskApproval, requestStop, type CapabilityRegistrySnapshot, type PolicyProfile, type ToolCapability } from "@agenthost/core";
import { listResourceEntries, readResource } from "../resources.js";
import { applyProductionExecutionMetadata, materializeToolDefinitions } from "../tool-metadata.js";
import { createFileTools } from "../tools/file.js";
import { createShellTools } from "../tools/shell.js";
import { createAgentTools } from "../tools/agent.js";
import { createDesktopTools } from "../tools/desktop.js";
import { createTaskTools } from "../tools/tasks.js";

const roots: string[] = [];
async function tempHome(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-resources-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function tool(name: string, executionClass: "state_changing" | "read_only"): ToolCapability {
  return {
    name,
    riskLevel: "medium",
    description: name,
    inputSchema: {},
    execution: {
      executionClass,
      externalEffect: false,
      requiresDryRun: executionClass === "state_changing",
      requiresConfirmationToken: executionClass === "state_changing",
      requiresExactTarget: false,
      source: "base",
      availability: "available"
    }
  };
}

function context(home: string) {
  const registry = {
    listTools: () => [tool("file.write", "state_changing"), tool("file.read", "read_only")],
    listStrategies: () => [],
    listAppCapabilities: () => []
  } as unknown as CapabilityRegistrySnapshot;
  return {
    registry,
    adapters: {} as never,
    policy: { name: "general" } as PolicyProfile,
    config: { agentHostDir: home } as never
  };
}

describe("MCP resources", () => {
  it("lists only implemented resources and reports the live inventory", async () => {
    const home = await tempHome();
    const entries = listResourceEntries();
    expect(entries.map((entry) => entry.uri)).toEqual([
      "agenthost://capabilities",
      "agenthost://capabilities.md",
      "agenthost://status"
    ]);
    expect(entries.some((entry) => entry.uri.includes("skills"))).toBe(false);

    const json = JSON.parse((await readResource(context(home), "agenthost://capabilities")).text);
    expect(json.toolCount).toBe(2);
    expect(json.byExecutionClass).toEqual({ state_changing: 1, read_only: 1 });
    expect(json.resources).not.toContain("agenthost://skills");

    const markdown = (await readResource(context(home), "agenthost://capabilities.md")).text;
    expect(markdown).not.toContain("agenthost://skills");
    expect(markdown).toContain("exact dry-run preview plus a single-use");
    await expect(readResource(context(home), "agenthost://unknown")).rejects.toThrow(/Unknown resource/);
  });

  it("clears active approval when an agent requests an emergency stop", async () => {
    const home = await tempHome();
    await mkdir(path.dirname(activeTaskApprovalPath(home)), { recursive: true });
    await writeFile(activeTaskApprovalPath(home), JSON.stringify({
      approvalId: "approval_test",
      taskId: "task_test",
      maxRisk: "medium",
      origin: "cli",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    }));
    const stop = createAgentTools().find((entry) => entry.name === "agent.stop");
    if (stop?.handler === undefined) throw new Error("agent.stop handler missing");
    const result = await stop.handler({ reason: "test stop" }, context(home) as never);
    expect(result.ok).toBe(true);
    expect(await readActiveTaskApproval(home)).toBeUndefined();
    expect(JSON.parse(await readFile(path.join(home, "run", "stop.requested"), "utf8")).reason).toBe("test stop");
  });

  it("reports live stop state instead of a static claim", async () => {
    const home = await tempHome();
    await requestStop(home, "test stop");
    const status = JSON.parse((await readResource(context(home), "agenthost://status")).text);
    expect(status.runState.stop).toMatchObject({ requested: true, reason: "test stop" });
    expect(status.activeTaskApproval).toBeNull();
  });
});

describe("tool metadata coverage", () => {
  it("declares every base tool and keeps task/agent control metadata non-tokenized", () => {
    const tools = materializeToolDefinitions(applyProductionExecutionMetadata([
      ...createFileTools(),
      ...createShellTools(),
      ...createDesktopTools(),
      ...createAgentTools(),
      ...createTaskTools()
    ]));
    const byName = new Map(tools.map((entry) => [entry.name, entry]));
    expect(byName.get("file.write")?.execution?.executionClass).toBe("state_changing");
    expect(byName.get("desktop.screenshot")?.execution?.executionClass).toBe("state_changing");
    expect(byName.get("agent.stop")?.execution?.executionClass).toBe("metadata_only");
    expect(byName.get("agent.takeover_begin")?.execution?.executionClass).toBe("metadata_only");
    expect(byName.get("task.update_status")?.execution?.executionClass).toBe("metadata_only");
  });
});
