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
  "accessibility_action",
  "accessibility_set_value",
  "accessibility_focus",
  "browser_action",
  "communication_send",
  "upload",
  "system_change",
  "unknown"
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const DATA_SENSITIVITIES = ["none", "low", "sensitive", "secret"] as const;
export type DataSensitivity = (typeof DATA_SENSITIVITIES)[number];

export const TOOL_FORGE_MANIFEST_KINDS = ["tool", "adapter", "skill", "workflow"] as const;
export type ToolForgeManifestKind = (typeof TOOL_FORGE_MANIFEST_KINDS)[number];

export const TOOL_FORGE_MANIFEST_SOURCES = ["generated", "user", "built-in"] as const;
export type ToolForgeManifestSource = (typeof TOOL_FORGE_MANIFEST_SOURCES)[number];

export const PERMISSION_DEFAULTS = ["allow", "approval_required", "deny", "guide_only"] as const;
export type PermissionDefault = (typeof PERMISSION_DEFAULTS)[number];

export const GRANT_EFFECTS = ["allow", "deny", "guide_only"] as const;
export type GrantEffect = (typeof GRANT_EFFECTS)[number];

export const GRANT_SCOPES = ["session", "persistent"] as const;
export type GrantScope = (typeof GRANT_SCOPES)[number];

export type PolicyProfileName =
  | "strict"
  | "dev"
  | "gui-dev"
  | "demo-unlocked-local"
  | "private-data"
  | "autopilot-future-disabled-by-default";

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
  preview?: boolean;
  confirmation?: ToolConfirmationInfo;
  grantDecision?: GrantDecision;
  approval: ApprovalInfo;
  data: T | null;
  observations: string[];
  error: ToolError | null;
}

export type ConfirmationStatus =
  | "previewGenerated"
  | "tokenUsed"
  | "tokenAccepted"
  | "tokenRejected";

export interface ToolConfirmationInfo {
  status: ConfirmationStatus;
  used: boolean;
  accepted: boolean;
  executed: boolean;
  reason: string;
  tokenId?: string;
  expiresAt?: string;
}

export interface ToolCapability {
  name: string;
  riskLevel: RiskLevel;
  description: string;
  strategy?: AutomationStrategy;
  inputSchema?: unknown;
  generated?: boolean;
}

export interface AppCapability {
  id: string;
  adapterId?: string;
  appId?: string;
  strategy: AutomationStrategy;
  riskLevel: RiskLevel;
  description: string;
  inputSchema?: unknown;
  safety: {
    actionType: ActionType;
    dataSensitivity?: DataSensitivity;
    externalEffect?: boolean;
    destructive?: boolean;
    communicative?: boolean;
  };
}

export interface CapabilityRegistrySnapshot {
  listStrategies(): AutomationStrategy[];
  listTools(): ToolCapability[];
  listAppCapabilities(): AppCapability[];
}

export interface PermissionDefaults {
  shell: PermissionDefault;
  fileRead: PermissionDefault;
  fileWrite: PermissionDefault;
  appOpen: PermissionDefault;
  screenshots: PermissionDefault;
  windowFocus: PermissionDefault;
  accessibilityRead: PermissionDefault;
  accessibilityActions: PermissionDefault;
  guiClick: PermissionDefault;
  guiType: PermissionDefault;
  guiHotkey: PermissionDefault;
  browserAutomation: PermissionDefault;
  communicationActions: PermissionDefault;
  privateDataReads: PermissionDefault;
  externalSendsUploads: PermissionDefault;
  destructiveActions: PermissionDefault;
  generatedTools: PermissionDefault;
}

export interface CapabilityGrantRequirements {
  requiresDryRun?: boolean;
  requiresConfirmationToken?: boolean;
  requiresApproval?: boolean;
  requiresExactTarget?: boolean;
  maxRiskLevel?: RiskLevel;
  allowedRoots?: string[];
  sandboxRoots?: Array<"run" | "temp">;
  outputRoots?: Array<"run">;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  maxRuntimeMs?: number;
  allowedOperations?: ToolForgeRuntimeOperation[];
}

export interface CapabilityGrantMatch {
  tools?: string[];
  strategies?: AutomationStrategy[];
  actionTypes?: ActionType[];
  appNames?: string[];
  appIds?: string[];
  appSensitivities?: AppSensitivity[];
  dataSensitivities?: DataSensitivity[];
  fileRoots?: string[];
  commandAllowlist?: string[];
  networkDomains?: string[];
  oauthScopes?: string[];
  generatedToolIds?: string[];
  registrationIds?: string[];
  runtimeToolNames?: string[];
  runtimeCapabilities?: ToolForgeRuntimeCapability[];
}

export interface CapabilityGrant {
  id: string;
  scope: GrantScope;
  effect: GrantEffect;
  description?: string;
  createdAt?: string;
  expiresAt?: string;
  match: CapabilityGrantMatch;
  requirements?: CapabilityGrantRequirements;
}

export interface PolicyProfile {
  name: PolicyProfileName;
  description: string;
  enabled: boolean;
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
  requireDryRunForStateChanging: boolean;
  requireConfirmationForStateChanging: boolean;
  requireExactTargetForStateChanging: boolean;
  defaults: PermissionDefaults;
  grants: CapabilityGrant[];
}

export interface AgentHostConfig {
  agentHostDir: string;
  configPath: string;
  logFile: string;
  profile: PolicyProfileName;
  /** Undefined only for older in-memory callers; loader always supplies `auto` by default. */
  forgeRuntimeSandboxMode?: ForgeRuntimeSandboxMode;
  browserBridge?: BrowserBridgeConfig;
  policy: PolicyProfile;
}

