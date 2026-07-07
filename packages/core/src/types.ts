export const RISK_LEVELS = ["observe", "low", "medium", "high", "blocked"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const APPROVAL_STATUSES = [
  "not_required",
  "required",
  "approved",
  "denied",
  "expired"
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const AUTOMATION_STRATEGIES = [
  "app_adapter",
  "official_api",
  "cli_or_script",
  "browser_automation",
  "accessibility",
  "gui_control",
  "guide_only"
] as const;
export type AutomationStrategy = (typeof AUTOMATION_STRATEGIES)[number];

export const APP_SENSITIVITIES = [
  "normal",
  "communication",
  "financial",
  "credential_or_security",
  "system_settings",
  "unknown"
] as const;
export type AppSensitivity = (typeof APP_SENSITIVITIES)[number];

export const ACTION_TYPES = [
  "observe",
  "inspect",
  "app_launch",
  "shell_command",
  "file_read",
  "file_write",
  "file_delete",
  "gui_click",
  "gui_type",
  "browser_action",
  "communication_send",
  "upload",
  "system_change",
  "unknown"
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const DATA_SENSITIVITIES = ["none", "low", "sensitive", "secret"] as const;
export type DataSensitivity = (typeof DATA_SENSITIVITIES)[number];

export type PolicyProfileName = "strict" | "dev";

export interface ApprovalInfo {
  required: boolean;
  status: ApprovalStatus;
  reason?: string;
}

export interface ToolError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  tool: string;
  riskLevel: RiskLevel;
  strategy?: AutomationStrategy;
  approval: ApprovalInfo;
  data: T | null;
  observations: string[];
  error: ToolError | null;
}

export interface ToolCapability {
  name: string;
  riskLevel: RiskLevel;
  description: string;
  strategy?: AutomationStrategy;
  inputSchema?: unknown;
}

export interface AppCapability {
  id: string;
  appId?: string;
  strategy: AutomationStrategy;
  riskLevel: RiskLevel;
  description: string;
  inputSchema?: unknown;
}

export interface CapabilityRegistrySnapshot {
  listStrategies(): AutomationStrategy[];
  listTools(): ToolCapability[];
  listAppCapabilities(): AppCapability[];
}

export interface PolicyProfile {
  name: PolicyProfileName;
  allowScreenshots: boolean;
  allowAppLaunch: boolean;
  allowShell: boolean;
  allowFileWriteRoots: string[];
  allowGenericClick: boolean;
  allowGenericType: boolean;
  allowEmailSend: boolean;
  allowUploads: boolean;
  requireApprovalForMediumRisk: boolean;
  blockHighRiskByDefault: boolean;
}

export interface AgentHostConfig {
  agentHostDir: string;
  configPath: string;
  logFile: string;
  profile: PolicyProfileName;
  policy: PolicyProfile;
}

export interface ToolContext {
  sessionId: string;
  config: AgentHostConfig;
  policy: PolicyProfile;
  registry: CapabilityRegistrySnapshot;
}

export interface AppAdapter {
  id: string;
  displayName: string;
  supportedPlatforms: string[];
  getCapabilities(): AppCapability[];
  execute(action: unknown, context: ToolContext): Promise<ToolResult>;
}

export interface SafetyInput {
  tool: string;
  actionType: ActionType;
  strategy?: AutomationStrategy;
  appId?: string;
  appName?: string;
  url?: string;
  filePath?: string;
  shellCommand?: string;
  dataSensitivity?: DataSensitivity;
  externalEffect?: boolean;
  destructive?: boolean;
  communicative?: boolean;
}

export interface SafetyDecision {
  riskLevel: RiskLevel;
  appSensitivity: AppSensitivity;
  approval: ApprovalInfo;
  allowed: boolean;
  blocked: boolean;
  reasons: string[];
  matchedRules: string[];
}

export type PathAccessMode = "read" | "write" | "delete";

export interface PathSafetyResult {
  inputPath: string;
  normalizedPath: string;
  access: PathAccessMode;
  isProtectedPath: boolean;
  protectionKind: "none" | "root" | "home" | "credential" | "browser_profile" | "system";
  isAllowedWriteRoot: boolean;
  allowedWriteRoots: string[];
  riskLevel: RiskLevel;
  reasons: string[];
  matchedRules: string[];
}

export interface SafetyEvaluationContext {
  homeDir?: string;
  cwd?: string;
  agentHostDir?: string;
}

export interface SystemInfo {
  platform: string;
  arch: string;
  nodeVersion: string;
  agentHostDir: string;
  profile: PolicyProfileName;
  strategies: AutomationStrategy[];
  tools: string[];
}

export interface CapabilityList {
  strategies: AutomationStrategy[];
  tools: ToolCapability[];
  appCapabilities: AppCapability[];
}

export interface AuditLogEntry {
  timestamp: string;
  sessionId: string;
  tool: string;
  riskLevel: RiskLevel;
  strategy?: AutomationStrategy;
  inputSummary: string;
  approvalStatus: ApprovalStatus;
  ok: boolean;
  durationMs: number;
  outputSummary: string;
  errorCode?: string;
}

export interface AuditLogger {
  log(entry: AuditLogEntry): Promise<void>;
}
