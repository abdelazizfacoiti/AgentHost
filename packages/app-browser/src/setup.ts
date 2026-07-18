export const SUPPORTED_BROWSER_FAMILIES = ["firefox", "chromium"] as const;
export type SupportedBrowserFamily = typeof SUPPORTED_BROWSER_FAMILIES[number];

export const BROWSER_SETUP_STATES = [
  "detecting_browser",
  "browser_selected",
  "checking_extension",
  "extension_missing",
  "waiting_for_extension",
  "enrollment_created",
  "waiting_for_approval",
  "extension_connected",
  "pairing",
  "paired",
  "verifying_reconnect",
  "ready",
  "needs_repair",
  "blocked",
  "failed",
  "cancelled"
] as const;
export type BrowserSetupLifecycleState = typeof BROWSER_SETUP_STATES[number];

export const BROWSER_SETUP_FAILURE_CODES = [
  "browser_not_detected",
  "browser_unsupported",
  "browser_selection_required",
  "extension_artifact_missing",
  "extension_not_installed",
  "extension_disconnected",
  "enrollment_expired",
  "device_revoked",
  "stale_extension_secret",
  "runtime_ledger_missing",
  "extension_pairing_state_missing",
  "pairing_state_mismatch",
  "pairing_ledger_corrupted",
  "protocol_mismatch",
  "extension_version_mismatch",
  "runtime_version_mismatch",
  "bridge_unavailable",
  "bridge_port_conflict",
  "origin_rejected",
  "extension_identity_mismatch",
  "reconnect_timeout",
  "setup_cancelled",
  "setup_transition_invalid"
] as const;
export type BrowserSetupFailureCode = typeof BROWSER_SETUP_FAILURE_CODES[number];

export interface BrowserInventoryEntry {
  family: SupportedBrowserFamily;
  supported: true;
  installed: boolean;
  executableAvailable: boolean;
  executableName?: string;
  running: boolean;
  expectedExtensionId: string;
  extensionArtifactAvailable: boolean;
  extensionConnectionState:
    | "unknown"
    | "missing"
    | "disconnected"
    | "connected"
    | "incompatible";
  pairedDeviceState: "none" | "paired" | "revoked" | "unknown";
  protocolCompatible: boolean;
  runtimeCompatible: boolean;
  reconnectReady: boolean;
  lastHealthStatus: "healthy" | "degraded" | "unavailable" | "unknown";
  safeFailureCode?: BrowserSetupFailureCode;
  recommendedNextAction: string;
}

export interface BrowserInventory {
  schemaVersion: 1;
  browsers: BrowserInventoryEntry[];
  selectedBrowser?: SupportedBrowserFamily;
  selectionRequired: boolean;
  evaluatedAt: string;
  redacted: true;
}

export interface BrowserSetupRecord {
  schemaVersion: 1;
  setupId: string;
  ownerSessionId: string;
  browserFamily: SupportedBrowserFamily;
  state: BrowserSetupLifecycleState;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  retryCount: number;
  reconnectVerified: boolean;
  enrollmentId?: string;
  approvalFingerprint?: string;
  pairedConnectionId?: string;
  extensionIdentitySuffix?: string;
  safeFailureCode?: BrowserSetupFailureCode;
  recommendedNextAction: string;
  redacted: true;
}

export interface BrowserSetupRecovery {
  code: BrowserSetupFailureCode;
  explanation: string;
  action: string;
  retryAllowed: boolean;
  resetRequired: boolean;
  browserApprovalRequired: boolean;
  externalPublishingRequired: boolean;
}

const TRANSITIONS: Record<BrowserSetupLifecycleState, BrowserSetupLifecycleState[]> = {
  detecting_browser: ["browser_selected", "blocked", "failed", "cancelled"],
  browser_selected: ["checking_extension", "blocked", "failed", "cancelled"],
  checking_extension: ["extension_missing", "enrollment_created", "waiting_for_extension", "extension_connected", "blocked", "failed", "cancelled"],
  extension_missing: ["checking_extension", "waiting_for_extension", "blocked", "cancelled"],
  waiting_for_extension: ["enrollment_created", "waiting_for_approval", "extension_connected", "needs_repair", "failed", "cancelled"],
  enrollment_created: ["waiting_for_extension", "waiting_for_approval", "extension_connected", "failed", "cancelled"],
  waiting_for_approval: ["extension_connected", "pairing", "failed", "cancelled"],
  extension_connected: ["pairing", "paired", "failed", "cancelled"],
  pairing: ["paired", "needs_repair", "failed", "cancelled"],
  paired: ["verifying_reconnect", "ready", "needs_repair", "failed", "cancelled"],
  verifying_reconnect: ["ready", "needs_repair", "failed", "cancelled"],
  ready: ["needs_repair", "cancelled"],
  needs_repair: ["checking_extension", "waiting_for_extension", "blocked", "failed", "cancelled"],
  blocked: [],
  failed: [],
  cancelled: []
};

