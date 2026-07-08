import { describe, expect, it } from "vitest";
import { toolFailure, toolSuccess } from "../index.js";

describe("ToolResult helpers", () => {
  it("creates a successful observe-level result", () => {
    const result = toolSuccess({
      tool: "system.get_info",
      riskLevel: "observe",
      preview: true,
      data: { ok: true }
    });

    expect(result).toMatchObject({
      ok: true,
      tool: "system.get_info",
      riskLevel: "observe",
      preview: true,
      approval: {
        required: false,
        status: "not_required"
      },
      error: null
    });
  });

  it("creates a structured failure result", () => {
    const result = toolFailure({
      tool: "system.get_info",
      riskLevel: "observe",
      preview: true,
      error: {
        code: "invalid_input",
        message: "Input did not match schema."
      }
    });

    expect(result.ok).toBe(false);
    expect(result.preview).toBe(true);
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("invalid_input");
  });
});
