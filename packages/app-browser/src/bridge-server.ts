import { randomBytes, timingSafeEqual } from "node:crypto";
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

const MAX_BODY = 256 * 1024;
const COMMAND_TIMEOUT_MS = 10_000;
const SESSION_MS = 5 * 60_000;
const BOOTSTRAP_TOKEN_MS = 10 * 60_000;
const MAX_COMMANDS = 64;

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
  deviceId: string;
  identity: ExtensionIdentity;
  exactOrigin: string;
  lastSeen: number;
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
  readonly #pairings: BrowserPairingStore;

  constructor(readonly config: BrowserBridgeConfig, readonly agentHostVersion = "0.1.0") {
    this.#pairings = new BrowserPairingStore(config.pairingStateFile ?? path.join(path.dirname(config.pairingTokenFile), "paired-devices.json"));
  }

  async start(): Promise<void> {
    if (!this.config.enabled || this.#server !== undefined) return;
    await mkdir(path.dirname(this.config.pairingTokenFile), { recursive: true, mode: 0o700 });
    await this.initializePersistentState();
    this.#server = createServer((request, response) => void this.#handle(request, response));
    await new Promise<void>((resolve, reject) => {
      this.#server!.once("error", reject);
      this.#server!.listen(this.config.port, "127.0.0.1", resolve);
    });
  }

  async initializePersistentState(): Promise<void> {
    await this.#loadBootstrapToken();
    try {
      this.#deviceCount = (await this.#pairings.list()).filter((device) => device.revokedAt === undefined).length;
    } catch {
      this.#lastError = "device_state_corrupt";
      this.#deviceCount = 0;
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
    else if (this.#server === undefined) state = "bridge_unavailable";
    else if (this.#lastError !== undefined && [
      "device_state_corrupt",
      "version_mismatch",
      "browser_busy",
      "pairing_revoked",
      "token_expired",
      "token_invalid"
    ].includes(this.#lastError)) state = this.#lastError;
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
      connected,
      state,
      compatibility: browserCompatibilitySummary(this.agentHostVersion),
      ...(this.#extensionSeenAt === undefined ? {} : { extensionLastSeenAt: new Date(this.#extensionSeenAt).toISOString() }),
      ...(this.#session === undefined ? {} : {
        browser: this.#session.identity.browser,
        extensionVersion: this.#session.identity.extensionVersion,
        protocolVersion: this.#session.identity.protocolVersion,
        deviceIdSuffix: this.#session.deviceId.slice(-8),
        lastSeenAt: new Date(this.#session.lastSeen).toISOString()
      }),
      ...(this.#lastError === undefined ? {} : { lastError: this.#lastError }),
      reason: this.#reason(state)
    };
  }

  async generatePairingToken(): Promise<{ token: string; created: boolean }> {
    await this.#pairings.revokeAll();
    this.#deviceCount = 0;
    this.#clearSession("unpaired");
    this.#bootstrapToken = pairingToken();
    this.#bootstrapCreatedAt = Date.now();
    await this.#writeBootstrapToken(this.#bootstrapToken);
    return { token: this.#bootstrapToken, created: true };
  }

  async resetPairing(): Promise<void> {
    await this.#pairings.revokeAll();
    this.#deviceCount = 0;
    this.#bootstrapToken = "";
    this.#bootstrapCreatedAt = 0;
    this.#clearSession("unpaired");
    await unlink(this.config.pairingTokenFile).catch(() => undefined);
  }

  verifyPairing(): boolean {
    return this.#valid();
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
      device_state_corrupt: "Persistent browser pairing state is invalid; reset pairing.",
      browser_busy: "Another paired browser session is active.",
      port_mismatch: "Extension port does not reach AgentHost.",
      manifest_missing: "Prepared extension manifest is missing.",
      unknown_error: "Browser bridge state is unknown."
    } as const)[state];
  }

  #authorized(request: IncomingMessage, exactOrigin: string): boolean {
    return this.#valid()
      && request.headers.authorization === `Bearer ${this.#session!.token}`
      && exactOrigin === this.#session!.exactOrigin;
  }

  #compatible(identity: ExtensionIdentity): boolean {
    return identity.protocolVersion === BROWSER_BRIDGE_PROTOCOL_VERSION && extensionVersionCompatible(identity.extensionVersion);
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
    route: "/v1/pair" | "/v1/reconnect",
    input: Record<string, unknown>,
    exactOrigin: string
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    if (normalizeExtensionOrigin(exactOrigin) !== exactOrigin) return { status: 403, body: { error: "invalid_origin" } };
    this.#extensionSeenAt = Date.now();
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
      if (identity.browser.family === "chromium" && exactOrigin !== `chrome-extension://${identity.extensionId}`) {
        return { status: 403, body: { error: "invalid_origin" } };
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
      this.#session = {
        token: randomBytes(32).toString("base64url"),
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
    if (!this.#compatible(identity)) {
      this.#lastError = "version_mismatch";
      return { status: 409, body: { error: "version_mismatch", compatibility: browserCompatibilitySummary(this.agentHostVersion) } };
    }
    if (identity.browser.family === "chromium" && exactOrigin !== `chrome-extension://${identity.extensionId}`) {
      return { status: 403, body: { error: "invalid_origin" } };
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
      if (exactOrigin === undefined) return json(response, 403, { error: "invalid_origin" });
      const url = request.url ?? "";

      if (request.method === "POST" && url === "/v1/pair") {
        const input = await body(request);
        const result = await this.protocolRequest("/v1/pair", input, exactOrigin);
        return json(response, result.status, result.body);
      }

      if (request.method === "POST" && url === "/v1/reconnect") {
        const input = await body(request);
        const result = await this.protocolRequest("/v1/reconnect", input, exactOrigin);
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
