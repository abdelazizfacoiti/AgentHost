import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  createAdapterRegistry,
  createBaseCapabilityRegistry,
  createSessionId,
  JsonlAuditLogger,
  loadAgentHostConfig,
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
  performLinuxPointerAction,
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
  writeLinuxFile
  ,analyzeLinuxImage
} from "@agenthost/os-linux";
import { BrowserBridgeServer, createBrowserAdapter, type BrowserBridgeAdapter } from "@agenthost/app-browser";
import type { AgentHostMcpContext, LinuxAutomation } from "./context.js";
import { ConfirmationManager } from "./confirmation.js";
import { ForgeStore } from "./forge-store.js";
import { GrantStore } from "./grants.js";
import { runTool } from "./tool-runner.js";
import { createAdapterTools } from "./tools/adapter.js";
import { createAccessibilityTools } from "./tools/accessibility.js";
import { createAppTools } from "./tools/app.js";
import { BLENDER_RUN_PYTHON_TOOL, createBlenderTools } from "./tools/blender.js";
import { createDesktopTools } from "./tools/desktop.js";
import { createFileTools } from "./tools/file.js";
import { createForgeTools } from "./tools/forge.js";
import { createForgeSandboxTools } from "./tools/forge-sandbox.js";
import { createGuideTools } from "./tools/guide.js";
import { createPolicyTools } from "./tools/policy.js";
import { createShellTools } from "./tools/shell.js";
import { createSystemTools } from "./tools/system.js";
import { createWindowTools } from "./tools/window.js";
import { createBrowserTools } from "./tools/browser.js";
import { createBrowserSetupTools } from "./tools/browser-setup.js";
import { createWorkflowTools } from "./tools/workflow.js";
import { createVisionTools } from "./tools/vision.js";
import { createCheckpointTools } from "./tools/checkpoint.js";
import { createSchedulerTools } from "./tools/scheduler.js";
import { createSchedulerReadinessTools } from "./tools/scheduler-readiness.js";
import { createSchedulerActivationTools } from "./tools/scheduler-activation.js";
import { SchedulerStore } from "./scheduler-store.js";
import { WorkflowStore } from "./workflow-store.js";
import { WorkflowReplayStore } from "./workflow-replay-store.js";
import { ToolReceiptManager } from "./tool-receipts.js";
import { VisionEvidenceStore } from "./vision-evidence.js";

const SERVER_VERSION = "0.1.0";

const SERVER_INSTRUCTIONS =
  "AgentHost is a universal local automation host. It can help operate many apps through layered strategies: app adapters, official APIs, CLI/scripts, browser automation, accessibility, GUI fallback, and guide mode. Prefer reliable app APIs and adapters over GUI clicking. Use GUI click/type only as fallback and only when policy allows. High-risk actions require approval.";

function blenderModuleSpecifier(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const isSource = currentDir.includes(`${path.sep}src`);
  const target = isSource ? "../../app-blender/src/index.js" : "../../app-blender/dist/index.js";

  return pathToFileURL(path.resolve(currentDir, target)).href;
}

async function registerOptionalBlenderRuntime(registry: CapabilityRegistry, adapters: AdapterRegistry): Promise<void> {
  if (adapters.get("blender") === undefined) {
    const blenderModule = (await import(blenderModuleSpecifier())) as {
      createBlenderAdapter?: () => { id: string };
    };

    if (typeof blenderModule.createBlenderAdapter === "function") {
      adapters.register(blenderModule.createBlenderAdapter() as never);
    }
  }

  if (!registry.listTools().some((tool) => tool.name === BLENDER_RUN_PYTHON_TOOL.name)) {
    registry.registerTool({
      name: BLENDER_RUN_PYTHON_TOOL.name,
      riskLevel: BLENDER_RUN_PYTHON_TOOL.riskLevel,
      strategy: BLENDER_RUN_PYTHON_TOOL.strategy,
      description: BLENDER_RUN_PYTHON_TOOL.description
    });
  }
}

export interface AgentHostServerOptions {
  config?: AgentHostConfig;
  policy?: PolicyProfile;
  registry?: CapabilityRegistry;
  adapters?: AdapterRegistry;
  logger?: AuditLogger;
  sessionId?: string;
  linux?: LinuxAutomation;
  browser?: BrowserBridgeAdapter;
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
}> {
  const config = options.config ?? (await loadAgentHostConfig());
  const registry = options.registry ?? createBaseCapabilityRegistry();
  const adapters = options.adapters ?? createAdapterRegistry();
  await registerOptionalBlenderRuntime(registry, adapters);
  const logger = options.logger ?? new JsonlAuditLogger(config.logFile);
  const policy = options.policy ?? config.policy;
  const confirmations = new ConfirmationManager();
  const forge = new ForgeStore(config.agentHostDir);
  await forge.ensureStructure();
  const workflowTrace = new WorkflowStore(config.agentHostDir);
  await workflowTrace.ensureStructure();
  const workflowReplay = new WorkflowReplayStore(config.agentHostDir);
  await workflowReplay.ensureStructure();
  const scheduler = new SchedulerStore(config.agentHostDir);
  await scheduler.ensureStructure();
  const receipts = new ToolReceiptManager();
  const visionEvidence = new VisionEvidenceStore();
  const grants = new GrantStore({
    persistentGrants: policy.grants,
    ...(options.sessionGrants === undefined ? {} : { sessionGrants: options.sessionGrants })
  });
  const browserBridge = options.browser === undefined
    ? new BrowserBridgeServer(config.browserBridge ?? { enabled: false, port: 43117, pairingTokenFile: path.join(config.agentHostDir, "browser", "pairing-token") })
    : undefined;
  if (browserBridge !== undefined) await browserBridge.start();
  const browser = options.browser ?? createBrowserAdapter(browserBridge!);
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
  const context: AgentHostMcpContext = {
    sessionId: options.sessionId ?? createSessionId(),
    config,
    policy,
    registry,
    adapters,
    logger,
    confirmations,
    grants,
    forge,
    workflowTrace,
    workflowReplay,
    scheduler,
    receipts,
    visionEvidence,
    browser, ...(browserBridge === undefined ? {} : { browserBridge }),
    linux
  };
  const tools = [
    ...createSystemTools(),
    ...createForgeTools(),
    ...createForgeSandboxTools(),
    ...createBrowserTools(), ...createBrowserSetupTools(),
    ...createWorkflowTools(),
    ...createSchedulerTools(),
    ...createSchedulerReadinessTools(),
    ...createSchedulerActivationTools(),
    ...createVisionTools(),
    ...createCheckpointTools(),
    ...createAdapterTools(),
    ...createBlenderTools(),
    ...createAppTools(),
    ...createShellTools(),
    ...createFileTools(),
    ...createDesktopTools(),
    ...createWindowTools(),
    ...createAccessibilityTools(),
    ...createGuideTools(),
    ...createPolicyTools()
  ];

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
        profile: context.policy.name,
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

  server.onclose = () => { void browserBridge?.close(); };
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
