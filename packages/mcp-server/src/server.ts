import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  createAdapterRegistry,
  createBaseCapabilityRegistry,
  createSessionId,
  JsonlAuditLogger,
  loadAgentHostConfig,
  summarizeForLog,
  validateOptionalAdapterExecutionPolicy,
  AGENTHOST_VERSION,
  type AdapterRegistry,
  type AgentHostConfig,
  type AuditLogger,
  type CapabilityRegistry,
  type PolicyProfile,
  type ToolResult
} from "@agenthost/core";
import {
  checkLinuxDependency,
  captureLinuxScreenshot,
  clickLinuxDesktop,
  copyLinuxFile,
  deleteLinuxPath,
  performLinuxPointerAction,
  moveLinuxFile,
  detectLinuxApp,
  detectLinuxAccessibilitySupport,
  ensureLinuxDir,
  findLinuxAccessibilityElements,
  focusLinuxAccessibilityElement,
  focusLinuxWindow,
  getLinuxActiveWindow,
  getLinuxScreenGeometry,
  getLinuxActiveWindowBounds,
  getLinuxAccessibilityTree,
  getLinuxAppStrategy,
  getLinuxDesktopCapabilities,
  getLinuxSystemInfo,
  inspectLinuxAccessibilityElement,
  invokeLinuxAccessibilityAction,
  linuxFileExists,
  listLinuxWindows,
  listInstalledLinuxApps,
  listLinuxDirectory,
  openLinuxApp,
  readLinuxFile,
  probeLinuxSandboxSupport,
  runSafeLinuxCommand,
  sendLinuxHotkey,
  setLinuxAccessibilityValue,
  typeLinuxText,
  writeLinuxFile,
  analyzeLinuxImage
} from "@agenthost/os-linux";
import { createOverlayRenderer, VisualSurfaceCoordinator } from "@agenthost/app-overlay";
import type { AgentHostMcpContext, LinuxAutomation } from "./context.js";
import { GrantStore } from "./grants.js";
import { createAdapterTools } from "./tools/adapter.js";
import { createDesktopTools } from "./tools/desktop.js";
import { createComputerTools } from "./tools/computer.js";
import { createFileTools } from "./tools/file.js";
import { createPolicyTools } from "./tools/policy.js";
import { createShellTools } from "./tools/shell.js";
import { createSystemTools } from "./tools/system.js";
import { createWindowTools } from "./tools/window.js";
import { createVisionTools } from "./tools/vision.js";
import { createTaskTools } from "./tools/tasks.js";
import { createAgentTools } from "./tools/agent.js";
import { applyProductionExecutionMetadata, materializeToolDefinitions, toolCapabilities } from "./tool-metadata.js";
import { listResourceEntries, readResource } from "./resources.js";
import { runTool } from "./tool-runner.js";
import { ToolActionOverlay } from "./action-overlay.js";

const SERVER_VERSION = AGENTHOST_VERSION;

const SERVER_INSTRUCTIONS =
  "AgentHost is a universal local automation host. It provides desktop automation, file operations, shell commands, vision/OCR, and window management. Use GUI click/type as fallback when policy allows. State-changing calls require an exact dry-run preview and single-use confirmation token unless an active task approval covers a low/medium effect.";

function blenderModuleSpecifier(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const isSource = currentDir.includes(`${path.sep}src`);
  const target = isSource ? "../../app-blender/src/index.js" : "../../app-blender/dist/index.js";

  return pathToFileURL(path.resolve(currentDir, target)).href;
}

function sshModuleSpecifier(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const isSource = currentDir.includes(`${path.sep}src`);
  const target = isSource ? "../../app-ssh/src/index.js" : "../../app-ssh/dist/index.js";

  return pathToFileURL(path.resolve(currentDir, target)).href;
}

async function registerOptionalSshRuntime(config: AgentHostConfig, adapters: AdapterRegistry): Promise<boolean> {
  if (config.optionalAdapters?.ssh?.enabled !== true) {
    return false;
  }

  if (adapters.get("ssh") === undefined) {
    const sshModule = (await import(sshModuleSpecifier())) as {
      createSshAdapter?: () => { id: string; optionalExecutionPolicy?: unknown };
    };

    if (typeof sshModule.createSshAdapter === "function") {
      const adapter = sshModule.createSshAdapter();
      validateOptionalAdapterExecutionPolicy(adapter as never);
      adapters.register(adapter as never);
    }
  }
  return adapters.get("ssh") !== undefined;
}

async function registerOptionalBlenderRuntime(config: AgentHostConfig, adapters: AdapterRegistry): Promise<boolean> {
  if (config.optionalAdapters?.blender?.enabled !== true) {
    return false;
  }

  if (adapters.get("blender") === undefined) {
    const blenderModule = (await import(blenderModuleSpecifier())) as {
      createBlenderAdapter?: () => { id: string; optionalExecutionPolicy?: unknown };
    };

    if (typeof blenderModule.createBlenderAdapter === "function") {
      const adapter = blenderModule.createBlenderAdapter();
      validateOptionalAdapterExecutionPolicy(adapter as never);
      adapters.register(adapter as never);
    }
  }
  return adapters.get("blender") !== undefined;
}

