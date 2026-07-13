import { createHash } from "node:crypto";
import { checkpointTemplateSummary, validateWorkflowCheckpointTemplate } from "./workflow-checkpoints.js";
import type { WorkflowCheckpointTemplate, WorkflowSkillParameter } from "./types.js";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

export function workflowCheckpointTemplateHash(template: WorkflowCheckpointTemplate): string {
  const { status, version, createdAt, updatedAt, approvedAt, archivedAt, templateHash, reviewId, changeSummary, ...functional } = template;
  return createHash("sha256").update(canonical(functional)).digest("hex");
}

export function normalizeWorkflowCheckpointTemplate(template: WorkflowCheckpointTemplate, timestamp: string): WorkflowCheckpointTemplate {
  const status = template.status ?? "review_required";
  return {
    ...template,
    status,
    version: template.version ?? 1,
    createdAt: template.createdAt ?? timestamp,
    updatedAt: template.updatedAt ?? timestamp,
    templateHash: template.templateHash ?? workflowCheckpointTemplateHash(template)
  };
}

export function reviewWorkflowCheckpointTemplate(template: WorkflowCheckpointTemplate, parameters: WorkflowSkillParameter[]): { safetyFindings: string[]; blockedReasons: string[] } {
  const safetyFindings: string[] = ["checkpoint_template_non_executable", "parameter_interpolation_only"];
  const blockedReasons: string[] = [];
  try { validateWorkflowCheckpointTemplate(template, parameters); } catch (error) { blockedReasons.push(error instanceof Error ? error.message : "checkpoint_template_invalid"); }
  if (template.sensitivity === "secret") blockedReasons.push("secret_checkpoint_blocked");
  if (template.sensitivity === "private" && template.requiredGrants.length === 0) blockedReasons.push("private_checkpoint_grant_required");
  if (template.status === "archived") blockedReasons.push("checkpoint_template_archived");
  return { safetyFindings, blockedReasons: [...new Set(blockedReasons)] };
}

export function workflowCheckpointTemplateReviewSummary(template: WorkflowCheckpointTemplate, blockedReasons: string[] = []): Record<string, unknown> {
  return {
    ...checkpointTemplateSummary(template, blockedReasons),
    status: template.status ?? "review_required",
    version: template.version ?? 1,
    templateHash: template.templateHash ?? workflowCheckpointTemplateHash(template),
    reviewId: template.reviewId,
    changeSummary: template.changeSummary === undefined ? undefined : "redacted",
    expectedTemplateRedacted: true
  };
}
