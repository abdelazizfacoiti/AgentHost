import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { chmod, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserBridgeConfig } from "@agenthost/core";
import { BrowserPairingStore } from "./pairing-store.js";
import {
  BROWSER_BRIDGE_PROTOCOL_VERSION,
  browserCompatibilitySummary,
  extensionVersionCompatible
} from "./version-compatibility.js";
import type { BridgeBrowserInfo, BrowserCommand } from "./types.js";
import { expectedExtensionId } from "./extension-identity.js";
import type { SupportedBrowserFamily } from "./setup.js";

const MAX_BODY = 256 * 1024;
const COMMAND_TIMEOUT_MS = 10_000;
const SESSION_MS = 5 * 60_000;
const BOOTSTRAP_TOKEN_MS = 10 * 60_000;
const MAX_COMMANDS = 64;
const ENROLLMENT_MS = 10 * 60_000;

export type BrowserSetupState =
  | "bridge_disabled"
  | "bridge_unavailable"
  | "extension_not_seen"
  | "unpaired"
  | "paired"
  | "token_invalid"
  | "token_expired"
  | "pairing_revoked"
  | "version_mismatch"
  | "protocol_mismatch"
  | "extension_identity_mismatch"
  | "origin_rejected"
  | "device_state_corrupt"
  | "browser_busy"
  | "port_mismatch"
  | "manifest_missing"
  | "unknown_error";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type ExtensionIdentity = {
  browser: BridgeBrowserInfo;
  extensionId: string;
  extensionVersion: string;
  protocolVersion: number;
};

type Session = {
  token: string;
  connectionId: string;
  connectedAt: number;
  deviceId: string;
  identity: ExtensionIdentity;
  exactOrigin: string;
  lastSeen: number;
};

type BrowserEnrollment = {
  enrollmentId: string;
  browserFamily: SupportedBrowserFamily;
  requestToken?: string;
  identity?: ExtensionIdentity;
  exactOrigin?: string;
  state: "waiting_for_extension" | "waiting_for_approval" | "approved" | "paired" | "cancelled";
  createdAt: number;
  approvedAt?: number;
  delivered: boolean;
  pendingSession?: Session;
  sessionResponse?: Record<string, unknown>;
};

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function pairingToken(): string {
  return `AH-${randomBytes(15).toString("hex").toUpperCase().match(/.{1,5}/g)!.join("-")}`;
}

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const item = Buffer.from(chunk);
    size += item.length;
    if (size > MAX_BODY) throw new Error("body_too_large");
    chunks.push(item);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

export function normalizeExtensionOrigin(raw: string): string | undefined {
  try {
    const value = new URL(raw);
    if ((value.protocol !== "moz-extension:" && value.protocol !== "chrome-extension:")
      || value.username !== ""
      || value.password !== ""
      || (value.pathname !== "" && value.pathname !== "/")
      || value.search !== ""
      || value.hash !== "") return undefined;
    return value.origin === "null" ? `${value.protocol}//${value.host}` : value.origin;
  } catch {
    return undefined;
  }
}

function parseOrigin(request: IncomingMessage): string | undefined {
  const raw = request.headers.origin;
  return typeof raw === "string" ? normalizeExtensionOrigin(raw) : undefined;
}

function parseIdentity(input: Record<string, unknown>): ExtensionIdentity | undefined {
  const browser = input.browser as BridgeBrowserInfo | undefined;
  if (browser?.family !== "firefox" && browser?.family !== "chromium") return undefined;
  if (typeof input.extensionId !== "string" || input.extensionId.length < 4 || input.extensionId.length > 200) return undefined;
  if (typeof input.extensionVersion !== "string" || input.extensionVersion.length > 50) return undefined;
  if (!Number.isInteger(input.protocolVersion)) return undefined;
  return {
    browser,
    extensionId: input.extensionId,
    extensionVersion: input.extensionVersion,
    protocolVersion: input.protocolVersion as number
  };
}

