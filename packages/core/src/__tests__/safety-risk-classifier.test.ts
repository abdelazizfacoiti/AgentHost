import { describe, expect, it } from "vitest";
import { evaluateApprovalRequirement, evaluateSafety, getDefaultPolicy } from "../index.js";

const homeDir = "/home/tester";

describe("evaluateSafety", () => {
  it("allows observe-level actions without approval", () => {
    const result = evaluateSafety({ tool: "system.get_info", actionType: "observe" }, getDefaultPolicy(), { homeDir });
    expect(result.riskLevel).toBe("observe");
    expect(result.allowed).toBe(true);
    expect(result.approval.status).toBe("not_required");
  });

  it("allows routine local actions without confirmation", () => {
    const app = evaluateSafety({ tool: "app.open", actionType: "app_launch", appName: "GIMP" }, getDefaultPolicy(), { homeDir });
    const click = evaluateSafety({ tool: "desktop.click", actionType: "gui_click", appName: "GIMP" }, getDefaultPolicy(), { homeDir });
    const type = evaluateSafety({ tool: "desktop.type_text", actionType: "gui_type", appName: "GIMP", dataSensitivity: "low" }, getDefaultPolicy(), { homeDir });
    const write = evaluateSafety({ tool: "file.write", actionType: "file_write", filePath: "~/Documents/notes.txt" }, getDefaultPolicy(), { homeDir });
    expect([app, click, type, write].every((result) => result.allowed)).toBe(true);
    expect([app, click, type, write].every((result) => result.approval.status === "not_required")).toBe(true);
  });

  it("requires exact confirmation for external sends and uploads without blocking them", () => {
    const send = evaluateSafety({ tool: "email.send", actionType: "communication_send", appName: "Gmail", externalEffect: true, communicative: true }, getDefaultPolicy(), { homeDir });
    const upload = evaluateSafety({ tool: "file.upload", actionType: "upload", externalEffect: true }, getDefaultPolicy(), { homeDir });
    expect(send.riskLevel).toBe("high");
    expect(send.blocked).toBe(false);
    expect(send.allowed).toBe(false);
    expect(send.approval.status).toBe("required");
    expect(send.grantDecision.requiresConfirmationToken).toBe(true);
    expect(upload.riskLevel).toBe("high");
    expect(upload.allowed).toBe(false);
    expect(upload.approval.status).toBe("required");
  });

  it("allows a high-risk external effect after an exact confirmation is accepted", () => {
    const result = evaluateSafety(
      { tool: "email.send", actionType: "communication_send", appName: "Gmail", communicative: true, externalEffect: true },
      getDefaultPolicy(),
      { homeDir, confirmationSatisfied: true }
    );
    expect(result.blocked).toBe(false);
    expect(result.allowed).toBe(true);
    expect(result.approval.status).toBe("approved");
  });

  it("requires confirmation for destructive local actions", () => {
    const result = evaluateSafety({ tool: "file.delete", actionType: "file_delete", filePath: "/tmp/old.txt", destructive: true }, getDefaultPolicy(), { homeDir });
    expect(result.riskLevel).toBe("high");
    expect(result.allowed).toBe(false);
    expect(result.approval.status).toBe("required");
    expect(result.grantDecision.requiresConfirmationToken).toBe(true);
  });

  it("keeps credential and security apps hard-blocked", () => {
    const result = evaluateSafety({ tool: "desktop.type_text", actionType: "gui_type", appName: "Bitwarden" }, getDefaultPolicy(), { homeDir });
    expect(result.riskLevel).toBe("blocked");
    expect(result.blocked).toBe(true);
    expect(result.appSensitivity).toBe("credential_or_security");
  });

  it("gates financial state changes with exact confirmation instead of a dead grant wall", () => {
    const result = evaluateSafety({ tool: "browser.fill_form", actionType: "browser_action", url: "https://bank.example.test/transfer" }, getDefaultPolicy(), { homeDir });
    expect(result.riskLevel).toBe("high");
    expect(result.blocked).toBe(false);
    expect(result.approval.status).toBe("required");
    expect(result.appSensitivity).toBe("financial");
  });

  it("requires approval for sensitive private data and accepts an exact confirmation", () => {
    const pending = evaluateSafety({ tool: "accessibility.inspect_element", actionType: "inspect", appName: "Gmail", dataSensitivity: "sensitive" }, getDefaultPolicy(), { homeDir });
    const confirmed = evaluateSafety({ tool: "accessibility.inspect_element", actionType: "inspect", appName: "Gmail", dataSensitivity: "sensitive" }, getDefaultPolicy(), { homeDir, confirmationSatisfied: true });
    expect(pending.blocked).toBe(false);
    expect(pending.approval.status).toBe("required");
    expect(pending.grantDecision.requiresConfirmationToken).toBe(true);
    expect(confirmed.allowed).toBe(true);
    expect(confirmed.approval.status).toBe("approved");
  });

  it("blocks secret data unconditionally", () => {
    const result = evaluateSafety({ tool: "accessibility.set_value", actionType: "accessibility_set_value", appName: "GIMP", dataSensitivity: "secret" }, getDefaultPolicy(), { homeDir });
    expect(result.riskLevel).toBe("blocked");
    expect(result.matchedRules).toContain("data.secret.blocked");
  });

  it("blocks screenshots when the policy disables them", () => {
    const policy = { ...getDefaultPolicy(), allowScreenshots: false };
    const result = evaluateSafety({ tool: "desktop.screenshot", actionType: "file_write", filePath: "/tmp/agenthost-shot.png" }, policy, { homeDir });
    expect(result.riskLevel).toBe("blocked");
    expect(result.matchedRules).toContain("policy.screenshot.disabled");
  });

  it("still blocks protected system paths", () => {
    const result = evaluateSafety({ tool: "file.write", actionType: "file_write", filePath: "/etc/passwd" }, getDefaultPolicy(), { homeDir });
    expect(result.riskLevel).toBe("blocked");
    expect(result.blocked).toBe(true);
    expect(result.matchedRules).toContain("path.protected.system");
  });

  it("defaults unknown actions to approval", () => {
    const result = evaluateSafety({ tool: "future.unknown", actionType: "unknown" }, getDefaultPolicy(), { homeDir });
    expect(result.riskLevel).toBe("medium");
    expect(result.allowed).toBe(false);
    expect(result.matchedRules).toContain("action.unknown.conservative");
  });

  it("ignores expired grants", () => {
    const result = evaluateSafety(
      { tool: "file.read", actionType: "file_read", filePath: "/tmp/private.txt", dataSensitivity: "sensitive" },
      getDefaultPolicy({ grants: [{
        id: "expired-private-read",
        scope: "persistent",
        effect: "allow",
        expiresAt: "2000-01-01T00:00:00.000Z",
        match: { tools: ["file.read"], dataSensitivities: ["sensitive"] }
      }] }),
      { homeDir }
    );
    expect(result.grantDecision.allowedByGrantIds).toEqual([]);
    expect(result.approval.status).toBe("required");
  });
});

describe("evaluateApprovalRequirement", () => {
  it("denies high-risk actions only when a policy explicitly blocks high risk", () => {
    const blocked = evaluateApprovalRequirement("high", { ...getDefaultPolicy(), blockHighRiskByDefault: true }, ["High-risk test."]);
    const allowed = evaluateApprovalRequirement("high", getDefaultPolicy(), ["High-risk test."]);
    expect(blocked.status).toBe("denied");
    expect(allowed.status).toBe("required");
  });

  it("marks an accepted exact confirmation as approved", () => {
    const approval = evaluateApprovalRequirement("high", getDefaultPolicy(), ["High-risk test."], false, true);
    expect(approval).toMatchObject({ required: false, status: "approved" });
  });
});
