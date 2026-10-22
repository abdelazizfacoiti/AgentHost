import { describe, expect, it } from "vitest";
import { redactForLog, redactSensitiveText, summarizeForLog } from "../index.js";

describe("redaction utilities", () => {
  it("redacts secret-like assignments in text", () => {
    expect(redactSensitiveText("token=abc123 password: hunter2")).toBe("token=[redacted] password: [redacted]");
  });

  it("redacts authorization headers and private key blocks", () => {
    expect(redactSensitiveText("Authorization: Bearer abc.def.ghi")).toBe("Authorization: Bearer [redacted]");
    expect(redactSensitiveText("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----")).toBe(
      "[redacted-private-key]"
    );
  });

  it("redacts confirmation token IDs from free text and summaries", () => {
    const tokenId = "conf_12345678-1234-4234-9234-123456789abc";
    expect(redactSensitiveText(`Run: agenthost confirm ${tokenId}`)).toBe("Run: agenthost confirm [redacted-confirmation-token]");
    expect(summarizeForLog({ message: `token ${tokenId}` })).not.toContain(tokenId);
  });

  it("redacts sensitive object fields recursively", () => {
    expect(
      redactForLog({
        user: "alice",
        apiKey: "abc123",
        nested: {
          cookie: "session=secret",
          note: "safe"
        }
      })
    ).toEqual({
      user: "alice",
      apiKey: "[redacted]",
      nested: {
        cookie: "[redacted]",
        note: "safe"
      }
    });
  });

  it("is used by log summaries", () => {
    expect(summarizeForLog({ token: "abc123", message: "hello" })).toBe(
      JSON.stringify({ token: "[redacted]", message: "hello" })
    );
  });
});
