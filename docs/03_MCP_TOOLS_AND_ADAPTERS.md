# AgentHost MCP Tools and Adapter Specification

All callable tools return `ToolResult`. MCP transport is stdio. The browser bridge and overlay child are separate local channels, not public MCP transports. Every loaded tool carries explicit execution metadata; missing or contradictory declarations fail registration, and MCP `tools/list` and `system.list_capabilities` are projected from the same loaded set.

The public Linux CLI starts this same stdio runtime from an installed release. Codex integration registers `agenthost start`, never a repository path; packaging commands do not add MCP tools or bypass tool safety.

## Inventory and execution classes

The server materializes one validated `ToolDefinition[]`. MCP `tools/list` and `system.list_capabilities` are projections of that same loaded set. Inventory count is generated from the loaded set at startup and must not be treated as a hard-coded documentation contract. Speech tools are included when the base server loads; optional adapters remain conditional. No loaded tool currently uses the available `inert` class; inert/review-only records are materialized as `metadata_only` today.

Each loaded definition has:

- `executionClass`;
- `externalEffect`;
- `requiresDryRun`;
- `requiresConfirmationToken`;
- `requiresExactTarget`;
- `source` (`base` or `optional_adapter`);
- `availability`.

### Capability strategy registry

`strategy.list`, `strategy.get`, `strategy.health`, `strategy.select`, and `strategy.explain_selection` expose redacted structural strategy metadata. `strategy.select` uses deterministic goal/profile/capability/adapter/Browser Bridge health filtering and stable scoring, then returns at most three bounded fallback IDs. Recorded episodic memory adjusts the score (capped success bonus, linear failure penalty) and is named in the explanation. `strategy.record_episode` / `strategy.recall_episodes` write and read those bounded redacted episodes (30-day TTL; policy aborts are never evidence). Route tie order is native adapter, Browser Bridge, structured browser, accessibility, local OCR/vision, desktop, then guide. `strategy.verify_outcome` performs one fixed read-only verification checkpoint. `strategy.propose`, `strategy.review`, `strategy.activate`, `strategy.record_outcome`, `strategy.revalidate`, `strategy.disable`, and `strategy.archive` change local strategy metadata only. No strategy tool invokes browser, desktop, accessibility, file, shell, Forge, workflow, or scheduler execution. Local strategy activation requires explicit review and two independently verified signed-receipt outcomes; built-ins are trusted structural definitions.

Missing/contradictory metadata and duplicate names fail closed. Disabled optional tools and generated Forge tool names are absent from both callable inventories.

`strategy.route_preview` is read-only action-level routing advice. Families are `browser_bridge`, `structured_browser`, `native_adapter`, `accessibility`, `local_ocr`, `screenshot_vision`, `desktop_input`, and `guide_only`. It returns bounded candidates, reason codes, alternatives, verification/latency classes, and fallback budget; it never executes, retries, changes targets, or creates confirmations. Persisted route metrics are aggregate verified outcomes only.

`strategy.goal_plan_preview` is a read-only planning projection. It returns a
bounded redacted `AgentGoal`, bounded ordered `ExecutionPlan`, optional `ActionRoute`,
checkpoint, decision-level, candidate-plan/route comparison, and visual-surface summary. Route
health inspection is bounded and read-only; no route action is invoked. It does
not persist goals, create confirmations, grant permissions, or start replay.

`strategy.capability_graph` returns a relevant TTL-bounded graph of loaded tools,
route families, adapters, and prerequisites, with a bounded live read-only route-health
overlay when the route service is available. `strategy.failure_memory` returns bounded
verified route evidence using fingerprints only. Both are read-only and never execute
routes or underlying tools. Planner visual selection
chooses compact activity, progress, checklist, instruction, approval, recovery,
comparison, or result surfaces from safe state; it never renders raw private
content.

## Strategy order

1. app adapter/API
2. official API/plugin API
3. CLI/script
4. browser DOM
5. accessibility
6. screenshot OCR/vision grounding
7. pointer GUI fallback
8. guide mode

## Tool groups

