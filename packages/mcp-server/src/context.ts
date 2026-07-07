import type {
  AgentHostConfig,
  AppDetectionResult,
  AppOpenResult,
  AppStrategyResult,
  AppStrategyTaskType,
  AdapterRegistrySnapshot,
  AuditLogger,
  CapabilityRegistrySnapshot,
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
