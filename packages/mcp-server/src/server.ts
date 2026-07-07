import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  createBaseCapabilityRegistry,
  createSessionId,
  JsonlAuditLogger,
  loadAgentHostConfig,
  type AgentHostConfig,
  type AuditLogger,
  type CapabilityRegistry,
  type PolicyProfile,
  type ToolResult
} from "@agenthost/core";
import { getLinuxSystemInfo } from "@agenthost/os-linux";
import { runTool } from "./tool-runner.js";
import { createSystemTools, type SystemToolContext } from "./tools/system.js";

const SERVER_VERSION = "0.1.0";

const SERVER_INSTRUCTIONS =
  "AgentHost is a universal local automation host. It can help operate many apps through layered strategies: app adapters, official APIs, CLI/scripts, browser automation, accessibility, GUI fallback, and guide mode. Prefer reliable app APIs and adapters over GUI clicking. Use GUI click/type only as fallback and only when policy allows. High-risk actions require approval.";

export interface AgentHostServerOptions {
  config?: AgentHostConfig;
  policy?: PolicyProfile;
  registry?: CapabilityRegistry;
  logger?: AuditLogger;
  sessionId?: string;
}

function toMcpToolResult(result: ToolResult): {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2)
      }
    ],
    isError: !result.ok
  };
}

export async function createAgentHostMcpServer(options: AgentHostServerOptions = {}): Promise<{
  server: Server;
  context: SystemToolContext;
}> {
  const config = options.config ?? (await loadAgentHostConfig());
  const registry = options.registry ?? createBaseCapabilityRegistry();
  const logger = options.logger ?? new JsonlAuditLogger(config.logFile);
  const context: SystemToolContext = {
    sessionId: options.sessionId ?? createSessionId(),
    config,
    policy: options.policy ?? config.policy,
    registry,
    logger,
    getSystemInfo: () => getLinuxSystemInfo(config, registry)
  };
  const tools = createSystemTools();

  const server = new Server(
    {
      name: "agenthost",
      version: SERVER_VERSION
    },
    {
      capabilities: {
        tools: {}
      },
      instructions: SERVER_INSTRUCTIONS
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.mcpInputSchema
    }))
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((candidate) => candidate.name === request.params.name);

    if (tool === undefined) {
      const error = {
        code: "unknown_tool",
        message: `Unknown tool: ${request.params.name}`
      };
      const result: ToolResult = {
        ok: false,
        tool: request.params.name,
        riskLevel: "observe",
        approval: {
          required: false,
          status: "not_required"
        },
        data: null,
        observations: ["The requested tool is not registered."],
        error
      };

      await logger.log({
        timestamp: new Date().toISOString(),
        sessionId: context.sessionId,
        tool: request.params.name,
        riskLevel: "observe",
        inputSummary: "Unknown tool call",
        approvalStatus: "not_required",
        ok: false,
        durationMs: 0,
        outputSummary: error.message,
        errorCode: error.code
      });

      return toMcpToolResult(result);
    }

    const result = await runTool(tool, request.params.arguments ?? {}, context);
    return toMcpToolResult(result);
  });

  return {
    server,
    context
  };
}

export async function startStdioServer(): Promise<void> {
  const { server } = await createAgentHostMcpServer();
  const transport = new StdioServerTransport();
  const keepAlive = setInterval(() => {
    // Keep the stdio server process alive during client startup.
  }, 2_147_483_647);
  const exitOnStdinEnd = process.env.AGENTHOST_STDIO_EXIT_ON_STDIN_END === "1";
  let stdinEnded = false;
  let canStopOnStdinEnd = false;
  let startupGrace: ReturnType<typeof setTimeout> | undefined;

  const allowStopOnStdinEnd = (): void => {
    canStopOnStdinEnd = true;

    if (startupGrace !== undefined) {
      clearTimeout(startupGrace);
    }

    if (stdinEnded) {
      clearInterval(keepAlive);
    }
  };

  const stopKeepAlive = (): void => {
    stdinEnded = true;

    if (exitOnStdinEnd || canStopOnStdinEnd) {
      clearInterval(keepAlive);
    }
  };

  server.oninitialized = allowStopOnStdinEnd;
  process.stdin.once("end", stopKeepAlive);
  process.stdin.once("close", stopKeepAlive);

  await server.connect(transport);
  process.stdin.resume();

  startupGrace = setTimeout(allowStopOnStdinEnd, 5_000);

  if (exitOnStdinEnd) {
    setTimeout(() => {
      clearInterval(keepAlive);
      void transport.close().finally(() => {
        process.exit(0);
      });
    }, 1_000);
  }
}
