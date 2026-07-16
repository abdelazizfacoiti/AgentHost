# AgentHost MCP Tools and Adapter Specification

All callable tools return `ToolResult`. MCP transport is stdio. The browser bridge and overlay child are separate local channels, not public MCP transports.

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

`strategy.list`, `strategy.get`, `strategy.health`, `strategy.select`, and `strategy.explain_selection` expose redacted structural strategy metadata. `strategy.select` uses deterministic goal/profile/capability/adapter/Browser Bridge health filtering and stable scoring, then returns at most three bounded fallback IDs. `strategy.verify_outcome` performs one fixed read-only verification checkpoint. `strategy.propose`, `strategy.review`, `strategy.activate`, `strategy.record_outcome`, `strategy.revalidate`, `strategy.disable`, and `strategy.archive` change local strategy metadata only. No strategy tool invokes browser, desktop, accessibility, file, shell, Forge, workflow, or scheduler execution. Local strategy activation requires explicit review and two independently verified signed-receipt outcomes; built-ins are trusted structural definitions.

Missing/contradictory metadata and duplicate names fail closed. Disabled optional tools and generated Forge tool names are absent from both callable inventories.

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

### Files and shell

`file.read`, `file.exists`, and `file.list` are read-only. `file.write` and `file.ensure_dir` are state-changing. `shell.run_safe` is state-changing and bounded.

State-changing calls require a declared dry-run, policy/grant approval, and session-bound confirmation where required. Protected paths, dangerous commands, secrets, broad filesystem access, sudo, installation, and unsafe network use remain blocked.

### Desktop, windows, and accessibility

Examples: `desktop.get_active_window`, `desktop.get_capabilities`, `desktop.screenshot`, `desktop.click`, `desktop.type_text`, `desktop.hotkey`, `desktop.move_mouse`, `desktop.scroll`, `desktop.double_click`, `desktop.right_click`, `desktop.drag`, `window.list`, `window.focus`, `accessibility.get_tree`, `accessibility.find_element`, `accessibility.inspect_element`, `accessibility.invoke_action`, `accessibility.set_value`, `accessibility.focus_element`.

Observation tools are read-only. Pointer, window, accessibility actions, and the current `desktop.screenshot` registration are classified state-changing by the loaded metadata and therefore use dry-run/confirmation baseline. Actions require active-window or exact accessibility/coordinate context where applicable. X11 is primary; Wayland returns clean unsupported/guide results.

### Browser setup, observation, and actions

Setup/diagnostics: `browser.detect`, `browser.setup_status`, `browser.diagnose_bridge`, `browser.generate_pairing_token`, `browser.reset_pairing`, `browser.get_extension_install_instructions`, `browser.verify_pairing`.

Observation: `browser.list_tabs`, `browser.get_active_tab`, `browser.current_url`, `browser.get_page_context`, `browser.extract_text`, `browser.find_element`, `browser.wait_for_state`, `browser.get_form_state`, `browser.get_selected_text`.

Actions: `browser.open_url`, `browser.click_element`, `browser.fill_text`, `browser.focus_element`.

The bridge is disabled by default, loopback-only, paired, fixed-command, bounded, and redacted. Actions require short-lived opaque tab/page-bound `elementId` references; direct selectors cannot execute actions. Navigation/action calls use dry-run and confirmation. Password, secret, login, CAPTCHA, MFA, payment, send, submit, upload, delete, and other protected operations are blocked or guide-only. Communication reads require grants; financial/credential/admin content is protected.

### Vision and screenshot handoff

`vision.analyze_image`, `vision.find_text`, `vision.find_target`, and `vision.prepare_pointer_action` are read-only. OCR is local Tesseract only. Results contain bounded redacted text/boxes/centers and suggestions. The handoff validates fresh trusted evidence and returns only a `desktop.click` `dryRun:true` payload; it never clicks or types.

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

`scheduler.job_*`, activation tools, readiness/activation previews, manual-run contract tools, preflight tools, acknowledgement/request tools, request review/revocation tools, and approval validity/explanation tools are metadata-only. They may create local review records, but never create timers, workers, run sessions, replay sessions, notifications, files, or execution permission. Scheduler approval remains non-executable.

### Overlay renderer and visual-assistance sessions

`overlay.get_capabilities`, renderer diagnostics/restart, primitives (`show_pointer`, `highlight_target`, `show_tooltip`, `show_widget`, `update`, `dismiss`, `clear`, `emergency_hide`), assistance-session tools, and `overlay.control_surface_show/get/update/hide/apply_event` are `visual_only` with no target-app external effect. Control surfaces bind one generic operator view to one trusted assistance session and expose only `continue`, `pause`, `resume`, `cancel`, `retry_visual_render`, `inspect_diagnostics`, `emergency_hide`, and `close_control_surface`. No `back` action exists. Events never invoke another tool. Renderer IDs are short-lived and invalid after restart; duplicate event IDs are rejected by a separate TTL replay ledger. GTK3/X11 is optional; headless fallback is safe; Wayland limitations are explicit.

R4 runtime activity is not a new execution tool. The normal tool runner emits bounded activity records and the overlay controller renders only allowlisted labels, lifecycle state, elapsed time, authoritative progress, blocker/warning codes, and renderer/suppression status. Direct tool rows are projected through this authoritative source once. Activity state never creates permissions, confirmations, target-app actions, or background work.

`npm run demo:visual-copilot` is explicit local demonstration command, not MCP capability. It uses same stores and renderer boundary, prompts for every operator decision, prints redacted diagnostics, and exits safely when GUI dependencies are unavailable.

## Optional adapters

`packages/app-blender` supplies `blender.run_python` only when `optionalAdapters.blender.enabled` is explicitly true. It is experimental, source `optional_adapter`, state-changing, reviewed-script, dry-run, confirmation-gated, bounded, output-root restricted, shell-free, and redacted. It is not a core product feature. Other adapters must declare the same generic execution policy before loading.

## Confirmation and result model

State-changing tools declare dry-run/confirmation metadata. The central runner validates schema, policy, grants, protected contexts, and the non-consuming confirmation envelope. Domain handlers revalidate exact targets and consume the token exactly once. `ToolResult` remains backward-compatible and may include a safe receipt. No receipt grants permission, and no confirmation token is returned by workflow/scheduler/overlay governance tools.

## Control Room

Control Room is HTTP reporting surface, not MCP capability. It is disabled by default and starts only when explicitly enabled. It displays bounded dashboard, task, timeline, screenshot-metadata, and health projections from real local records. It never invokes MCP tools, creates confirmations, grants access, starts replay, starts jobs, or controls browser/desktop targets.

## Speech tools

`speech.list_providers`, `speech.get_capabilities`, `speech.list_voices`, `speech.list_languages`, `speech.devices_list`, and `speech.routing_diagnose` expose bounded local/offline metadata. `speech.artifact_get`, `speech.playback_state`, and `speech.transmission_get` return owner-scoped metadata only. `speech.synthesize` creates an expiring owner-scoped artifact; `speech.play` and `speech.stop` affect only AgentHost-owned local playback. These state-changing tools require dry-run and confirmation.

`speech.transmission_prepare` validates an existing local default output route and target without transmitting. `speech.transmission_execute` is separate, high-risk, grant- and confirmation-gated, one-time exact-binding playback; execution rechecks artifact metadata, route readiness, owner, expiry, and target binding. Arbitrary device routing is unsupported. It does not join meetings, create routes, record microphones, transcribe, send written recaps, or use network TTS.
