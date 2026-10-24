import { describe, expect, it } from "vitest";
import { getDefaultPolicy } from "../policies.js";
import { schedulerActivationPreview, schedulerReadiness } from "../scheduler-readiness.js";
import type { ScheduledJobSpec, WorkflowSkill } from "../types.js";
const job: ScheduledJobSpec = { jobId: "job_test", name: "x", description: "x", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", status: "approved", schedule: { kind: "recurring", everyMinutes: 60, timezone: "UTC" }, task: { type: "skill_replay_dryrun", dataSensitivity: "none", parameterNames: [], requiredGrantIds: [] }, delivery: { kind: "local_log" }, parametersSummary: [], requiredGrants: [], requiredConfirmations: [], safetyRestrictions: [], retryPolicy: "none", maxAttempts: 1, version: 1, jobHash: "x", executable: false, scheduledExecutionEnabled: false };
const copy = (changes: Partial<ScheduledJobSpec>): ScheduledJobSpec => ({ ...job, ...changes });
const skill: WorkflowSkill = { skillId: "skill_test", name: "Test", description: "Test", version: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", status: "active", supportedStrategies: ["guide"], appCategories: [], parameters: [], steps: [], checkpoints: [], requiredGrants: [], safetyRestrictions: [], blockedActions: [], sourceTraceId: "trace_test" };

describe("scheduler readiness", () => {
  it("stays activation unsupported and previews next run", () => {
    const result = schedulerReadiness({ job, policy: getDefaultPolicy(), activeGrantIds: [] });
    expect(result).toMatchObject({ readyForActivation: false, activationSupported: false, executableNow: false, scheduledExecutionEnabled: false, nextRunPreview: { scheduleKind: "recurring", previewOnly: true } });
    expect(schedulerActivationPreview({ job, policy: getDefaultPolicy(), activeGrantIds: [] }).futureRequirements).toEqual(expect.arrayContaining(["run_receipts", "explicit_activation_approval", "no_hidden_background_work"]));
  });

  it("blocks inactive lifecycle, invalid schedules, missing grants, and unsafe delivery", () => {
    const draft = schedulerReadiness({ job: copy({ status: "review_required" }), policy: getDefaultPolicy(), activeGrantIds: [] });
    expect(draft.blockers.map((x) => x.code)).toContain("job_not_approved");
    const invalid = schedulerReadiness({ job: copy({ schedule: { kind: "recurring", everyMinutes: 1, timezone: "No/Such_Zone" } }), policy: getDefaultPolicy(), activeGrantIds: [] });
    expect(invalid.blockers.map((x) => x.code)).toEqual(expect.arrayContaining(["scheduler_timezone_invalid", "scheduler_frequency_too_high"]));
    const grants = schedulerReadiness({ job: copy({ requiredGrants: ["grant_private"] }), policy: getDefaultPolicy(), activeGrantIds: [] });
    expect(grants).toMatchObject({ grantsSatisfied: false, missingGrants: ["grant_private"] });
    const delivery = schedulerReadiness({ job: copy({ delivery: { kind: "external_send_blocked" } }), policy: getDefaultPolicy(), activeGrantIds: [] });
    expect(delivery.blockers.map((x) => x.code)).toContain("scheduler_external_delivery_blocked");
  });

  it("blocks future task types and uses only pure skill dry-run planning", () => {
    const future = schedulerReadiness({ job: copy({ task: { ...job.task, type: "browser_research_future" } }), policy: getDefaultPolicy(), activeGrantIds: [] });
    expect(future.blockers.map((x) => x.code)).toContain("scheduler_task_future_only");
    const preview = schedulerReadiness({ job: copy({ task: { ...job.task, skillId: skill.skillId } }), policy: getDefaultPolicy(), activeGrantIds: [], skill });
    expect(preview.taskDryRunPreview).toMatchObject({ skillId: skill.skillId, actionsExecuted: false, confirmationTokensCreated: false });
  });
});
