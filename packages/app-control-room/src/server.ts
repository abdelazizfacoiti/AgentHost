import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import type { ControlRoomConfig } from "@agenthost/core";
import type { ControlRoomReportProvider } from "./types.js";
import { CONTROL_ROOM_HTML } from "./static.js";

const MAX_LIMIT = 100;
const MAX_REQUEST_URL = 2000;
const MAX_RESPONSE_BYTES = 1_000_000;

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value) ?? "null";
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
    response.writeHead(413, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    response.end(JSON.stringify({ error: "control_room_response_too_large" }));
    return;
  }
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(body);
}
function equal(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function safeId(value: string): string { return value.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 200); }
function queryCursor(value: string | null): number | undefined {
  if (value === null) return 0;
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
function queryDate(value: string | null): string | undefined | null {
  if (value === null) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export interface ControlRoomStartResult { url: string; tokenFile: string; port: number; }

export class ControlRoomServer {
  #server: Server | undefined;
  #token = "";
  constructor(readonly config: ControlRoomConfig, readonly provider: ControlRoomReportProvider) {}

  async start(): Promise<ControlRoomStartResult> {
    if (this.#server !== undefined) return { url: "http://127.0.0.1:" + this.config.port + "/", tokenFile: this.config.accessTokenFile, port: this.config.port };
    this.#token = randomBytes(32).toString("base64url");
    await mkdir(path.dirname(this.config.accessTokenFile), { recursive: true, mode: 0o700 });
    await writeFile(this.config.accessTokenFile, this.#token + "\n", { encoding: "utf8", mode: 0o600 });
    await chmod(this.config.accessTokenFile, 0o600);
    this.#server = createServer((request, response) => void this.#handle(request, response));
    try {
      await new Promise<void>((resolve, reject) => {
        this.#server!.once("error", reject);
        this.#server!.listen(this.config.port, "127.0.0.1", resolve);
      });
    } catch (error) {
      this.#server = undefined;
      await this.#removeTokenFile(this.#token);
      this.#token = "";
      throw error;
    }
    return { url: "http://127.0.0.1:" + this.config.port + "/#accessToken=" + encodeURIComponent(this.#token), tokenFile: this.config.accessTokenFile, port: this.config.port };
  }

  async close(): Promise<void> {
    const server = this.#server;
    const token = this.#token;
    this.#server = undefined;
    this.#token = "";
    await new Promise<void>((resolve) => server === undefined ? resolve() : server.close(() => resolve()));
    await this.#removeTokenFile(token);
  }
  status(): { listening: boolean; port: number } { return { listening: this.#server !== undefined, port: this.config.port }; }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.url === undefined || request.url.length > MAX_REQUEST_URL) return json(response, 414, { error: "control_room_request_too_large" });
      const origin = request.headers.origin;
      if (origin !== undefined && origin !== "http://127.0.0.1:" + this.config.port) return json(response, 403, { error: "control_room_origin_rejected" });
      if (request.method === "GET" && (request.url === "/" || request.url === "/index.html")) {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
        response.end(CONTROL_ROOM_HTML);
        return;
      }
      const authorization = request.headers.authorization;
      if (typeof authorization !== "string" || !authorization.startsWith("Bearer ") || !equal(authorization.slice(7), this.#token)) return json(response, 401, { error: "control_room_unauthorized" });
      if (request.method === "POST") {
        const parsed = new URL(request.url, "http://127.0.0.1:" + this.config.port);
        if (parsed.pathname === "/api/v1/agent/stop") {
          if (this.provider.agentControl === undefined) return json(response, 404, { error: "control_room_not_found" });
          return json(response, 200, await this.provider.agentControl({ action: "stop" }));
        }
        if (parsed.pathname === "/api/v1/agent/resume") {
          if (this.provider.agentControl === undefined) return json(response, 404, { error: "control_room_not_found" });
          return json(response, 200, await this.provider.agentControl({ action: "resume" }));
        }
        return json(response, 405, { error: "control_room_read_only" });
      }
      if (request.method !== "GET") return json(response, 405, { error: "control_room_read_only" });
      const parsed = new URL(request.url, "http://127.0.0.1:" + this.config.port);
      const limitValue = Number(parsed.searchParams.get("limit") ?? "50");
      const limit = Number.isFinite(limitValue) ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(limitValue))) : 50;
      const from = queryDate(parsed.searchParams.get("from"));
      const to = queryDate(parsed.searchParams.get("to"));
      if (from === null || to === null || (from !== undefined && to !== undefined && from > to)) return json(response, 400, { error: "control_room_invalid_range" });
      const cursor = queryCursor(parsed.searchParams.get("cursor"));
      if (cursor === undefined) return json(response, 400, { error: "control_room_invalid_cursor" });
      if (parsed.pathname === "/api/v1/status") return json(response, 200, { enabled: this.config.enabled, listening: true, port: this.config.port });
      if (parsed.pathname === "/api/v1/agent/status") {
        if (this.provider.agentStatus === undefined) return json(response, 404, { error: "control_room_not_found" });
        return json(response, 200, await this.provider.agentStatus());
      }
      if (parsed.pathname === "/api/v1/dashboard") return json(response, 200, await this.provider.dashboard({ ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) }));
      if (parsed.pathname === "/api/v1/health") return json(response, 200, await this.provider.health());
      if (parsed.pathname === "/api/v1/tasks") { const status = parsed.searchParams.get("status"); return json(response, 200, await this.provider.tasks({ limit, ...(cursor === 0 ? {} : { cursor: String(cursor) }), ...(status === null ? {} : { status }), ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) })); }
      if (parsed.pathname === "/api/v1/screenshots") { const taskId = parsed.searchParams.get("taskId"); return json(response, 200, await this.provider.screenshots({ limit, ...(cursor === 0 ? {} : { cursor: String(cursor) }), ...(taskId === null ? {} : { taskId }), ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) })); }
      const taskMatch = /^\/api\/v1\/tasks\/([^/]+)(?:\/(timeline))?$/.exec(parsed.pathname);
      if (taskMatch !== null) {
        const taskId = safeId(decodeURIComponent(taskMatch[1]!));
        if (!taskId) return json(response, 400, { error: "control_room_invalid_id" });
        return json(response, 200, taskMatch[2] === "timeline" ? await this.provider.timeline(taskId, { limit, ...(cursor === 0 ? {} : { cursor: String(cursor) }), ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) }) : await this.provider.task(taskId));
      }
      const screenshotMatch = /^\/api\/v1\/screenshots\/([^/]+)$/.exec(parsed.pathname);
      if (screenshotMatch !== null) {
        const screenshotId = safeId(decodeURIComponent(screenshotMatch[1]!));
        if (!screenshotId) return json(response, 400, { error: "control_room_invalid_id" });
        return json(response, 200, await this.provider.screenshot(screenshotId));
      }
      return json(response, 404, { error: "control_room_not_found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "control_room_unavailable";
      return json(response, message.endsWith("_not_found") ? 404 : 500, { error: message.endsWith("_not_found") ? message : "control_room_unavailable" });
    }
  }

  async #removeTokenFile(token: string): Promise<void> {
    if (!token) return;
    try {
      const stored = (await readFile(this.config.accessTokenFile, "utf8")).trim();
      if (equal(stored, token)) await unlink(this.config.accessTokenFile);
    } catch { /* Token cleanup is best effort; stale token is invalid without live server state. */ }
  }
}