export class BrowserBridgeServer {
  #server: Server | undefined;
  #bootstrapToken = "";
  #bootstrapCreatedAt = 0;
  #session: Session | undefined;
  #pending = new Map<string, Pending>();
  #commands: Array<{ id: string; command: BrowserCommand; payload: unknown }> = [];
  #extensionSeenAt: number | undefined;
  #lastError: BrowserSetupState | undefined;
  #deviceCount = 0;
  #deviceCounts: Record<SupportedBrowserFamily, number> = { firefox: 0, chromium: 0 };
  #lastObservedBrowserFamily: SupportedBrowserFamily | undefined;
  #enrollment: BrowserEnrollment | undefined;
  readonly #pairings: BrowserPairingStore;

  constructor(readonly config: BrowserBridgeConfig, readonly agentHostVersion = "0.1.0") {
    this.#pairings = new BrowserPairingStore(config.pairingStateFile ?? path.join(path.dirname(config.pairingTokenFile), "paired-devices.json"));
  }

  async start(): Promise<void> {
    if (!this.config.enabled || this.#server !== undefined) return;
    await mkdir(path.dirname(this.config.pairingTokenFile), { recursive: true, mode: 0o700 });
    await this.initializePersistentState();
    const server = createServer((request, response) => void this.#handle(request, response));
    this.#server = server;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(this.config.port, "127.0.0.1", resolve);
      });
    } catch (error) {
      const code = error !== null && typeof error === "object" && "code" in error
        && typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;
      this.#lastError = code === "EADDRINUSE" ? "port_mismatch" : "bridge_unavailable";
      this.#server = undefined;
      server.removeAllListeners();
      try {
        server.close();
      } catch {
        // Failed-to-bind servers have no active listener to clean up.
      }
    }
  }

  async initializePersistentState(): Promise<void> {
    await this.#loadBootstrapToken();
    try {
      const devices = (await this.#pairings.list()).filter((device) => device.revokedAt === undefined);
      this.#deviceCount = devices.length;
      this.#deviceCounts = {
        firefox: devices.filter((device) => device.browserFamily === "firefox").length,
        chromium: devices.filter((device) => device.browserFamily === "chromium").length
      };
    } catch {
      this.#lastError = "device_state_corrupt";
      this.#deviceCount = 0;
      this.#deviceCounts = { firefox: 0, chromium: 0 };
    }
  }

  async close(): Promise<void> {
    this.#clearSession("bridge_unavailable");
    const server = this.#server;
    await new Promise<void>((resolve) => server === undefined ? resolve() : server.close(() => resolve()));
    this.#server = undefined;
  }

  status() {
    const connected = this.#valid();
    const address = this.#server?.address();
    const port = typeof address === "object" && address !== null ? address.port : this.config.port;
    let state: BrowserSetupState;
    if (!this.config.enabled) state = "bridge_disabled";
    else if (this.#lastError !== undefined && [
      "device_state_corrupt",
      "version_mismatch",
      "protocol_mismatch",
      "extension_identity_mismatch",
      "origin_rejected",
      "browser_busy",
      "pairing_revoked",
      "token_expired",
      "token_invalid",
      "port_mismatch",
      "bridge_unavailable"
    ].includes(this.#lastError)) state = this.#lastError;
    else if (this.#server === undefined) state = "bridge_unavailable";
    else if (connected) state = "paired";
    else if (this.#extensionSeenAt === undefined) state = "extension_not_seen";
    else state = "unpaired";
    return {
      enabled: this.config.enabled,
      listening: this.#server !== undefined,
      host: "127.0.0.1",
      port,
      tokenExists: this.#bootstrapValid(),
      extensionSeen: this.#extensionSeenAt !== undefined,
      paired: this.#deviceCount > 0,
      enrolledDeviceCount: this.#deviceCount,
      enrolledDeviceCounts: { ...this.#deviceCounts },
      connected,
      state,
      compatibility: browserCompatibilitySummary(this.agentHostVersion),
      ...(this.#extensionSeenAt === undefined ? {} : { extensionLastSeenAt: new Date(this.#extensionSeenAt).toISOString() }),
      ...(this.#lastObservedBrowserFamily === undefined ? {} : {
        lastObservedBrowserFamily: this.#lastObservedBrowserFamily
      }),
      ...(this.#session === undefined ? {} : {
        browser: this.#session.identity.browser,
        extensionVersion: this.#session.identity.extensionVersion,
        protocolVersion: this.#session.identity.protocolVersion,
        deviceIdSuffix: this.#session.deviceId.slice(-8),
        connectionId: this.#session.connectionId,
        connectedAt: new Date(this.#session.connectedAt).toISOString(),
        lastSeenAt: new Date(this.#session.lastSeen).toISOString()
      }),
      ...(this.#lastError === undefined ? {} : { lastError: this.#lastError }),
      ...(this.#enrollment === undefined ? {} : {
        enrollment: {
          enrollmentId: this.#enrollment.enrollmentId,
          browserFamily: this.#enrollment.browserFamily,
          state: this.#enrollment.state,
          expiresAt: new Date(this.#enrollment.createdAt + ENROLLMENT_MS).toISOString()
        }
      }),
      reason: this.#reason(state)
    };
  }

  beginEnrollment(browserFamily: SupportedBrowserFamily): {
    enrollmentId: string;
    browserFamily: SupportedBrowserFamily;
    state: BrowserEnrollment["state"];
    expiresAt: string;
  } {
    if (!this.config.enabled) {
      throw new Error("bridge_unavailable");
    }
    if (this.#valid()) throw new Error("browser_busy");
    if (this.#enrollment !== undefined
      && this.#enrollment.state !== "cancelled"
      && this.#enrollment.state !== "paired"
      && Date.now() - this.#enrollment.createdAt < ENROLLMENT_MS) {
      throw new Error("browser_busy");
    }
    this.#enrollment = {
      enrollmentId: `browser_enrollment_${randomBytes(16).toString("hex")}`,
      browserFamily,
      state: "waiting_for_extension",
      createdAt: Date.now(),
      delivered: false
    };
    return this.enrollmentStatus(this.#enrollment.enrollmentId);
  }

  enrollmentStatus(enrollmentId: string): {
    enrollmentId: string;
    browserFamily: SupportedBrowserFamily;
    state: BrowserEnrollment["state"];
    expiresAt: string;
    extensionIdentitySuffix?: string;
    approvalFingerprint?: string;
  } {
    const enrollment = this.#activeEnrollment(enrollmentId);
    return {
      enrollmentId: enrollment.enrollmentId,
      browserFamily: enrollment.browserFamily,
      state: enrollment.state,
      expiresAt: new Date(enrollment.createdAt + ENROLLMENT_MS).toISOString(),
      ...(enrollment.identity === undefined
        ? {}
        : {
            extensionIdentitySuffix: enrollment.identity.extensionId.slice(-12),
            approvalFingerprint: this.#approvalFingerprint(enrollment)
          })
    };
  }

  async approveEnrollment(
    enrollmentId: string,
    expectedApprovalFingerprint: string
  ): Promise<ReturnType<BrowserBridgeServer["enrollmentStatus"]>> {
    const enrollment = this.#activeEnrollment(enrollmentId);
    if (enrollment.state !== "waiting_for_approval"
      || enrollment.identity === undefined
      || enrollment.exactOrigin === undefined) {
      throw new Error("browser_enrollment_not_approvable");
    }
    if (!equal(expectedApprovalFingerprint, this.#approvalFingerprint(enrollment))) {
      throw new Error("browser_enrollment_fingerprint_mismatch");
    }
    const enrolled = await this.#pairings.enroll({
      browserFamily: enrollment.identity.browser.family,
      extensionId: enrollment.identity.extensionId,
      exactOrigin: enrollment.exactOrigin,
      extensionVersion: enrollment.identity.extensionVersion,
      protocolVersion: enrollment.identity.protocolVersion
    });
    this.#deviceCount += 1;
    this.#deviceCounts[enrollment.identity.browser.family] += 1;
    const pendingSession: Session = {
      token: randomBytes(32).toString("base64url"),
      connectionId: `browser_connection_${randomBytes(12).toString("hex")}`,
      connectedAt: Date.now(),
      deviceId: enrolled.device.deviceId,
      identity: enrollment.identity,
      exactOrigin: enrollment.exactOrigin,
      lastSeen: Date.now()
    };
    enrollment.state = "approved";
    enrollment.approvedAt = Date.now();
    enrollment.pendingSession = pendingSession;
    enrollment.sessionResponse = this.#sessionResponse(pendingSession, {
      refreshSecret: enrolled.refreshSecret
    });
    this.#lastError = undefined;
    return this.enrollmentStatus(enrollmentId);
  }

  cancelEnrollment(enrollmentId: string): void {
    const enrollment = this.#activeEnrollment(enrollmentId);
    enrollment.state = "cancelled";
    delete enrollment.requestToken;
    delete enrollment.pendingSession;
    delete enrollment.sessionResponse;
  }

  async generatePairingToken(): Promise<{ token: string; created: boolean }> {
    await this.#pairings.revokeAll();
    this.#deviceCount = 0;
    this.#deviceCounts = { firefox: 0, chromium: 0 };
    this.#clearSession("unpaired");
    this.#bootstrapToken = pairingToken();
    this.#bootstrapCreatedAt = Date.now();
    await this.#writeBootstrapToken(this.#bootstrapToken);
    return { token: this.#bootstrapToken, created: true };
  }

  async resetPairing(): Promise<void> {
    await this.#pairings.revokeAll();
    this.#deviceCount = 0;
    this.#deviceCounts = { firefox: 0, chromium: 0 };
    this.#bootstrapToken = "";
    this.#bootstrapCreatedAt = 0;
    this.#clearSession("unpaired");
    this.#enrollment = undefined;
    await unlink(this.config.pairingTokenFile).catch(() => undefined);
  }

  verifyPairing(): boolean {
    return this.#valid();
  }

  /**
   * Drops the active extension session and any queued commands so another
   * paired device can connect next. The bridge holds exactly one session:
   * whoever reconnects first after release wins it. Returns the previous
   * holder's device suffix for verification loops.
   */
  releaseSession(): { released: boolean; previousDeviceSuffix?: string } {
    const previous = this.#session;
    this.#clearSession();
    if (previous !== undefined) this.#lastError = undefined;
    return { released: true, ...(previous === undefined ? {} : { previousDeviceSuffix: previous.deviceId.slice(-8) }) };
  }

  async #loadBootstrapToken(): Promise<void> {
    try {
      const [value, metadata] = await Promise.all([
        readFile(this.config.pairingTokenFile, "utf8"),
        stat(this.config.pairingTokenFile)
      ]);
      this.#bootstrapToken = value.trim();
      this.#bootstrapCreatedAt = metadata.mtimeMs;
      if (!this.#bootstrapValid()) {
        this.#bootstrapToken = "";
        this.#bootstrapCreatedAt = 0;
        await unlink(this.config.pairingTokenFile).catch(() => undefined);
      }
    } catch {
      this.#bootstrapToken = "";
      this.#bootstrapCreatedAt = 0;
    }
  }

  async #writeBootstrapToken(value: string): Promise<void> {
    await mkdir(path.dirname(this.config.pairingTokenFile), { recursive: true, mode: 0o700 });
    await writeFile(this.config.pairingTokenFile, `${value}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(this.config.pairingTokenFile, 0o600);
  }

  async #consumeBootstrapToken(): Promise<void> {
    this.#bootstrapToken = "";
    this.#bootstrapCreatedAt = 0;
    await unlink(this.config.pairingTokenFile).catch(() => undefined);
  }

  #bootstrapValid(): boolean {
    return this.#bootstrapToken.length >= 24 && Date.now() - this.#bootstrapCreatedAt < BOOTSTRAP_TOKEN_MS;
  }

  #valid(): boolean {
    return this.#session !== undefined && Date.now() - this.#session.lastSeen < SESSION_MS;
  }

  #clearSession(reason?: BrowserSetupState): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("browser_extension_unavailable"));
    }
    this.#pending.clear();
    this.#commands = [];
    this.#session = undefined;
    if (reason !== undefined) this.#lastError = reason;
  }

  #reason(state: BrowserSetupState): string {
    return ({
      bridge_disabled: "Browser bridge is disabled.",
      bridge_unavailable: "Browser bridge listener is unavailable.",
      extension_not_seen: "No extension request seen; install extension and verify port.",
      unpaired: this.#deviceCount > 0 ? "Paired browser device is disconnected." : "Extension seen but no browser device is enrolled.",
      paired: "Paired extension connected.",
      token_invalid: "Extension presented an invalid or expired one-time pairing token.",
      token_expired: "Browser session expired; paired extension must reconnect.",
      pairing_revoked: "Browser device pairing was revoked.",
      version_mismatch: "Browser extension and AgentHost bridge versions are incompatible.",
      protocol_mismatch: "Browser extension protocol is incompatible.",
      extension_identity_mismatch: "Browser extension identity does not match the approved artifact.",
      origin_rejected: "Browser extension origin failed exact validation.",
      device_state_corrupt: "Persistent browser pairing state is invalid; reset pairing.",
      browser_busy: "Another paired browser session is active.",
      port_mismatch: "Extension port does not reach AgentHost.",
      manifest_missing: "Prepared extension manifest is missing.",
      unknown_error: "Browser bridge state is unknown."
    } as const)[state];
  }

  #authorized(request: IncomingMessage, exactOrigin: string | undefined): boolean {
    const sessionRoute = (request.method === "GET" && request.url === "/v1/commands")
      || (request.method === "POST" && request.url?.startsWith("/v1/results/") === true);
    return this.#valid()
      && request.headers.authorization === `Bearer ${this.#session!.token}`
      && (exactOrigin === undefined ? sessionRoute : exactOrigin === this.#session!.exactOrigin);
  }

  #compatible(identity: ExtensionIdentity): boolean {
    return identity.protocolVersion === BROWSER_BRIDGE_PROTOCOL_VERSION && extensionVersionCompatible(identity.extensionVersion);
  }

  #identityAllowed(identity: ExtensionIdentity, exactOrigin: string): boolean {
    if (identity.extensionId !== expectedExtensionId(identity.browser.family)) return false;
    return identity.browser.family === "firefox"
      ? exactOrigin.startsWith("moz-extension://")
      : exactOrigin === `chrome-extension://${identity.extensionId}`;
  }

  #approvalFingerprint(enrollment: BrowserEnrollment): string {
    if (enrollment.identity === undefined || enrollment.exactOrigin === undefined) {
      throw new Error("browser_enrollment_identity_unavailable");
    }
    return createHash("sha256").update([
      "agenthost-browser-enrollment-v1",
      enrollment.enrollmentId,
      enrollment.browserFamily,
      enrollment.identity.extensionId,
      enrollment.identity.extensionVersion,
      String(enrollment.identity.protocolVersion),
      enrollment.exactOrigin
    ].join("\0"), "utf8").digest("hex").slice(0, 24);
  }

  #activeEnrollment(enrollmentId: string): BrowserEnrollment {
    const enrollment = this.#enrollment;
    if (enrollment === undefined
      || enrollment.enrollmentId !== enrollmentId
      || enrollment.state === "cancelled"
      || Date.now() - enrollment.createdAt >= ENROLLMENT_MS) {
      throw new Error("enrollment_expired");
    }
    return enrollment;
  }

  async #requestEnrollment(
    input: Record<string, unknown>,
    exactOrigin: string
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const enrollment = this.#enrollment;
    if (enrollment === undefined || Date.now() - enrollment.createdAt >= ENROLLMENT_MS) {
      return { status: 410, body: { error: "enrollment_expired" } };
    }
    const identity = parseIdentity(input);
    if (identity === undefined) return { status: 400, body: { error: "browser_response_invalid" } };
    this.#lastObservedBrowserFamily = identity.browser.family;
    if (identity.browser.family !== enrollment.browserFamily) {
      return { status: 409, body: { error: "browser_selection_mismatch" } };
    }
    if (!this.#identityAllowed(identity, exactOrigin)) {
      this.#lastError = "extension_identity_mismatch";
      return { status: 403, body: { error: "extension_identity_mismatch" } };
    }
    if (identity.protocolVersion !== BROWSER_BRIDGE_PROTOCOL_VERSION) {
      this.#lastError = "protocol_mismatch";
      return { status: 409, body: { error: "protocol_mismatch", compatibility: browserCompatibilitySummary(this.agentHostVersion) } };
    }
    if (!extensionVersionCompatible(identity.extensionVersion)) {
      this.#lastError = "version_mismatch";
      return { status: 409, body: { error: "extension_version_mismatch", compatibility: browserCompatibilitySummary(this.agentHostVersion) } };
    }
    if (enrollment.identity !== undefined || enrollment.exactOrigin !== undefined) {
      const same = enrollment.identity?.browser.family === identity.browser.family
        && enrollment.identity.extensionId === identity.extensionId
        && enrollment.identity.extensionVersion === identity.extensionVersion
        && enrollment.identity.protocolVersion === identity.protocolVersion
        && enrollment.exactOrigin === exactOrigin;
      if (!same) return { status: 409, body: { error: "browser_busy" } };
    } else {
      enrollment.identity = identity;
      enrollment.exactOrigin = exactOrigin;
    }
    enrollment.requestToken ??= randomBytes(32).toString("base64url");
    enrollment.state = "waiting_for_approval";
    this.#extensionSeenAt = Date.now();
    return {
      status: 202,
      body: {
        enrollmentId: enrollment.enrollmentId,
        requestToken: enrollment.requestToken,
        approvalFingerprint: this.#approvalFingerprint(enrollment),
        state: enrollment.state,
        expiresAt: new Date(enrollment.createdAt + ENROLLMENT_MS).toISOString()
      }
    };
  }

  async #pollEnrollment(
    input: Record<string, unknown>,
    exactOrigin: string
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const enrollment = this.#enrollment;
    if (enrollment === undefined || Date.now() - enrollment.createdAt >= ENROLLMENT_MS) {
      return { status: 410, body: { error: "enrollment_expired" } };
    }
    if (typeof input.requestToken !== "string"
      || enrollment.requestToken === undefined
      || !equal(input.requestToken, enrollment.requestToken)
      || exactOrigin !== enrollment.exactOrigin) {
      return { status: 403, body: { error: "origin_rejected" } };
    }
    if (enrollment.state !== "approved"
      || enrollment.sessionResponse === undefined
      || enrollment.pendingSession === undefined) {
      return { status: 202, body: { state: enrollment.state } };
    }
    if (enrollment.delivered) return { status: 409, body: { error: "enrollment_already_delivered" } };
    enrollment.delivered = true;
    enrollment.state = "paired";
    const response = enrollment.sessionResponse;
    this.#session = enrollment.pendingSession;
    delete enrollment.sessionResponse;
    delete enrollment.pendingSession;
    delete enrollment.requestToken;
    return { status: 200, body: response };
  }

  #sessionResponse(session: Session, enrollment?: { refreshSecret: string }) {
    return {
      sessionToken: session.token,
      deviceId: session.deviceId,
      ...(enrollment === undefined ? {} : { refreshSecret: enrollment.refreshSecret }),
      state: "paired",
      compatibility: browserCompatibilitySummary(this.agentHostVersion)
    };
  }

  async protocolRequest(
    route: "/v1/pair" | "/v1/reconnect" | "/v1/enrollment/request" | "/v1/enrollment/status",
    input: Record<string, unknown>,
    exactOrigin: string
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    if (normalizeExtensionOrigin(exactOrigin) !== exactOrigin) return { status: 403, body: { error: "invalid_origin" } };
    this.#extensionSeenAt = Date.now();
    if (route === "/v1/enrollment/request") {
      return await this.#requestEnrollment(input, exactOrigin);
    }
    if (route === "/v1/enrollment/status") {
      return await this.#pollEnrollment(input, exactOrigin);
    }
    if (route === "/v1/pair") {
      if (!this.#bootstrapValid()) {
        this.#lastError = "token_expired";
        return { status: 401, body: { error: "token_expired" } };
      }
      if (typeof input.pairingToken !== "string" || !equal(input.pairingToken, this.#bootstrapToken)) {
        this.#lastError = "token_invalid";
        return { status: 401, body: { error: "token_invalid" } };
      }
      const identity = parseIdentity(input);
      if (identity === undefined) return { status: 400, body: { error: "browser_response_invalid" } };
      this.#lastObservedBrowserFamily = identity.browser.family;
      if (!this.#identityAllowed(identity, exactOrigin)) {
        this.#lastError = "extension_identity_mismatch";
        return { status: 403, body: { error: "extension_identity_mismatch" } };
      }
      if (!this.#compatible(identity)) {
        this.#lastError = "version_mismatch";
        return { status: 409, body: { error: "version_mismatch", compatibility: browserCompatibilitySummary(this.agentHostVersion) } };
      }
      if (this.#valid()) {
        this.#lastError = "browser_busy";
        return { status: 409, body: { error: "browser_busy" } };
      }
      const enrolled = await this.#pairings.enroll({
        browserFamily: identity.browser.family,
        extensionId: identity.extensionId,
        exactOrigin,
        extensionVersion: identity.extensionVersion,
        protocolVersion: identity.protocolVersion
      });
      await this.#consumeBootstrapToken();
      this.#deviceCount = 1;
      this.#deviceCounts = {
        firefox: identity.browser.family === "firefox" ? 1 : 0,
        chromium: identity.browser.family === "chromium" ? 1 : 0
      };
      this.#session = {
        token: randomBytes(32).toString("base64url"),
        connectionId: `browser_connection_${randomBytes(12).toString("hex")}`,
        connectedAt: Date.now(),
        deviceId: enrolled.device.deviceId,
        identity,
        exactOrigin,
        lastSeen: Date.now()
      };
      this.#lastError = undefined;
      return { status: 200, body: this.#sessionResponse(this.#session, { refreshSecret: enrolled.refreshSecret }) };
    }

    const identity = parseIdentity(input);
    if (identity === undefined || typeof input.deviceId !== "string" || typeof input.refreshSecret !== "string") {
      return { status: 400, body: { error: "browser_response_invalid" } };
    }
    this.#lastObservedBrowserFamily = identity.browser.family;
    if (!this.#compatible(identity)) {
      this.#lastError = "version_mismatch";
      return { status: 409, body: { error: "version_mismatch", compatibility: browserCompatibilitySummary(this.agentHostVersion) } };
    }
    if (!this.#identityAllowed(identity, exactOrigin)) {
      this.#lastError = "extension_identity_mismatch";
      return { status: 403, body: { error: "extension_identity_mismatch" } };
    }
    if (this.#valid() && this.#session!.deviceId !== input.deviceId) {
      this.#lastError = "browser_busy";
      return { status: 409, body: { error: "browser_busy" } };
    }
    const device = await this.#pairings.authenticate({
      deviceId: input.deviceId,
      refreshSecret: input.refreshSecret,
      browserFamily: identity.browser.family,
      extensionId: identity.extensionId,
      exactOrigin,
      extensionVersion: identity.extensionVersion,
      protocolVersion: identity.protocolVersion
    });
    if (device === undefined) {
      this.#lastError = "pairing_revoked";
      return { status: 401, body: { error: "pairing_revoked" } };
    }
    this.#session = {
      token: randomBytes(32).toString("base64url"),
      connectionId: `browser_connection_${randomBytes(12).toString("hex")}`,
      connectedAt: Date.now(),
      deviceId: device.deviceId,
      identity,
      exactOrigin,
      lastSeen: Date.now()
    };
    this.#deviceCount = Math.max(this.#deviceCount, 1);
    this.#lastError = undefined;
    return { status: 200, body: this.#sessionResponse(this.#session) };
  }

  async command(command: BrowserCommand, payload: unknown): Promise<unknown> {
    if (!this.config.enabled) throw new Error("browser_bridge_disabled");
    if (!this.#valid()) throw new Error("browser_pairing_required");
    if (this.#commands.length >= MAX_COMMANDS || this.#pending.size >= MAX_COMMANDS) throw new Error("browser_command_queue_full");
    const id = randomBytes(12).toString("hex");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        this.#commands = this.#commands.filter((item) => item.id !== id);
        reject(new Error("browser_command_timeout"));
      }, COMMAND_TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timer });
      this.#commands.push({ id, command, payload });
    });
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const exactOrigin = parseOrigin(request);
      const url = request.url ?? "";
      const sessionRoute = (request.method === "GET" && url === "/v1/commands")
        || (request.method === "POST" && url.startsWith("/v1/results/"));
      if (exactOrigin === undefined && !sessionRoute) return json(response, 403, { error: "invalid_origin" });

      if (request.method === "POST" && url === "/v1/pair") {
        if (exactOrigin === undefined) return json(response, 403, { error: "invalid_origin" });
        const input = await body(request);
        const result = await this.protocolRequest("/v1/pair", input, exactOrigin);
        return json(response, result.status, result.body);
      }

      if (request.method === "POST" && url === "/v1/reconnect") {
        if (exactOrigin === undefined) return json(response, 403, { error: "invalid_origin" });
        const input = await body(request);
        const result = await this.protocolRequest("/v1/reconnect", input, exactOrigin);
        return json(response, result.status, result.body);
      }

      if (request.method === "POST" && url === "/v1/enrollment/request") {
        if (exactOrigin === undefined) return json(response, 403, { error: "invalid_origin" });
        const input = await body(request);
        const result = await this.protocolRequest("/v1/enrollment/request", input, exactOrigin);
        return json(response, result.status, result.body);
      }

      if (request.method === "POST" && url === "/v1/enrollment/status") {
        if (exactOrigin === undefined) return json(response, 403, { error: "invalid_origin" });
        const input = await body(request);
        const result = await this.protocolRequest("/v1/enrollment/status", input, exactOrigin);
        return json(response, result.status, result.body);
      }

      if (!this.#authorized(request, exactOrigin)) return json(response, 401, { error: "browser_session_expired" });
      this.#session!.lastSeen = Date.now();
      this.#extensionSeenAt = this.#session!.lastSeen;

      if (request.method === "GET" && url === "/v1/commands") {
        return json(response, 200, { commands: this.#commands.splice(0) });
      }
      if (request.method === "POST" && url.startsWith("/v1/results/")) {
        const id = url.slice("/v1/results/".length);
        const pending = this.#pending.get(id);
        if (pending === undefined) return json(response, 404, { error: "unknown_command" });
        this.#pending.delete(id);
        clearTimeout(pending.timer);
        const result = await body(request);
        result.ok === true
          ? pending.resolve(result.data)
          : pending.reject(new Error(typeof result.error === "string" ? result.error : "browser_response_invalid"));
        return json(response, 200, { ok: true });
      }
      return json(response, 404, { error: "unknown_endpoint" });
    } catch (error) {
      const code = error instanceof Error ? error.message : "browser_response_invalid";
      this.#lastError = code === "browser_pairing_state_corrupt" ? "device_state_corrupt" : "unknown_error";
      return json(response, 400, { error: code });
    }
  }
}
