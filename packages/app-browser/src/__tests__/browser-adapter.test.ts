import { describe, expect, it } from "vitest";
import { createBrowserAdapter } from "../browser-adapter.js";
import { browserSensitivity, sanitizeBrowserUrl } from "../url-sensitivity.js";
import { redactBrowserText } from "../page-redaction.js";

describe("browser adapter safety helpers", () => {
  it("sanitizes browser URLs and classifies sensitive sites", () => {
    expect(sanitizeBrowserUrl("https://user:pass@mail.google.com/a?message=1#x")).toMatchObject({ url: "https://mail.google.com/a", redacted: true });
    expect(browserSensitivity("https://mail.google.com/mail/u/0")).toBe("communication");
    expect(browserSensitivity("https://bank.example.test/login")).toBe("credential_or_security");
  });
  it("redacts emails, phone-like text, and credentials", () => {
    const value = redactBrowserText("mail a@example.com phone +1 555 123 4567 token=secret-value");
    expect(value.text).not.toContain("a@example.com");
    expect(value.text).not.toContain("secret-value");
    expect(value.counts.email).toBe(1);
  });
  it("surfaces the session holder for background handoff decisions", async () => {
    const adapter = createBrowserAdapter({
      status: () => ({ enabled: true, paired: true, connected: true, browser: { family: "chromium" as const }, deviceIdSuffix: "abcdef12", connectedAt: "2026-09-11T10:00:00.000Z", lastSeenAt: "2026-09-11T10:01:00.000Z", reason: "paired" }),
      command: async () => { throw new Error("unused"); },
      releaseSession: () => ({ released: true as const })
    } as never);
    await expect(adapter.detect()).resolves.toMatchObject({
      connected: true,
      session: { family: "chromium", deviceIdSuffix: "abcdef12" }
    });
    await expect(adapter.releaseSession()).resolves.toMatchObject({ released: true });
  });
});
