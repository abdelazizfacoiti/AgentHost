import { randomUUID } from "node:crypto";
import { checkpointTemplateSummary, validateWorkflowCheckpointTemplate } from "./workflow-checkpoints.js";
import { isBlockedWorkflowAction } from "./workflow.js";
import type { WorkflowCheckpointTemplate, WorkflowSkill, WorkflowSkillReplayBlocker, WorkflowSkillReplayDryRun, WorkflowSkillReplayStepPreview } from "./types.js";

const HIGH_RISK = /send|submit|post|upload|delete|archive|pay|buy|credential|secret|password|mfa|captcha/i;
const READ_ONLY = new Set(["browser.detect", "browser.list_tabs", "browser.get_active_tab", "browser.current_url", "browser.get_page_context", "browser.extract_text", "browser.find_element", "browser.wait_for_state", "browser.get_form_state", "browser.get_selected_text", "accessibility.get_tree", "accessibility.inspect_element", "accessibility.find_element", "file.read", "file.exists", "file.list", "checkpoint.evaluate", "checkpoint.wait_for"]);

function summary(value: string): string { return value.length === 0 ? "No recorded input summary." : "Redacted recorded input summary."; }
function stepChanging(step: WorkflowSkill["steps"][number]): boolean { return !READ_ONLY.has(step.tool) && (step.riskLevel !== "observe" || !["find_element", "wait_for_state", "extract_text_redacted", "checkpoint"].includes(step.actionType)); }
function selectTemplates(skill: WorkflowSkill, reviewMode: boolean): WorkflowCheckpointTemplate[] { return (skill.checkpointTemplates ?? []).filter((template) => reviewMode ? template.status === "approved" || template.status === "draft" || template.status === "review_required" : template.status === "approved"); }

