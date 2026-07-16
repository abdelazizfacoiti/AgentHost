import { describe, expect, it } from "vitest";
import { canTransitionRuntimeActivity, runtimeActivityDedupKey, runtimeActivityLabel, runtimeActivityPriority, validateRuntimeActivityTransition } from "../runtime-activity.js";

describe("runtime activity model", () => {
  it("allows only bounded lifecycle transitions and requires verified completion", () => {
    expect(canTransitionRuntimeActivity("preparing", "inspecting")).toBe(true);
    expect(canTransitionRuntimeActivity("completed", "acting")).toBe(false);
    expect(validateRuntimeActivityTransition("acting", "completed")).toContain("runtime_activity_terminal_verification_required");
    expect(validateRuntimeActivityTransition("acting", "completed", { verified: true, source: "tool_result" })).toEqual([]);
  });

  it("uses safe labels, deterministic priority, and owner/task/source deduplication", () => {
    expect(runtimeActivityLabel("opening_browser", 8)).toBe("Opening ");
    expect(runtimeActivityPriority("waiting_for_approval")).toBeGreaterThan(runtimeActivityPriority("acting"));
    expect(runtimeActivityDedupKey({ ownerSessionId: "owner", taskId: "task", source: "browser", operation: "inspect" })).toBe(runtimeActivityDedupKey({ ownerSessionId: "owner", taskId: "task", source: "browser", operation: "inspect" }));
    expect(runtimeActivityDedupKey({ ownerSessionId: "other", taskId: "task", source: "browser", operation: "inspect" })).not.toBe(runtimeActivityDedupKey({ ownerSessionId: "owner", taskId: "task", source: "browser", operation: "inspect" }));
  });
});
