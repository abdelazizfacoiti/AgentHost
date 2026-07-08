import type { CapabilityGrant, PermissionDefaults, PolicyProfile, PolicyProfileName } from "./types.js";

const STRICT_DEFAULTS: PermissionDefaults = {
  shell: "deny",
  fileRead: "allow",
  fileWrite: "approval_required",
  appOpen: "approval_required",
  screenshots: "approval_required",
  windowFocus: "deny",
  accessibilityRead: "allow",
  accessibilityActions: "approval_required",
  guiClick: "deny",
  guiType: "deny",
  guiHotkey: "deny",
  browserAutomation: "deny",
  communicationActions: "deny",
  privateDataReads: "deny",
  externalSendsUploads: "deny",
  destructiveActions: "deny",
  generatedTools: "deny"
};

const DEV_DEFAULTS: PermissionDefaults = {
  shell: "allow",
  fileRead: "allow",
  fileWrite: "allow",
  appOpen: "allow",
  screenshots: "allow",
  windowFocus: "deny",
  accessibilityRead: "allow",
  accessibilityActions: "allow",
  guiClick: "deny",
  guiType: "deny",
  guiHotkey: "deny",
  browserAutomation: "deny",
  communicationActions: "deny",
  privateDataReads: "deny",
  externalSendsUploads: "deny",
  destructiveActions: "deny",
  generatedTools: "deny"
};

const GUI_DEV_DEFAULTS: PermissionDefaults = {
  ...DEV_DEFAULTS,
  windowFocus: "allow",
  accessibilityActions: "allow",
  guiClick: "allow",
  guiType: "allow",
  guiHotkey: "allow"
};

const PRIVATE_DATA_DEFAULTS: PermissionDefaults = {
  ...STRICT_DEFAULTS,
  fileRead: "approval_required",
  accessibilityRead: "approval_required",
  privateDataReads: "deny"
};

const AUTOPILOT_DEFAULTS: PermissionDefaults = {
  shell: "deny",
  fileRead: "deny",
  fileWrite: "deny",
  appOpen: "deny",
  screenshots: "deny",
  windowFocus: "deny",
  accessibilityRead: "deny",
  accessibilityActions: "deny",
  guiClick: "deny",
  guiType: "deny",
  guiHotkey: "deny",
  browserAutomation: "deny",
  communicationActions: "deny",
  privateDataReads: "deny",
  externalSendsUploads: "deny",
  destructiveActions: "deny",
  generatedTools: "deny"
};

function cloneDefaults(defaults: PermissionDefaults): PermissionDefaults {
  return { ...defaults };
}

function cloneGrants(grants: CapabilityGrant[]): CapabilityGrant[] {
  return grants.map((grant) => ({
    ...grant,
    match: {
      ...grant.match,
      ...(grant.match.tools === undefined ? {} : { tools: [...grant.match.tools] }),
      ...(grant.match.strategies === undefined ? {} : { strategies: [...grant.match.strategies] }),
      ...(grant.match.actionTypes === undefined ? {} : { actionTypes: [...grant.match.actionTypes] }),
      ...(grant.match.appNames === undefined ? {} : { appNames: [...grant.match.appNames] }),
      ...(grant.match.appIds === undefined ? {} : { appIds: [...grant.match.appIds] }),
      ...(grant.match.appSensitivities === undefined ? {} : { appSensitivities: [...grant.match.appSensitivities] }),
      ...(grant.match.dataSensitivities === undefined ? {} : { dataSensitivities: [...grant.match.dataSensitivities] }),
      ...(grant.match.fileRoots === undefined ? {} : { fileRoots: [...grant.match.fileRoots] }),
      ...(grant.match.commandAllowlist === undefined
        ? {}
        : { commandAllowlist: [...grant.match.commandAllowlist] }),
      ...(grant.match.networkDomains === undefined ? {} : { networkDomains: [...grant.match.networkDomains] }),
      ...(grant.match.oauthScopes === undefined ? {} : { oauthScopes: [...grant.match.oauthScopes] }),
      ...(grant.match.generatedToolIds === undefined
        ? {}
        : { generatedToolIds: [...grant.match.generatedToolIds] })
    },
    ...(grant.requirements === undefined
      ? {}
      : {
          requirements: {
            ...grant.requirements,
            ...(grant.requirements.allowedRoots === undefined
              ? {}
              : { allowedRoots: [...grant.requirements.allowedRoots] })
          }
        })
  }));
}

export const STRICT_POLICY_PROFILE: PolicyProfile = {
  name: "strict",
  description: "Conservative local profile for normal users.",
  enabled: true,
  allowScreenshots: true,
  allowAppLaunch: true,
  allowShell: false,
  allowFileWriteRoots: ["~/.agenthost"],
  allowGenericClick: false,
  allowGenericType: false,
  allowEmailSend: false,
  allowUploads: false,
  requireApprovalForMediumRisk: true,
  blockHighRiskByDefault: true,
  requireDryRunForStateChanging: true,
  requireConfirmationForStateChanging: true,
  requireExactTargetForStateChanging: true,
  defaults: STRICT_DEFAULTS,
  grants: []
};

