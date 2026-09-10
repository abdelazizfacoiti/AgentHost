import { describe, expect, it } from "vitest";
import { getPolicyProfile, listPolicyProfiles } from "../policies.js";

describe("general-purpose default profile", () => {
  it("permits routine capabilities and gates consequential ones by approval", () => {
    const profile = getPolicyProfile("general");
    expect(profile.enabled).toBe(true);
    expect(profile.allowShell).toBe(true);
    expect(profile.allowAppLaunch).toBe(true);
    expect(profile.allowScreenshots).toBe(true);
    expect(profile.allowGenericClick).toBe(true);
    expect(profile.allowGenericType).toBe(true);
    expect(profile.requireApprovalForMediumRisk).toBe(false);
    expect(profile.blockHighRiskByDefault).toBe(false);
    expect(profile.requireDryRunForStateChanging).toBe(true);
    expect(profile.requireConfirmationForStateChanging).toBe(true);
    expect(profile.requireExactTargetForStateChanging).toBe(true);
    expect(profile.defaults.shell).toBe("allow");
    expect(profile.defaults.guiClick).toBe("allow");
    expect(profile.defaults.guiType).toBe("allow");
    expect(profile.defaults.browserAutomation).toBe("allow");
    expect(profile.defaults.communicationActions).toBe("approval_required");
    expect(profile.defaults.privateDataReads).toBe("approval_required");
    expect(profile.defaults.externalSendsUploads).toBe("approval_required");
    expect(profile.defaults.destructiveActions).toBe("approval_required");
    expect(profile.defaults.generatedTools).toBe("deny");
    expect(profile.grants.map((grant) => grant.id)).toContain("general.communication-read");
  });

  it("is listed alongside the conservative profiles", () => {
    const names = listPolicyProfiles().map((profile) => profile.name);
    expect(names).toContain("general");
    expect(names).toContain("strict");
    expect(names).toContain("dev");
  });
});