export interface BrowserBridgeConfig {
  enabled: boolean;
  port: number;
  pairingTokenFile: string;
}

export type BrowserFamily = "firefox" | "chromium";
export type BrowserBridgeStatus = "disabled" | "pairing_required" | "connected" | "unavailable";

export interface BrowserDetectResult {
  supported: boolean;
  enabled: boolean;
  paired: boolean;
  connected: boolean;
  status: BrowserBridgeStatus;
  backend: "webextension_loopback";
  browser?: { family: BrowserFamily; version?: string };
  reason: string;
}

export interface BrowserTabSummary {
  tabId: string;
  windowId: string;
  active: boolean;
  url: string;
  origin: string;
  title?: string;
  appSensitivity: AppSensitivity;
  sitePermission: "granted" | "missing" | "not_required";
  urlRedacted: boolean;
}

export interface BrowserPageContext {
  tab: BrowserTabSummary;
  language?: string;
  headings: string[];
  landmarks: string[];
  links: Array<{ text: string; url: string }>;
  controls: Array<{ role: string; name: string; disabled: boolean }>;
  truncated: boolean;
  redactionCounts: Record<string, number>;
}

export interface BrowserTextResult {
  tab: BrowserTabSummary;
  text: string;
  characterCount: number;
  truncated: boolean;
  redactionCounts: Record<string, number>;
}

export type BrowserElementActionKind = "safe_navigation" | "safe_toggle" | "safe_disclosure" | "safe_search" | "text_input" | "message_input" | "form_submit" | "communication_send" | "upload" | "destructive" | "financial" | "authentication" | "captcha" | "password_input" | "unknown";
export interface BrowserElementSummary {
  elementId: string;
  tabId: string;
  role: string;
  nameSummary: string;
  bounds?: { x: number; y: number; width: number; height: number };
  visible: boolean;
  enabled: boolean;
  confidence: number;
  ambiguous: boolean;
  actionKind: BrowserElementActionKind;
  expiresAt: string;
}
export interface BrowserFormStateResult {
  tab: BrowserTabSummary;
  fields: Array<{ elementId?: string; label: string; type: string; required: boolean; disabled: boolean; valueStatus: "empty" | "filled" | "redacted" }>;
  submitButtonPresent: boolean;
  truncated: boolean;
}
export interface BrowserCheckpointResult {
  passed: boolean;
  actionPerformed: boolean;
  checks: Array<{ kind: string; passed: boolean; redactedSummary: string }>;
  durationMs: number;
}

/** OS isolation preference for the fixed Forge JSON runner. */
export type ForgeRuntimeSandboxMode = "auto" | "none" | "bubblewrap" | "firejail" | "unshare";

export interface ToolContext {
  sessionId: string;
  config: AgentHostConfig;
  policy: PolicyProfile;
  registry: CapabilityRegistrySnapshot;
}

export interface AdapterActionRequest {
  adapterId: string;
  capabilityId: string;
  appId?: string;
  input: unknown;
}

export interface AppAdapter {
  id: string;
  displayName: string;
  appIds: string[];
  supportedPlatforms: string[];
  matchesApp?(input: { appId?: string; appName?: string }): boolean;
  getCapabilities(): AppCapability[];
  execute(action: AdapterActionRequest, context: ToolContext): Promise<ToolResult>;
}

export interface AdapterSummary {
  id: string;
  displayName: string;
  appIds: string[];
  supportedPlatforms: string[];
  capabilityCount: number;
}

export interface AdapterRegistrationResult {
  registered: boolean;
  skipped: boolean;
  adapterId: string;
  reason: string;
}

export interface AdapterCapabilityFilter {
  adapterId?: string;
  appId?: string;
}

export interface AdapterDetectionInput {
  appName: string;
  appId?: string;
}

export interface AdapterDetectionResult {
  appName: string;
  appId?: string;
  adapterAvailable: boolean;
  adapters: AdapterSummary[];
  capabilities: AppCapability[];
  recommendedStrategy: AutomationStrategy;
  reason: string;
}

export interface AdapterListResult {
  adapters: AdapterSummary[];
}

export interface AdapterCapabilitiesResult {
  adapterId?: string;
  appId?: string;
  capabilities: AppCapability[];
}

export interface AdapterRegistrySnapshot {
  get(adapterId: string): AppAdapter | undefined;
  listAdapters(): AdapterSummary[];
  listCapabilities(filter?: AdapterCapabilityFilter): AppCapability[];
  detectForApp(input: AdapterDetectionInput): AdapterDetectionResult;
}

export const GUIDE_WORKFLOW_KINDS = [
  "unsupported_app",
  "unknown_app",
  "sensitive_app",
  "unsafe_action",
  "manual_review",
  "general"
] as const;
export type GuideWorkflowKind = (typeof GUIDE_WORKFLOW_KINDS)[number];

export interface GuideToolSuggestion {
  tool: string;
  reason: string;
  input?: unknown;
}

export interface GuideStep {
  id: string;
  title: string;
  instruction: string;
  appName?: string;
  riskLevel: RiskLevel;
  expectedResult?: string;
  warning?: string;
  userActionRequired: boolean;
  canAutomateLater: boolean;
  relatedToolSuggestion?: GuideToolSuggestion;
}

export interface GuideCreateStepsInput {
  workflowGoal: string;
  appName?: string;
  appId?: string;
  workflowKind?: GuideWorkflowKind;
  taskType?: AppStrategyTaskType;
  reason?: string;
  availableStrategies?: AutomationStrategy[];
  knownAppSensitivity?: AppSensitivity;
  knownRiskLevel?: RiskLevel;
}

