import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SchedulerStore } from "../scheduler-store.js";
import type { ScheduledJobSpec } from "@agenthost/core";

const job = (id: string): ScheduledJobSpec => ({
  jobId: id,
  name: "Private title",
  description: "Private description",
  createdAt: "2026-07-24T00:00:00.000Z",
  updatedAt: "2026-07-24T00:00:00.000Z",
  status: "approved",
  schedule: { kind: "once", runAt: "2026-08-01T00:00:00.000Z", timezone: "UTC" },
  task: { type: "custom_future", dataSensitivity: "none", parameterNames: ["secret_value"], requiredGrantIds: [] },
  delivery: { kind: "local_log" },
  parametersSummary: [{ name: "secret_value", provided: true, redacted: true }],
  requiredGrants: [],
  requiredConfirmations: [],
  safetyRestrictions: [],
  retryPolicy: "none",
  maxAttempts: 1,
  version: 1,
  jobHash: "job_hash",
  executable: false,
  scheduledExecutionEnabled: false
});

describe("scheduler store ownership and inert lifecycle", () => {
  it("binds new records to the trusted owner and rejects another owner", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "agenthost-scheduler-store-"));
    const ownerA = new SchedulerStore(home, "session_a");
    const ownerB = new SchedulerStore(home, "session_b");
    await ownerA.ensureStructure();
    await ownerA.saveJob(job("job_owner"));
    await expect(ownerB.getJob("job_owner")).rejects.toThrow("scheduler_owner_mismatch");
    const stored = JSON.parse(await readFile(path.join(home, "scheduler", "jobs", "job_owner.json"), "utf8")) as ScheduledJobSpec;
    expect(stored.ownerSessionId).toBe("session_a");
    expect(stored.name).toBe("[redacted]");
    expect(stored.description).toBe("[redacted]");
    expect(stored.executable).toBe(false);
    expect(stored.scheduledExecutionEnabled).toBe(false);
  });

  it("records only inert metadata for pause, resume, cancel, and archive transitions", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "agenthost-scheduler-lifecycle-"));
    const store = new SchedulerStore(home, "session_lifecycle");
    await store.ensureStructure();
    await store.saveJob(job("job_lifecycle"));
    expect((await store.transition("job_lifecycle", "paused")).status).toBe("paused");
    expect((await store.transition("job_lifecycle", "review_required")).status).toBe("review_required");
    expect((await store.transition("job_lifecycle", "cancelled")).status).toBe("cancelled");
    const cancelled = await store.transition("job_lifecycle", "cancelled");
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.executable).toBe(false);
    expect(cancelled.scheduledExecutionEnabled).toBe(false);
    await expect(store.transition("job_lifecycle", "approved")).rejects.toThrow("scheduler_job_terminal");
  });
});
