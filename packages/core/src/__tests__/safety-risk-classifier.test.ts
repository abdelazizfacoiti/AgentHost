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

  it("demo profile allows normal local actions but keeps sensitive apps blocked", () => {
    const demo = getPolicyProfile("demo-unlocked-local");
    const write = evaluateSafety({ tool: "file.write", actionType: "file_write", filePath: "~/Desktop/agenthost-demo/test.txt" }, demo, { homeDir });
    const outside = evaluateSafety({ tool: "file.write", actionType: "file_write", filePath: "~/Documents/private.txt" }, demo, { homeDir });
    const normalApp = evaluateSafety({ tool: "app.open", actionType: "app_launch", appName: "GIMP" }, demo, { homeDir });
    const financial = evaluateSafety({ tool: "desktop.click", actionType: "gui_click", appName: "My Bank" }, demo, { homeDir });
    expect(write.allowed).toBe(true);
    expect(outside.allowed).toBe(false);
    expect(normalApp.allowed).toBe(true);
    expect(financial.blocked).toBe(true);
  });

  it("demo profile allows communication reads but blocks sends", () => {
    const demo = getPolicyProfile("demo-unlocked-local");
    const read = evaluateSafety({ tool: "accessibility.inspect_element", actionType: "inspect", appName: "Gmail", dataSensitivity: "sensitive" }, demo, { homeDir });
    const send = evaluateSafety({ tool: "email.send", actionType: "communication_send", appName: "Gmail", communicative: true, externalEffect: true }, demo, { homeDir });
    expect(read.allowed).toBe(true);
    expect(read.grantDecision.allowedByGrantIds).toContain("demo-unlocked-local.communication-read");
    expect(send.blocked).toBe(true);
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

  it("keeps read-only accessibility inspection low risk", () => {
    const result = evaluateSafety(
      {
        tool: "accessibility.inspect_element",
        actionType: "inspect",
        appName: "Notes"
      },
      getPolicyProfile("strict"),
      { homeDir }
    );

    expect(result.riskLevel).toBe("low");
    expect(result.allowed).toBe(true);
  });

  it("requires approval for medium-risk accessibility actions in strict profile", () => {
    const result = evaluateSafety(
      {
        tool: "accessibility.focus_element",
        actionType: "accessibility_focus",
        appName: "GIMP"
      },
      getPolicyProfile("strict"),
      { homeDir }
    );

    expect(result.riskLevel).toBe("medium");
    expect(result.allowed).toBe(false);
    expect(result.approval.status).toBe("required");
  });

  it("treats communication accessibility actions as high-risk", () => {
    const result = evaluateSafety(
      {
        tool: "accessibility.invoke_action",
        actionType: "accessibility_action",
        appName: "Gmail"
      },
      getPolicyProfile("dev"),
      { homeDir }
    );

    expect(result.riskLevel).toBe("high");
    expect(result.matchedRules).toContain("app.communication.high_risk");
  });

  it("blocks secret accessibility values by default", () => {
    const result = evaluateSafety(
      {
        tool: "accessibility.set_value",
        actionType: "accessibility_set_value",
        appName: "GIMP",
        dataSensitivity: "secret"
      },
      getPolicyProfile("dev"),
      { homeDir }
    );

    expect(result.riskLevel).toBe("blocked");
    expect(result.matchedRules).toContain("data.secret.blocked");
  });

  it("treats communication clicks as high-risk when generic GUI control is enabled", () => {
    const policy = {
      ...getPolicyProfile("dev"),
      allowGenericClick: true
    };
    const result = evaluateSafety(
      {
        tool: "desktop.click",
        actionType: "gui_click",
        appName: "Gmail"
      },
      policy,
      { homeDir }
    );

    expect(result.riskLevel).toBe("high");
    expect(result.matchedRules).toContain("app.communication.high_risk");
  });

  it("blocks screenshots when the policy disables them", () => {
    const policy = {
      ...getPolicyProfile("dev"),
      allowScreenshots: false
    };
    const result = evaluateSafety(
      {
        tool: "desktop.screenshot",
        actionType: "file_write",
        filePath: "/tmp/agenthost-shot.png"
      },
      policy,
      { homeDir }
    );

    expect(result.riskLevel).toBe("blocked");
    expect(result.matchedRules).toContain("policy.screenshot.disabled");
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

  it("requires explicit grants for private-data reads in the private-data profile", () => {
    const result = evaluateSafety(
      {
        tool: "file.read",
        actionType: "file_read",
        filePath: "/tmp/private.txt",
        dataSensitivity: "sensitive"
      },
      getPolicyProfile("private-data"),
      { homeDir }
    );

    expect(result.blocked).toBe(true);
    expect(result.approval.status).toBe("denied");
    expect(result.matchedRules).toContain("profile.default.file_read.deny");
  });

  it("lets an explicit grant allow private-data reads without weakening other safety rules", () => {
    const result = evaluateSafety(
      {
        tool: "file.read",
        actionType: "file_read",
        filePath: "/tmp/private.txt",
        dataSensitivity: "sensitive"
      },
      getPolicyProfile("private-data", {
        grants: [
          {
            id: "private-data-read",
            scope: "persistent",
            effect: "allow",
            match: {
              tools: ["file.read"],
              dataSensitivities: ["sensitive"]
            }
          }
        ]
      }),
      { homeDir }
    );

    expect(result.blocked).toBe(false);
    expect(result.allowed).toBe(false);
    expect(result.approval.status).toBe("required");
    expect(result.grantDecision.allowedByGrantIds).toEqual(["private-data-read"]);
  });

  it("requires an explicit grant before reading private data from communication apps", () => {
    const withoutGrant = evaluateSafety(
      {
        tool: "accessibility.inspect_element",
        actionType: "inspect",
        appName: "Gmail",
        dataSensitivity: "sensitive"
      },
      getPolicyProfile("dev"),
      { homeDir }
    );
    const withGrant = evaluateSafety(
      {
        tool: "accessibility.inspect_element",
        actionType: "inspect",
        appName: "Gmail",
        dataSensitivity: "sensitive"
      },
      getPolicyProfile("dev", {
        grants: [
          {
            id: "comm-private-read",
            scope: "persistent",
            effect: "allow",
            match: {
              tools: ["accessibility.inspect_element"],
              appSensitivities: ["communication"],
              dataSensitivities: ["sensitive"]
            }
          }
        ]
      }),
      { homeDir }
    );

    expect(withoutGrant.blocked).toBe(true);
    expect(withoutGrant.matchedRules).toContain("app.communication.private_data_requires_grant");
    expect(withGrant.blocked).toBe(false);
    expect(withGrant.grantDecision.allowedByGrantIds).toEqual(["comm-private-read"]);
  });

  it("lets gui-dev permit generic GUI input while still requiring preview and confirmation", () => {
    const result = evaluateSafety(
      {
        tool: "desktop.click",
        actionType: "gui_click",
        appName: "Notes"
      },
      getPolicyProfile("gui-dev"),
      { homeDir }
    );

    expect(result.blocked).toBe(false);
    expect(result.allowed).toBe(true);
    expect(result.grantDecision.requiresDryRun).toBe(true);
    expect(result.grantDecision.requiresConfirmationToken).toBe(true);
  });

  it("ignores expired grants", () => {
    const result = evaluateSafety(
      {
        tool: "file.read",
        actionType: "file_read",
        filePath: "/tmp/private.txt",
        dataSensitivity: "sensitive"
      },
      getPolicyProfile("private-data", {
        grants: [
          {
            id: "expired-private-read",
            scope: "persistent",
            effect: "allow",
            expiresAt: "2000-01-01T00:00:00.000Z",
            match: {
              tools: ["file.read"],
              dataSensitivities: ["sensitive"]
            }
          }
        ]
      }),
      { homeDir }
    );

    expect(result.blocked).toBe(true);
    expect(result.grantDecision.allowedByGrantIds).toEqual([]);
  });
});

describe("evaluateApprovalRequirement", () => {
  it("denies high-risk actions when the active profile blocks high risk by default", () => {
    const approval = evaluateApprovalRequirement("high", getPolicyProfile("dev"), ["High-risk test."]);

    expect(approval.status).toBe("denied");
    expect(approval.required).toBe(false);
  });
});