The following groups are verified from the current factories. `system.list_capabilities` is the authoritative complete list; this document avoids duplicating every generated schema.

### System, policy, app, and adapter discovery

Examples: `system.get_info`, `system.list_capabilities`, `system.check_dependency`, `policy.*`, `app.detect`, `app.list_installed`, `app.get_strategy`, `adapter.list`, `adapter.get_capabilities`, `adapter.detect_for_app`.

Class: read-only or diagnostic. External effect: none. Dry-run/confirmation: not required. These report local state and policy metadata only.

### Agent control, tasks, skills, and observation

`agent.status`, `agent.stop`, `agent.resume`, `agent.takeover_begin`,
`agent.takeover_end` (stop/takeover enforced centrally, exempt from their own
gate), and `agent.discover_capabilities` (runtime families, counts, adapters,
browser/desktop availability). `task.create/status/update/log_event/pause/
resume/complete` persist long-running goal state under `tasks/`.
`task.execute_plan` runs a bounded (10-step, 8 KB) tool sequence against one
active task: dry-run validation plus one plan token, stop/takeover gates
before every step, per-step event logging, fail-fast with a replan hint.
`agenthost task watch <id> [--follow] [--notify]` tails that log without
watching the app.
`agenthost task approve <id> [--max-risk low|medium]` (operator-only, no MCP
tool) pre-approves a task's routine effects for 30 minutes: the central
runner chains the exact dry-run + single-use confirmation server-side, so one
model turn replaces two. Only low/medium, non-external, non-destructive
effects qualify; high/critical effects keep per-action confirmation, and
`stop`, new tasks, or expiry revoke the approval.
`skills.list/get` serve the reusable catalog (software-development,
web-research, file-management, browser-work, desktop-automation,
data-analysis, document-editing, testing-debugging, system-administration).
`computer.observe_state` returns active window, desktop capabilities, and
screen geometry for post-action verification and recovery. `includeWindows`
and `includeBrowserTabs` fold window-list and tab-list turns into the same
call. `computer.wait_for` polls active-window state at ~150ms until it
matches (or times out), replacing fixed multi-second sleeps and the model
turn spent waiting.

### Files and shell

`file.read`, `file.exists`, and `file.list` are read-only. `file.write`, `file.ensure_dir`, `file.copy`, and `file.move` are state-changing with dry-run/confirmation; `file.delete` is high-consequence (approval, exact target, no recursive mode). `shell.run_safe` is state-changing and bounded; the shell classifier now treats wrapper/metacharacter/destructive/package operations as approval-gated high-risk rather than hard-blocked, while sudo, filesystem formatting, kill-all, and root permission changes stay blocked, as do credential and browser-profile paths.

State-changing calls require a declared dry-run, policy/grant approval, and session-bound confirmation where required. Protected paths, dangerous commands, secrets, broad filesystem access, sudo, installation, and unsafe network use remain blocked.

### Desktop, windows, and accessibility

Examples: `desktop.get_active_window`, `desktop.get_capabilities`, `desktop.screenshot`, `desktop.click`, `desktop.type_text`, `desktop.hotkey`, `desktop.move_mouse`, `desktop.scroll`, `desktop.double_click`, `desktop.right_click`, `desktop.drag`, `window.list`, `window.focus`, `accessibility.get_tree`, `accessibility.find_element`, `accessibility.inspect_element`, `accessibility.invoke_action`, `accessibility.set_value`, `accessibility.focus_element`.

Observation tools are read-only. Pointer, window, accessibility actions, and the current `desktop.screenshot` registration are classified state-changing by the loaded metadata and therefore use dry-run/confirmation baseline. Actions require active-window or exact accessibility/coordinate context where applicable. `desktop.type_text` routes ASCII letters/digits/space through `xdotool type` and everything else through clipboard paste (install `xclip`/`xsel`); `window.focus` returns the previous window for focus restoration. X11 is primary; Wayland returns clean unsupported/guide results.

### Browser setup, observation, and actions