export interface GuideResult {
  strategy: "guide_only";
  workflowGoal: string;
  workflowKind: GuideWorkflowKind;
  appName?: string;
  appSensitivity: AppSensitivity;
  riskLevel: RiskLevel;
  summary: string;
  warnings: string[];
  steps: GuideStep[];
  canAutomateLater: boolean;
  relatedToolSuggestions: GuideToolSuggestion[];
}

export interface GuideSuggestion {
  strategy: "guide_only";
  reason: string;
  warning?: string;
  suggestedTool: "guide.create_steps";
  input: GuideCreateStepsInput;
}

export interface GuideExplainStrategyInput {
  appName?: string;
  taskType?: AppStrategyTaskType;
  availableStrategies?: AutomationStrategy[];
  recommendedStrategy?: AutomationStrategy;
  reason?: string;
  knownAppSensitivity?: AppSensitivity;
}

export interface GuideStrategyExplanationResult {
  recommendedStrategy: AutomationStrategy;
  appName?: string;
  appSensitivity: AppSensitivity;
  summary: string;
  reasons: string[];
  warnings: string[];
  guideSuggestion: GuideSuggestion;
}

export interface SafetyInput {
  tool: string;
  actionType: ActionType;
  strategy?: AutomationStrategy;
  generatedToolId?: string;
  generatedTool?: boolean;
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

export interface GrantDecision {
  matchedGrantIds: string[];
  allowedByGrantIds: string[];
  deniedByGrantIds: string[];
  guideOnlyByGrantIds: string[];
  requiresDryRun: boolean;
  requiresConfirmationToken: boolean;
  requiresApproval: boolean;
  requiresExactTarget: boolean;
}

export interface SafetyDecision {
  riskLevel: RiskLevel;
  appSensitivity: AppSensitivity;
  approval: ApprovalInfo;
  allowed: boolean;
  blocked: boolean;
  guideOnly: boolean;
  reasons: string[];
  matchedRules: string[];
  grantDecision: GrantDecision;
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
  grants?: CapabilityGrant[];
}

export type DependencyKind = "command" | "desktop_app" | "any";

export interface DependencyCheckResult {
  found: boolean;
  kind: DependencyKind;
  name: string;
  commandPath?: string;
  desktopEntryPath?: string;
  displayName?: string;
  reason: string;
}

export interface InstalledAppSummary {
  appId: string;
  displayName: string;
  command?: string;
  executablePath?: string;
  desktopEntryPath?: string;
}

export interface AppDetectionResult {
  found: boolean;
  appId: string;
  displayName?: string;
  executablePath?: string;
  desktopEntryPath?: string;
  adapterAvailable: boolean;
  adapterIds?: string[];
  adapterCapabilities?: AppCapability[];
  availableStrategies: AutomationStrategy[];
  recommendedStrategy: AutomationStrategy;
  appSensitivity: AppSensitivity;
  reason: string;
  guideSuggestion?: GuideSuggestion;
}

export type AppStrategyTaskType = "open" | "inspect" | "automate" | "unknown";

export interface AppStrategyResult extends AppDetectionResult {
  taskType: AppStrategyTaskType;
}

export interface AppOpenResult {
  opened: boolean;
  appId: string;
  displayName?: string;
  pid?: number;
  strategy: AutomationStrategy;
  command?: string;
  reason: string;
}

export interface ShellRunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

export interface FileWriteResult {
  path: string;
  bytesWritten: number;
  created: true;
}

export interface FileReadResult {
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  bytesRead: number;
  truncated: boolean;
}

export interface FileExistsResult {
  path: string;
  exists: boolean;
  type?: "file" | "directory" | "other";
}

export interface FileListEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "other";
}

export interface FileListResult {
  path: string;
  entries: FileListEntry[];
  truncated: boolean;
}

export interface FileEnsureDirResult {
  path: string;
  exists: boolean;
  created: boolean;
}

export type DesktopMouseButton = "left" | "middle" | "right";

export interface DesktopWindowContext {
  windowId?: string;
  appName?: string;
  title?: string;
  pid?: number;
  appSensitivity?: AppSensitivity;
}

export interface DesktopGetActiveWindowResult {
  supported: boolean;
  backend: string;
  activeWindow?: DesktopWindowContext;
  reason: string;
}

export interface DesktopScreenshotResult {
  supported: boolean;
  backend: string;
  path?: string;
  bytesWritten?: number;
  activeWindow?: DesktopWindowContext;
  reason: string;
}

export interface DesktopHotkeyResult {
  supported: boolean;
  backend: string;
  sent: boolean;
  keys: string[];
  activeWindow: DesktopWindowContext;
  reason: string;
}

export interface DesktopTypeTextResult {
  supported: boolean;
  backend: string;
  typed: boolean;
  characterCount: number;
  activeWindow: DesktopWindowContext;
  reason: string;
}

export interface DesktopClickResult {
  supported: boolean;
  backend: string;
  clicked: boolean;
  x: number;
  y: number;
  button: DesktopMouseButton;
  activeWindow: DesktopWindowContext;
  reason: string;
}

export type DesktopPointerAction = "move_mouse" | "scroll" | "double_click" | "right_click" | "drag";
export interface DesktopPointerResult {
  supported: boolean;
  backend: string;
  performed: boolean;
  action: DesktopPointerAction;
  activeWindow: DesktopWindowContext;
  reason: string;
}

export type SandboxBackendId =
  | "bubblewrap"
  | "firejail"
  | "unshare"
  | "flatpak-spawn"
  | "nsjail"
  | "systemd-run";

export type SandboxFeatureStatus = {
  status: "available" | "unavailable" | "unknown";
  reason: string;
};

