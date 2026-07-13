import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULER_POLICY, schedulerTaskFindings, validateSchedulerSchedule } from "../scheduler.js";

describe("scheduler spec safety", () => {
  it("blocks invalid timezone, high frequency, watch, and external delivery", () => {
    expect(validateSchedulerSchedule({ kind: "recurring", everyMinutes: 5, timezone: "No/Such_Zone" }, DEFAULT_SCHEDULER_POLICY)).toEqual(expect.arrayContaining(["scheduler_timezone_invalid", "scheduler_frequency_too_high"]));
    expect(validateSchedulerSchedule({ kind: "condition_watch_future", timezone: "UTC" }, DEFAULT_SCHEDULER_POLICY)).toContain("scheduler_condition_watch_future_only");
    expect(schedulerTaskFindings({ type: "custom_future", dataSensitivity: "secret", parameterNames: [], requiredGrantIds: [] }, { kind: "external_send_blocked" })).toEqual(expect.arrayContaining(["scheduler_task_future_only", "scheduler_secret_task_blocked", "scheduler_external_delivery_blocked"]));
  });
});
