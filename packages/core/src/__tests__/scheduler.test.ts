import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULER_POLICY, schedulerTaskFindings, validateSchedulerSchedule } from "../scheduler.js";

describe("scheduler spec safety", () => {
  it("blocks invalid timezone, high frequency, watch, and external delivery", () => {
    expect(validateSchedulerSchedule({ kind: "recurring", everyMinutes: 5, timezone: "No/Such_Zone" }, DEFAULT_SCHEDULER_POLICY)).toEqual(expect.arrayContaining(["scheduler_timezone_invalid", "scheduler_frequency_too_high"]));
    expect(validateSchedulerSchedule({ kind: "condition_watch_future", timezone: "UTC" }, DEFAULT_SCHEDULER_POLICY)).toContain("scheduler_condition_watch_future_only");
    expect(schedulerTaskFindings({ type: "custom_future", dataSensitivity: "secret", parameterNames: [], requiredGrantIds: [] }, { kind: "external_send_blocked" })).toEqual(expect.arrayContaining(["scheduler_task_future_only", "scheduler_secret_task_blocked", "scheduler_external_delivery_blocked"]));
  });

  it("uses conservative manual-run approval expiry defaults", () => {
    expect(DEFAULT_SCHEDULER_POLICY).toMatchObject({ manualRunApprovalTtlSeconds: 900, manualRunApprovalExpiryWarningSeconds: 300, requireFreshApprovalAtExecution: true, requireFullRevalidationAfterExpiry: true, allowAutomaticRefresh: false });
  });

  it("accepts bounded delayed, cron, and calendar metadata without creating execution state", () => {
    expect(validateSchedulerSchedule({ kind: "delayed", delayMinutes: 15, timezone: "UTC" }, DEFAULT_SCHEDULER_POLICY)).toEqual([]);
    expect(validateSchedulerSchedule({ kind: "cron", expression: "0 9 * * 1-5", timezone: "UTC" }, DEFAULT_SCHEDULER_POLICY)).toEqual([]);
    expect(validateSchedulerSchedule({ kind: "calendar", unit: "weekdays", at: "09:30", timezone: "UTC" }, DEFAULT_SCHEDULER_POLICY)).toEqual([]);
  });

  it("rejects malformed or high-frequency schedule metadata", () => {
    expect(validateSchedulerSchedule({ kind: "delayed", delayMinutes: 0, timezone: "UTC" }, DEFAULT_SCHEDULER_POLICY)).toContain("scheduler_delay_invalid");
    expect(validateSchedulerSchedule({ kind: "cron", expression: "not a cron", timezone: "UTC" }, DEFAULT_SCHEDULER_POLICY)).toContain("scheduler_cron_invalid");
    expect(validateSchedulerSchedule({ kind: "calendar", unit: "daily", at: "9:3", timezone: "UTC" }, DEFAULT_SCHEDULER_POLICY)).toContain("scheduler_calendar_time_invalid");
  });
});
