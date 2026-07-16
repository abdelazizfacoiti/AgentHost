import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { request } from "node:http";
import { describe, expect, it } from "vitest";
import { ControlRoomServer, type ControlRoomReportProvider } from "../index.js";

function provider(): ControlRoomReportProvider {
  const health = { service: "available" as const, stores: { activity: "available" as const, workflows: "available" as const, forge: "available" as const, scheduler: "available" as const }, limitations: ["Read-only reporting."] };
  return {
    dashboard: async () => ({ generatedAt: new Date().toISOString(), range: { from: "", to: "" }, counts: { active: 0, recent: 0, completed: 0, failed: 0, cancelled: 0, blocked: 0, toolExecutions: 0, screenshotCaptures: 0, confirmationRequests: 0 }, recentActivity: [], health }),
    tasks: async () => ({ tasks: [], truncated: false }), task: async () => { throw new Error("control_room_task_not_found"); }, timeline: async () => ({ events: [], truncated: false }), screenshots: async () => ({ screenshots: [], truncated: false }), screenshot: async () => { throw new Error("control_room_screenshot_not_found"); }, health: async () => health
  };
}
async function get(port: number, url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> { return new Promise((resolve, reject) => { const req = request({ hostname: "127.0.0.1", port, path: url, method: "GET", headers }, (res) => { const chunks: Buffer[] = []; res.on("data", (chunk) => chunks.push(Buffer.from(chunk))); res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") })); }); req.on("error", reject); req.end(); }); }

describe("ControlRoomServer", () => {
  it("binds loopback, requires token, rejects non-read methods, and serves bounded reports", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-control-room-"));
    const server = new ControlRoomServer({ enabled: true, port: 43180, accessTokenFile: path.join(root, "access-token") }, provider());
    let started: Awaited<ReturnType<ControlRoomServer["start"]>>;
    try { started = await server.start(); } catch (error) { if (error instanceof Error && /EPERM|EACCES/.test(error.message)) return; throw error; }
    const token = (await readFile(started.tokenFile, "utf8")).trim();
    expect((await get(43180, "/api/v1/status")).status).toBe(401);
    expect((await get(43180, "/api/v1/dashboard", { authorization: "Bearer " + token })).status).toBe(200);
    expect((await get(43180, "/api/v1/dashboard", { authorization: "Bearer wrong", origin: "http://evil.invalid" })).status).toBe(403);
    expect((await get(43180, "/api/v1/dashboard", { authorization: "Bearer " + token, origin: "http://127.0.0.1:43180" })).status).toBe(200);
    expect((await get(43180, "/api/v1/dashboard", { authorization: "Bearer " + token, origin: "http://evil.invalid" })).status).toBe(403);
    expect((await get(43180, "/api/v1/tasks?cursor=bad", { authorization: "Bearer " + token })).status).toBe(400);
    expect((await get(43180, "/api/v1/tasks?from=not-a-date", { authorization: "Bearer " + token })).status).toBe(400);
    expect((await get(43180, "/api/v1/tasks?limit=10000", { authorization: "Bearer " + token })).status).toBe(200);
    await server.close();
    await expect(readFile(started.tokenFile, "utf8")).rejects.toThrow();
  });
});
