import type {
  AgentHostConfig,
  AppDetectionResult,
  AppOpenResult,
  AppStrategyResult,
  AppStrategyTaskType,
  AdapterRegistrySnapshot,
  AuditLogger,
  CapabilityRegistrySnapshot,
  DesktopClickResult,
  DesktopGetActiveWindowResult,
  DesktopHotkeyResult,
  DesktopScreenshotResult,
  DesktopTypeTextResult,
  DesktopWindowContext,
  DependencyCheckResult,
  DependencyKind,
  FileEnsureDirResult,
  FileExistsResult,
  FileListResult,
  FileReadResult,
  FileWriteResult,
  InstalledAppSummary,
  PolicyProfile,
  ShellRunResult,
  SystemInfo
} from "@agenthost/core";
import type { RunSafeCommandInput } from "@agenthost/os-linux";

export interface LinuxAutomation {
  getSystemInfo(): Promise<SystemInfo> | SystemInfo;
  checkDependency(input: { name: string; kind?: DependencyKind }): Promise<DependencyCheckResult>;
  detectApp(input: { appName: string }): Promise<AppDetectionResult>;
  listInstalledApps(input: { query?: string; limit?: number }): Promise<{ apps: InstalledAppSummary[]; truncated: boolean }>;
  openApp(input: { appName: string }): Promise<AppOpenResult>;
  getAppStrategy(input: { appName: string; taskType?: AppStrategyTaskType }): Promise<AppStrategyResult>;
  runSafeCommand(input: RunSafeCommandInput): Promise<ShellRunResult>;
  writeFile(input: {
    path: string;
    content: string;
    encoding?: "utf8" | "base64";
    createParents?: boolean;
  }): Promise<FileWriteResult>;
  readFile(input: { path: string; encoding?: "utf8" | "base64"; maxBytes?: number }): Promise<FileReadResult>;
  fileExists(input: { path: string }): Promise<FileExistsResult>;
  listDirectory(input: { path: string; limit?: number }): Promise<FileListResult>;
  ensureDir(input: { path: string }): Promise<FileEnsureDirResult>;
  getActiveWindow(): Promise<DesktopGetActiveWindowResult>;
  screenshot(input: { path: string; includeActiveWindowOnly?: boolean }): Promise<DesktopScreenshotResult>;
  hotkey(input: { keys: string[]; activeWindow: DesktopWindowContext }): Promise<DesktopHotkeyResult>;
  typeText(input: { text: string; activeWindow: DesktopWindowContext }): Promise<DesktopTypeTextResult>;
  click(input: {
    x: number;
    y: number;
    button?: "left" | "middle" | "right";
    activeWindow: DesktopWindowContext;
  }): Promise<DesktopClickResult>;
}

export interface AgentHostMcpContext {
  sessionId: string;
  config: AgentHostConfig;
  policy: PolicyProfile;
  registry: CapabilityRegistrySnapshot;
  adapters: AdapterRegistrySnapshot;
  logger: AuditLogger;
  linux: LinuxAutomation;
}
