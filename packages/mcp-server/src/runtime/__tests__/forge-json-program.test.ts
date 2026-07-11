import { describe, expect, it } from "vitest";
import { evaluateProgram, ForgeProgramError, parseProgram, validateSchema } from "../forge-json-program.js";

describe("Forge JSON program", () => {
  it("evaluates bounded JSON input/output", () => {
    const program = parseProgram(JSON.stringify({ schemaVersion: "agenthost.forge.handler.v1", tools: { inspect: { op: "object", entries: { name: { op: "input", pointer: "/name" }, label: { op: "concat", values: [{ op: "const", value: "ok-" }, { op: "input", pointer: "/name" }] } } } } }));
    expect(evaluateProgram(program, "inspect", { name: "safe" })).toEqual({ name: "safe", label: "ok-safe" });
  });

  it("rejects unsupported operations and schema keywords", () => {
    expect(() => parseProgram(JSON.stringify({ schemaVersion: "agenthost.forge.handler.v1", tools: { bad: { op: "fetch" } } }))).toThrow(ForgeProgramError);
    expect(() => validateSchema({ oneOf: [] }, null)).toThrow(ForgeProgramError);
  });
});
