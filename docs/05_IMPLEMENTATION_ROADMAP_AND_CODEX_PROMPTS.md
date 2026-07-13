# AgentHost Implementation Roadmap and Codex Prompts

## Development loop

Use plan, explicit approval, scoped implementation, build/test/lint/smoke, review, and commit. Keep changes phase-scoped. Never use global approval bypass. Preserve schema validation, policy, grants, dry-run, confirmation, and audit boundaries.

## Completed phases 0–31

- **0–1 Foundation:** TypeScript monorepo, MCP stdio server, universal core types, `ToolResult`, config, logging, registry.
- **2 Safety:** risk/app sensitivity/shell/path classifiers, redaction, policy-gated runner.
- **3–5 Universal automation:** Linux system/app/file/shell tools, guide mode, adapter registry.
- **6 Optional adapter:** Blender adapter, output validation, clean missing-dependency behavior.
- **7–11 Desktop safety:** X11 desktop/window/accessibility tools, active-window targeting, ambiguity rejection, dry-run previews, exact session confirmation tokens, Wayland unsupported handling.
- **12 Permission profiles and capability grants:** explicit profiles, scoped session/persistent grants, grant listing/revocation/explanations.
- **13 Tool Forge manifest foundation:** manifest schema, permission/risk/data declarations, validation and proposal flow.
- **14 Reviewed artifact lifecycle:** reviews, approval, artifact state transitions, safe grant application.
- **15 Inert generated project scaffolding/static validation:** generated projects remain inert; static checks only.
- **16 Inert validation harness:** bounded validation harness, no generated execution.
- **17 Inert registration gate:** registration eligibility and revocation; generated tools remain metadata.
- **18 Runtime boundary:** runtime eligibility and metadata-only stub boundary.
- **19 Bounded subprocess runner:** fixed child runner, JSON-only handler contract, caps, timeout, run records.
- **20 Runtime capability grants:** deny-by-default runtime capabilities, limits, operation allowlists, sandbox-folder restrictions.
- **21 Desktop pointer actions:** move, scroll, double-click, right-click, drag with active-window and safety controls.
- **22 Sandbox support probe:** read-only detection of bwrap/firejail/unshare/flatpak-spawn/nsjail/systemd-run and kernel security support.
- **23 Optional OS sandboxing:** auto backend selection, safe mounts/env, network denial, fixed-runner fallback.
- **24 Controlled generated capability dispatch:** inert metadata discovery and dispatch through existing bounded runner only.
- **25 Browser bridge foundation:** paired Firefox/Chromium localhost WebExtension, sanitized tabs/page context/text, safe navigation.
- **26 Browser element actions:** short-lived opaque element references, safe find/click/fill/focus, waits, form metadata, selected text.
- **27 Universal workflow traces and skills:** redacted traces, inert generic skills, no replay.
- **28 Local screenshot grounding/OCR:** Tesseract text boxes, target candidates, redaction, unsupported behavior.
- **29 Screenshot-to-action handoff:** fresh trusted evidence and validated desktop-click dry-run suggestions only.
- **30 Semantic post-action checkpointing:** read-only browser, desktop, accessibility, file, and vision checkpoints.
- **31 Reviewable checkpoint templates:** declared parameters, safe interpolation, grant/sensitivity previews, checkpoint-only evaluation; no skill replay.

## Current state

AgentHost is a universal local workstation runtime. Provider names such as Gmail, WhatsApp, Google, Zoom, Slack, Outlook, and LinkedIn remain examples for future adapters/workflows, not roadmap anchors. Communication sending and sensitive financial/credential actions remain blocked or explicitly gated.

## Phase 31.5 — Browser Extension Packaging and Pairing Reliability

Completed. Stable unpacked preparation, local setup command, pairing diagnostics, popup status, reset/recovery, and safe token handling.

No browser action capability expanded.

## Phase 31.6 — Browser Agentic Setup Validation and Documentation Sync

Completed. Documents setup states, reset/re-pair behavior, Firefox temporary-add-on limitation, Chromium unpacked behavior, manual browser smoke, explicit fallback routing, and token/logging safety. No browser action capability expanded.

## Recommended next phases

### Phase 32 — Local Review/Edit Lifecycle for Workflow Skill Checkpoint Templates

Add explicit review/edit/archive lifecycle for template metadata, parameter declarations, grants, sensitivity, and safety notes. No replay.

### Phase 33 — Universal Skill Replay Dry-Run

Build a complete replay plan preview that resolves original tools, grants, checkpoints, blocked steps, and confirmation requirements without executing any action.

### Phase 34 — Controlled Skill Replay Preview/Step Runner

Introduce explicitly approved, stepwise replay with original tool safety, grants, dry-run, confirmation, checkpoint verification, stop conditions, and no autonomous background operation.

### Phase 35 — Scheduler / Agent Jobs

Only after replay safety is proven: visible local jobs, bounded schedules, approval gates, cancellation, audit records, and no hidden persistence.

### Phase 36 — Meeting Assistant Mode

Provider-agnostic meeting observation, local notes, and explicit user-approved drafts. No automatic send, join, recording, or identity/security bypass.

### Phase 37 — Control Room UI

Local tray/control-room UI for server status, sessions, approvals, grants, traces, skills, sandbox support, logs, and emergency stop.

### Phase 38 — Packaging/Product Hardening

Install/update/uninstall hygiene, signed/reproducible artifacts where practical, migration/versioning, diagnostics, documentation, and platform expansion.

Provider-specific Gmail/WhatsApp/etc. workflows may be examples during these phases, never hardcoded architectural targets.