const RECOVERY: Record<BrowserSetupFailureCode, Omit<BrowserSetupRecovery, "code">> = {
  browser_not_detected: { explanation: "No supported browser executable was detected.", action: "Install a supported Firefox or Chromium browser, then rerun browser setup.", retryAllowed: true, resetRequired: false, browserApprovalRequired: false, externalPublishingRequired: false },
  browser_unsupported: { explanation: "Detected browser is outside current support.", action: "Choose a detected Firefox or Chromium browser.", retryAllowed: true, resetRequired: false, browserApprovalRequired: false, externalPublishingRequired: false },
  browser_selection_required: { explanation: "Multiple supported browsers are available.", action: "Select firefox or chromium explicitly.", retryAllowed: true, resetRequired: false, browserApprovalRequired: false, externalPublishingRequired: false },
  extension_artifact_missing: { explanation: "Prepared extension artifact is missing.", action: "Run browser extension preparation for selected browser.", retryAllowed: true, resetRequired: false, browserApprovalRequired: false, externalPublishingRequired: false },
  extension_not_installed: { explanation: "Extension has not contacted local bridge.", action: "Load approved extension artifact through browser extension UI.", retryAllowed: true, resetRequired: false, browserApprovalRequired: true, externalPublishingRequired: false },
  extension_disconnected: { explanation: "Paired extension is not connected.", action: "Open extension popup and retry local reconnect.", retryAllowed: true, resetRequired: false, browserApprovalRequired: false, externalPublishingRequired: false },
  enrollment_expired: { explanation: "Short-lived enrollment session expired.", action: "Start a fresh browser setup enrollment.", retryAllowed: true, resetRequired: false, browserApprovalRequired: true, externalPublishingRequired: false },
  device_revoked: { explanation: "Browser device was revoked.", action: "Start a fresh enrollment and approve new device.", retryAllowed: true, resetRequired: false, browserApprovalRequired: true, externalPublishingRequired: false },
  stale_extension_secret: { explanation: "Stored browser reconnect credential is stale.", action: "Clear extension pairing state, then enroll again.", retryAllowed: true, resetRequired: true, browserApprovalRequired: true, externalPublishingRequired: false },
  runtime_ledger_missing: { explanation: "Runtime has no matching paired-device ledger.", action: "Create fresh enrollment; do not reuse extension credential.", retryAllowed: true, resetRequired: false, browserApprovalRequired: true, externalPublishingRequired: false },
  extension_pairing_state_missing: { explanation: "Runtime has pairing but extension state is missing.", action: "Use extension popup to request repair enrollment.", retryAllowed: true, resetRequired: false, browserApprovalRequired: true, externalPublishingRequired: false },
  pairing_state_mismatch: { explanation: "Runtime and extension pairing states disagree.", action: "Review both states, then approve a targeted repair.", retryAllowed: true, resetRequired: true, browserApprovalRequired: true, externalPublishingRequired: false },
  pairing_ledger_corrupted: { explanation: "Runtime pairing ledger failed validation.", action: "Back up corrupt ledger, then explicitly reset pairing.", retryAllowed: false, resetRequired: true, browserApprovalRequired: true, externalPublishingRequired: false },
  protocol_mismatch: { explanation: "Bridge protocol versions are incompatible.", action: "Update AgentHost or extension to matching protocol.", retryAllowed: false, resetRequired: false, browserApprovalRequired: false, externalPublishingRequired: false },
  extension_version_mismatch: { explanation: "Extension version is incompatible.", action: "Install compatible extension artifact.", retryAllowed: false, resetRequired: false, browserApprovalRequired: true, externalPublishingRequired: false },
  runtime_version_mismatch: { explanation: "AgentHost runtime version is incompatible.", action: "Update or roll back AgentHost to compatible version.", retryAllowed: false, resetRequired: false, browserApprovalRequired: false, externalPublishingRequired: false },
  bridge_unavailable: { explanation: "Local Browser Bridge is unavailable.", action: "Enable bridge and restart AgentHost.", retryAllowed: true, resetRequired: false, browserApprovalRequired: false, externalPublishingRequired: false },
  bridge_port_conflict: { explanation: "Configured loopback port is already in use.", action: "Stop conflicting process or choose one approved unused loopback port.", retryAllowed: true, resetRequired: false, browserApprovalRequired: false, externalPublishingRequired: false },
  origin_rejected: { explanation: "Extension origin failed exact validation.", action: "Use approved extension build for selected browser.", retryAllowed: false, resetRequired: false, browserApprovalRequired: true, externalPublishingRequired: false },
  extension_identity_mismatch: { explanation: "Extension identity differs from approved artifact.", action: "Remove mismatched build and load approved artifact.", retryAllowed: false, resetRequired: false, browserApprovalRequired: true, externalPublishingRequired: false },
  reconnect_timeout: { explanation: "Paired extension did not reconnect within bounded wait.", action: "Open extension popup and retry; repair only if state remains stale.", retryAllowed: true, resetRequired: false, browserApprovalRequired: false, externalPublishingRequired: false },
  setup_cancelled: { explanation: "Operator cancelled browser setup.", action: "Restart setup when ready.", retryAllowed: true, resetRequired: false, browserApprovalRequired: false, externalPublishingRequired: false },
  setup_transition_invalid: { explanation: "Setup state transition was invalid.", action: "Inspect setup status and start a fresh setup if terminal.", retryAllowed: false, resetRequired: false, browserApprovalRequired: false, externalPublishingRequired: false }
};

export function canTransitionBrowserSetup(
  from: BrowserSetupLifecycleState,
  to: BrowserSetupLifecycleState
): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export function browserSetupRecovery(code: BrowserSetupFailureCode): BrowserSetupRecovery {
  return { code, ...RECOVERY[code] };
}

export function selectBrowserFromInventory(
  browsers: BrowserInventoryEntry[],
  requested?: SupportedBrowserFamily
): { selected?: SupportedBrowserFamily; failureCode?: BrowserSetupFailureCode } {
  const installed = browsers.filter((item) => item.installed && item.executableAvailable && item.supported);
  if (requested !== undefined) {
    return installed.some((item) => item.family === requested)
      ? { selected: requested }
      : { failureCode: "browser_not_detected" };
  }
  if (installed.length === 0) return { failureCode: "browser_not_detected" };
  if (installed.length > 1) return { failureCode: "browser_selection_required" };
  return { selected: installed[0]!.family };
}
