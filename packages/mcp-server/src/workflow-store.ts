import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  WORKFLOW_BLOCKED_ACTIONS,
  checkpointTemplateSummary,
  normalizeWorkflowCheckpointTemplate,
  reviewWorkflowCheckpointTemplate,
  workflowCheckpointTemplateHash,
  workflowCheckpointTemplateReviewSummary,
  isBlockedWorkflowAction,
  redactWorkflowSummary,
  type WorkflowCheckpoint,
  type WorkflowSkill,
  type WorkflowCheckpointTemplate,
  type WorkflowCheckpointTemplateReview,
  type WorkflowCheckpointTemplateReviewStatus,
  type WorkflowSkillDryRunResult,
  type WorkflowSkillParameter,
  type WorkflowSkillStatus,
  type WorkflowTrace,
  type WorkflowTraceStatus,
  type WorkflowTraceStep
} from "@agenthost/core";

const MAX_STEPS = 1000;
type StoredCheckpointTemplateReview = WorkflowCheckpointTemplateReview & { candidate?: WorkflowCheckpointTemplate; baseTemplateHash?: string; baseTemplateVersion?: number; };

function id(prefix: string): string { return `${prefix}_${randomUUID()}`; }
function now(): string { return new Date().toISOString(); }
function unique(values: string[]): string[] { return [...new Set(values)]; }

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, filePath);
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export interface WorkflowTraceEvent {
  sessionId: string;
  step: WorkflowTraceStep;
}

export class WorkflowStore {
  readonly #tracesDir: string;
  readonly #skillsDir: string;
  readonly #reviewsDir: string;
  readonly #activeBySession = new Map<string, string>();

  constructor(agentHostDir: string) {
    const root = path.join(agentHostDir, "workflows");
    this.#tracesDir = path.join(root, "traces");
    this.#skillsDir = path.join(root, "skills");
    this.#reviewsDir = path.join(root, "checkpoint-template-reviews");
  }

