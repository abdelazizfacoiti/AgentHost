import { describe, expect, it } from "vitest";
import { validateOverlayAssistanceTemplate, bindOverlayAssistanceTemplate, type OverlayAssistanceTemplate } from "../index.js";

const template = (): OverlayAssistanceTemplate => ({
  templateId: "template_safe",
  ownerSessionId: "owner",
  name: "Safe visual flow",
  version: 1,
  parameters: [{ name: "label", type: "string", required: true, sensitivity: "public" }],
  steps: [
    { stepId: "step_1", index: 0, type: "pointer", primitiveType: "pointer", label: "Point {{label}}" },
    { stepId: "step_2", index: 1, type: "wait_for_event", requiresEvent: true, expectedEvent: "accepted" }
  ],
  status: "draft",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});

describe("visual assistance templates", () => {
  it("validates and binds literal visual steps", () => {
    const value = template();
    expect(validateOverlayAssistanceTemplate(value)).toEqual([]);
    const bound = bindOverlayAssistanceTemplate(value, { label: "Continue" });
    expect(bound.errors).toEqual([]);
    expect(bound.steps[0]?.primitive?.label).toBe("Point Continue");
  });

  it("rejects executable interpolation and unsafe fields", () => {
    const value = { ...template(), steps: [{ ...template().steps[0], label: "{{process.env.SECRET}}", callback: "run" }] };
    const errors = validateOverlayAssistanceTemplate(value);
    expect(errors).toContain("overlay_template_unknown_field");
    expect(errors).toContain("overlay_template_interpolation_invalid");
  });

  it("rejects secret parameters and undeclared bindings", () => {
    const value = { ...template(), parameters: [{ name: "secret", type: "string", required: true, sensitivity: "secret" as const }] };
    expect(validateOverlayAssistanceTemplate(value)).toContain("overlay_template_secret_parameter_blocked");
    expect(bindOverlayAssistanceTemplate(template(), { unknown: "x" }).errors).toContain("overlay_template_unknown_parameter");
  });
});