export interface SandboxBackendSupport {
  id: SandboxBackendId;
  commandName: string;
  commandPath: string;
  detected: true;
  usability: "candidate" | "limited" | "informational";
  reason: string;
  limitations: string[];
}

export interface SandboxBackendUnavailable {
  id: SandboxBackendId;
  detected: false;
  reason: string;
}

export interface SandboxSupportProbeResult {
  platform: string;
  supported: boolean;
  availableBackends: SandboxBackendSupport[];
  unavailableBackends: SandboxBackendUnavailable[];
  recommendedBackend: SandboxBackendId | null;
  kernelFeatures: {
    userNamespaces: SandboxFeatureStatus;
    seccomp: SandboxFeatureStatus;
    appArmor: SandboxFeatureStatus;
    flatpakContainer: SandboxFeatureStatus;
  };
  limitations: string[];
  requiresInstall: boolean;
  requiresSudo: false;
  safeForAgentHostUse: boolean;
  notes: string[];
}

export interface DesktopCapabilitySupport {
  supported: boolean;
  backend: string;
  reason: string;
}

export type DesktopSessionType = "x11" | "wayland" | "unknown";

export interface DesktopCapabilitiesResult {
  platform: string;
  sessionType: DesktopSessionType;
  displayAvailable: boolean;
  backend: string;
  activeWindow: DesktopCapabilitySupport;
  screenshot: DesktopCapabilitySupport;
  windowList: DesktopCapabilitySupport;
  windowFocus: DesktopCapabilitySupport;
  accessibility: DesktopCapabilitySupport;
  guiInput: DesktopCapabilitySupport;
}

export interface DesktopWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopWindowSummary {
  windowId: string;
  appName?: string;
  title?: string;
  pid?: number;
  appSensitivity?: AppSensitivity;
  bounds?: DesktopWindowBounds;
}

export interface WindowListResult {
  supported: boolean;
  backend: string;
  windows: DesktopWindowSummary[];
  truncated: boolean;
  reason: string;
}

export interface WindowFocusResult {
  supported: boolean;
  backend: string;
  focused: boolean;
  window: DesktopWindowContext;
  reason: string;
}

export interface AccessibilityTreeNode {
  id: string;
  role: string;
  name?: string;
  text?: string;
  description?: string;
  bounds?: DesktopWindowBounds;
  sensitive?: boolean;
  hidden?: boolean;
  children?: AccessibilityTreeNode[];
}

export interface AccessibilityElementCandidate {
  id: string;
  role: string;
  name?: string;
  text?: string;
  bounds?: DesktopWindowBounds;
  confidence: number;
  reason: string;
}

export interface AccessibilityElementTarget {
  appName?: string;
  windowId?: string;
  pid?: number;
  elementId?: string;
  query?: string;
  role?: string;
}

export interface AccessibilityValueMetadata {
  supportsText: boolean;
  supportsValue: boolean;
  editable: boolean;
  readOnly: boolean;
  textLength?: number;
  minimum?: number;
  maximum?: number;
  step?: number;
}

export interface AccessibilityElementDetails {
  elementId: string;
  role: string;
  name?: string;
  description?: string;
  states: string[];
  availableActions: string[];
  bounds?: DesktopWindowBounds;
  valueMetadata?: AccessibilityValueMetadata;
  appName?: string;
  windowId?: string;
  windowTitle?: string;
  pid?: number;
  appSensitivity?: AppSensitivity;
  dataSensitivity: DataSensitivity;
  hidden?: boolean;
}

export interface AccessibilityTreeResult {
  supported: boolean;
  backend: string;
  root?: AccessibilityTreeNode;
  nodeCount: number;
  truncated: boolean;
  redacted: boolean;
  reason: string;
}

export interface AccessibilityFindElementResult {
  supported: boolean;
  backend: string;
  candidates: AccessibilityElementCandidate[];
  reason: string;
}

export interface AccessibilityInspectElementResult {
  supported: boolean;
  backend: string;
  matched: boolean;
  ambiguous: boolean;
  redacted: boolean;
  reason: string;
  element?: AccessibilityElementDetails;
}

export interface AccessibilityInvokeActionResult {
  supported: boolean;
  backend: string;
  matched: boolean;
  ambiguous: boolean;
  performed: boolean;
  redacted: boolean;
  actionName?: string;
  reason: string;
  target?: AccessibilityElementDetails;
}

export interface AccessibilitySetValueResult {
  supported: boolean;
  backend: string;
  matched: boolean;
  ambiguous: boolean;
  changed: boolean;
  redacted: boolean;
  redactedValue: boolean;
  reason: string;
  target?: AccessibilityElementDetails;
}

export interface AccessibilityFocusElementResult {
  supported: boolean;
  backend: string;
  matched: boolean;
  ambiguous: boolean;
  focused: boolean;
  redacted: boolean;
  reason: string;
  target?: AccessibilityElementDetails;
}

export type PreviewTargetKind =
  | "accessibility_element"
  | "desktop_window"
  | "shell_command"
  | "file_path"
  | "app"
  | "browser";

export interface ActionPreviewTarget {
  kind: PreviewTargetKind;
  summary: string;
  appName?: string;
  windowId?: string;
  pid?: number;
  title?: string;
  elementId?: string;
  role?: string;
  name?: string;
  availableActions?: string[];
  path?: string;
  command?: string;
}

export interface ActionPreviewAlternative {
  strategy: AutomationStrategy;
  tool?: string;
  reason: string;
}

