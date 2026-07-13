# AgentHost Product Specification

## Product

AgentHost is a local workstation capability runtime: a safe, permissioned body for Codex and other AI agents. It exposes structured local tools through MCP while keeping policy, grants, previews, confirmations, redaction, and audit logging in one safety boundary.

AgentHost is universal and provider-agnostic. Gmail, WhatsApp Web, LinkedIn, Google, Zoom, Slack, Outlook, Blender, and similar names are examples of possible apps, not hardcoded product targets.

```text
Agent / Codex
  -> AgentHost MCP server
  -> schema + risk + policy + grants
  -> dry-run + confirmation when required
  -> safest available adapter or OS strategy
  -> structured result + redacted audit record
```

## Strategy priority

1. app adapter or official API/plugin API
2. CLI/script interface
3. browser DOM
4. accessibility tree
5. local screenshot OCR/vision grounding
6. pointer GUI fallback
7. guide mode

GUI remains fallback. Browser tools never silently fall back to screenshots or mouse control.

## Current capability state: Phase 31.6

Completed foundation includes:

- universal core types, `ToolResult`, capability registry, config, policy profiles, grants, risk classification, redaction, JSONL audit logging
- system, app, file, shell, window, accessibility, desktop, guide, adapter, and optional Blender tools
- dry-run previews and exact, session-bound, expiring confirmation tokens
- desktop pointer actions: move, scroll, double-click, right-click, drag
- Tool Forge manifest validation, reviews, artifact lifecycle, inert project scaffolding, static validation, inert harness, registration gates, runtime eligibility, capability grants, bounded JSON subprocess runner, optional OS sandboxing, and controlled generated dispatch
- generated artifacts remain non-live; generated JavaScript/Python is never dynamically imported or executed
- browser bridge foundation for Firefox/Chromium through paired localhost WebExtension; tab metadata, sanitized URL navigation, page context, bounded text, element discovery, safe element click/fill/focus, state waits, form metadata, and selected-text reads
- stable unpacked extension preparation, setup/pairing diagnostics, reset/recovery, and documented manual validation
- short-lived, tab-bound browser `elementId` references; direct selectors cannot perform actions
- local Tesseract OCR grounding: text boxes, bounds, centers, target candidates, redaction, and clean unsupported results when unavailable
- trusted screenshot evidence and `vision.prepare_pointer_action`, which only returns a validated `desktop.click` dry-run suggestion
- semantic read-only checkpoints and reviewable workflow checkpoint templates
- redacted workflow traces and inert workflow skills with explicit parameter binding and checkpoint-only dry-runs

## Browser and vision boundaries

Browser bridge is disabled by default, binds only to `127.0.0.1`, uses pairing/session tokens, fixed commands, bounded bodies/timeouts, and one active session. It has no cookies, storage, debugger, arbitrary script, upload, submit, send, or form API.

Extension DOM bridge is recommended for structured browser automation, not required. If unavailable, AgentHost may recommend accessibility, local OCR/vision, pointer fallback, or guide mode according to safety and strategy priority. It never silently executes another strategy after browser failure. See [Browser Setup Validation](06_BROWSER_SETUP_VALIDATION.md).

Communication pages require private-data grants for content reads. Financial, credential/security, password-manager, and admin pages are blocked or guide-only. Login, CAPTCHA, MFA, payment confirmation, secret extraction, and communication sending remain unavailable by default.

Vision tools analyze approved local images only. They never click or type, never upload screenshots, and never call cloud OCR. Screenshot handoff validates freshness, hash, coordinate space, bounds, active window, risk, and sensitivity before returning a dry-run suggestion.

## Workflow and Forge model

Workflow traces store redacted tool summaries, safety decisions, grants, and checkpoint results. Skills are drafts/metadata only. `workflow.skill_bind_checkpoints` and `workflow.skill_checkpoints_dryrun` validate declared parameters and optionally evaluate read-only checkpoints; they never replay skill actions or create confirmation tokens.

Tool Forge follows:

```text
manifest -> review -> artifact -> static validation -> inert harness
-> registration gate -> runtime eligibility/grants -> fixed JSON handler runner
```

Runtime execution is deny-by-default, capability-granted, bounded, timeout-limited, environment-filtered, network-free, GUI-free, shell-free, and optionally wrapped by bubblewrap/firejail/unshare. Generated tools never appear as independent live MCP tools.

## Platform scope

Linux is first. X11 supports pointer and window backends when safe dependencies exist. Wayland returns clean unsupported/guide results where no safe backend exists. Windows and macOS remain future platform work.

## Non-negotiables

- no silent send, submit, post, upload, delete, archive, pay, buy, or publish
- no CAPTCHA/MFA/login/payment/security bypass
- no passwords, cookies, tokens, private keys, browser storage, or secret extraction
- no public bridge, stealth control, persistence, background autonomy, sudo, dependency installation, or unsafe network access
- state-changing tools retain policy, grant, dry-run, confirmation, and audit requirements