export interface AgentHostServerOptions {
  config?: AgentHostConfig;
  policy?: PolicyProfile;
  registry?: CapabilityRegistry;
  adapters?: AdapterRegistry;
  logger?: AuditLogger;
  sessionId?: string;
  linux?: LinuxAutomation;
  sessionGrants?: import("@agenthost/core").CapabilityGrant[];
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
  context: AgentHostMcpContext;
  closeResources: () => Promise<void>;
}> {
  const config = options.config ?? (await loadAgentHostConfig());
  const sessionId = options.sessionId ?? createSessionId();
  const registry = options.registry ?? createBaseCapabilityRegistry();
  const adapters = options.adapters ?? createAdapterRegistry();
  const blenderEnabled = await registerOptionalBlenderRuntime(config, adapters);
  const sshEnabled = await registerOptionalSshRuntime(config, adapters);
  const logger = options.logger ?? new JsonlAuditLogger(config.logFile);
  const policy = options.policy ?? config.policy;
  const grants = new GrantStore({
    persistentGrants: policy.grants,
    ...(options.sessionGrants === undefined ? {} : { sessionGrants: options.sessionGrants })
  });
  const overlay = new VisualSurfaceCoordinator(createOverlayRenderer(config.overlay?.rendererMode ?? config.overlayRendererMode ?? "auto", { sessionId }), { sessionId }, { reducedMotion: config.overlay?.reducedMotion ?? false });
  const actionOverlay = new ToolActionOverlay(overlay, {
    widgetId: `agenthost-action-${sessionId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120)}`,
    placement: config.overlay?.preferredPosition ?? "top_right",
    persistent: config.overlay?.persistent ?? true,
    autoHideMs: config.overlay?.autoHideMs ?? 15_000
  });
  const linux: LinuxAutomation =
    options.linux ?? {
      getSystemInfo: () => getLinuxSystemInfo(config, registry),
      checkDependency: (input) => checkLinuxDependency(input),
      detectApp: (input) => detectLinuxApp(input, policy),
      listInstalledApps: (input) => listInstalledLinuxApps(input),
      openApp: (input) => openLinuxApp(input, policy),
      getAppStrategy: (input) => getLinuxAppStrategy(input, policy),
      runSafeCommand: (input) => runSafeLinuxCommand(input),
      writeFile: (input) => writeLinuxFile(input, { agentHostDir: config.agentHostDir }),
      readFile: (input) => readLinuxFile(input, { agentHostDir: config.agentHostDir }),
      fileExists: (input) => linuxFileExists(input, { agentHostDir: config.agentHostDir }),
      listDirectory: (input) => listLinuxDirectory(input, { agentHostDir: config.agentHostDir }),
      ensureDir: (input) => ensureLinuxDir(input, { agentHostDir: config.agentHostDir }),
      copyFile: (input) => copyLinuxFile(input, { agentHostDir: config.agentHostDir }),
      moveFile: (input) => moveLinuxFile(input, { agentHostDir: config.agentHostDir }),
      deletePath: (input) => deleteLinuxPath(input, { agentHostDir: config.agentHostDir }),
      getDesktopCapabilities: () => getLinuxDesktopCapabilities({ agentHostDir: config.agentHostDir }),
      getActiveWindow: () => getLinuxActiveWindow({ agentHostDir: config.agentHostDir }),
      getScreenGeometry: () => getLinuxScreenGeometry({ agentHostDir: config.agentHostDir }),
      getActiveWindowBounds: () => getLinuxActiveWindowBounds({ agentHostDir: config.agentHostDir }),
      screenshot: (input) => captureLinuxScreenshot(input, { agentHostDir: config.agentHostDir }),
      listWindows: (input) => listLinuxWindows(input, { agentHostDir: config.agentHostDir }),
      focusWindow: (input) => focusLinuxWindow(input, { agentHostDir: config.agentHostDir }),
      hotkey: (input) => sendLinuxHotkey(input, { agentHostDir: config.agentHostDir }),
      typeText: (input) => typeLinuxText(input, { agentHostDir: config.agentHostDir }),
      click: (input) => clickLinuxDesktop(input, { agentHostDir: config.agentHostDir }),
      pointer: (input) => performLinuxPointerAction(input, { agentHostDir: config.agentHostDir }),
      checkSandboxSupport: () => probeLinuxSandboxSupport({ env: process.env }),
      analyzeImage: (input) => analyzeLinuxImage(input, { env: process.env }),
      getAccessibilityTree: (input) => getLinuxAccessibilityTree(input, { agentHostDir: config.agentHostDir }),
      findAccessibilityElement: (input) => findLinuxAccessibilityElements(input, { agentHostDir: config.agentHostDir }),
      inspectAccessibilityElement: (input) =>
        inspectLinuxAccessibilityElement(input, { agentHostDir: config.agentHostDir }),
      invokeAccessibilityAction: (input) =>
        invokeLinuxAccessibilityAction(input, { agentHostDir: config.agentHostDir }),
      setAccessibilityValue: (input) => setLinuxAccessibilityValue(input, { agentHostDir: config.agentHostDir }),
      focusAccessibilityElement: (input) =>
        focusLinuxAccessibilityElement(input, { agentHostDir: config.agentHostDir })
    };
  const serverModulePath = fileURLToPath(import.meta.url);
  const runtime = {
    version: SERVER_VERSION,
    entryPath: path.join(path.dirname(serverModulePath), `index${path.extname(serverModulePath)}`),
    startedAt: new Date().toISOString()
  };
  const context: AgentHostMcpContext = {
    sessionId,
    config,
    policy,
    registry,
    adapters,
    logger,
    grants,
    overlay,
    actionOverlay,
    overlayScreenshotSuppression: async (capture) => {
      try {
        return await overlay.withScreenshotSuppressed(capture);
      } finally {
        await actionOverlay.refresh();
      }
    },
    linux,
    runtime
  };
  const tools = [
    ...createSystemTools(),
    ...createVisionTools(),
    ...createAdapterTools(),
    ...(blenderEnabled ? [] : []),
    ...(sshEnabled ? [] : []),
    ...createShellTools(),
    ...createFileTools(),
    ...createDesktopTools(),
    ...createComputerTools(),
    ...createTaskTools(),
    ...createAgentTools(),
    ...createWindowTools(),
    ...createPolicyTools()
  ];

  const loadedTools = materializeToolDefinitions(applyProductionExecutionMetadata(tools));
  registry.syncTools(toolCapabilities(loadedTools));
  context.tools = new Map(loadedTools.map((tool) => [tool.name, tool]));

  const server = new Server(
    {
      name: "agenthost",
      version: SERVER_VERSION
    },
    {
      capabilities: {
        tools: {},
        resources: {}
      },
      instructions: SERVER_INSTRUCTIONS
    }
  );

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: listResourceEntries()
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    try {
      const { mimeType, text } = await readResource(
        { registry: context.registry, adapters: context.adapters, policy: context.policy, config: context.config },
        request.params.uri
      );
      return { contents: [{ uri: request.params.uri, mimeType, text }] };
    } catch {
      throw new Error(`Unknown resource: ${request.params.uri}`);
    }
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: loadedTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.mcpInputSchema
    }))
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = loadedTools.find((candidate) => candidate.name === request.params.name);

    if (tool === undefined) {
      const requestedName = request.params.name.slice(0, 200);
      const error = {
        code: "unknown_tool",
        message: `Unknown tool: ${summarizeForLog(requestedName)}`
      };
      const result: ToolResult = {
        ok: false,
        tool: requestedName,
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
        profile: context.policy.name,
        tool: requestedName,
        riskLevel: "observe",
        ...(context.runtime === undefined ? {} : { serverVersion: context.runtime.version, serverPath: context.runtime.entryPath }),
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

  let resourceClosePromise: Promise<void> | undefined;
  const closeResources = async (): Promise<void> => {
    if (resourceClosePromise !== undefined) return await resourceClosePromise;
    resourceClosePromise = (async () => {
      await actionOverlay.close();
      await overlay.close();
    })();
    return await resourceClosePromise;
  };
  server.onclose = () => { void closeResources(); };
  return {
    server,
    context,
    closeResources
  };
}

export async function startStdioServer(): Promise<void> {
  const { server, closeResources } = await createAgentHostMcpServer();
  const transport = new StdioServerTransport();
  const keepAlive = setInterval(() => {
    // Keep the stdio server process alive during client startup.
  }, 2_147_483_647);
  const exitOnStdinEnd = process.env.AGENTHOST_STDIO_EXIT_ON_STDIN_END === "1";
  let stdinEnded = false;
  let canStopOnStdinEnd = false;
  let startupGrace: ReturnType<typeof setTimeout> | undefined;
  let stopping = false;

  const shutdown = async (exitCode: number): Promise<void> => {
    if (stopping) return;
    stopping = true;
    clearInterval(keepAlive);
    if (startupGrace !== undefined) clearTimeout(startupGrace);
    await transport.close().catch(() => undefined);
    await closeResources();
    process.exitCode = exitCode;
  };

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
  process.once("SIGINT", () => { void shutdown(130); });
  process.once("SIGTERM", () => { void shutdown(143); });

  await server.connect(transport);
  process.stdin.resume();

  startupGrace = setTimeout(allowStopOnStdinEnd, 5_000);

  if (exitOnStdinEnd) {
    setTimeout(() => { void shutdown(0); }, 1_000);
  }
}