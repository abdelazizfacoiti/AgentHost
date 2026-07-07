import { describe, expect, it } from "vitest";
import { evaluateApprovalRequirement, evaluateSafety, getPolicyProfile } from "../index.js";

const homeDir = "/home/tester";

describe("evaluateSafety", () => {
  it("allows observe-level actions without approval", () => {
    const result = evaluateSafety(
      {
        tool: "system.get_info",
        actionType: "observe"
      },
      getPolicyProfile("strict"),
      { homeDir }
    );

    expect(result.riskLevel).toBe("observe");
    expect(result.allowed).toBe(true);
    expect(result.approval.status).toBe("not_required");
  });

  it("requires approval for medium risk in strict profile but not dev profile", () => {
    const strictResult = evaluateSafety(
      {
        tool: "app.open",
        actionType: "app_launch",
        appName: "GIMP"
      },
      getPolicyProfile("strict"),
      { homeDir }
    );
    const devResult = evaluateSafety(
      {
        tool: "app.open",
        actionType: "app_launch",
        appName: "GIMP"
      },
      getPolicyProfile("dev"),
      { homeDir }
    );

    expect(strictResult.riskLevel).toBe("medium");
    expect(strictResult.allowed).toBe(false);
    expect(strictResult.approval.status).toBe("required");
    expect(devResult.allowed).toBe(true);
    expect(devResult.approval.status).toBe("not_required");
  });

  it("blocks communication sending and uploads by policy", () => {
    const sendResult = evaluateSafety(
      {
        tool: "email.send",
        actionType: "communication_send",
        appName: "Gmail",
        externalEffect: true,
        communicative: true
      },
      getPolicyProfile("dev"),
      { homeDir }
    );
    const uploadResult = evaluateSafety(
      {
        tool: "file.upload",
        actionType: "upload",
        externalEffect: true
      },
      getPolicyProfile("dev"),
      { homeDir }
    );

    expect(sendResult.riskLevel).toBe("blocked");
    expect(sendResult.matchedRules).toContain("policy.communication_send.disabled");
    expect(uploadResult.riskLevel).toBe("blocked");
    expect(uploadResult.matchedRules).toContain("policy.upload.disabled");
  });

  it("blocks financial and credential/security autonomous actions", () => {
    const financialResult = evaluateSafety(
      {
        tool: "browser.fill_form",
        actionType: "browser_action",
        url: "https://bank.example.test/transfer"
      },
      getPolicyProfile("dev"),
      { homeDir }
    );
    const credentialResult = evaluateSafety(
      {
        tool: "desktop.type_text",
        actionType: "gui_type",
        appName: "Bitwarden"
      },
      getPolicyProfile("dev"),
      { homeDir }
    );

    expect(financialResult.riskLevel).toBe("blocked");
    expect(financialResult.appSensitivity).toBe("financial");
    expect(credentialResult.riskLevel).toBe("blocked");
    expect(credentialResult.appSensitivity).toBe("credential_or_security");
  });

  it("blocks generic GUI click and type when policy disables them", () => {
    const clickResult = evaluateSafety(
      {
        tool: "desktop.click",
        actionType: "gui_click"
      },
      getPolicyProfile("dev"),
      { homeDir }
    );
    const typeResult = evaluateSafety(
      {
        tool: "desktop.type_text",
        actionType: "gui_type"
      },
      getPolicyProfile("dev"),
      { homeDir }
    );

    expect(clickResult.riskLevel).toBe("blocked");
    expect(clickResult.matchedRules).toContain("policy.gui_click.disabled");
    expect(typeResult.riskLevel).toBe("blocked");
    expect(typeResult.matchedRules).toContain("policy.gui_type.disabled");
  });

  it("defaults unknown actions conservatively", () => {
    const result = evaluateSafety(
      {
        tool: "future.unknown",
        actionType: "unknown"
      },
      getPolicyProfile("strict"),
      { homeDir }
    );

    expect(result.riskLevel).toBe("medium");
    expect(result.allowed).toBe(false);
    expect(result.matchedRules).toContain("action.unknown.conservative");
  });
});

describe("evaluateApprovalRequirement", () => {
  it("denies high-risk actions when the active profile blocks high risk by default", () => {
    const approval = evaluateApprovalRequirement("high", getPolicyProfile("dev"), ["High-risk test."]);

    expect(approval.status).toBe("denied");
    expect(approval.required).toBe(false);
  });
});