export interface ActionPreviewResult {
  preview: true;
  wouldExecute: boolean;
  wouldRequireApproval: boolean;
  wouldBeBlocked: boolean;
  riskLevel: RiskLevel;
  appSensitivity?: AppSensitivity;
  dataSensitivity?: DataSensitivity;
  targetSummary: string;
  target?: ActionPreviewTarget;
  ambiguous: boolean;
  reasons: string[];
  matchedRules: string[];
  saferAlternative?: ActionPreviewAlternative;
  supported?: boolean;
  backend?: string;
  confirmationAvailable?: boolean;
  confirmationRequired?: boolean;
  confirmationToken?: string;
  tokenId?: string;
  expiresAt?: string;
  inputFingerprint?: string;
  targetFingerprint?: string;
  confirmationExplanation?: string;
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

export interface PolicyProfileSummary {
  name: PolicyProfileName;
  description: string;
  enabled: boolean;
  defaults: PermissionDefaults;
  requireDryRunForStateChanging: boolean;
  requireConfirmationForStateChanging: boolean;
  requireExactTargetForStateChanging: boolean;
}

export interface GrantSummary {
  id: string;
  scope: GrantScope;
  effect: GrantEffect;
  description?: string;
  createdAt?: string;
  expiresAt?: string;
  active: boolean;
  match: CapabilityGrantMatch;
  requirements?: CapabilityGrantRequirements;
}

export interface PolicyGetProfileResult {
  activeProfile: PolicyProfileSummary;
}

export interface PolicyListProfilesResult {
  profiles: PolicyProfileSummary[];
}

export interface PolicyListGrantsResult {
  profile: PolicyProfileName;
  grants: GrantSummary[];
}

export interface PolicyExplainDecisionResult {
  profile: PolicyProfileName;
  input: SafetyInput;
  decision: SafetyDecision;
}

export interface ToolForgeRequirements {
  requiresDryRun?: boolean | undefined;
  requiresConfirmationToken?: boolean | undefined;
  requiresApproval?: boolean | undefined;
}

export interface ToolForgeToolDeclaration {
  name: string;
  description: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  riskLevel: RiskLevel;
  actionType: ActionType;
  strategy?: AutomationStrategy | undefined;
}

export interface ToolForgePermissionRequest {
  id: string;
  description?: string | undefined;
  generatedToolId?: string | undefined;
  tools?: string[] | undefined;
  strategies?: AutomationStrategy[] | undefined;
  actionTypes?: ActionType[] | undefined;
  appNames?: string[] | undefined;
  appSensitivities?: AppSensitivity[] | undefined;
  fileRoots?: string[] | undefined;
  commandAllowlist?: string[] | undefined;
  networkDomains?: string[] | undefined;
  oauthScopes?: string[] | undefined;
  dataSensitivity?: DataSensitivity | undefined;
  canReadPrivateData?: boolean | undefined;
  canWriteFiles?: boolean | undefined;
  canRunShell?: boolean | undefined;
  canUseGui?: boolean | undefined;
  canSendMessages?: boolean | undefined;
  canDeleteData?: boolean | undefined;
  canUploadFiles?: boolean | undefined;
  requiresDryRun?: boolean | undefined;
  requiresConfirmationToken?: boolean | undefined;
  requiresApproval?: boolean | undefined;
}

export const TOOL_FORGE_RUNTIME_CAPABILITIES = [
  "pure_compute", "read_runtime_input", "write_runtime_output", "use_manifest_metadata", "use_registration_metadata",
  "read_sandbox_file", "write_sandbox_file", "list_sandbox_files",
  "read_user_file", "write_user_file", "network_fetch", "shell_command", "gui_action", "private_data_read", "communication_send"
] as const;
export type ToolForgeRuntimeCapability = (typeof TOOL_FORGE_RUNTIME_CAPABILITIES)[number];

export const TOOL_FORGE_RUNTIME_OPERATIONS = [
  "const", "input", "object", "array", "concat", "length", "get", "equals", "if", "join", "sum", "map", "filter", "var", "manifest", "registration"
] as const;
export type ToolForgeRuntimeOperation = (typeof TOOL_FORGE_RUNTIME_OPERATIONS)[number];

export interface ToolForgeRuntimePermissionRequest {
  id: string;
  toolNames: string[];
  capabilities: ToolForgeRuntimeCapability[];
  allowedOperations: ToolForgeRuntimeOperation[];
  maxInputBytes?: number;
  maxOutputBytes?: number;
  maxRuntimeMs?: number;
  sandboxRoots?: Array<"run" | "temp">;
  outputRoots?: Array<"run">;
  requiresDryRun?: boolean;
  requiresConfirmationToken?: boolean;
  requiresApproval?: boolean;
}

export interface ToolForgeManifest {
  schemaVersion: "agenthost.forge.v1";
  id: string;
  displayName: string;
  version: string;
  description: string;
  kind: ToolForgeManifestKind;
  source: ToolForgeManifestSource;
  tools: ToolForgeToolDeclaration[];
  requestedPermissions: ToolForgePermissionRequest[];
  runtimePermissions?: ToolForgeRuntimePermissionRequest[];
  riskDeclaration: RiskLevel;
  dataSensitivityDeclaration: DataSensitivity;
  requirements: ToolForgeRequirements;
}

export interface ToolForgeValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface ToolForgeValidationResult {
  valid: boolean;
  manifest?: ToolForgeManifest;
  errors: ToolForgeValidationIssue[];
  warnings: ToolForgeValidationIssue[];
  dangerousPermissions: string[];
  blockedPermissions: string[];
}

export interface ToolForgePermissionReview {
  permissionId: string;
  summary: string;
  riskLevel: RiskLevel;
  dangerous: boolean;
  blocked: boolean;
  matchedGrantIds: string[];
  missingGrant: boolean;
  reasons: string[];
  proposedGrant?: CapabilityGrant;
}

export interface ToolForgeReviewResult {
  valid: boolean;
  manifestId?: string;
  displayName?: string;
  kind?: ToolForgeManifestKind;
  riskLevel: RiskLevel;
  dataSensitivity: DataSensitivity;
  requestedCapabilities: ToolForgePermissionReview[];
  dangerousPermissions: string[];
  missingGrants: string[];
  matchedGrantIds: string[];
  sessionApprovalPossible: boolean;
  persistentApprovalAllowed: boolean;
  blockedReasons: string[];
  warnings: string[];
  saferAlternatives: string[];
}

export interface ToolForgeGrantProposal {
  grant: CapabilityGrant;
  permissionId: string;
  reasons: string[];
}

export interface ToolForgeGrantProposalResult {
  manifestId: string;
  proposals: ToolForgeGrantProposal[];
  warnings: string[];
}

export const TOOL_FORGE_REVIEW_DECISION_STATUSES = [
  "pending",
  "approved_for_session",
  "approved_persistent",
  "denied",
  "expired"
] as const;
export type ToolForgeReviewDecisionStatus = (typeof TOOL_FORGE_REVIEW_DECISION_STATUSES)[number];

export const TOOL_FORGE_ARTIFACT_STATUSES = [
  "draft",
  "validated",
  "scaffolded",
  "validation_pending",
  "reviewed",
  "grant_pending",
  "approved_inert",
  "rejected",
  "archived"
] as const;
export type ToolForgeArtifactStatus = (typeof TOOL_FORGE_ARTIFACT_STATUSES)[number];

export const TOOL_FORGE_VALIDATION_STATUSES = ["passed", "failed", "warnings"] as const;
export type ToolForgeValidationStatus = (typeof TOOL_FORGE_VALIDATION_STATUSES)[number];

export const TOOL_FORGE_HARNESS_MODES = ["static-plus", "contract"] as const;
export type ToolForgeHarnessMode = (typeof TOOL_FORGE_HARNESS_MODES)[number];

export const TOOL_FORGE_HARNESS_STATUSES = ["passed", "failed", "skipped", "blocked"] as const;
export type ToolForgeHarnessStatus = (typeof TOOL_FORGE_HARNESS_STATUSES)[number];

export const TOOL_FORGE_REGISTRATION_STATUSES = [
  "pending",
  "registered_inert",
  "rejected",
  "revoked",
  "expired"
] as const;
export type ToolForgeRegistrationStatus = (typeof TOOL_FORGE_REGISTRATION_STATUSES)[number];

export const TOOL_FORGE_RUNTIME_MODES = ["stub", "subprocess"] as const;
export type ToolForgeRuntimeMode = (typeof TOOL_FORGE_RUNTIME_MODES)[number];

export const TOOL_FORGE_RUNTIME_STATUSES = ["passed", "failed", "blocked", "timeout", "completed", "timed_out"] as const;
export type ToolForgeRuntimeStatus = (typeof TOOL_FORGE_RUNTIME_STATUSES)[number];

export interface ToolForgeArtifactRecord {
  artifactId: string;
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  kind: ToolForgeManifestKind;
  source: ToolForgeManifestSource;
  storagePath: string;
  projectPath?: string;
  status: ToolForgeArtifactStatus;
  executable: false;
  registered: false;
  createdAt: string;
  updatedAt: string;
}

export interface ToolForgeReviewRecord {
  reviewId: string;
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  timestamp: string;
  profile: PolicyProfileName;
  riskLevel: RiskLevel;
  dataSensitivity: DataSensitivity;
  dangerousPermissions: string[];
  blockedPermissions: string[];
  missingGrants: string[];
  proposedGrants: CapabilityGrant[];
  decisionStatus: ToolForgeReviewDecisionStatus;
  explanation: string;
  saferAlternatives: string[];
  review: ToolForgeReviewResult;
}

export interface ToolForgeManifestSummary {
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  kind: ToolForgeManifestKind;
  source: ToolForgeManifestSource;
  status: ToolForgeArtifactStatus;
  executable: false;
  registered: false;
  createdAt: string;
  updatedAt: string;
}

export interface ToolForgeReviewSummary {
  reviewId: string;
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  timestamp: string;
  profile: PolicyProfileName;
  riskLevel: RiskLevel;
  decisionStatus: ToolForgeReviewDecisionStatus;
}

export interface ToolForgeProjectFilePlanEntry {
  path: string;
  kind: "file" | "directory";
  description: string;
  bytes?: number;
}

export interface ToolForgeScaffoldProjectResult {
  artifact: ToolForgeArtifactRecord;
  manifestHash: string;
  projectPath: string;
  reviewId?: string;
  files: ToolForgeProjectFilePlanEntry[];
  overwritten: boolean;
}

export interface ToolForgeValidationCheck {
  id: string;
  level: "info" | "warning" | "error";
  message: string;
  path?: string;
}

export interface ToolForgeValidationRecord {
  validationId: string;
  artifactId: string;
  manifestId: string;
  manifestHash: string;
  projectPath: string;
  status: ToolForgeValidationStatus;
  checks: ToolForgeValidationCheck[];
  createdAt: string;
  summary: string;
  safeToConsiderRegistration: boolean;
}

export interface ToolForgeValidateProjectResult {
  artifact?: ToolForgeArtifactRecord;
  validation: ToolForgeValidationRecord;
}

export interface ToolForgeArtifactSummary {
  artifactId: string;
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  kind: ToolForgeManifestKind;
  source: ToolForgeManifestSource;
  storagePath: string;
  projectPath?: string;
  status: ToolForgeArtifactStatus;
  executable: false;
  registered: false;
  createdAt: string;
  updatedAt: string;
}

export interface ToolForgeGetArtifactResult {
  artifact: ToolForgeArtifactRecord;
}

export interface ToolForgeListArtifactsResult {
  artifacts: ToolForgeArtifactSummary[];
}

export interface ToolForgeValidationSummary {
  validationId: string;
  artifactId: string;
  manifestId: string;
  manifestHash: string;
  projectPath: string;
  status: ToolForgeValidationStatus;
  createdAt: string;
  summary: string;
  safeToConsiderRegistration: boolean;
}

export interface ToolForgeGetValidationResult {
  validation: ToolForgeValidationRecord;
}

export interface ToolForgeListValidationsResult {
  validations: ToolForgeValidationSummary[];
}

export interface ToolForgeHarnessRunRecord {
  harnessRunId: string;
  artifactId: string;
  manifestId: string;
  manifestHash: string;
  projectPath: string;
  mode: ToolForgeHarnessMode;
  status: ToolForgeHarnessStatus;
  checks: ToolForgeValidationCheck[];
  stdoutSummary: string;
  stderrSummary: string;
  durationMs: number;
  safeToConsiderRegistration: boolean;
  createdAt: string;
}

export interface ToolForgeRunValidationHarnessResult {
  artifact: ToolForgeArtifactRecord;
  validation: ToolForgeValidationRecord;
  harnessRun: ToolForgeHarnessRunRecord;
}

export interface ToolForgeHarnessRunSummary {
  harnessRunId: string;
  artifactId: string;
  manifestId: string;
  manifestHash: string;
  projectPath: string;
  mode: ToolForgeHarnessMode;
  status: ToolForgeHarnessStatus;
  durationMs: number;
  safeToConsiderRegistration: boolean;
  createdAt: string;
}

export interface ToolForgeGetHarnessRunResult {
  harnessRun: ToolForgeHarnessRunRecord;
}

export interface ToolForgeListHarnessRunsResult {
  harnessRuns: ToolForgeHarnessRunSummary[];
}

export interface ToolForgeRegistrationEligibilityResult {
  eligible: boolean;
  active: boolean;
  artifactId: string;
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  registeredTools: ToolForgeToolDeclaration[];
  requiredGrantIds: string[];
  activeGrantIds: string[];
  missingRequirements: string[];
  reasons: string[];
  reviewId?: string;
  validationIds: string[];
  harnessRunIds: string[];
}

export interface ToolForgeRegistrationRecord {
  registrationId: string;
  artifactId: string;
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  registeredAt: string;
  status: ToolForgeRegistrationStatus;
  registeredTools: ToolForgeToolDeclaration[];
  permissionsSnapshot: ToolForgePermissionRequest[];
  grantsSnapshot: GrantSummary[];
  reviewId?: string;
  validationIds: string[];
  harnessRunIds: string[];
  executable: false;
  live: false;
  explanation: string;
  expiresAt?: string;
}

export interface ToolForgeRegistrationSummary {
  registrationId: string;
  artifactId: string;
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  registeredAt: string;
  status: ToolForgeRegistrationStatus;
  executable: false;
  live: false;
  expiresAt?: string;
}

export interface ToolForgeRegisterArtifactResult {
  eligibility: ToolForgeRegistrationEligibilityResult;
  registration: ToolForgeRegistrationRecord;
}

export interface ToolForgeGetRegistrationResult {
  registration: ToolForgeRegistrationRecord;
}

export interface ToolForgeListRegistrationsResult {
  registrations: ToolForgeRegistrationSummary[];
}

export interface ToolForgeRevokeRegistrationResult {
  registration: ToolForgeRegistrationRecord;
}

export interface ToolForgeRuntimeSandboxPolicy {
  mode: ToolForgeRuntimeMode;
  childProcess: boolean;
  networkAllowed: false;
  filesystemRoots: string[];
  outputRoot?: string;
  shellAllowed: false;
  guiAllowed: false;
  envAllowlist: string[];
  envBlocked: string[];
  timeoutMs: number;
  stdoutBytesMax: number;
  stderrBytesMax: number;
}

export interface ToolForgeRuntimeEligibilityResult {
  eligible: boolean;
  active: boolean;
  registrationId: string;
  artifactId: string;
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  registrationStatus: ToolForgeRegistrationStatus;
  toolName: string;
  tool?: ToolForgeToolDeclaration;
  reviewId?: string;
  validationIds: string[];
  harnessRunIds: string[];
  requiredGrantIds: string[];
  activeGrantIds: string[];
  requestedPermissionIds: string[];
  blockedPermissionIds: string[];
  requestedRuntimeCapabilities: ToolForgeRuntimeCapability[];
  grantedRuntimeCapabilities: ToolForgeRuntimeCapability[];
  deniedRuntimeCapabilities: ToolForgeRuntimeCapability[];
  unsupportedRuntimeCapabilities: ToolForgeRuntimeCapability[];
  runtimeGrantIds: string[];
  requestedOperations: ToolForgeRuntimeOperation[];
  allowedOperations: ToolForgeRuntimeOperation[];
  blockedOperations: ToolForgeRuntimeOperation[];
  enforcedLimits: { maxInputBytes: number; maxOutputBytes: number; maxRuntimeMs: number };
  runtimeRequirements: { requiresDryRun: boolean; requiresConfirmationToken: boolean; requiresApproval: boolean };
  missingRequirements: string[];
  reasons: string[];
  sandbox: ToolForgeRuntimeSandboxPolicy;
}

export interface ToolForgeSandboxStubOutput {
  mode: ToolForgeRuntimeMode;
  generatedCodeExecuted: false;
  metadataOnly: true;
  tool: {
    name: string;
    description: string;
    riskLevel: RiskLevel;
    actionType: ActionType;
    strategy?: AutomationStrategy;
  };
  registration: {
    registrationId: string;
    status: ToolForgeRegistrationStatus;
    manifestHash: string;
  };
  manifest: {
    manifestId: string;
    manifestVersion: string;
    displayName: string;
    description: string;
  };
  sandbox: ToolForgeRuntimeSandboxPolicy;
}

export interface ToolForgeRuntimeRunRecord {
  runtimeRunId: string;
  registrationId: string;
  artifactId: string;
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  toolName: string;
  mode: ToolForgeRuntimeMode;
  status: ToolForgeRuntimeStatus;
  executedGeneratedCode: false;
  metadataOnly: boolean;
  runnerMode: "metadata_stub" | "subprocess";
  /** Backend selected around the fixed subprocess; never executes generated source code. */
  sandboxBackend?: "none" | "bubblewrap" | "firejail" | "unshare";
  sandboxLimitations?: string[];
  projectPath: string;
  outputRoot: string;
  inputFingerprint: string;
  summary: string;
  sandbox: ToolForgeRuntimeSandboxPolicy;
  durationMs: number;
  commandSummary?: string;
  cwd?: string;
  envKeys?: string[];
  timeoutMs?: number;
  outputSizeBytes?: number;
  resultSummary?: string;
  errorSummary?: string;
  runtimeCapabilitiesUsed?: ToolForgeRuntimeCapability[];
  enforcedLimits?: { maxInputBytes: number; maxOutputBytes: number; maxRuntimeMs: number };
  executableStillFalse: true;
  liveStillFalse: true;
  createdAt: string;
}

export interface ToolForgeRuntimeRunSummary {
  runtimeRunId: string;
  registrationId: string;
  artifactId: string;
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  toolName: string;
  mode: ToolForgeRuntimeMode;
  status: ToolForgeRuntimeStatus;
  executedGeneratedCode: false;
  metadataOnly: boolean;
  runnerMode: "metadata_stub" | "subprocess";
  createdAt: string;
}

export interface ToolForgeCheckRuntimeEligibilityResult {
  eligibility: ToolForgeRuntimeEligibilityResult;
}

export interface ToolForgeRunSandboxedToolResult {
  eligibility: ToolForgeRuntimeEligibilityResult;
  runtimeRun: ToolForgeRuntimeRunRecord;
  output: ToolForgeSandboxStubOutput | { mode: "subprocess"; generatedCodeExecuted: false; metadataOnly: false; result: unknown; sandbox: ToolForgeRuntimeSandboxPolicy };
}

/** Metadata for a generated tool that remains inert and non-callable as an MCP tool. */
export interface ToolForgeDispatchableTool {
  registrationId: string;
  artifactId: string;
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  toolName: string;
  description: string;
  inputSchema: unknown;
  riskLevel: RiskLevel;
  runtimeCapabilities: ToolForgeRuntimeCapability[];
  registrationStatus: ToolForgeRegistrationStatus;
  active: boolean;
  inactiveReasons: string[];
  notCallableAsMcpTool: true;
}

export interface ToolForgeListDispatchableToolsResult {
  tools: ToolForgeDispatchableTool[];
}

export interface ToolForgeGetDispatchableToolResult {
  tool: ToolForgeDispatchableTool;
}

export interface ToolForgeDispatchGeneratedToolResult extends ToolForgeRunSandboxedToolResult {
  dispatch: {
    registrationId: string;
    artifactId: string;
    manifestId: string;
    toolName: string;
    underlyingTool: "forge.run_sandboxed_tool";
    notCallableAsMcpTool: true;
  };
}

export interface ToolForgeGetRuntimeRunResult {
  runtimeRun: ToolForgeRuntimeRunRecord;
}

export interface ToolForgeListRuntimeRunsResult {
  runtimeRuns: ToolForgeRuntimeRunSummary[];
}

export interface ToolForgeSaveManifestResult {
  manifest: ToolForgeManifest;
  manifestHash: string;
  storagePath: string;
  artifact: ToolForgeArtifactRecord;
}

export interface ToolForgeGetManifestResult {
  manifest: ToolForgeManifest;
  manifestHash: string;
  storagePath: string;
  artifact: ToolForgeArtifactRecord;
}

export interface ToolForgeListManifestsResult {
  manifests: ToolForgeManifestSummary[];
}

export interface ToolForgeCreateReviewResult {
  review: ToolForgeReviewRecord;
}

export interface ToolForgeGetReviewResult {
  review: ToolForgeReviewRecord;
}

export interface ToolForgeListReviewsResult {
  reviews: ToolForgeReviewSummary[];
}

export interface ToolForgeArchiveManifestResult {
  artifact: ToolForgeArtifactRecord;
}

export interface ToolForgeApplySessionGrantsResult {
  reviewId: string;
  manifestId: string;
  manifestHash: string;
  appliedGrantIds: string[];
  grants: GrantSummary[];
}

export interface AuditLogEntry {
  timestamp: string;
  sessionId: string;
  profile: PolicyProfileName;
  tool: string;
  riskLevel: RiskLevel;
  strategy?: AutomationStrategy;
  preview?: boolean;
  confirmationStatus?: ConfirmationStatus;
  confirmationTokenId?: string;
  confirmationReason?: string;
  matchedGrantIds?: string[];
  deniedGrantIds?: string[];
  guideOnlyGrantIds?: string[];
  grantDecision?: GrantDecision;
  dryRunRequired?: boolean;
  confirmationRequiredByGrant?: boolean;
  approvalRequiredByGrant?: boolean;
  grantDenied?: boolean;
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
