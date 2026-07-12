import { describe, expect, it } from "vitest";
import { actionBlocked, isSafeCss } from "../element-policy.js";

describe("browser element policy", () => {
  it("allows only bounded simple CSS", () => {
    expect(isSafeCss("button.primary")).toBe(true);
    expect(isSafeCss("button:has(span)")).toBe(false);
    expect(isSafeCss("input[type=password]")).toBe(false);
  });
  it("blocks unsafe element action classes", () => {
    expect(actionBlocked("communication_send")).toBe(true);
    expect(actionBlocked("form_submit")).toBe(true);
    expect(actionBlocked("safe_navigation")).toBe(false);
  });
});
