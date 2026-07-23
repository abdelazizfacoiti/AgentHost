import { createHash, createHmac, randomBytes } from "node:crypto";
import type { AppSensitivity, DataSensitivity, RiskLevel } from "@agenthost/core";

const CONTROL_KEYS = new Set(["dryRun", "confirmationToken"]);
const RISK_ORDER: RiskLevel[] = ["observe", "low", "medium", "high", "blocked"];

export const DEFAULT_CONFIRMATION_TTL_MS = 3 * 60 * 1000;

export interface PreviewConfirmationToken {
  confirmationToken: string;
  tokenId: string;
  expiresAt: string;
  inputFingerprint: string;
  targetFingerprint?: string;
  effectFingerprint?: string;
}

interface ConfirmationRecord {
  sessionId: string;
  tool: string;
  inputFingerprint: string;
  targetFingerprint?: string;
  effectFingerprint?: string;
  riskLevel: RiskLevel;
  appSensitivity?: AppSensitivity;
  dataSensitivity?: DataSensitivity;
  targetSummary: string;
  createdAt: string;
  expiresAt: string;
  tokenId: string;
  used: boolean;
}

interface CreateConfirmationInput {
  sessionId: string;
  tool: string;
  input: unknown;
  target?: unknown;
  riskLevel: RiskLevel;
  effectFingerprint?: string;
  appSensitivity?: AppSensitivity;
  dataSensitivity?: DataSensitivity;
  targetSummary: string;
}

interface VerifyConfirmationInput {
  sessionId: string;
  tool: string;
  input: unknown;
  target?: unknown;
  riskLevel: RiskLevel;
  effectFingerprint?: string;
}

export interface ConfirmationVerificationResult {
  ok: boolean;
  tokenId?: string;
  reason: string;
  inputFingerprint?: string;
  targetFingerprint?: string;
}

function stripControlFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripControlFields(item));
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !CONTROL_KEYS.has(key))
      .map(([key, entryValue]) => [key, stripControlFields(entryValue)] as const)
      .sort(([a], [b]) => a.localeCompare(b));

    return Object.fromEntries(entries);
  }

  return value;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function riskRank(riskLevel: RiskLevel): number {
  return RISK_ORDER.indexOf(riskLevel);
}

export class ConfirmationManager {
  readonly #records = new Map<string, ConfirmationRecord>();
  readonly #fingerprintSecret = randomBytes(32);

  constructor(private readonly ttlMs = DEFAULT_CONFIRMATION_TTL_MS) {}

  fingerprintInput(input: unknown): string {
    return this.#fingerprintValue(stripControlFields(input), "input");
  }

  fingerprintTarget(target: unknown): string {
    return this.#fingerprintValue(target, "target");
  }

  createPreviewToken(input: CreateConfirmationInput): PreviewConfirmationToken {
    const confirmationToken = `ahc_${randomBytes(24).toString("base64url")}`;
    const tokenHash = sha256Hex(confirmationToken);
    const tokenId = tokenHash.slice(0, 12);
    const inputFingerprint = this.fingerprintInput(input.input);
    const targetFingerprint = input.target === undefined ? undefined : this.fingerprintTarget(input.target);
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + this.ttlMs).toISOString();

