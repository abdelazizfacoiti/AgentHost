import type { CapabilityGrant, PermissionDefaults, RuntimePolicy } from "./types.js";

const DEFAULT_PERMISSIONS: PermissionDefaults = {
  shell: "allow",
  fileRead: "allow",
  fileWrite: "allow",
  appOpen: "allow",
  screenshots: "allow",
  windowFocus: "allow",
  accessibilityRead: "allow",
  accessibilityActions: "allow",
  guiClick: "allow",
  guiType: "allow",
  guiHotkey: "allow",
  browserAutomation: "allow",
  communicationActions: "approval_required",
  privateDataReads: "approval_required",
  externalSendsUploads: "approval_required",
  destructiveActions: "approval_required",
  generatedTools: "deny"
};

export const DEFAULT_POLICY: RuntimePolicy = {
  description: "Autonomous local policy. Routine local actions execute directly; external, destructive, and private-data effects require exact confirmation.",
  enabled: true,
  allowScreenshots: true,
  allowAppLaunch: true,
  allowShell: true,
  allowFileWriteRoots: ["~", "/tmp"],
  allowGenericClick: true,
  allowGenericType: true,
  allowEmailSend: true,
  allowUploads: true,
  requireApprovalForMediumRisk: false,
  blockHighRiskByDefault: false,
  requireDryRunForStateChanging: false,
  requireConfirmationForStateChanging: false,
  requireExactTargetForStateChanging: false,
  defaults: DEFAULT_PERMISSIONS,
  grants: [{
    id: "default.communication-read",
    scope: "persistent",
    effect: "allow",
    description: "Read/inspect communication apps. Sends and external effects still require exact confirmation.",
    match: {
      actionTypes: ["observe", "inspect", "file_read"],
      appSensitivities: ["communication"]
    },
    requirements: { maxRiskLevel: "medium" }
  }]
};

function cloneGrants(grants: CapabilityGrant[]): CapabilityGrant[] {
  return structuredClone(grants);
}

export function getDefaultPolicy(options: { grants?: CapabilityGrant[] } = {}): RuntimePolicy {
  return {
    ...DEFAULT_POLICY,
    allowFileWriteRoots: [...DEFAULT_POLICY.allowFileWriteRoots],
    defaults: { ...DEFAULT_POLICY.defaults },
    grants: cloneGrants([...DEFAULT_POLICY.grants, ...(options.grants ?? [])])
  };
}