Setup/diagnostics: `browser.detect` (includes the session holder for handoff decisions), `browser.setup_status`, `browser.diagnose_bridge`, `browser.generate_pairing_token`, `browser.reset_pairing`, `browser.get_extension_install_instructions`, `browser.verify_pairing`, `browser.background_status` (placement, isolated profile, worker aliveness; spawns nothing).

Observation: `browser.list_tabs`, `browser.get_active_tab`, `browser.current_url`, `browser.get_page_context`, `browser.extract_text`, `browser.find_element`, `browser.wait_for_state`, `browser.get_form_state`, `browser.get_selected_text`.

Browser setup is also explicit and local: `browser.inventory`,
`browser.setup_status`, `browser.setup_begin`, `browser.setup_approve`,
`browser.setup_cancel`, `browser.setup_verify`, `browser.diagnose_bridge`,
and installation-instruction tools expose bounded inventory/enrollment state.
Enrollment is browser-family scoped, identity/protocol/version checked, and
stored as redacted local lifecycle metadata. Setup never returns reconnect
secrets through status or logs; pairing approval remains explicit.

Actions: `browser.open_url`, `browser.click_element`, `browser.fill_text`, `browser.focus_element` — website-agnostic. `browser.background_launch` (confirmation-gated) spawns the detached headless worker in the isolated profile; `browser.release_session` (confirmation-gated) drops the single bridge session so the next paired device to reconnect — e.g. the worker — holds it (verify with `browser.detect`). Financial and system-settings contexts are approval-gated instead of blanket-blocked (external/destructive financial effects still have no governed route); only credential/security contexts, password inputs, authentication, and CAPTCHA remain hard-blocked. Checkpoint failures now carry recovery guidance (re-observe, re-find, alternative capability).

The bridge is disabled by default, loopback-only, paired, fixed-command, bounded, and redacted. Actions require short-lived opaque tab/page-bound `elementId` references; direct selectors cannot execute actions. Navigation/action calls use dry-run and confirmation. Password, secret, login, CAPTCHA, MFA, and credential/security operations remain protected. Send, submit, upload, delete, and payment effects are governed by exact target/content/route bindings when a supported route exists; otherwise they return `action_unsupported` or guide-only. Communication reads require grants; financial/credential/admin content is protected.

### Vision and screenshot handoff

`vision.analyze_image`, `vision.find_text`, `vision.find_target`, and `vision.prepare_pointer_action` are read-only. OCR is local Tesseract only. Observation is first-class: financial and system-settings windows are now observable (credential/security stays blocked, including pointer handoff), and `computer.observe_state` exists for mandatory post-action verification. The handoff validates fresh trusted evidence and returns only a `desktop.click` `dryRun:true` payload; it never clicks or types.

### Checkpoints

`checkpoint.evaluate` and `checkpoint.wait_for` are read-only, bounded semantic checks. They may inspect browser, accessibility, desktop, file, or trusted vision state. Secret checkpoints block; private checkpoints require grants. Checkpoints never execute actions or create confirmation tokens.

### Forge lifecycle, validation, sandbox, runtime, and dispatch

Manifest/review/artifact/registration/validation tools (`forge.validate_manifest`, `forge.review_manifest`, `forge.propose_grants`, `forge.save_manifest`, `forge.*_review`, `forge.scaffold_project`, `forge.validate_project`, `forge.run_validation_harness`, registration and listing tools) are metadata-only. They do not import or execute generated source.

`forge.check_sandbox_support` is diagnostic. `forge.check_runtime_eligibility`, `forge.list_dispatchable_tools`, and `forge.get_dispatchable_tool` are metadata-only. `forge.run_sandboxed_tool` and `forge.dispatch_generated_tool` are state-changing fixed-control tools: dry-run, grants, confirmation, handler contract, hard limits, and sandbox selection apply. Generated tool names remain absent from live MCP capabilities.

### Workflow traces, skills, templates, replay, and receipts

`workflow.trace_*`, `workflow.skill_*`, checkpoint-template lifecycle tools, `workflow.skill_replay_dryrun`, and replay session/step tools are metadata-only or read-only governance. They store redacted records, prepare at most one current step, and never replay actions autonomously.

