import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prepareRuntimeRun, runForgeSubprocess } from "../forge-subprocess.js";

describe("Forge subprocess runner", () => {
  it("runs fixed JSON handler with clean environment", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-forge-"));
    const project = path.join(root, "project");
    const run = path.join(root, "run");
    await Promise.all([mkdir(path.join(project, "runtime"), { recursive: true }), mkdir(run)]);
    await writeFile(path.join(project, "agenthost.manifest.json"), JSON.stringify({ tools: [{ name: "inspect", inputSchema: { type: "object", required: ["value"], properties: { value: { type: "string" } }, additionalProperties: false }, outputSchema: { type: "object", required: ["value"], properties: { value: { type: "string" } }, additionalProperties: false } }] }));
    await writeFile(path.join(project, "runtime", "handler.json"), JSON.stringify({ schemaVersion: "agenthost.forge.handler.v1", tools: { inspect: { op: "object", entries: { value: { op: "input", pointer: "/value" } } } } }));
    const paths = await prepareRuntimeRun({ runDirectory: run, payload: { value: "ok" } });
    const result = await runForgeSubprocess({ projectPath: project, manifestPath: path.join(project, "agenthost.manifest.json"), handlerPath: path.join(project, "runtime", "handler.json"), toolName: "inspect", inputPath: paths.inputPath, outputPath: paths.outputPath, tempDirectory: paths.tempDirectory, runnerPath: path.resolve("packages/mcp-server/dist/runtime/forge-runner.js") });
    expect(result.status, JSON.stringify(result)).toBe("passed");
    expect(result.result).toEqual({ value: "ok" });
    expect(result.envKeys).not.toContain("DISPLAY");
    expect(JSON.parse(await readFile(paths.outputPath, "utf8"))).toMatchObject({ ok: true });
  });

  it("kills timed out runner and caps stdout", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-forge-"));
    const project = path.join(root, "project"); const run = path.join(root, "run");
    await Promise.all([mkdir(path.join(project, "runtime"), { recursive: true }), mkdir(run)]);
    await writeFile(path.join(project, "agenthost.manifest.json"), JSON.stringify({ tools: [{ name: "inspect", inputSchema: {}, outputSchema: {} }] }));
    await writeFile(path.join(project, "runtime", "handler.json"), "{}");
    await writeFile(path.join(root, "hang.mjs"), "setInterval(() => {}, 1000);");
    const paths = await prepareRuntimeRun({ runDirectory: run, payload: {} });
    const result = await runForgeSubprocess({ projectPath: project, manifestPath: path.join(project, "agenthost.manifest.json"), handlerPath: path.join(project, "runtime", "handler.json"), toolName: "inspect", inputPath: paths.inputPath, outputPath: paths.outputPath, tempDirectory: paths.tempDirectory, runnerPath: path.join(root, "hang.mjs"), timeoutMs: 1 });
    expect(result.status).toBe("timeout");
  });
});
