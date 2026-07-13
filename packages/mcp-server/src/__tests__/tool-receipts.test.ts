import { describe, expect, it } from "vitest";
import { toolSuccess } from "@agenthost/core";
import { ToolReceiptManager } from "../tool-receipts.js";

describe("ToolReceiptManager", () => {
  it("signs safe receipts and rejects tamper or reuse", () => {
    const manager = new ToolReceiptManager();
    const receipt = manager.issue({ sessionId: "session_test", tool: "file.write", rawInput: { path: "/tmp/private", text: "secret", confirmationToken: "token" }, result: toolSuccess({ tool: "file.write", riskLevel: "medium", data: {} }), riskLevel: "medium" });
    expect(receipt).toMatchObject({ tool: "file.write", executionStatus: "executed" });
    expect(JSON.stringify(receipt)).not.toContain("secret");
    expect(JSON.stringify(receipt)).not.toContain("token");
    expect(manager.verify(receipt)).toMatchObject({ ok: true });
    expect(manager.verify({ ...receipt, tool: "shell.run_safe" })).toMatchObject({ ok: false, reason: "receipt_tampered" });
    manager.consume(receipt.receiptId);
    expect(manager.verify(receipt)).toMatchObject({ ok: false, reason: "receipt_already_consumed" });
  });

  it("reserves one replay-bound receipt once, then consumes atomically", () => {
    const manager = new ToolReceiptManager();
    const replayBinding = { replaySessionId: "replay_one", preparedStepId: "step_one", prepareId: "prepare_one", stepIndex: 0 };
    const input = { elementId: "opaque" };
    manager.registerReplayExpectation({ ...replayBinding, sessionId: "session_test", tool: "browser.click_element", inputFingerprint: manager.fingerprintInput(input), preview: true });
    const receipt = manager.issue({ sessionId: "session_test", tool: "browser.click_element", rawInput: { ...input, dryRun: true }, result: toolSuccess({ tool: "browser.click_element", riskLevel: "medium", preview: true, data: {} }), riskLevel: "medium" });
    const reserved = manager.reserveForReplay(receipt, replayBinding);
    expect(reserved).toMatchObject({ ok: true, reason: "receipt_reserved" });
    expect(manager.reserveForReplay(receipt, replayBinding)).toMatchObject({ ok: false, reason: "receipt_reserved" });
    manager.commitReservation(receipt.receiptId, reserved.reservationId!);
    expect(manager.reserveForReplay(receipt, replayBinding)).toMatchObject({ ok: false, reason: "receipt_already_consumed" });
    expect(manager.status(receipt.receiptId)).toBe("consumed");
  });
});
