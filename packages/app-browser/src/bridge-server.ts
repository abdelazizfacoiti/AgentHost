import { timingSafeEqual, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserBridgeConfig } from "@agenthost/core";
import type { BridgeBrowserInfo, BrowserCommand } from "./types.js";

const MAX_BODY = 256 * 1024;
const TIMEOUT_MS = 10_000;
const SESSION_MS = 5 * 60_000;
export type BrowserSetupState = "bridge_disabled" | "bridge_unavailable" | "extension_not_seen" | "unpaired" | "paired" | "token_invalid" | "token_expired" | "port_mismatch" | "manifest_missing" | "unknown_error";
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type Session = { token: string; browser: BridgeBrowserInfo; lastSeen: number };

function json(response: ServerResponse, status: number, body: unknown) { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(body)); }
function token(): string { return `AH-${randomBytes(15).toString("hex").toUpperCase().match(/.{1,5}/g)!.join("-")}`; }
function equal(left: string, right: string): boolean { const a = Buffer.from(left), b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
async function body(request: IncomingMessage): Promise<Record<string, unknown>> { const chunks: Buffer[] = []; let size = 0; for await (const chunk of request) { const item = Buffer.from(chunk); size += item.length; if (size > MAX_BODY) throw new Error("body_too_large"); chunks.push(item); } return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>; }

export class BrowserBridgeServer {
  #server: Server | undefined;
  #token = "";
  #session: Session | undefined;
  #pending = new Map<string, Pending>();
  #commands: Array<{ id: string; command: BrowserCommand; payload: unknown }> = [];
  #extensionSeenAt: number | undefined;
  #lastError: BrowserSetupState | undefined;

  constructor(readonly config: BrowserBridgeConfig) {}

  async start(): Promise<void> {
    if (!this.config.enabled || this.#server !== undefined) return;
    await mkdir(path.dirname(this.config.pairingTokenFile), { recursive: true, mode: 0o700 });
    this.#token = await this.#readOrCreateToken();
    this.#server = createServer((request, response) => void this.#handle(request, response));
    await new Promise<void>((resolve, reject) => { this.#server!.once("error", reject); this.#server!.listen(this.config.port, "127.0.0.1", resolve); });
  }

  async close(): Promise<void> { this.#clearSession("bridge_unavailable"); const server = this.#server; await new Promise<void>((resolve) => server === undefined ? resolve() : server.close(() => resolve())); this.#server = undefined; }

  status() {
    const connected = this.#valid();
    const state: BrowserSetupState = !this.config.enabled ? "bridge_disabled" : this.#server === undefined ? "bridge_unavailable" : this.#lastError === "token_invalid" ? "token_invalid" : connected ? "paired" : this.#extensionSeenAt === undefined ? "extension_not_seen" : "unpaired";
    return { enabled: this.config.enabled, listening: this.#server !== undefined, port: this.config.port, tokenExists: this.#token.length > 0, extensionSeen: this.#extensionSeenAt !== undefined, paired: this.#session !== undefined, connected, state, ...(this.#extensionSeenAt === undefined ? {} : { extensionLastSeenAt: new Date(this.#extensionSeenAt).toISOString() }), ...(this.#session === undefined ? {} : { browser: this.#session.browser, lastSeenAt: new Date(this.#session.lastSeen).toISOString() }), ...(this.#lastError === undefined ? {} : { lastError: this.#lastError }), reason: this.#reason(state) };
  }

  async generatePairingToken(): Promise<{ token: string; created: boolean }> { if (this.#token.length > 0) return { token: this.#token, created: false }; this.#token = token(); await this.#writeToken(this.#token); return { token: this.#token, created: true }; }
  async resetPairing(): Promise<string> { this.#clearSession("unpaired"); this.#token = token(); await this.#writeToken(this.#token); return this.#token; }
  verifyPairing(): boolean { return this.#valid(); }

  async #readOrCreateToken(): Promise<string> { try { const value = (await readFile(this.config.pairingTokenFile, "utf8")).trim(); if (value.length >= 24) return value; } catch { /* create below */ } const value = token(); await this.#writeToken(value); return value; }
  async #writeToken(value: string): Promise<void> { await mkdir(path.dirname(this.config.pairingTokenFile), { recursive: true, mode: 0o700 }); await writeFile(this.config.pairingTokenFile, `${value}\n`, { encoding: "utf8", mode: 0o600 }); await chmod(this.config.pairingTokenFile, 0o600); }
  #valid(): boolean { return this.#session !== undefined && Date.now() - this.#session.lastSeen < SESSION_MS; }
  #clearSession(reason?: BrowserSetupState): void { for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("browser_extension_unavailable")); } this.#pending.clear(); this.#session = undefined; if (reason !== undefined) this.#lastError = reason; }
  #reason(state: BrowserSetupState): string { return ({ bridge_disabled: "Browser bridge is disabled.", bridge_unavailable: "Browser bridge listener is unavailable.", extension_not_seen: "No extension request seen; install extension and verify port.", unpaired: "Extension seen but not paired.", paired: "Paired extension connected.", token_invalid: "Extension presented an invalid pairing token.", token_expired: "Browser session expired; extension should reconnect.", port_mismatch: "Extension port does not reach AgentHost.", manifest_missing: "Prepared extension manifest is missing.", unknown_error: "Browser bridge state is unknown." } as const)[state]; }
  #origin(request: IncomingMessage) { const origin = request.headers.origin ?? ""; return typeof origin === "string" && (origin.startsWith("moz-extension://") || origin.startsWith("chrome-extension://")); }
  #authorized(request: IncomingMessage) { return this.#valid() && request.headers.authorization === `Bearer ${this.#session!.token}`; }

  async command(command: BrowserCommand, payload: unknown): Promise<unknown> {
    if (!this.config.enabled) throw new Error("browser_bridge_disabled");
    if (!this.#valid()) throw new Error("browser_pairing_required");
    const id = randomBytes(12).toString("hex");
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.#pending.delete(id); reject(new Error("browser_command_timeout")); }, TIMEOUT_MS); this.#pending.set(id, { resolve, reject, timer }); this.#commands.push({ id, command, payload }); });
  }

  async #handle(request: IncomingMessage, response: ServerResponse) {
    try {
      if (!this.#origin(request)) return json(response, 403, { error: "invalid_origin" });
      const url = request.url ?? "";
      if (request.method === "POST" && url === "/v1/pair") {
        const input = await body(request); this.#extensionSeenAt = Date.now();
        if (typeof input.pairingToken !== "string" || !equal(input.pairingToken, this.#token)) { this.#lastError = "token_invalid"; return json(response, 401, { error: "token_invalid" }); }
        const browser = input.browser as BridgeBrowserInfo;
        if (browser?.family !== "firefox" && browser?.family !== "chromium") return json(response, 400, { error: "browser_response_invalid" });
        this.#session = { token: randomBytes(32).toString("base64url"), browser, lastSeen: Date.now() }; this.#lastError = undefined;
        return json(response, 200, { sessionToken: this.#session.token, state: "paired" });
      }
      if (!this.#authorized(request)) return json(response, 401, { error: "browser_session_expired" });
      this.#session!.lastSeen = Date.now(); this.#extensionSeenAt = this.#session!.lastSeen;
      if (request.method === "GET" && url === "/v1/commands") return json(response, 200, { commands: this.#commands.splice(0) });
      if (request.method === "POST" && url.startsWith("/v1/results/")) { const id = url.slice("/v1/results/".length); const pending = this.#pending.get(id); if (pending === undefined) return json(response, 404, { error: "unknown_command" }); this.#pending.delete(id); clearTimeout(pending.timer); const result = await body(request); result.ok === true ? pending.resolve(result.data) : pending.reject(new Error(typeof result.error === "string" ? result.error : "browser_response_invalid")); return json(response, 200, { ok: true }); }
      return json(response, 404, { error: "unknown_endpoint" });
    } catch (error) { this.#lastError = "unknown_error"; return json(response, 400, { error: error instanceof Error ? error.message : "browser_response_invalid" }); }
  }
}
