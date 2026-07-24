import { createHash } from "node:crypto";
import type { PolicyProfile, SchedulerPolicy, ScheduledJobDeliveryPolicy, ScheduledJobSchedule, ScheduledJobTask } from "./types.js";

export const DEFAULT_SCHEDULER_POLICY: SchedulerPolicy = {
  allowSchedulerSpecs: true,
  allowScheduledExecution: false,
  allowJobActivation: false,
  requireReviewForJobs: true,
  requireReviewForActivation: true,
  requireApprovalForJobActivation: true,
  allowBackgroundWorkers: false,
  allowExternalDelivery: false,
  allowNotifications: false,
  minRecurringIntervalMinutes: 60,
  allowConditionWatch: false,
  requireExplicitUserActivation: true,
  requireVisibleJobLifecycle: true,
  requireCancellationSupport: true,
  requireRunReceipts: true,
  requireRunAuditLogs: true,
  manualRunApprovalTtlSeconds: 900,
  manualRunApprovalExpiryWarningSeconds: 300,
  requireFreshApprovalAtExecution: true,
  requireFullRevalidationAfterExpiry: true,
  allowAutomaticRefresh: false
};

export function schedulerPolicy(profile: PolicyProfile): SchedulerPolicy {
  return profile.scheduler === undefined ? DEFAULT_SCHEDULER_POLICY : { ...DEFAULT_SCHEDULER_POLICY, ...profile.scheduler };
}

export function schedulerHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const CRON_FIELD_RANGES = [59, 23, 31, 12, 7] as const;
const CRON_PART = /^(?:\*|\d{1,2})(?:[-/]\d{1,2})?(?:,\*|,\d{1,2}(?:[-/]\d{1,2})?)*$/u;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

/** Strict, dependency-free validation for the inert cron metadata contract. */
export function validateCronExpression(expression: string): boolean {
  const fields = expression.trim().split(/\s+/u);
  if (fields.length !== 5 || fields.some((field) => !CRON_PART.test(field))) return false;
  return fields.every((field, index) => field.split(",").every((part) => {
    const values = part.replace(/^\*/, "0").split(/[\/-]/u).map(Number);
    return values.every((value) => Number.isInteger(value) && value >= 0 && value <= (CRON_FIELD_RANGES[index] ?? 0));
  }));
}

export function validateSchedulerSchedule(value: ScheduledJobSchedule, policy = DEFAULT_SCHEDULER_POLICY): string[] {
  const reasons: string[] = [];
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.timezone });
  } catch {
    reasons.push("scheduler_timezone_invalid");
  }
  if (value.kind === "once" && (Number.isNaN(Date.parse(value.runAt)) || Date.parse(value.runAt) <= Date.now())) reasons.push("scheduler_once_invalid");
  if (value.kind === "delayed" && (!Number.isInteger(value.delayMinutes) || value.delayMinutes < 1 || value.delayMinutes > 525_600)) reasons.push("scheduler_delay_invalid");
  if (value.kind === "recurring" && value.everyMinutes < policy.minRecurringIntervalMinutes) reasons.push("scheduler_frequency_too_high");
  if (value.kind === "cron" && !validateCronExpression(value.expression)) reasons.push("scheduler_cron_invalid");
  if (value.kind === "calendar" && value.at !== undefined && !TIME.test(value.at)) reasons.push("scheduler_calendar_time_invalid");
  if (value.kind === "condition_watch_future") reasons.push("scheduler_condition_watch_future_only");
  return reasons;
}

export function schedulerTaskFindings(task: ScheduledJobTask, delivery: ScheduledJobDeliveryPolicy): string[] {
  const findings: string[] = [];
  if (task.type !== "skill_replay_dryrun") findings.push("scheduler_task_future_only");
  if (task.dataSensitivity === "secret") findings.push("scheduler_secret_task_blocked");
  if (task.dataSensitivity === "sensitive" && task.requiredGrantIds.length === 0) findings.push("scheduler_private_grant_required");
  if (delivery.kind === "external_send_blocked") findings.push("scheduler_external_delivery_blocked");
  if (["desktop_notification_future", "draft_message_future", "draft_email_future"].includes(delivery.kind)) findings.push("scheduler_delivery_future_only");
  return findings;
}
