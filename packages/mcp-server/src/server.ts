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
import { createOverlayRenderer, OverlayManager, VisualSurfaceCoordinator } from "@agenthost/app-overlay";
import type { AgentHostMcpContext, LinuxAutomation } from "./context.js";
import { ConfirmationManager } from "./confirmation.js";
import { ForgeStore } from "./forge-store.js";
import { GrantStore } from "./grants.js";
import { runTool } from "./tool-runner.js";
import { createAdapterTools } from "./tools/adapter.js";
import { createAccessibilityTools } from "./tools/accessibility.js";
import { createAppTools } from "./tools/app.js";
import { createBlenderTools } from "./tools/blender.js";
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
import { createSchedulerManualRunTools } from "./tools/scheduler-manual-run.js";
import { createSchedulerManualRunPreflightTools } from "./tools/scheduler-manual-run-preflight.js";
import { createSchedulerManualRunAuditTools } from "./tools/scheduler-manual-run-audit.js";
import { createSchedulerManualRunRequestLifecycleTools } from "./tools/scheduler-manual-run-request-lifecycle.js";
import { createSchedulerManualRunApprovalDiagnosticsTools } from "./tools/scheduler-manual-run-approval-diagnostics.js";
import { createOverlayTools } from "./tools/overlay.js";
import { createOverlayDiagnosticsTools } from "./tools/overlay-diagnostics.js";
import { createOverlayAssistanceTools } from "./tools/overlay-assistance.js";
import { createOverlayAssistanceInspectionTools } from "./tools/overlay-assistance-inspection.js";
import { createOverlayAssistanceTemplateTools } from "./tools/overlay-assistance-templates.js";
import { createOverlayControlSurfaceTools } from "./tools/overlay-control-surface.js";
import { SchedulerStore } from "./scheduler-store.js";
import { WorkflowStore } from "./workflow-store.js";
import { WorkflowReplayStore } from "./workflow-replay-store.js";
import { ToolReceiptManager } from "./tool-receipts.js";
import { VisionEvidenceStore } from "./vision-evidence.js";
import { OverlayAssistanceStore } from "./overlay-assistance-store.js";
import { OverlayAssistanceTemplateStore } from "./overlay-assistance-template-store.js";
import { OverlayControlSurfaceStore } from "./overlay-control-surface-store.js";
import { materializeToolDefinitions, toolCapabilities } from "./tool-metadata.js";
import { ControlRoomStore } from "./control-room-store.js";
import { CapabilityStrategyStore } from "./capability-strategy-store.js";
import { CapabilityStrategyService } from "./capability-strategy-service.js";
import { AdaptiveActionRouter } from "./adaptive-action-router.js";
import { RouteMetricsStore } from "./route-metrics-store.js";
import { createCapabilityStrategyTools } from "./tools/capability-strategy.js";
import { SpeechStore } from "./speech-store.js";
import { SpeechService } from "./speech-service.js";
import { createSpeechTools } from "./tools/speech.js";
import { RuntimeActivityStore } from "./runtime-activity-store.js";
import { RuntimeActivityService } from "./runtime-activity-service.js";
import { RuntimeActivityOverlayController } from "./runtime-activity-overlay.js";

const SERVER_VERSION = AGENTHOST_VERSION;

const SERVER_INSTRUCTIONS =
  "AgentHost is a universal local automation host. It can help operate many apps through layered strategies: app adapters, official APIs, CLI/scripts, browser automation, accessibility, GUI fallback, and guide mode. Prefer reliable app APIs and adapters over GUI clicking. Use GUI click/type only as fallback and only when policy allows. High-risk actions require approval.";

