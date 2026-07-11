import { describe, expect, it } from "vitest";
import { evaluateRuntimeGrantCoverage } from "../runtime-grants.js";
import type { ToolForgeRuntimeCapability, ToolForgeRuntimeOperation } from "../types.js";

const input = { generatedToolId: "example.tool", registrationId: "registration.one", toolName: "example.inspect", capabilities: ["pure_compute", "read_runtime_input", "write_runtime_output"] as ToolForgeRuntimeCapability[], operations: ["const", "input", "object"] as ToolForgeRuntimeOperation[] };

describe("runtime grant coverage", () => {
  it("requires capability-specific active allow grants", () => {
    const coverage = evaluateRuntimeGrantCoverage(input, [{ id: "allow", scope: "session", effect: "allow", match: { generatedToolIds: ["example.tool"], runtimeToolNames: ["example.inspect"], runtimeCapabilities: [...input.capabilities] }, requirements: { allowedOperations: [...input.operations], maxRuntimeMs: 400 } }]);
    expect(coverage.grantedCapabilities).toEqual([...input.capabilities]);
    expect(coverage.allowedOperations).toEqual([...input.operations]);
    expect(coverage.limits.maxRuntimeMs).toBe(400);
  });

  it("deny and expired grants block coverage", () => {
    const coverage = evaluateRuntimeGrantCoverage(input, [{ id: "expired", scope: "session", effect: "allow", expiresAt: "2000-01-01T00:00:00.000Z", match: { generatedToolIds: ["example.tool"], runtimeCapabilities: [...input.capabilities] } }, { id: "deny", scope: "session", effect: "deny", match: { generatedToolIds: ["example.tool"], runtimeCapabilities: ["read_runtime_input"] } }]);
    expect(coverage.grantedCapabilities).toEqual([]);
    expect(coverage.deniedCapabilities).toEqual(["read_runtime_input"]);
  });
});
