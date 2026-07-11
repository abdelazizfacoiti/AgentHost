#!/usr/bin/env node
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluateProgram, ForgeProgramError, FORGE_JSON_BYTES_MAX, parseJsonValue, parseProgram, validateSchema } from "./forge-json-program.js";

interface Args { manifest: string; project: string; tool: string; input: string; output: string; handler: string; }
function argument(name: string): string { const index = process.argv.indexOf(`--${name}`); const value = index < 0 ? undefined : process.argv[index + 1]; if (value === undefined || value.startsWith("--")) throw new ForgeProgramError("invalid_arguments", `Missing --${name}.`); return value; }
function parseArgs(): Args { return { manifest: argument("manifest"), project: argument("project"), tool: argument("tool"), input: argument("input"), output: argument("output"), handler: argument("handler") }; }
function fail(code: string, message: string): never { process.stderr.write(`${JSON.stringify({ ok: false, error: { code, message } })}\n`); process.exitCode = 1; throw new Error(message); }
async function main(): Promise<void> {
  const args = parseArgs();
  const project = path.resolve(args.project);
  const manifestPath = path.resolve(args.manifest);
  const handlerPath = path.resolve(args.handler);
  const inputPath = path.resolve(args.input);
  const outputPath = path.resolve(args.output);
  if (manifestPath !== path.join(project, "agenthost.manifest.json") || handlerPath !== path.join(project, "runtime", "handler.json") || path.dirname(inputPath) !== path.dirname(outputPath) || path.basename(inputPath) !== "input.json" || path.basename(outputPath) !== "output.json") {
    throw new ForgeProgramError("sandbox_path_invalid", "Runner paths do not match approved sandbox contract.");
  }
  const [manifestText, handlerText, inputText] = await Promise.all([readFile(manifestPath, "utf8"), readFile(handlerPath, "utf8"), readFile(inputPath, "utf8")]);
  const manifest = JSON.parse(manifestText) as { tools?: Array<{ name?: unknown; inputSchema?: unknown; outputSchema?: unknown }> };
  const tool = manifest.tools?.find((entry) => entry.name === args.tool);
  if (tool === undefined) throw new ForgeProgramError("tool_not_found", "Manifest does not declare requested tool.");
  if (tool.inputSchema === undefined || tool.outputSchema === undefined) throw new ForgeProgramError("schema_missing", "Tool must declare input and output schemas.");
  const input = parseJsonValue(inputText);
  validateSchema(tool.inputSchema, input);
  const result = evaluateProgram(parseProgram(handlerText), args.tool, input);
  validateSchema(tool.outputSchema, result);
  const output = JSON.stringify({ ok: true, toolName: args.tool, result });
  if (Buffer.byteLength(output, "utf8") > FORGE_JSON_BYTES_MAX) throw new ForgeProgramError("output_too_large", "Runner output exceeds sandbox size limit.");
  const temporary = `${args.output}.tmp`;
  await writeFile(temporary, `${output}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, outputPath);
}
main().catch((error: unknown) => { const known = error instanceof ForgeProgramError ? error : new ForgeProgramError("runner_failed", error instanceof Error ? error.message : "Runner failed."); if (!(error instanceof Error && error.message === known.message && process.exitCode === 1)) { process.stderr.write(`${JSON.stringify({ ok: false, error: { code: known.code, message: known.message } })}\n`); } process.exitCode = 1; });