    this.#records.set(tokenHash, {
      sessionId: input.sessionId,
      tool: input.tool,
      inputFingerprint,
      ...(targetFingerprint === undefined ? {} : { targetFingerprint }),
      ...(input.effectFingerprint === undefined ? {} : { effectFingerprint: input.effectFingerprint }),
      riskLevel: input.riskLevel,
      ...(input.appSensitivity === undefined ? {} : { appSensitivity: input.appSensitivity }),
      ...(input.dataSensitivity === undefined ? {} : { dataSensitivity: input.dataSensitivity }),
      targetSummary: input.targetSummary,
      createdAt,
      expiresAt,
      tokenId,
      used: false
    });

    return {
      confirmationToken,
      tokenId,
      expiresAt,
      inputFingerprint,
      ...(targetFingerprint === undefined ? {} : { targetFingerprint }),
      ...(input.effectFingerprint === undefined ? {} : { effectFingerprint: input.effectFingerprint })
    };
  }

  verifyAndConsume(token: string, input: VerifyConfirmationInput): ConfirmationVerificationResult {
    const verification = this.verifyEnvelope(token, input);
    if (!verification.ok) {
      return verification;
    }

    const tokenHash = sha256Hex(token);
    const record = this.#records.get(tokenHash);
    if (record === undefined) {
      return { ok: false, reason: "Confirmation token was not found." };
    }

    const targetFingerprint = input.target === undefined ? undefined : this.fingerprintTarget(input.target);
    if (record.targetFingerprint !== targetFingerprint) {
      return {
        ok: false,
        tokenId: record.tokenId,
        reason: "Confirmation token target does not match the current resolved target.",
        inputFingerprint: verification.inputFingerprint ?? this.fingerprintInput(input.input),
        ...(targetFingerprint === undefined ? {} : { targetFingerprint })
      };
    }

    record.used = true;
    this.#records.set(tokenHash, record);

    return {
      ...verification,
      ok: true,
      tokenId: record.tokenId,
      reason: "Confirmation token accepted.",
      inputFingerprint: verification.inputFingerprint ?? this.fingerprintInput(input.input),
      ...(targetFingerprint === undefined ? {} : { targetFingerprint })
    };
  }

  /**
   * Validates the session/tool/input envelope without consuming the token.
   * Domain handlers remain responsible for exact-target validation and the
   * single consuming verifyAndConsume call.
   */
  verifyEnvelope(token: string, input: Omit<VerifyConfirmationInput, "target">): ConfirmationVerificationResult {
    const tokenHash = sha256Hex(token);
    const record = this.#records.get(tokenHash);

    if (record === undefined) {
      return {
        ok: false,
        reason: "Confirmation token was not found."
      };
    }

    if (record.used) {
      return {
        ok: false,
        tokenId: record.tokenId,
        reason: "Confirmation token was already used."
      };
    }

    if (Date.now() > Date.parse(record.expiresAt)) {
      return {
        ok: false,
        tokenId: record.tokenId,
        reason: "Confirmation token expired."
      };
    }

    if (record.sessionId !== input.sessionId) {
      return {
        ok: false,
        tokenId: record.tokenId,
        reason: "Confirmation token belongs to a different session."
      };
    }

    if (record.tool !== input.tool) {
      return {
        ok: false,
        tokenId: record.tokenId,
        reason: "Confirmation token was generated for a different tool."
      };
    }

    const inputFingerprint = this.fingerprintInput(input.input);
    if (record.inputFingerprint !== inputFingerprint) {
      return {
        ok: false,
        tokenId: record.tokenId,
        reason: "Confirmation token input does not match the current request.",
        inputFingerprint
      };
    }

    if (riskRank(input.riskLevel) > riskRank(record.riskLevel)) {
      return {
        ok: false,
        tokenId: record.tokenId,
        reason: "Confirmation token risk level no longer matches the current action.",
        inputFingerprint
      };
    }

    if (input.effectFingerprint !== undefined && record.effectFingerprint !== undefined && record.effectFingerprint !== input.effectFingerprint) {
      return { ok: false, tokenId: record.tokenId, reason: "Confirmation token effect binding changed.", inputFingerprint };
    }

    return {
      ok: true,
      tokenId: record.tokenId,
      reason: "Confirmation token accepted.",
      inputFingerprint
    };
  }

  #fingerprintValue(value: unknown, prefix: "input" | "target"): string {
    const normalized = stableStringify(value);
    const digest = createHmac("sha256", this.#fingerprintSecret).update(normalized).digest("hex");
    return `${prefix}_${digest.slice(0, 24)}`;
  }
}
