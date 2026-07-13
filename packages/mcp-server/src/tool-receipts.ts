import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { RiskLevel, ToolResult, ToolResultReceipt, ToolResultReceiptPayload, ToolResultReceiptVerification } from "@agenthost/core";

const TTL = 5 * 60_000;
type ReplayBinding = NonNullable<ToolResultReceipt["replayBinding"]>;
type RecordState = { status: "active" } | { status: "reserved"; reservationId: string; binding: ReplayBinding } | { status: "consumed"; binding: ReplayBinding };
type Expectation = ReplayBinding & { sessionId: string; tool: string; inputFingerprint: string; preview: boolean };
type ReceiptRecord = { receipt: ToolResultReceipt; state: RecordState };
function stable(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`; }
function strip(input: unknown): unknown { if (typeof input !== "object" || input === null || Array.isArray(input)) return input; const { confirmationToken: _token, dryRun: _dryRun, replayBinding: _binding, ...rest } = input as Record<string, unknown>; return rest; }

export class ToolReceiptManager {
  readonly #secret = randomBytes(32); readonly #records = new Map<string, ReceiptRecord>(); readonly #expectations = new Map<string, Expectation>();
  fingerprintInput(input: unknown): string { return this.#sign(stable(strip(input))).slice(0, 32); }
  registerReplayExpectation(input: Expectation): void { this.#expectations.set(input.prepareId, input); }
  invalidateReplayExpectations(replaySessionId: string): number { const matches = [...this.#expectations.entries()].filter(([, item]) => item.replaySessionId === replaySessionId); for (const [prepareId] of matches) this.#expectations.delete(prepareId); return matches.length; }
  issue(input: { sessionId: string; tool: string; rawInput: unknown; result: ToolResult; riskLevel: RiskLevel; target?: unknown }): ToolResultReceipt {
    const createdAt = new Date().toISOString(); const preview = input.result.preview === true; const status = !input.result.ok ? "failed" : preview ? "preview" : "executed"; const inputFingerprint = this.fingerprintInput(input.rawInput);
    const replayBinding = [...this.#expectations.values()].find((item) => item.sessionId === input.sessionId && item.tool === input.tool && item.inputFingerprint === inputFingerprint && item.preview === preview);
    const payload: ToolResultReceiptPayload = { receiptId: `receipt_${randomUUID()}`, sessionId: input.sessionId, tool: input.tool, createdAt, expiresAt: new Date(Date.now() + TTL).toISOString(), resultFingerprint: this.#sign(stable({ tool: input.tool, ok: input.result.ok, preview, error: input.result.error?.code, confirmation: input.result.confirmation?.status, riskLevel: input.riskLevel })).slice(0, 32), inputFingerprint, ...(input.target === undefined ? {} : { targetFingerprint: this.#sign(stable(input.target)).slice(0, 32) }), riskLevel: input.riskLevel, preview, ...(input.result.confirmation === undefined ? {} : { confirmationStatus: input.result.confirmation.status }), executionStatus: status, ...(replayBinding === undefined ? {} : { replayBinding: { replaySessionId: replayBinding.replaySessionId, preparedStepId: replayBinding.preparedStepId, prepareId: replayBinding.prepareId, stepIndex: replayBinding.stepIndex } }) };
    const receipt = { ...payload, receiptSignature: this.#sign(stable(payload)) }; this.#records.set(receipt.receiptId, { receipt, state: { status: "active" } }); return receipt;
  }
  verify(receipt: ToolResultReceipt): ToolResultReceiptVerification { const record = this.#records.get(receipt.receiptId); if (record === undefined) return { ok: false, reason: "receipt_missing" }; if (!this.#equal(record.receipt.receiptSignature, receipt.receiptSignature) || !this.#equal(this.#sign(stable(this.#payload(receipt))), receipt.receiptSignature)) return { ok: false, reason: "receipt_tampered" }; if (Date.now() > Date.parse(receipt.expiresAt)) return { ok: false, reason: "receipt_expired" }; if (record.state.status === "reserved") return { ok: false, reason: "receipt_reserved" }; if (record.state.status === "consumed") return { ok: false, reason: "receipt_already_consumed" }; return { ok: true, reason: "receipt_verified", receipt: record.receipt }; }
  reserveForReplay(receipt: ToolResultReceipt, binding: ReplayBinding): { ok: boolean; reason: string; reservationId?: string; receipt?: ToolResultReceipt } {
    const verified = this.verify(receipt); if (!verified.ok || verified.receipt === undefined) return verified;
    const actual = verified.receipt.replayBinding; if (actual === undefined || !this.#sameBinding(actual, binding)) return { ok: false, reason: "wrong_replay_session" };
    const reservationId = `reserve_${randomUUID()}`; this.#records.set(receipt.receiptId, { receipt: verified.receipt, state: { status: "reserved", reservationId, binding } }); return { ok: true, reason: "receipt_reserved", reservationId, receipt: verified.receipt };
  }
  commitReservation(receiptId: string, reservationId: string): void { const record = this.#records.get(receiptId); if (record?.state.status !== "reserved" || record.state.reservationId !== reservationId) throw new Error(record?.state.status === "consumed" ? "receipt_already_consumed" : "receipt_reserved"); this.#records.set(receiptId, { receipt: record.receipt, state: { status: "consumed", binding: record.state.binding } }); }
  releaseReservation(receiptId: string, reservationId: string): void { const record = this.#records.get(receiptId); if (record?.state.status === "reserved" && record.state.reservationId === reservationId) this.#records.set(receiptId, { receipt: record.receipt, state: { status: "active" } }); }
  consume(receiptId: string): void { const record = this.#records.get(receiptId); if (record === undefined || record.state.status !== "active") throw new Error(record?.state.status === "consumed" ? "receipt_already_consumed" : "receipt_reserved"); this.#records.set(receiptId, { receipt: record.receipt, state: { status: "consumed", binding: { replaySessionId: "manual", preparedStepId: "manual", prepareId: "manual", stepIndex: -1 } } }); }
  status(receiptId: string): "active" | "reserved" | "consumed" | "missing" { return this.#records.get(receiptId)?.state.status ?? "missing"; }
  #payload(receipt: ToolResultReceipt): ToolResultReceiptPayload { const { receiptSignature: _signature, ...payload } = receipt; return payload; }
  #sign(value: string): string { return createHmac("sha256", this.#secret).update(value).digest("hex"); }
  #equal(a: string, b: string): boolean { const left = Buffer.from(a), right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
  #sameBinding(a: ReplayBinding, b: ReplayBinding): boolean { return a.replaySessionId === b.replaySessionId && a.preparedStepId === b.preparedStepId && a.prepareId === b.prepareId && a.stepIndex === b.stepIndex; }
}
