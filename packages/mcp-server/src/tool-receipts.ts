import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { RiskLevel, ToolResult, ToolResultReceipt, ToolResultReceiptPayload, ToolResultReceiptVerification } from "@agenthost/core";

const TTL = 5 * 60_000;
function stable(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`; }
function strip(input: unknown): unknown { if (typeof input !== "object" || input === null || Array.isArray(input)) return input; const { confirmationToken: _token, dryRun: _dryRun, ...rest } = input as Record<string, unknown>; return rest; }
export class ToolReceiptManager {
  readonly #secret = randomBytes(32); readonly #records = new Map<string, { receipt: ToolResultReceipt; used?: boolean }>();
  fingerprintInput(input: unknown): string { return this.#sign(stable(strip(input))).slice(0, 32); }
  issue(input: { sessionId: string; tool: string; rawInput: unknown; result: ToolResult; riskLevel: RiskLevel; target?: unknown }): ToolResultReceipt {
    const createdAt = new Date().toISOString(); const preview = input.result.preview === true; const status = !input.result.ok ? "failed" : preview ? "preview" : "executed";
    const payload: ToolResultReceiptPayload = { receiptId: `receipt_${randomUUID()}`, sessionId: input.sessionId, tool: input.tool, createdAt, expiresAt: new Date(Date.now() + TTL).toISOString(), resultFingerprint: this.#sign(stable({ tool: input.tool, ok: input.result.ok, preview, error: input.result.error?.code, confirmation: input.result.confirmation?.status, riskLevel: input.riskLevel })).slice(0, 32), inputFingerprint: this.fingerprintInput(input.rawInput), ...(input.target === undefined ? {} : { targetFingerprint: this.#sign(stable(input.target)).slice(0, 32) }), riskLevel: input.riskLevel, preview, ...(input.result.confirmation === undefined ? {} : { confirmationStatus: input.result.confirmation.status }), executionStatus: status };
    const receipt = { ...payload, receiptSignature: this.#sign(stable(payload)) }; this.#records.set(receipt.receiptId, { receipt }); return receipt;
  }
  verify(receipt: ToolResultReceipt): ToolResultReceiptVerification { const record = this.#records.get(receipt.receiptId); if (record === undefined) return { ok: false, reason: "receipt_unknown" }; if (!this.#equal(record.receipt.receiptSignature, receipt.receiptSignature) || !this.#equal(this.#sign(stable(this.#payload(receipt))), receipt.receiptSignature)) return { ok: false, reason: "receipt_tampered" }; if (Date.now() > Date.parse(receipt.expiresAt)) return { ok: false, reason: "receipt_expired" }; if (record.used) return { ok: false, reason: "receipt_reused" }; return { ok: true, reason: "receipt_verified", receipt: record.receipt }; }
  consume(receiptId: string): void { const record = this.#records.get(receiptId); if (record === undefined || record.used) throw new Error("receipt_reused"); record.used = true; this.#records.set(receiptId, record); }
  #payload(receipt: ToolResultReceipt): ToolResultReceiptPayload { const { receiptSignature: _signature, ...payload } = receipt; return payload; }
  #sign(value: string): string { return createHmac("sha256", this.#secret).update(value).digest("hex"); }
  #equal(a: string, b: string): boolean { const left = Buffer.from(a), right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
}
