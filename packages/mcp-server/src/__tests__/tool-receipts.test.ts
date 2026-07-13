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
    expect(manager.verify(receipt)).toMatchObject({ ok: false, reason: "receipt_reused" });
  });
});
