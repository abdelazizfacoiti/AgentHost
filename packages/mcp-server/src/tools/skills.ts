import { toolFailure, toolSuccess, type ToolResult } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";

/** Reusable skills: extend the agent; the agent composes capabilities dynamically and may combine skills. */
interface Skill {
  name: string;
  purpose: string;
  whenToUse: string;
  tools: string[];
  instructions: string[];
  constraints: string[];
  verification: string[];
  recovery: string[];
}

const SKILLS: Skill[] = [
  {
    name: "software-development",
    purpose: "Build, edit, test, and debug local code projects.",
    whenToUse: "User asks to create, modify, build, test, or fix software.",
    tools: ["file.read", "file.write", "file.copy", "file.move", "shell.run_safe", "computer.observe_state", "task.create", "task.log_event"],
    instructions: ["Inspect the project layout first.", "Make small edits.", "Run tests/builds with shell.run_safe.", "Observe output; fix failures iteratively."],
    constraints: ["No sudo, no secret exfiltration.", "Destructive deletes need approval."],
    verification: ["Build/tests pass; re-read modified files."],
    recovery: ["Inspect stderr, modify command, retry; restore from backup copies on bad edits."]
  },
  {
    name: "web-research",
    purpose: "Research the web and compare results into a report.",
    whenToUse: "User asks to look up, compare, or summarize web information.",
    tools: ["browser.open_url", "browser.find_element", "browser.get_page_context", "browser.extract_text", "file.write", "computer.observe_state"],
    instructions: ["Use user-controlled or public pages; open navigation with confirmation.", "Extract bounded text, compare across tabs.", "Write findings into a document; verify output exists."],
    constraints: ["Credential/security pages blocked; financial external effects unavailable.", "No login/CAPTCHA bypass."],
    verification: ["Report file exists; key claims cite observed pages."],
    recovery: ["On stale elements, re-observe page and re-find; on bridge failure use accessibility/vision/guide explicitly."]
  },
  {
    name: "file-management",
    purpose: "Organize, search, archive, and summarize local files.",
    whenToUse: "User asks to find, organize, extract, or summarize files (e.g. invoices by month with totals).",
    tools: ["file.list", "file.read", "file.copy", "file.move", "shell.run_safe", "computer.observe_state"],
    instructions: ["List before acting; operate on explicit paths.", "Process files one batch at a time.", "Write the summary/report and verify it."],
    constraints: ["Credential/browser-profile paths blocked.", "Deletes need approval; recursive delete unsupported."],
    verification: ["Output report exists with expected rows/totals."],
    recovery: ["On missing files, re-list directories; on parse errors, inspect file metadata and try another tool."]
  },
  {
    name: "browser-work",
    purpose: "General browser interaction: navigate, click, type, verify outcomes.",
    whenToUse: "Any task needing browser UI: downloads, uploads via supported routes, form preparation.",
    tools: ["browser.open_url", "browser.click_element", "browser.fill_text", "browser.focus_element", "browser.wait_for_state", "computer.observe_state"],
    instructions: ["After every action, verify with page context or wait_for_state; never assume click succeeded.", "Use short-lived elementIds from fresh find_element calls."],
    constraints: ["Password/CAPTCHA/auth elements blocked.", "Send/submit/upload/delete/payment effects need exact-target confirmation or governed routes."],
    verification: ["Checkpoint passes; observed page matches intent."],
    recovery: ["Inspect new UI, locate equivalent element, retry; abandon route after repeated failure and try accessibility/desktop/guide."]
  },
  {
    name: "desktop-automation",
    purpose: "Drive native apps via accessibility, vision grounding, and pointer actions.",
    whenToUse: "Native applications without CLI/API; GUI fallback.",
    tools: ["desktop.click", "desktop.type_text", "desktop.hotkey", "accessibility.get_tree", "vision.find_target", "vision.prepare_pointer_action", "computer.observe_state"],
    instructions: ["Prefer accessibility tree over coordinates.", "Vision handoff is suggestion-only; execute via desktop.click dryRun flow.", "Always supply active-window context."],
    constraints: ["Credential/security windows blocked for handoff.", "X11 primary; Wayland reports limits."],
    verification: ["Active window and screenshot show the intended state."],
    recovery: ["Re-observe, re-ground target, retry; restart app if process died and restore context."]
  },
  {
    name: "data-analysis",
    purpose: "Extract, transform, and report on local data with scripts.",
    whenToUse: "Totals, discrepancies, spreadsheets, summaries over local files.",
    tools: ["file.read", "file.list", "shell.run_safe", "file.write"],
    instructions: ["Inspect inputs first.", "Run analysis scripts with bounded output.", "Write the report and validate row counts/totals."],
    constraints: ["No arbitrary remote fetch without approval.", "Large outputs truncated; page through files."],
    verification: ["Report matches recomputed spot-checks."],
    recovery: ["On script failure, inspect stderr and adjust; on bad data, quarantine rows and continue."]
  },
  {
    name: "document-editing",
    purpose: "Modify documents via the appropriate app interface.",
    whenToUse: "Edit office docs, PDFs (via tools), text, images where supported.",
    tools: ["file.read", "file.write", "app.detect", "desktop.hotkey", "computer.observe_state"],
    instructions: ["Open via app adapter/CLI/GUI in strategy order.", "Save, then verify output file exists and re-reads."],
    constraints: ["Sensitive/secret content needs grants.", "No silent external send of documents."],
    verification: ["Saved file verified by re-read or app state."],
    recovery: ["On app crash, restart and restore; on format errors, try an alternative application."]
  },
  {
    name: "testing-debugging",
    purpose: "Run tests, inspect logs, isolate failures, fix and re-verify.",
    whenToUse: "Failing builds, flaky behavior, log inspection.",
    tools: ["shell.run_safe", "file.read", "file.list", "task.log_event"],
    instructions: ["Reproduce first; capture bounded logs.", "Fix smallest change; re-run.", "Record failure/success in task events."],
    constraints: ["No system-changing fixes without approval."],
    verification: ["Previously failing check now passes."],
    recovery: ["Bisect changes; use loop detection: abandon repeated identical failing commands."]
  },
  {
    name: "system-administration",
    purpose: "Inspect processes, logs, and workstation state within policy.",
    whenToUse: "Process inspection, log review, diagnostics.",
    tools: ["shell.run_safe", "system.get_info", "system.check_dependency", "computer.observe_state"],
    instructions: ["Read-only inspection first.", "State changes need approval; prefer dry-run previews."],
    constraints: ["No sudo, package install, service changes, or formatting without explicit approval path (currently high-risk gated)."],
    verification: ["System state matches expectation after change."],
    recovery: ["On failure, capture diagnostics and stop before retrying destructive paths."]
  }
];

