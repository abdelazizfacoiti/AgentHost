import { describe, expect, it } from "vitest";
import { renderTaskHtml, renderTaskMarkdown } from "../task-export.js";

const record = {
  taskId: "task_demo",
  goal: "Check the local news on hespress",
  status: "completed",
  phase: "verify",
  currentAction: "desktop.screenshot",
  createdAt: "2026-09-14T09:50:00.000Z",
  updatedAt: "2026-09-14T10:00:00.000Z",
  events: [
    { at: "2026-09-14T09:55:00.000Z", kind: "progress", summary: "window.focus: ok" },
    { at: "2026-09-14T09:56:00.000Z", kind: "progress", summary: "desktop.click: ok | with <pipe> and\nnewline" }
  ]
};

describe("task export", () => {
  it("renders markdown with goal, status, and timeline rows", () => {
    const md = renderTaskMarkdown(record);
    expect(md).toContain("# AgentHost run: task_demo");
    expect(md).toContain("Check the local news on hespress");
    expect(md).toContain("**completed**");
    expect(md).toContain("window.focus: ok");
    expect(md).toContain("2 events");
  });

  it("escapes markdown table syntax in event summaries", () => {
    const md = renderTaskMarkdown({
      ...record,
      events: [{ at: "t", kind: "progress", summary: "a | b\nc" }]
    });
    expect(md).toContain("a \\| b<br>c");
  });

  it("renders self-contained html with escaped markup", () => {
    const evil = { ...record, events: [{ at: "t", kind: "progress", summary: "<script>alert(1)</script>" }] };
    const html = renderTaskHtml(evil);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Check the local news on hespress");
  });

  it("handles missing fields without throwing", () => {
    expect(() => renderTaskMarkdown({})).not.toThrow();
    expect(() => renderTaskHtml({})).not.toThrow();
    expect(renderTaskMarkdown({})).toContain("0 events");
  });
});
