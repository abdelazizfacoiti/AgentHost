import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, getDefaultPolicy } from "../policies.js";

describe("default autonomous policy", () => {
  it("permits routine local work and gates consequential effects by confirmation", () => {
    const policy = getDefaultPolicy();
    expect(policy.enabled).toBe(true);
    expect(policy.allowShell).toBe(true);
    expect(policy.allowAppLaunch).toBe(true);
    expect(policy.allowScreenshots).toBe(true);
    expect(policy.allowGenericClick).toBe(true);
    expect(policy.allowGenericType).toBe(true);
    expect(policy.requireApprovalForMediumRisk).toBe(false);
    expect(policy.blockHighRiskByDefault).toBe(false);
    expect(policy.requireDryRunForStateChanging).toBe(false);
    expect(policy.requireConfirmationForStateChanging).toBe(false);
    expect(policy.requireExactTargetForStateChanging).toBe(false);
    expect(policy.defaults.shell).toBe("allow");
    expect(policy.defaults.guiClick).toBe("allow");
    expect(policy.defaults.guiType).toBe("allow");
    expect(policy.defaults.browserAutomation).toBe("allow");
    expect(policy.defaults.communicationActions).toBe("approval_required");
    expect(policy.defaults.privateDataReads).toBe("approval_required");
    expect(policy.defaults.externalSendsUploads).toBe("approval_required");
    expect(policy.defaults.destructiveActions).toBe("approval_required");
    expect(policy.defaults.generatedTools).toBe("deny");
    expect(policy.grants.map((grant) => grant.id)).toContain("default.communication-read");
  });

  it("returns isolated copies", () => {
    const first = getDefaultPolicy();
    first.allowFileWriteRoots.push("/tmp/mutated");
    first.grants.push({ id: "test", scope: "session", effect: "allow", match: {} });
    expect(DEFAULT_POLICY.allowFileWriteRoots).not.toContain("/tmp/mutated");
    expect(getDefaultPolicy().grants).toHaveLength(DEFAULT_POLICY.grants.length);
  });
});