Receipts are attached by the normal runner rather than exposed as a standalone action tool. They contain signed fingerprints and safe status metadata only. Replay apply requires a valid, fresh, unconsumed receipt and replay binding; checkpoints still determine semantic success.

### Assistance previews and visual-flow templates

`overlay.assistance_step_preview` and `overlay.assistance_session_explain` are `read_only`. They return bounded current-step, progress, waiting, renderer, target-freshness, blocker, and recommendation metadata. They never render, advance, allocate overlay IDs, resolve targets, or call another tool.

`overlay.assistance_template_validate`, `overlay.assistance_template_preview`, `overlay.assistance_template_get`, and `overlay.assistance_template_list` are `read_only`. `overlay.assistance_template_save`, `overlay.assistance_template_archive`, and `overlay.assistance_template_instantiate` are `metadata_only`. Templates use existing visual step/primitive types, declared scalar parameters, literal `{{parameterName}}` substitution, and typed target placeholders only. Unknown fields, executable text, expressions, shell/env/glob expansion, dynamic tool names, secret values, stale live IDs, and unsupported steps are rejected. Instantiation creates a draft assistance session only; it does not start, render, execute, grant permissions, or create confirmation tokens.

`overlay.assistance_target_refresh` is `visual_only`. It accepts `sessionId`, current `stepId`, and one typed target binding. Server context supplies ownership. Resolver validation checks target kind, bounds, sensitivity, and freshness. It changes visual session metadata only, never renders automatically, and is limited to two explicit refreshes per step. Target-bound steps declare `requiresTarget`; missing/stale required targets block `overlay.assistance_step_show` until refreshed. Static unbound primitives retain existing behavior.

### Scheduler and manual-run governance

`scheduler.job_*` (including pause, resume, cancel, archive, and remove), activation tools, readiness/activation previews, manual-run contract tools, preflight tools, acknowledgement/request tools, request review/revocation tools, and approval validity/explanation tools are metadata-only. They may create local review records for bounded once/delayed/recurring/cron/calendar descriptions, but never create timers, workers, run sessions, replay sessions, notifications, files, or execution permission. Scheduler approval remains non-executable.

### Overlay renderer and visual-assistance sessions

`overlay.get_capabilities`, renderer diagnostics/restart, primitives (`show_pointer`, `highlight_target`, `show_tooltip`, `show_widget`, `update`, `dismiss`, `clear`, `emergency_hide`), assistance-session tools, visual guides (`overlay.guide_present/advance/dismiss`), and `overlay.control_surface_show/get/update/hide/apply_event` are `visual_only` with no target-app external effect. `overlay.guide_present` renders a checklist with progress plus a highlight and tooltip on the current step's screen target in one call; `advance` moves everything to the next step (finishing dismisses all); `dismiss` clears immediately. Guides are ephemeral, owner-scoped, TTL-bound, and auto-expire. Control surfaces bind one generic operator view to one trusted assistance session and expose only `continue`, `pause`, `resume`, `cancel`, `retry_visual_render`, `inspect_diagnostics`, `emergency_hide`, and `close_control_surface`. No `back` action exists. Events never invoke another tool. Renderer IDs are short-lived and invalid after restart; duplicate event IDs are rejected by a separate TTL replay ledger. GTK3/X11 is optional; headless fallback is safe; Wayland limitations are explicit.

R4 runtime activity is not a new execution tool. The normal tool runner emits bounded activity records and the overlay controller renders only allowlisted labels, lifecycle state, elapsed time, authoritative progress, blocker/warning codes, and renderer/suppression status. Direct tool rows are projected through this authoritative source once. Activity state never creates permissions, confirmations, target-app actions, or background work.

`npm run demo:visual-copilot` is explicit local demonstration command, not MCP capability. It uses same stores and renderer boundary, prompts for every operator decision, prints redacted diagnostics, and exits safely when GUI dependencies are unavailable.

