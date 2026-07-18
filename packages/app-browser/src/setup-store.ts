import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  browserSetupRecovery,
  canTransitionBrowserSetup,
  type BrowserSetupFailureCode,
  type BrowserSetupLifecycleState,
  type BrowserSetupRecord,
  type SupportedBrowserFamily
} from "./setup.js";

const MAX_RECORDS = 100;
export const LOCAL_BROWSER_SETUP_OWNER = "local_browser_setup";

function validRecord(value: unknown): value is BrowserSetupRecord {
  if (value === null || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return item.schemaVersion === 1
    && typeof item.setupId === "string"
    && typeof item.ownerSessionId === "string"
    && (item.browserFamily === "firefox" || item.browserFamily === "chromium")
    && [
      "detecting_browser", "browser_selected", "checking_extension", "extension_missing",
      "waiting_for_extension", "enrollment_created", "waiting_for_approval",
      "extension_connected", "pairing", "paired", "verifying_reconnect", "ready",
      "needs_repair", "blocked", "failed", "cancelled"
    ].includes(String(item.state))
    && typeof item.createdAt === "string"
    && typeof item.updatedAt === "string"
    && typeof item.expiresAt === "string"
    && Number.isInteger(item.retryCount)
    && typeof item.reconnectVerified === "boolean"
    && typeof item.recommendedNextAction === "string"
    && item.redacted === true;
}

export class BrowserSetupStore {
  readonly #file: string;
  readonly #ownerSessionId: string;
  readonly #records = new Map<string, BrowserSetupRecord>();
  #loaded = false;

  constructor(agentHostDir: string, ownerSessionId: string) {
    this.#file = path.join(agentHostDir, "browser", "setup", "history.json");
    this.#ownerSessionId = ownerSessionId.slice(0, 200);
  }

  async ensureStructure(): Promise<void> {
    if (this.#loaded) return;
    await mkdir(path.dirname(this.#file), { recursive: true, mode: 0o700 });
    try {
      const values = JSON.parse(await readFile(this.#file, "utf8")) as unknown;
      if (Array.isArray(values)) {
        for (const value of values.slice(-MAX_RECORDS)) {
          if (validRecord(value) && value.ownerSessionId === this.#ownerSessionId) {
            this.#records.set(value.setupId, { ...value });
          }
        }
      }
    } catch {
      // First run or invalid history. Pairing ledger remains separate.
    }
    this.#loaded = true;
  }

  async create(browserFamily: SupportedBrowserFamily, ttlMs = 10 * 60_000): Promise<BrowserSetupRecord> {
    await this.ensureStructure();
    const timestamp = new Date().toISOString();
    const record: BrowserSetupRecord = {
      schemaVersion: 1,
      setupId: `browser_setup_${randomUUID()}`,
      ownerSessionId: this.#ownerSessionId,
      browserFamily,
      state: "detecting_browser",
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: new Date(Date.now() + Math.max(60_000, Math.min(30 * 60_000, ttlMs))).toISOString(),
      retryCount: 0,
      reconnectVerified: false,
      recommendedNextAction: "Inspect supported browser inventory.",
      redacted: true
    };
    this.#records.set(record.setupId, record);
    await this.#save();
    return { ...record };
  }

  async get(setupId: string): Promise<BrowserSetupRecord> {
    await this.ensureStructure();
    const record = this.#records.get(setupId);
    if (record === undefined || record.ownerSessionId !== this.#ownerSessionId) {
      throw new Error("browser_setup_not_found");
    }
    return { ...record };
  }

  async list(): Promise<BrowserSetupRecord[]> {
    await this.ensureStructure();
    return [...this.#records.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, MAX_RECORDS)
      .map((record) => ({ ...record }));
  }

  async transition(
    setupId: string,
    state: BrowserSetupLifecycleState,
    options: {
      failureCode?: BrowserSetupFailureCode;
      enrollmentId?: string;
      approvalFingerprint?: string;
      pairedConnectionId?: string;
      extensionIdentitySuffix?: string;
      reconnectVerified?: boolean;
      incrementRetry?: boolean;
      recommendedNextAction?: string;
    } = {}
  ): Promise<BrowserSetupRecord> {
    await this.ensureStructure();
    const record = this.#records.get(setupId);
    if (record === undefined || record.ownerSessionId !== this.#ownerSessionId) {
      throw new Error("browser_setup_not_found");
    }
    if (!canTransitionBrowserSetup(record.state, state)) {
      throw new Error("setup_transition_invalid");
    }
    record.state = state;
    record.updatedAt = new Date().toISOString();
    if (options.failureCode !== undefined) {
      record.safeFailureCode = options.failureCode;
      record.recommendedNextAction = browserSetupRecovery(options.failureCode).action;
    } else {
      delete record.safeFailureCode;
    }
    if (options.enrollmentId !== undefined) {
      record.enrollmentId = options.enrollmentId.slice(0, 200);
    }
    if (options.approvalFingerprint !== undefined) {
      record.approvalFingerprint = options.approvalFingerprint.slice(0, 64);
    }
    if (options.pairedConnectionId !== undefined) {
      record.pairedConnectionId = options.pairedConnectionId.slice(0, 120);
    }
    if (options.extensionIdentitySuffix !== undefined) {
      record.extensionIdentitySuffix = options.extensionIdentitySuffix.slice(-12);
    }
    if (options.reconnectVerified !== undefined) {
      record.reconnectVerified = options.reconnectVerified;
    }
    if (options.incrementRetry === true) record.retryCount = Math.min(10, record.retryCount + 1);
    if (options.recommendedNextAction !== undefined) {
      record.recommendedNextAction = options.recommendedNextAction.slice(0, 240);
    }
    await this.#save();
    return { ...record };
  }

  async cancel(setupId: string): Promise<BrowserSetupRecord> {
    const record = await this.get(setupId);
    if (record.state === "cancelled") return record;
    return await this.transition(setupId, "cancelled", {
      failureCode: "setup_cancelled"
    });
  }

  async #save(): Promise<void> {
    const temporary = `${this.#file}.${process.pid}.${randomUUID()}.tmp`;
    const values = [...this.#records.values()]
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .slice(-MAX_RECORDS);
    await writeFile(temporary, `${JSON.stringify(values, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await chmod(temporary, 0o600);
    await rename(temporary, this.#file);
  }
}