  async ensureStructure(): Promise<void> {
    await Promise.all([mkdir(this.#tracesDir, { recursive: true, mode: 0o700 }), mkdir(this.#skillsDir, { recursive: true, mode: 0o700 }), mkdir(this.#reviewsDir, { recursive: true, mode: 0o700 })]);
  }

  async createTrace(input: { sessionId: string; name: string; description?: string; appCategories?: string[] }): Promise<WorkflowTrace> {
    if (this.#activeBySession.has(input.sessionId)) throw new Error("trace_already_active");
    const timestamp = now();
    const trace: WorkflowTrace = {
      traceId: id("trace"), name: redactWorkflowSummary(input.name), ...(input.description === undefined ? {} : { description: redactWorkflowSummary(input.description) }),
      createdAt: timestamp, updatedAt: timestamp, status: "active", appCategories: unique((input.appCategories ?? []).map(redactWorkflowSummary)),
      strategiesUsed: [], steps: [], checkpoints: [], requiredGrants: [], safetyNotes: [], sessionId: input.sessionId, truncated: false, droppedStepCount: 0
    };
    await this.#saveTrace(trace);
    this.#activeBySession.set(input.sessionId, trace.traceId);
    return trace;
  }

  async capture(event: WorkflowTraceEvent): Promise<void> {
    const traceId = this.#activeBySession.get(event.sessionId);
    if (traceId === undefined) return;
    const trace = await this.getTrace(traceId);
    if (trace.status !== "active") return;
    if (trace.steps.length >= MAX_STEPS) {
      trace.truncated = true; trace.droppedStepCount = (trace.droppedStepCount ?? 0) + 1; trace.updatedAt = now();
      await this.#saveTrace(trace); return;
    }
    const step = event.step;
    trace.steps.push(step);
    if (!trace.strategiesUsed.includes(step.strategy)) trace.strategiesUsed.push(step.strategy);
    if (step.appCategory !== undefined && !trace.appCategories.includes(step.appCategory)) trace.appCategories.push(step.appCategory);
    for (const grant of step.requiredGrantIds ?? []) if (!trace.requiredGrants.includes(grant)) trace.requiredGrants.push(grant);
    if (step.checkpointResult !== undefined) trace.checkpoints.push(step.checkpointResult);
    trace.updatedAt = now();
    await this.#saveTrace(trace);
  }

  async stopTrace(input: { sessionId: string; traceId: string; outcome?: "success" | "failure" | "unknown"; summary?: string; safetyNotes?: string[] }): Promise<WorkflowTrace> {
    const trace = await this.getTrace(input.traceId);
    if (trace.sessionId !== input.sessionId || trace.status !== "active") throw new Error("trace_not_active");
    trace.status = input.outcome === "failure" ? "failed" : "stopped";
    trace.summary = redactWorkflowSummary(input.summary ?? (trace.status === "failed" ? "Trace stopped after failure." : "Trace stopped."));
    trace.safetyNotes = unique([...trace.safetyNotes, ...(input.safetyNotes ?? []).map(redactWorkflowSummary)]);
    trace.stoppedAt = now(); trace.updatedAt = trace.stoppedAt;
    await this.#saveTrace(trace); this.#activeBySession.delete(input.sessionId); return trace;
  }

  async archiveTrace(traceId: string): Promise<WorkflowTrace> {
    const trace = await this.getTrace(traceId);
    if (trace.status === "active") throw new Error("trace_active_cannot_archive");
    if (trace.status !== "archived") { trace.status = "archived"; trace.archivedAt = now(); trace.updatedAt = trace.archivedAt; await this.#saveTrace(trace); }
    return trace;
  }

  async getTrace(traceId: string): Promise<WorkflowTrace> { return this.#readRecord(this.#tracePath(traceId), "trace_not_found"); }
  async listTraces(status?: WorkflowTraceStatus): Promise<WorkflowTrace[]> {
    return (await this.#list<WorkflowTrace>(this.#tracesDir)).filter((record) => status === undefined || record.status === status).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async saveSkillFromTrace(input: { traceId: string; name: string; description: string; parameters?: WorkflowSkillParameter[]; checkpointTemplates?: WorkflowCheckpointTemplate[]; appCategories?: string[] }): Promise<WorkflowSkill> {
    const trace = await this.getTrace(input.traceId);
    if (trace.status !== "stopped" && trace.status !== "failed") throw new Error("trace_must_be_stopped");
    const checkpoints = trace.checkpoints.map((checkpoint) => ({ ...checkpoint }));
    const steps = trace.steps.filter((step) => !step.preview).map((step) => {
      const blocked = isBlockedWorkflowAction(step.actionType, step.tool);
      return {
        stepId: step.stepId, tool: step.tool, strategy: step.strategy, actionType: step.actionType, riskLevel: step.riskLevel,
        inputSummary: step.inputSummary, checkpointIds: checkpoints.filter((c) => c.sourceStepId === step.stepId).map((c) => c.checkpointId),
        requiredGrantIds: step.requiredGrantIds ?? [], requiresConfirmation: step.safetyDecision?.requiresConfirmationToken ?? false,
        blocked: blocked !== undefined || step.safetyDecision?.blocked === true, ...(blocked === undefined ? {} : { blockedReason: `${blocked} remains blocked.` })
      };
    });
    const timestamp = now();
    const skill: WorkflowSkill = {
      skillId: id("skill"), name: redactWorkflowSummary(input.name), description: redactWorkflowSummary(input.description), version: 1,
      createdAt: timestamp, updatedAt: timestamp, status: "draft", supportedStrategies: unique(steps.map((step) => step.strategy)) as WorkflowSkill["supportedStrategies"],
      appCategories: unique((input.appCategories ?? trace.appCategories).map(redactWorkflowSummary)), parameters: (input.parameters ?? []).map((p) => ({ ...p, ...(p.description === undefined ? {} : { description: redactWorkflowSummary(p.description) }) })),
      steps, checkpoints, checkpointTemplates: (input.checkpointTemplates ?? []).map((template) => normalizeWorkflowCheckpointTemplate(template, timestamp)), requiredGrants: unique([...trace.requiredGrants, ...(input.checkpointTemplates ?? []).flatMap((template) => template.requiredGrants)]),
      safetyRestrictions: ["Preview only. Phase 27 never executes workflow skills.", "Future replay must re-evaluate policy, grants, dry-run, and confirmation."],
      blockedActions: [...WORKFLOW_BLOCKED_ACTIONS], sourceTraceId: trace.traceId
    };
    await this.#saveSkill(skill); return skill;
  }

  async getSkill(skillId: string): Promise<WorkflowSkill> { return this.#normalizeSkill(await this.#readRecord(this.#skillPath(skillId), "skill_not_found")); }
  async listSkills(status?: WorkflowSkillStatus): Promise<WorkflowSkill[]> {
    return (await this.#list<WorkflowSkill>(this.#skillsDir)).map((record) => this.#normalizeSkill(record)).filter((record) => status === undefined || record.status === status).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async archiveSkill(skillId: string): Promise<WorkflowSkill> {
    const skill = await this.getSkill(skillId);
    if (skill.status !== "archived") { skill.status = "archived"; skill.archivedAt = now(); skill.updatedAt = skill.archivedAt; await this.#saveSkill(skill); }
    return skill;
  }
  async proposeCheckpointTemplate(input: { skillId: string; operation: "create" | "update"; template: WorkflowCheckpointTemplate; changeSummary: string }): Promise<WorkflowCheckpointTemplateReview> {
    const skill = await this.getSkill(input.skillId); const existing = skill.checkpointTemplates?.find((item) => item.templateId === input.template.templateId);
    if (input.operation === "create" && existing !== undefined) throw new Error("checkpoint_template_already_exists");
    if (input.operation === "update" && existing === undefined) throw new Error("checkpoint_template_not_found");
    if (existing?.status === "archived") throw new Error("checkpoint_template_archived");
    const { reviewId: _reviewId, ...templateWithoutReview } = input.template;
    const timestamp = now(); const candidate = normalizeWorkflowCheckpointTemplate({ ...templateWithoutReview, status: "review_required", version: existing === undefined ? 1 : (existing.version ?? 1) + 1, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp, changeSummary: redactWorkflowSummary(input.changeSummary) }, timestamp);
    const safety = reviewWorkflowCheckpointTemplate(candidate, skill.parameters);
    if (safety.blockedReasons.includes("checkpoint_template_private_literal_blocked")) throw new Error("checkpoint_template_private_literal_blocked");
    const review: StoredCheckpointTemplateReview = { reviewId: id("checkpoint_review"), skillId: skill.skillId, templateId: candidate.templateId, action: input.operation, createdAt: timestamp, updatedAt: timestamp, status: "pending", version: candidate.version ?? 1, templateHash: workflowCheckpointTemplateHash(candidate), ...(existing === undefined ? {} : { beforeSummary: workflowCheckpointTemplateReviewSummary(existing) }), afterSummary: workflowCheckpointTemplateReviewSummary(candidate, safety.blockedReasons), safetyFindings: safety.safetyFindings, requiredGrantsSummary: [...candidate.requiredGrants], blockedReasons: safety.blockedReasons, candidate, ...(existing === undefined ? {} : { baseTemplateHash: existing.templateHash, baseTemplateVersion: existing.version }) };
    await this.#saveReview(review); return this.#publicReview(review);
  }
  async reviewCheckpointTemplate(input: { reviewId: string; decision: "analyze" | "approve" | "reject"; reviewer?: string }): Promise<WorkflowCheckpointTemplateReview> {
    const review = await this.#getStoredReview(input.reviewId); if (review.status !== "pending" && input.decision !== "analyze") throw new Error("checkpoint_review_not_pending");
    if (review.candidate === undefined) throw new Error("checkpoint_review_candidate_missing");
    const skill = await this.getSkill(review.skillId); const safety = reviewWorkflowCheckpointTemplate(review.candidate, skill.parameters);
    review.safetyFindings = safety.safetyFindings; review.blockedReasons = safety.blockedReasons; review.afterSummary = workflowCheckpointTemplateReviewSummary(review.candidate, safety.blockedReasons); review.updatedAt = now();
    if (input.reviewer !== undefined) review.reviewer = redactWorkflowSummary(input.reviewer);
    if (input.decision === "reject") { review.action = "reject"; review.status = "rejected"; }
    else if (safety.blockedReasons.length > 0) review.status = "blocked";
    else if (input.decision === "approve") { review.action = "approve"; review.status = "approved"; }
    await this.#saveReview(review); return this.#publicReview(review);
  }
  async applyCheckpointTemplate(reviewId: string): Promise<WorkflowCheckpointTemplateReview> {
    const review = await this.#getStoredReview(reviewId); if (review.status !== "approved" || review.candidate === undefined) throw new Error("checkpoint_review_not_approved");
    const skill = await this.getSkill(review.skillId); const existing = skill.checkpointTemplates?.find((item) => item.templateId === review.templateId);
    if (review.action === "approve" && existing === undefined && review.beforeSummary !== undefined) throw new Error("checkpoint_template_changed");
    if (review.baseTemplateHash !== undefined && (existing?.templateHash !== review.baseTemplateHash || existing?.version !== review.baseTemplateVersion)) throw new Error("checkpoint_template_changed");
    const safety = reviewWorkflowCheckpointTemplate(review.candidate, skill.parameters); if (safety.blockedReasons.length > 0) { review.status = "blocked"; review.blockedReasons = safety.blockedReasons; review.updatedAt = now(); await this.#saveReview(review); throw new Error("checkpoint_review_blocked"); }
    const { templateHash: _candidateHash, ...candidateWithoutHash } = review.candidate;
    const timestamp = now(); const applied = normalizeWorkflowCheckpointTemplate({ ...candidateWithoutHash, status: "approved", approvedAt: timestamp, updatedAt: timestamp, reviewId: review.reviewId }, timestamp);
    const templates = skill.checkpointTemplates ?? []; const next = existing === undefined ? [...templates, applied] : templates.map((template) => template.templateId === applied.templateId ? applied : template);
    skill.checkpointTemplates = next; skill.version += 1; skill.updatedAt = timestamp; skill.requiredGrants = unique([...skill.requiredGrants, ...applied.requiredGrants]); await this.#saveSkill(skill);
    review.status = "applied"; review.updatedAt = timestamp; review.templateHash = applied.templateHash!; await this.#saveReview(review); return this.#publicReview(review);
  }
  async archiveCheckpointTemplate(input: { skillId: string; templateId: string; changeSummary: string; reviewer?: string }): Promise<WorkflowCheckpointTemplateReview> {
    const skill = await this.getSkill(input.skillId); const existing = skill.checkpointTemplates?.find((item) => item.templateId === input.templateId); if (existing === undefined) throw new Error("checkpoint_template_not_found");
    const { templateHash: _existingHash, ...existingWithoutHash } = existing;
    const timestamp = now(); const archived = normalizeWorkflowCheckpointTemplate({ ...existingWithoutHash, status: "archived", archivedAt: timestamp, updatedAt: timestamp, version: (existing.version ?? 1) + 1, changeSummary: redactWorkflowSummary(input.changeSummary) }, timestamp);
    skill.checkpointTemplates = (skill.checkpointTemplates ?? []).map((item) => item.templateId === input.templateId ? archived : item); skill.version += 1; skill.updatedAt = timestamp; await this.#saveSkill(skill);
    const review: StoredCheckpointTemplateReview = { reviewId: id("checkpoint_review"), skillId: skill.skillId, templateId: archived.templateId, action: "archive", createdAt: timestamp, updatedAt: timestamp, status: "archived", version: archived.version ?? 1, templateHash: archived.templateHash!, beforeSummary: workflowCheckpointTemplateReviewSummary(existing), afterSummary: workflowCheckpointTemplateReviewSummary(archived, ["checkpoint_template_archived"]), safetyFindings: ["checkpoint_template_non_executable"], requiredGrantsSummary: [...archived.requiredGrants], blockedReasons: [], ...(input.reviewer === undefined ? {} : { reviewer: redactWorkflowSummary(input.reviewer) }) };
    await this.#saveReview(review); return this.#publicReview(review);
  }
  async getCheckpointTemplateReview(reviewId: string): Promise<WorkflowCheckpointTemplateReview> { return this.#publicReview(await this.#getStoredReview(reviewId)); }
  async listCheckpointTemplateReviews(input: { skillId?: string; templateId?: string; status?: WorkflowCheckpointTemplateReviewStatus }): Promise<WorkflowCheckpointTemplateReview[]> { return (await this.#list<StoredCheckpointTemplateReview>(this.#reviewsDir)).filter((review) => (input.skillId === undefined || review.skillId === input.skillId) && (input.templateId === undefined || review.templateId === input.templateId) && (input.status === undefined || review.status === input.status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((review) => this.#publicReview(review)); }
  async dryRunSkill(input: { skillId: string; providedParameterNames: string[]; activeGrantIds: string[] }): Promise<WorkflowSkillDryRunResult> {
    const skill = await this.getSkill(input.skillId);
    const missingParameters = skill.parameters.filter((parameter) => parameter.required && !input.providedParameterNames.includes(parameter.name)).map((parameter) => parameter.name);
    const missingGrantIds = skill.requiredGrants.filter((grant) => !input.activeGrantIds.includes(grant));
    const checkpointTemplates = (skill.checkpointTemplates ?? []).filter((template) => template.status === "approved").map((template) => checkpointTemplateSummary(template, template.sensitivity === "secret" ? ["secret_checkpoint_blocked"] : template.sensitivity === "private" && template.requiredGrants.length === 0 ? ["private_checkpoint_grant_required"] : template.requiredGrants.some((grant) => !input.activeGrantIds.includes(grant)) ? ["checkpoint_grant_missing"] : []));
    return { skillId: skill.skillId, version: skill.version, executable: false, requiredGrants: skill.requiredGrants, missingGrantIds, steps: skill.steps, blockedSteps: skill.steps.filter((step) => step.blocked), confirmationStepIds: skill.steps.filter((step) => step.requiresConfirmation).map((step) => step.stepId), safetyRestrictions: skill.safetyRestrictions, missingParameters, checkpointTemplates };
  }

  async #readRecord<T>(filePath: string, missingCode: string): Promise<T> {
    try { return await readJson<T>(filePath); } catch (error) { if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") throw new Error(missingCode); throw new Error("workflow_record_invalid"); }
  }
  #normalizeSkill(skill: WorkflowSkill): WorkflowSkill { return { ...skill, checkpointTemplates: (skill.checkpointTemplates ?? []).map((template) => normalizeWorkflowCheckpointTemplate(template, skill.updatedAt)) }; }
  async #list<T>(directory: string): Promise<T[]> { const entries = await readdir(directory, { withFileTypes: true }).catch(() => []); return Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => this.#readRecord<T>(path.join(directory, entry.name), "workflow_record_invalid"))); }
  #tracePath(traceId: string): string { return path.join(this.#tracesDir, `${traceId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`); }
  #skillPath(skillId: string): string { return path.join(this.#skillsDir, `${skillId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`); }
  #reviewPath(reviewId: string): string { return path.join(this.#reviewsDir, `${reviewId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`); }
  async #saveTrace(trace: WorkflowTrace): Promise<void> { await writeJson(this.#tracePath(trace.traceId), trace); }
  async #saveSkill(skill: WorkflowSkill): Promise<void> { await writeJson(this.#skillPath(skill.skillId), skill); }
  async #saveReview(review: StoredCheckpointTemplateReview): Promise<void> { await writeJson(this.#reviewPath(review.reviewId), review); }
  async #getStoredReview(reviewId: string): Promise<StoredCheckpointTemplateReview> { return this.#readRecord(this.#reviewPath(reviewId), "checkpoint_review_not_found"); }
  #publicReview(review: StoredCheckpointTemplateReview): WorkflowCheckpointTemplateReview { const { candidate, baseTemplateHash, baseTemplateVersion, ...value } = review; return value; }
}
