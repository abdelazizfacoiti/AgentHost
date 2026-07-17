import { describe, expect, it } from "vitest";
import { isTrustedVisualComponent, normalizeTrustedVisualComponents } from "../component-registry.js";

describe("visual component registry", () => {
  it("accepts only fixed renderer components", () => {
    expect(isTrustedVisualComponent({ type: "text", text: "safe" })).toBe(true);
    expect(isTrustedVisualComponent({ type: "html", value: "<script>" })).toBe(false);
  });

  it("bounds normalized components", () => {
    const values = Array.from({ length: 40 }, () => ({ type: "text", text: "safe" } as const));
    expect(normalizeTrustedVisualComponents(values)).toHaveLength(30);
  });
});
