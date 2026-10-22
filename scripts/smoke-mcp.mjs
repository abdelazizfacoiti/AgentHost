#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentHostMcpServer } from "../packages/mcp-server/dist/server.js";
import { runTool } from "../packages/mcp-server/dist/tool-runner.js";
import { listResourceEntries, readResource } from "../packages/mcp-server/dist/resources.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(rootDir, "packages", "mcp-server", "dist", "index.js");
const smokeDir = path.join(rootDir, ".agenthost", "smoke");

if (!existsSync(serverPath)) {
  console.error("Built MCP server not found. Run `npm run build` first.");
  process.exit(1);
}

process.env.AGENTHOST_HOME = smokeDir;
process.env.AGENTHOST_PROFILE = "dev";

const { context, closeResources } = await createAgentHostMcpServer();

try {
  const toolNames = [...(context.tools?.keys() ?? [])].sort();
  for (const expected of ["system.get_info", "system.list_capabilities", "desktop.screenshot", "vision.analyze_image", "desktop.click"]) {
    if (!toolNames.includes(expected)) {
      throw new Error(`Missing registered tool: ${expected}`);
    }
  }

  const info = context.tools?.get("system.get_info");
  if (info === undefined) throw new Error("Missing system.get_info definition.");
  const result = await runTool(info, {}, context);
  if (!result.ok) throw new Error("system.get_info did not return an ok ToolResult.");
  if (result.serverVersion === undefined || result.serverPath === undefined) throw new Error("system.get_info is missing runtime provenance.");

  const resources = listResourceEntries().map((entry) => entry.uri);
  if (resources.join(",") !== "agenthost://capabilities,agenthost://capabilities.md,agenthost://status") {
    throw new Error(`Unexpected MCP resources: ${resources.join(", ")}`);
  }
  const status = await readResource(context, "agenthost://status");
  const statusJson = JSON.parse(status.text);
  if (typeof statusJson.runState?.stop?.requested !== "boolean") throw new Error("agenthost://status is missing run state.");

  console.log("AgentHost smoke test passed.");
  console.log(JSON.stringify({ toolCount: toolNames.length, resources, capabilityTools: toolNames }, null, 2));
} finally {
  await closeResources();
}