const empty = z.object({}).strict();
const getInput = z.object({ name: z.string().trim().min(1).max(100) }).strict();

export function createSkillTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const list: AgentHostToolDefinition<z.infer<typeof empty>, unknown, AgentHostMcpContext> = {
    name: "skills.list", description: "Lists reusable skill catalog: purpose, when to use, tools, verification, recovery. Combine multiple skills per task.",
    riskLevel: "observe", inputSchema: empty, mcpInputSchema: { type: "object", properties: {}, additionalProperties: false },
    inputSummary: "List skills", safety: { actionType: "observe" },
    async handler(): Promise<ToolResult<unknown>> {
      return toolSuccess({ tool: "skills.list", riskLevel: "observe", data: { skills: SKILLS.map((skill) => ({ name: skill.name, purpose: skill.purpose, whenToUse: skill.whenToUse })) }, observations: ["Skills extend the agent; capabilities compose dynamically."] });
    }
  };
  const get: AgentHostToolDefinition<z.infer<typeof getInput>, unknown, AgentHostMcpContext> = {
    name: "skills.get", description: "Returns full skill detail: tools, instructions, constraints, verification, failure recovery.",
    riskLevel: "observe", inputSchema: getInput, mcpInputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
    inputSummary: "Get skill", safety: { actionType: "observe" },
    async handler(input): Promise<ToolResult<unknown>> {
      const skill = SKILLS.find((candidate) => candidate.name === input.name);
      if (skill === undefined) return toolFailure({ tool: "skills.get", riskLevel: "low", error: { code: "skill_not_found", message: `Unknown skill: ${input.name}` } });
      return toolSuccess({ tool: "skills.get", riskLevel: "observe", data: skill });
    }
  };
  return [list, get];
}