export function createWorkflowSkillReplayDryRun(input: { skill: WorkflowSkill; parameters: Record<string, unknown>; activeGrantIds: string[]; availableTools: string[]; reviewMode?: boolean; evaluateCheckpoints?: boolean }): WorkflowSkillReplayDryRun {
  const { skill, parameters } = input;
  const blockers: WorkflowSkillReplayBlocker[] = [];
  const declared = new Map(skill.parameters.map((parameter) => [parameter.name, parameter]));
  for (const name of Object.keys(parameters)) if (!declared.has(name)) blockers.push({ code: "checkpoint_parameter_unknown", message: "Unknown parameter binding." });
  for (const parameter of skill.parameters) if (parameter.required && !(parameter.name in parameters)) blockers.push({ code: "checkpoint_parameter_missing", message: `Required parameter ${parameter.name} missing.` });
  const available = new Set(input.availableTools);
  const steps: WorkflowSkillReplayStepPreview[] = skill.steps.map((step, index) => {
    const reasons: string[] = [];
    const unsupported = !available.has(step.tool) || step.strategy === "unknown";
    if (unsupported) reasons.push("workflow_step_unsupported");
    const blockedAction = isBlockedWorkflowAction(step.actionType, step.tool);
    if (step.blocked) reasons.push(step.blockedReason ?? "workflow_step_blocked");
    if (blockedAction !== undefined) reasons.push(`blocked_action_${blockedAction}`);
    if (step.riskLevel === "high" || step.riskLevel === "blocked" || HIGH_RISK.test(`${step.tool} ${step.actionType}`)) reasons.push("high_risk_action_blocked");
    const missing = step.requiredGrantIds.filter((id) => !input.activeGrantIds.includes(id)); if (missing.length > 0) reasons.push("step_grant_missing");
    const stateChanging = stepChanging(step); const preview = { stepId: step.stepId, sourceStepId: step.stepId, order: index + 1, tool: step.tool, strategy: step.strategy, actionType: step.actionType, riskLevel: step.riskLevel, stateChanging, wouldRequireDryRun: stateChanging, wouldRequireConfirmation: stateChanging || step.requiresConfirmation, requiredGrants: [...step.requiredGrantIds], blocked: reasons.length > 0, blockedReasons: reasons, inputSummary: summary(step.inputSummary), expectedOutputSummary: step.checkpointIds.length === 0 ? "No recorded checkpoint." : `Checkpoint plan: ${step.checkpointIds.length} redacted item(s).`, parameterBindingsUsed: skill.parameters.filter((parameter) => parameter.usedByStepIds.includes(step.stepId)).map((parameter) => parameter.name), supported: !unsupported, ...(unsupported ? { unsupportedReason: step.strategy === "unknown" ? "unknown_strategy" : "tool_not_available" } : {}) } satisfies WorkflowSkillReplayStepPreview;
    if (preview.blocked) blockers.push({ code: preview.blockedReasons[0]!, stepId: step.stepId, message: "Replay step blocked or unsupported." }); return preview;
  });
  const checkpoints = selectTemplates(skill, input.reviewMode === true).map((template) => {
    const reasons: string[] = []; const missing = template.requiredGrants.filter((id) => !input.activeGrantIds.includes(id));
    try { validateWorkflowCheckpointTemplate(template, skill.parameters); } catch (error) { reasons.push(error instanceof Error ? error.message : "checkpoint_template_invalid"); }
    if (template.status !== "approved") reasons.push("checkpoint_template_unapproved_preview_only");
    if (template.sensitivity === "secret") reasons.push("secret_checkpoint_blocked");
    if (template.sensitivity === "private" && template.requiredGrants.length === 0) reasons.push("private_checkpoint_grant_required");
    if (missing.length > 0) reasons.push("checkpoint_grant_missing");
    if (reasons.length > 0) blockers.push({ code: reasons[0]!, templateId: template.templateId, message: "Checkpoint template blocked." });
    const redacted = checkpointTemplateSummary(template, reasons); return { templateId: template.templateId, kind: template.kind, strategy: template.strategy, sensitivity: template.sensitivity, status: template.status ?? "review_required", requiredGrants: [...template.requiredGrants], missingGrants: missing, parameterNames: [...template.parameters], expectedFields: redacted.expectedFields, blocked: reasons.length > 0, blockedReasons: reasons, previewOnly: true as const };
  });
  const requiredIds = [...new Set([...skill.requiredGrants, ...skill.steps.flatMap((step) => step.requiredGrantIds), ...checkpoints.flatMap((checkpoint) => checkpoint.requiredGrants)])];
  const missingGrants = requiredIds.filter((id) => !input.activeGrantIds.includes(id));
  if (missingGrants.length > 0) blockers.push({ code: "grant_missing", message: "One or more required grants inactive." });
  const warnings = ["Replay preview only; no underlying tool called.", "Parameter values redacted and must pass current safety checks during any future replay.", ...(input.reviewMode === true ? ["Unapproved checkpoint templates shown for review only."] : []), ...(input.evaluateCheckpoints === true ? ["Checkpoint evaluation deferred; Phase 33 does not evaluate checkpoints."] : [])];
  const executableInFuture = skill.status !== "archived" && blockers.length === 0;
  if (skill.status === "archived") blockers.push({ code: "skill_archived", message: "Archived skill cannot be replay planned." });
  return { dryRunId: `skill_replay_dryrun_${randomUUID()}`, skillId: skill.skillId, skillVersion: skill.version, createdAt: new Date().toISOString(), parametersSummary: skill.parameters.map((parameter) => ({ name: parameter.name, type: parameter.type, required: parameter.required, sensitive: parameter.sensitive, provided: parameter.name in parameters, redacted: true })), steps, checkpoints, requiredGrants: requiredIds.map((grantId) => ({ grantId, active: input.activeGrantIds.includes(grantId), source: skill.requiredGrants.includes(grantId) ? "skill" : skill.steps.some((step) => step.requiredGrantIds.includes(grantId)) ? "step" : "checkpoint" })), missingGrants, confirmationRequirements: steps.filter((step) => step.wouldRequireConfirmation).map((step) => step.stepId), blockers, warnings, executableInFuture: executableInFuture && blockers.length === 0, ...(blockers.length === 0 ? {} : { reason: "Replay has blockers; future execution remains unavailable." }), actionsExecuted: false, confirmationTokensCreated: false, previewOnly: true, executable: false };
}
