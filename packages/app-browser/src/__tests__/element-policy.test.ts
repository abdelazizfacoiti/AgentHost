import { describe, expect, it } from "vitest";
import { actionBlocked, isSafeCss } from "../element-policy.js";

describe("browser element policy", () => {
  it("allows only bounded simple CSS", () => {
    expect(isSafeCss("button.primary")).toBe(true);
    expect(isSafeCss("button:has(span)")).toBe(false);
    expect(isSafeCss("input[type=password]")).toBe(false);
  });
  it("hard-blocks only protected fields/actions", () => {
    expect(actionBlocked("communication_send")).toBe(false);
    expect(actionBlocked("form_submit")).toBe(false);
    expect(actionBlocked("password_input")).toBe(true);
    expect(actionBlocked("safe_navigation")).toBe(false);
  });
});