V2 surface projection uses a versioned envelope and fixed trusted component registry. Dynamic markup/scripts, URLs, expressions, imports, arbitrary MCP calls, shell commands, raw arguments, secrets, and private page/OCR/filesystem content are rejected. Visible native rendering requires handshake, transparency, mapping, draw-ready, epoch, request correlation, live registration, and post-acknowledgement projection; headless state never claims visible success. Screenshot suppression hides every coordinator surface, not only runtime activity.

## Optional adapters

`packages/app-blender` supplies `blender.run_python` only when `optionalAdapters.blender.enabled` is explicitly true. It is experimental, source `optional_adapter`, state-changing, reviewed-script, dry-run, confirmation-gated, bounded, output-root restricted, shell-free, and redacted. It is not a core product feature. Other adapters must declare the same generic execution policy before loading.

`packages/app-ssh` is the second adapter and the first remote device: `ssh.run_command` runs one reviewed shell command on another machine over OpenSSH when `optionalAdapters.ssh.enabled` is explicitly true. Targets are strict argv (plain hostname/IP, login name, port), key authentication only (`BatchMode=yes`, no password prompts), blocked remote patterns stay blocked via the shared shell classifier, and output is bounded. The tool passes no local app identity to the classifier (no local app is automated); the device is bound in the confirmation target instead.

## Confirmation and result model

State-changing tools declare dry-run/confirmation metadata. The central runner validates schema, policy, grants, protected contexts, and the non-consuming confirmation envelope. Domain handlers revalidate exact targets and consume the token exactly once. `ToolResult` remains backward-compatible and may include a safe receipt. No receipt grants permission, and no confirmation token is returned by workflow/scheduler/overlay governance tools.

''## MCP resources: fast discovery for agent clients

Codex, Claude Code, Copilot, OpenCode, and other MCP clients should NOT
ingest all 250+ tool schemas up front. Pull these lazy resources first:

- `agenthost://capabilities.md` — one condensed brief (families, loop,
  confirmation model) sized for system prompts.
- `agenthost://capabilities` — live families, tool counts, and classes.
- `agenthost://skills` — reusable skill catalog.
- `agenthost://status` — live stop/takeover state and tool count.

Then call `agent.discover_capabilities` and `skills.list/get` for detail, and
only then `tools/list`. For static config files (`AGENTS.md`, `CLAUDE.md`),
paste `agenthost capabilities --markdown`.

## Overlay lifecycle: no stuck widgets

Every overlay carries a TTL (default 30s, max 5min) enforced by a 5-second
sweeper even when nothing polls state. The status widget stays on screen at
all times: terminal work (completed, failed, cancelled; default 5s) yields to
a persistent idle widget, as do `task.complete` and `agent.stop` (set
`runtimeActivityOverlay.persistWhenIdle: false` for the legacy auto-hide).
Renderer children exit when
their MCP parent dies (stdin HUP plus a 5-second parent-watch). If a widget
ever sticks anyway, `agenthost overlay hide` terminates orphaned renderers
(live ones are left alone) and `overlay.emergency_hide` clears owned
overlays at once.

## Control Room

Control Room is HTTP reporting surface, not MCP capability. It is disabled by default and starts only when explicitly enabled. It displays bounded dashboard, task, timeline, screenshot-metadata, and health projections from real local records. It never invokes MCP tools, creates confirmations, grants access, starts replay, starts jobs, or controls browser/desktop targets.

## Speech tools

`speech.list_providers`, `speech.get_capabilities`, `speech.list_voices`, `speech.list_languages`, `speech.devices_list`, and `speech.routing_diagnose` expose bounded local/offline metadata. `speech.artifact_get`, `speech.playback_state`, and `speech.transmission_get` return owner-scoped metadata only. `speech.synthesize` creates an expiring owner-scoped artifact; `speech.play` and `speech.stop` affect only AgentHost-owned local playback. These state-changing tools require dry-run and confirmation.

`speech.transmission_prepare` validates an existing local default output route and target without transmitting. `speech.transmission_execute` is separate, high-risk, grant- and confirmation-gated, one-time exact-binding playback; execution rechecks artifact metadata, route readiness, owner, expiry, and target binding. Arbitrary device routing is unsupported. It does not join meetings, create routes, record microphones, transcribe, send written recaps, or use network TTS.
