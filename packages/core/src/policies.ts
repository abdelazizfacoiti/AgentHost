import type { PolicyProfile, PolicyProfileName } from "./types.js";

export const STRICT_POLICY_PROFILE: PolicyProfile = {
  name: "strict",
  allowScreenshots: true,
  allowAppLaunch: true,
  allowShell: false,
  allowFileWriteRoots: ["~/.agenthost"],
  allowGenericClick: false,
  allowGenericType: false,
  allowEmailSend: false,
  allowUploads: false,
  requireApprovalForMediumRisk: true,
  blockHighRiskByDefault: true
};

export const DEV_POLICY_PROFILE: PolicyProfile = {
  name: "dev",
  allowScreenshots: true,
  allowAppLaunch: true,
  allowShell: true,
  allowFileWriteRoots: ["~/.agenthost", "~/Desktop/agenthost-output"],
  allowGenericClick: false,
  allowGenericType: false,
  allowEmailSend: false,
  allowUploads: false,
  requireApprovalForMediumRisk: false,
  blockHighRiskByDefault: true
};

export function getPolicyProfile(name: PolicyProfileName): PolicyProfile {
  switch (name) {
    case "strict":
      return { ...STRICT_POLICY_PROFILE, allowFileWriteRoots: [...STRICT_POLICY_PROFILE.allowFileWriteRoots] };
    case "dev":
      return { ...DEV_POLICY_PROFILE, allowFileWriteRoots: [...DEV_POLICY_PROFILE.allowFileWriteRoots] };
  }
}

export function listPolicyProfiles(): PolicyProfile[] {
  return [getPolicyProfile("strict"), getPolicyProfile("dev")];
}
