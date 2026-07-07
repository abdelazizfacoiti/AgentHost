#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createBaseCapabilityRegistry,
  createSessionId,
  JsonlAuditLogger,
  loadAgentHostConfig
} from "../packages/core/dist/index.js";
import { getLinuxSystemInfo } from "../packages/os-linux/dist/index.js";
import { runTool } from "../packages/mcp-server/dist/tool-runner.js";
import { createSystemTools } from "../packages/mcp-server/dist/tools/system.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(rootDir, "packages", "mcp-server", "dist", "index.js");
const smokeDir = path.join(rootDir, ".agenthost", "smoke");

if (!existsSync(serverPath)) {
  console.error("Built MCP server not found. Run `npm run build` first.");
  process.exit(1);
}

const config = await loadAgentHostConfig({
  env: {
    ...process.env,
    AGENTHOST_HOME: smokeDir,
    AGENTHOST_PROFILE: "dev"
  }
});
const registry = createBaseCapabilityRegistry();
const logger = new JsonlAuditLogger(config.logFile);
const context = {
  sessionId: createSessionId(),
  config,
  policy: config.policy,
  registry,
  logger,
  getSystemInfo: () => getLinuxSystemInfo(config, registry)
};
const tools = createSystemTools();

async function callTool(name) {
  const tool = tools.find((candidate) => candidate.name === name);

  if (tool === undefined) {
    throw new Error(`Missing tool definition: ${name}`);
  }

  const result = await runTool(tool, {}, context);

  if (!result.ok || result.tool !== name) {
    throw new Error(`${name} did not return an ok ToolResult.`);
  }

  return result;
}

const info = await callTool("system.get_info");
const capabilities = await callTool("system.list_capabilities");

const toolNames = capabilities.data.tools.map((tool) => tool.name).sort();

for (const expected of ["system.get_info", "system.list_capabilities"]) {
  if (!toolNames.includes(expected)) {
    throw new Error(`Missing capability: ${expected}`);
  }
}

console.log("AgentHost smoke test passed.");
console.log(
  JSON.stringify(
    {
      systemInfoTool: info.tool,
      capabilityTools: toolNames,
      logFile: config.logFile
    },
    null,
    2
  )
);