export const DEV_POLICY_PROFILE: PolicyProfile = {
  name: "dev",
  description: "Development profile for safe local experimentation.",
  enabled: true,
  allowScreenshots: true,
  allowAppLaunch: true,
  allowShell: true,
  allowFileWriteRoots: ["~/.agenthost", "~/Desktop/agenthost-output"],
  allowGenericClick: false,
  allowGenericType: false,
  allowEmailSend: false,
  allowUploads: false,
  requireApprovalForMediumRisk: false,
  blockHighRiskByDefault: true,
  requireDryRunForStateChanging: true,
  requireConfirmationForStateChanging: true,
  requireExactTargetForStateChanging: true,
  defaults: DEV_DEFAULTS,
  grants: []
};

export const GUI_DEV_POLICY_PROFILE: PolicyProfile = {
  name: "gui-dev",
  description: "Development profile for GUI testing with dry-run and confirmation safeguards.",
  enabled: true,
  allowScreenshots: true,
  allowAppLaunch: true,
  allowShell: true,
  allowFileWriteRoots: ["~/.agenthost", "~/Desktop/agenthost-output"],
  allowGenericClick: true,
  allowGenericType: true,
  allowEmailSend: false,
  allowUploads: false,
  requireApprovalForMediumRisk: false,
  blockHighRiskByDefault: true,
  requireDryRunForStateChanging: true,
  requireConfirmationForStateChanging: true,
  requireExactTargetForStateChanging: true,
  defaults: GUI_DEV_DEFAULTS,
  grants: []
};

export const PRIVATE_DATA_POLICY_PROFILE: PolicyProfile = {
  name: "private-data",
  description: "Restricted profile for private-data inspection with explicit grants.",
  enabled: true,
  allowScreenshots: true,
  allowAppLaunch: true,
  allowShell: false,
  allowFileWriteRoots: ["~/.agenthost"],
  allowGenericClick: false,
  allowGenericType: false,
  allowEmailSend: false,
  allowUploads: false,
  requireApprovalForMediumRisk: true,
  blockHighRiskByDefault: true,
  requireDryRunForStateChanging: true,
  requireConfirmationForStateChanging: true,
  requireExactTargetForStateChanging: true,
  defaults: PRIVATE_DATA_DEFAULTS,
  grants: []
};

export const AUTOPILOT_FUTURE_DISABLED_POLICY_PROFILE: PolicyProfile = {
  name: "autopilot-future-disabled-by-default",
  description: "Reserved future profile. Listed for planning, but disabled for real execution.",
  enabled: false,
  allowScreenshots: false,
  allowAppLaunch: false,
  allowShell: false,
  allowFileWriteRoots: ["~/.agenthost"],
  allowGenericClick: false,
  allowGenericType: false,
  allowEmailSend: false,
  allowUploads: false,
  requireApprovalForMediumRisk: true,
  blockHighRiskByDefault: true,
  requireDryRunForStateChanging: true,
  requireConfirmationForStateChanging: true,
  requireExactTargetForStateChanging: true,
  defaults: AUTOPILOT_DEFAULTS,
  grants: []
};

function clonePolicyProfile(profile: PolicyProfile, grants: CapabilityGrant[] = []): PolicyProfile {
  return {
    ...profile,
    allowFileWriteRoots: [...profile.allowFileWriteRoots],
    defaults: cloneDefaults(profile.defaults),
    grants: cloneGrants(grants)
  };
}

export function getPolicyProfile(name: PolicyProfileName, options: { grants?: CapabilityGrant[] } = {}): PolicyProfile {
  const grants = options.grants ?? [];

  switch (name) {
    case "strict":
      return clonePolicyProfile(STRICT_POLICY_PROFILE, grants);
    case "dev":
      return clonePolicyProfile(DEV_POLICY_PROFILE, grants);
    case "gui-dev":
      return clonePolicyProfile(GUI_DEV_POLICY_PROFILE, grants);
    case "private-data":
      return clonePolicyProfile(PRIVATE_DATA_POLICY_PROFILE, grants);
    case "autopilot-future-disabled-by-default":
      return clonePolicyProfile(AUTOPILOT_FUTURE_DISABLED_POLICY_PROFILE, grants);
  }
}

export function listPolicyProfiles(): PolicyProfile[] {
  return [
    getPolicyProfile("strict"),
    getPolicyProfile("dev"),
    getPolicyProfile("gui-dev"),
    getPolicyProfile("private-data"),
    getPolicyProfile("autopilot-future-disabled-by-default")
  ];
}
