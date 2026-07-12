import { describe, expect, it } from "vitest";
import { resolveWorkflowCheckpointTemplates, validateWorkflowCheckpointTemplate, type WorkflowCheckpointTemplate, type WorkflowSkillParameter } from "../index.js";

const parameters: WorkflowSkillParameter[] = [{ name: "path", type: "string", required: true, sensitive: true, usedByStepIds: [] }];
const template: WorkflowCheckpointTemplate = { templateId: "file_check", name: "File", description: "Check file", kind: "file_exists", strategy: "file", sensitivity: "public", expectedTemplate: { path: "{{path}}", literal: "$HOME/*.txt" }, parameters: ["path"], requiredGrants: [], safetyNotes: [] };

describe("workflow checkpoint templates", () => {
  it("binds only declared interpolation without shell, environment, or glob expansion", () => {
    const resolved = resolveWorkflowCheckpointTemplates({ templates: [template], parameters, bindings: { path: "/tmp/file" } });
    expect(resolved[0]?.checkpoint.expected).toEqual({ path: "/tmp/file", literal: "$HOME/*.txt" });
  });
  it("rejects expressions and undeclared interpolation", () => {
    expect(() => validateWorkflowCheckpointTemplate({ ...template, expectedTemplate: { path: "{{process.env.HOME}}" } }, parameters)).toThrow("checkpoint_template_invalid_interpolation");
    expect(() => validateWorkflowCheckpointTemplate({ ...template, expectedTemplate: { path: "{{path}}" }, parameters: [] }, parameters)).toThrow("checkpoint_template_parameter_not_declared");
  });
});