function blenderModuleSpecifier(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const isSource = currentDir.includes(`${path.sep}src`);
  const target = isSource ? "../../app-blender/src/index.js" : "../../app-blender/dist/index.js";

  return pathToFileURL(path.resolve(currentDir, target)).href;
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
  const sessionId = options.sessionId ?? createSessionId();
  const registry = options.registry ?? createBaseCapabilityRegistry();
  const adapters = options.adapters ?? createAdapterRegistry();
  const blenderEnabled = await registerOptionalBlenderRuntime(config, adapters);
  const logger = options.logger ?? new JsonlAuditLogger(config.logFile);
  const policy = options.policy ?? config.policy;
  const confirmations = new ConfirmationManager();
  const forge = new ForgeStore(config.agentHostDir);
  await forge.ensureStructure();
  const workflowTrace = new WorkflowStore(config.agentHostDir);
  await workflowTrace.ensureStructure();
  const workflowReplay = new WorkflowReplayStore(config.agentHostDir);
  await workflowReplay.ensureStructure();
  const strategyStore = new CapabilityStrategyStore(config.agentHostDir);
  await strategyStore.ensureStructure();
  const strategyService = new CapabilityStrategyService(strategyStore);
  const routeMetrics = new RouteMetricsStore(config.agentHostDir);
  await routeMetrics.ensureStructure();
  const routeRouter = new AdaptiveActionRouter(routeMetrics);
  const speechStore = new SpeechStore(config.agentHostDir);
  await speechStore.ensureStructure();
  const scheduler = new SchedulerStore(config.agentHostDir);
  await scheduler.ensureStructure();
  const receipts = new ToolReceiptManager();
  const visionEvidence = new VisionEvidenceStore();
  const overlay = new VisualSurfaceCoordinator(createOverlayRenderer(config.overlay?.rendererMode ?? config.overlayRendererMode ?? "auto", { sessionId }), { sessionId }, { reducedMotion: config.overlay?.reducedMotion ?? config.runtimeActivityOverlay?.reducedMotion ?? false });
  const runtimeActivityStore = new RuntimeActivityStore(config.agentHostDir, { ownerSessionId: sessionId });
  await runtimeActivityStore.ensureStructure();
  const runtimeActivity = new RuntimeActivityService(runtimeActivityStore);
  const runtimeActivityOverlay = new RuntimeActivityOverlayController(overlay, runtimeActivity, config.runtimeActivityOverlay ?? { enabled: true, position: "top_left", reducedMotion: false, terminalAutoHideMs: 5_000, maxLabelChars: 80, showElapsed: true, showProgress: true, interactiveControls: false, screenshotSuppression: true, multiTaskSummary: true });
  runtimeActivityOverlay.start();
  const overlayAssistance = new OverlayAssistanceStore(config.agentHostDir, overlay, sessionId);
  await overlayAssistance.ensureStructure();
  const overlayAssistanceTemplates = new OverlayAssistanceTemplateStore(config.agentHostDir, sessionId, overlayAssistance);
  await overlayAssistanceTemplates.ensureStructure();
  const overlayControlSurface = new OverlayControlSurfaceStore(config.agentHostDir, overlay, overlayAssistance, sessionId);
  await overlayControlSurface.ensureStructure();
  const grants = new GrantStore({
    persistentGrants: policy.grants,
    ...(options.sessionGrants === undefined ? {} : { sessionGrants: options.sessionGrants })
  });
  const browserBridge = options.browser === undefined
    ? new BrowserBridgeServer(config.browserBridge ?? { enabled: false, port: 43117, pairingTokenFile: path.join(config.agentHostDir, "browser", "pairing-token") }, SERVER_VERSION)
    : undefined;
  if (browserBridge !== undefined) await browserBridge.start();
  const browser = options.browser ?? createBrowserAdapter(browserBridge!);
  let speechService: SpeechService | undefined;
  const controlRoomStore = new ControlRoomStore(config.agentHostDir, { workflowTrace, assistance: overlayAssistance, forge, scheduler, overlay, strategies: strategyService, routes: routeRouter, runtimeActivity: { projection: async () => { const renderer = await runtimeActivityOverlay.projection(); return runtimeActivity.projection({ visible: renderer.visible, status: renderer.rendererStatus, suppression: renderer.suppression }); } }, speech: { capabilities: async () => speechService === undefined ? { enabled: false, redacted: true, reason: "speech_starting" } : await speechService.capabilities() as unknown as Record<string, unknown>, projection: async (ownerSessionId) => speechService === undefined ? { enabled: false, redacted: true, reason: "speech_starting" } : await speechService.projection(ownerSessionId) }, ...(browserBridge === undefined ? {} : { browserBridge }) }, { ownerSessionId: sessionId });
  await controlRoomStore.ensureStructure();
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
  speechService = new SpeechService(config, speechStore, linux);
  const speech = speechService;
  const context: AgentHostMcpContext = {
    sessionId,
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
    overlay,
    overlayAssistance,
    overlayAssistanceTemplates,
    overlayControlSurface,
    runtimeActivity,
    runtimeActivityOverlay,
    controlRoom: controlRoomStore,
    strategyStore,
    strategyService,
    routeRouter,
    speech,
    browser, ...(browserBridge === undefined ? {} : { browserBridge }),
    linux
  };
  const tools = [
    ...createSystemTools(),
    ...createCapabilityStrategyTools(),
    ...createForgeTools(),
    ...createForgeSandboxTools(),
    ...createBrowserTools(), ...createBrowserSetupTools(),
    ...createWorkflowTools(),
    ...createSchedulerTools(),
    ...createSchedulerReadinessTools(),
    ...createSchedulerActivationTools(),
    ...createSchedulerManualRunTools(),
    ...createSchedulerManualRunPreflightTools(),
    ...createSchedulerManualRunAuditTools(),
    ...createSchedulerManualRunRequestLifecycleTools(),
    ...createSchedulerManualRunApprovalDiagnosticsTools(),
    ...createOverlayTools(),
    ...createOverlayDiagnosticsTools(),
    ...createOverlayAssistanceTools(),
    ...createOverlayAssistanceInspectionTools(),
    ...createOverlayAssistanceTemplateTools(),
    ...createOverlayControlSurfaceTools(),
    ...createVisionTools(),
    ...createCheckpointTools(),
    ...createSpeechTools(),
    ...createAdapterTools(),
    ...(blenderEnabled ? createBlenderTools() : []),
    ...createAppTools(),
    ...createShellTools(),
    ...createFileTools(),
    ...createDesktopTools(),
    ...createWindowTools(),
    ...createAccessibilityTools(),
    ...createGuideTools(),
    ...createPolicyTools()
  ];

  const loadedTools = materializeToolDefinitions(tools);
  registry.syncTools(toolCapabilities(loadedTools));

  let controlRoomServer: { start(): Promise<{ url: string }>; close(): Promise<void> } | undefined;
  if (config.controlRoom?.enabled === true) {
    try {
      const controlRoomModule = await import("../../app-control-room/dist/index.js") as { ControlRoomServer: new (config: NonNullable<AgentHostConfig["controlRoom"]>, provider: ReturnType<ControlRoomStore["provider"]>) => { start(): Promise<{ url: string }>; close(): Promise<void> } };
      controlRoomServer = new controlRoomModule.ControlRoomServer(config.controlRoom, controlRoomStore.provider());
      const started = await controlRoomServer.start();
      console.error(`AgentHost Control Room: ${started.url}`);
    } catch (error) {
      console.error(`AgentHost Control Room unavailable: ${error instanceof Error ? error.message : "startup_failed"}`);
    }
  }

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
    tools: loadedTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.mcpInputSchema
    }))
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = loadedTools.find((candidate) => candidate.name === request.params.name);

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

  server.onclose = () => { void controlRoomServer?.close(); void browserBridge?.close(); void overlayControlSurface.close(); void overlayAssistance.close(); void runtimeActivityOverlay.close(); void overlay.close(); };
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
