import { describe, expect, it } from "vitest";
import { redactWorkflowSummary, workflowActionForTool, workflowStrategyForTool } from "../index.js";

describe("workflow helpers", () => {
  it("maps generic AgentHost tools without provider-specific behavior", () => {
    expect(workflowStrategyForTool("browser.fill_text")).toBe("browser");
    expect(workflowStrategyForTool("file.write")).toBe("file");
    expect(workflowStrategyForTool("forge.run_sandboxed_tool")).toBe("forge_runtime");
    expect(workflowActionForTool("browser.fill_text")).toBe("fill_text_redacted");
  });

  it("redacts trace URLs, private values, and user paths", () => {
    const value = redactWorkflowSummary("https://user:pass@example.test/inbox?token=abc#x a@b.test +15551234567 /home/user/private.txt");
    expect(value).not.toContain("pass");
    expect(value).not.toContain("token=abc");
    expect(value).toContain("[redacted-email]");
    expect(value).toContain("[redacted-phone]");
    expect(value).toContain("[redacted-path]");
  });
});
