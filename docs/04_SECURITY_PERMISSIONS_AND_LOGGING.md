# AgentHost Security, Permissions, and Logging

## Security goal

AgentHost is local-first, visible, permissioned, previewable, confirmation-bound, bounded, auditable, and conservative. It must never behave like malware, spyware, credential theft software, stealth remote control, or an unattended automation service.

## Release and installation boundary

R5 installation is rootless and limited to AgentHost-owned user paths. It performs no package installation, system-service registration, public binding, browser auto-installation, or secret generation. Codex configuration edits require preview, explicit apply, backup, validation, and rollback. Release scans reject credential-like material, token values, current-user absolute paths, screenshots/audio/logs, caches, and runtime state. Uninstall preserves runtime data by default.

## Hard non-negotiables

- no silent send, submit, post, upload, delete, archive, pay, buy, publish, or destructive overwrite;
- no login, CAPTCHA, MFA, payment, security, or approval bypass;
- no password, cookie, browser-storage, token, API-key, private-key, or secret extraction;
- no public bridge, remote access, stealth control, hidden persistence, background autonomy, sudo, package installation, or unsafe network access;
- no arbitrary generated JavaScript/Python execution;
- no generated tools as independent live MCP tools.

## Central execution baseline

Every loaded tool has validated execution metadata. Missing or contradictory metadata fails closed. For state-changing tools, the central runner:

1. validates schema and metadata;
2. evaluates policy, grants, protected context, risk, and guide-only restrictions;
3. requires the declared prior dry-run and confirmation contract;
4. verifies the session/tool/input confirmation envelope without consuming it;
5. invokes the handler only after acceptance.

The handler remains responsible for current target resolution, exact target/input checks, app-specific sensitivity, path/backend constraints, and the single consuming confirmation operation. Receipts are issued after the result. Narrow legacy preflight paths are explicit and tested; there is no implicit safety opt-out.

Confirmation tokens are short-lived, session-bound, input-fingerprint-bound, risk-bound, single-use, and never logged raw. Confirmation verifies intent; it does not bypass policy, grants, protected contexts, or handler checks.

## Profiles and grants

Profiles include strict, dev, gui-dev, demo-unlocked-local, private-data, and future-disabled autopilot. Demo mode only reduces friction for approved local/demo roots and normal apps; hard safety blocks remain.

Persistent grant config is strict and round-trips these runtime fields without synthesizing permissions:

- generated registration/tool/capability scopes;
- `sandboxRoots` and `outputRoots`;
- `allowedOperations`;
- positive `maxInputBytes`, `maxOutputBytes`, and `maxRuntimeMs` limits;
- dry-run, confirmation, approval, exact-target, risk, path, app, sensitivity, and expiry requirements.

Unknown fields, malformed values, unsupported dangerous capabilities, invalid roots, and limits above hard runtime limits reject. Runtime matching intersects grants with hard limits; persisted grants cannot expand them. Current Forge hard limits are 64 KiB input, 64 KiB output, and 5 seconds unless a narrower grant applies.

## Browser bridge and element safety

Firefox/Chromium bridge is disabled by default and binds only to `127.0.0.1`. Enrollment token is short-lived and consumed once. Persistent device record binds browser family, exact origin, extension identity, protocol, and compatible version; AgentHost stores only reconnect-secret hash. Session token remains memory-only. One active session, request bodies, command queue, command timeout, and reconnect window are bounded. Revocation/rotation invalidates prior device credentials. No cookies, page storage, history, debugger, webRequest, password APIs, arbitrary JavaScript, upload, submit, send, or generic form API exists.

Setup diagnostics expose state codes and recovery steps, not tokens, page content, or private URLs. Pairing-token generation/reset is dry-run and confirmation-gated; explicit generation returns the token once. Tokens never enter logs.

Browser element IDs are opaque, short-lived, tab/page-bound references. Actions require a unique reference and revalidate session, URL, identity, visibility, enabled state, and ambiguity. Direct selectors cannot execute actions. Communication reads require private-data grants. Financial, credential/security, password-manager, and admin contexts are blocked or guide-only.

## Vision, screenshot evidence, and checkpoints

Vision accepts approved local AgentHost screenshot/output roots and uses local Tesseract only. It never uploads images, uses cloud OCR, clicks, types, or logs image bytes/full private OCR. Text, email, phone, URL, token, and auth-looking values are redacted.

Trusted screenshot handoff requires session binding, image hash, coordinate-space proof, dimensions, active-window match, bounds, confidence, sensitivity checks, and a 10-second freshness window. It returns only a desktop-click dry-run suggestion.

`checkpoint.evaluate` and `checkpoint.wait_for` are read-only. Secret checkpoints block; private checkpoints require grants. Checkpoint templates are review metadata with declared parameters and literal `{{parameter}}` interpolation only. No expression, shell, environment, glob, code, or hidden tool execution is allowed.

## Receipts and replay protections

The runner attaches a short-lived HMAC-signed receipt containing fingerprints, tool/risk/preview/execution status, and safe confirmation metadata. It contains no raw input/output, token, page text, OCR, secret, or private content.

Replay receipt states are active, reserved, and consumed. Reservation binds one session, step, prepare ID, and tool/input fingerprint. Tampered, missing, expired, wrong, reused, or stale receipts fail closed. Replay sessions permit one explicit current step; no loop, retry, background task, or action execution is performed by the replay layer. Semantic completion still requires a read-only checkpoint.

## Forge runtime and OS sandboxing

Forge review, artifact validation, registration, eligibility, grants, and fixed-runner boundaries precede runtime dispatch. Only bounded `runtime/handler.json` JSON operations run in a child process; generated source is not imported.

The runner uses `shell:false`, a filtered environment, bounded stdin/stdout/stderr/output/runtime, per-run writable folders, and no GUI/DBus/API-key/private-data environment. It denies network, shell, broad filesystem, and dangerous capabilities.

`auto` prefers Bubblewrap/bwrap with unprivileged user namespaces, read-only project/runtime mounts, writable per-run storage, and an isolated network namespace. If unavailable, it falls back to the fixed runner with a limitation warning. Explicit `none` uses the fixed runner. Firejail and unshare are currently detected-only and fail closed because no reviewed filesystem profile exists. OS sandboxing does not authorize arbitrary source execution.

## Optional adapters

Optional external-process/application adapters must be disabled by default and declare experimental/stable status, execution metadata, fingerprint behavior, shell policy, environment allowlist, timeout/output caps, filesystem/output roots, and redacted audit policy.

Blender is the reference optional adapter, not a core feature. When explicitly enabled, `blender.run_python` requires reviewed script input, dry-run, exact confirmation bound to the reviewed input/output target, static Python safety checks, shell-free bounded subprocess execution, filtered environment, AgentHost output-root validation, expected-output validation, timeout/output caps, and redacted results. It remains distinct from Forge’s bounded JSON runtime.

## Capability strategy security

Strategy records are installation-local, schema-versioned, bounded, atomic, and mode `0600`. They contain structural goal/capability/health/verification metadata only. Validators reject secrets, credentials, private content, screenshots/OCR/page/file content, transient browser/accessibility/vision/overlay/window IDs, coordinates, arbitrary code/shell, callbacks, expressions, dynamic tool names, hidden retries, and unbounded loops. Profile, grant, compatibility, protected-context, and live prerequisite checks run again at selection. Selection is advisory and cannot execute or authorize actions. Local strategies require explicit review plus two independently verified signed receipts; stale or failing strategies degrade and fail closed. Audit logs contain IDs/status/counts/failure codes only, never strategy inputs or receipt signatures.

## Overlay and renderer safety

Overlay targets are fresh, owner/session-bound, sensitivity-checked, and TTL-limited. Widgets accept only allowlisted intent events. Events update overlay/session state only and never invoke another tool. The GTK child uses authenticated bounded JSONL IPC, filtered environment, handshake validation, crash detection, bounded restart, and headless fallback.

Control surfaces derive ownership from trusted MCP server context; MCP input cannot supply `ownerSessionId`. One surface exists per valid assistance session. Event IDs use a separate TTL-bound replay ledger, and event routing validates session, surface, overlay binding, renderer epoch, action enum, and freshness. Persisted records contain only redacted status, progress, diagnostics, IDs, and safe reason codes. Live overlay IDs never survive renderer restart.

`overlay.emergency_hide` hides AgentHost-owned overlays and clears owned visual state. It is not a global AgentHost process circuit breaker, does not kill target apps, and does not undo prior external actions.

### Runtime activity overlay

Runtime activity records are owner/session-bound, bounded, allowlisted, and redacted. They contain IDs, safe source/label keys, lifecycle state, elapsed time, authoritative progress, blocker/warning codes, renderer epoch metadata, and screenshot-suppression state only. Raw inputs/outputs, prompts, page/OCR text, messages, URLs, filesystem paths, credentials, tokens, and screenshots are excluded. Completion requires verified tool/result state; process exit alone cannot claim success. The overlay is click-through and non-focus-stealing, never invokes tools, and never grants permission.

Screenshot capture serializes overlapping requests, acknowledges overlay hide before capture, verifies no live overlay remains, then acknowledges restoration. Failure returns safe suppression diagnostics; capture is never silently treated as clean. Renderer restart invalidates live bindings and reprojects only after a fresh handshake/render acknowledgement.

### Assistance previews and visual-template safety

Assistance step previews and session explanations are read-only projections. They use trusted owner context, bounded status codes, renderer health, progress, target freshness, and grant IDs only. They do not render, advance, resolve targets, invoke browser/desktop/accessibility/file/shell/Forge/workflow/scheduler tools, create grants, or create confirmation tokens.

Visual-flow templates are owner-scoped local metadata. Only existing visual primitives/widgets, declared scalar parameters, literal `{{parameterName}}` substitution, and typed target placeholders are accepted. Expressions, callbacks, shell/code, environment or glob expansion, dynamic tool names, retries, autonomy, secret values, raw private values, stale live IDs, and executable fields are rejected. Private bindings require existing grants and are redacted; secrets never persist. Template preview writes nothing. Save/archive/instantiate are metadata-only, and instantiation creates a draft session without starting or rendering it.

### Demo and target-recovery safety

The A3 demo uses public fixture text and validated local screen point only. Operator prompts gate start, target binding, continue, retry, and completion. No target-app tool, grant, confirmation token, or autonomous loop is reachable from launcher. `overlay.assistance_target_refresh` validates current-step ownership, kind, bounds, sensitivity, and TTL; two explicit refreshes maximum. Stale target or renderer epoch invalidates trust and requires explicit recovery. Headless/Wayland fallback reports limitation instead of claiming unsupported coordinates. Demo diagnostics omit private content, screenshots, fingerprints, tokens, and unrelated paths.

## Scheduler governance safety

Jobs, activation, manual-run contracts, preflights, acknowledgements, requests, reviews, expiry, and staleness records are metadata-only. They cannot create timers, workers, run sessions, replay sessions, files, notifications, messages, or confirmation tokens. Approval records do not authorize execution. Any future worker must revalidate policy, grants, readiness, dry-run, confirmation, receipts, checkpoints, cancellation, and stop-on-failure at run time.

## Files, redaction, and audit logs

Default writable roots are `~/.agenthost/` and approved AgentHost output roots. Protected paths include system roots, home-wide private data, SSH/GnuPG/keyrings, browser profiles, credentials, and secrets.

JSONL audit entries contain tool, risk, profile, policy/grant decision, safe IDs, sanitized origin/app, counts, sizes, truncation, backend, receipt ID, and error code. They never contain pairing/session/confirmation tokens, receipt signatures, passwords, secrets, raw OCR/page text, screenshots, private messages, hidden environment values, or full sensitive paths.

## Control Room security

Control Room binds only to `127.0.0.1`, uses separate default port `43118`, requires cryptographically random per-process bearer token, and rejects non-local origins. Token file mode is `0600`; raw token never enters MCP results, audit logs, or projections. API routes are GET-only, bounded, and expose opaque IDs instead of filesystem paths. No arbitrary path, command, tool dispatch, confirmation approval, permission grant, replay, scheduler execution, upload, send, submit, delete, payment, or remote endpoint exists.

Control Room receives redacted activity summaries and screenshot metadata only. It omits private page/OCR/file content, secrets, cookies, passwords, environment values, raw screenshots, and receipt signatures. Service failure cannot weaken or alter AgentHost tool safety.

## Local speech security

Speech provider discovery uses fixed local commands only. No provider installation, model download, cloud TTS, or silent network fallback exists. Provider processes receive filtered environment and bounded arguments; secrets, tokens, cookies, credentials, GUI variables, and arbitrary commands are excluded.

Synthesis input is size-limited and never persisted as raw text. Secret-looking text is blocked; private/sensitive text requires grants. Artifacts use opaque owner-scoped IDs, AgentHost-only directories, restrictive permissions, atomic writes, and TTL cleanup. Logs, traces, and Control Room contain hashes, lengths, provider/voice IDs, status, limits, and counts only.

Playback is limited to AgentHost-owned artifacts and owned child processes. Device/routing diagnostics are read-only; AgentHost does not create sinks, loopbacks, virtual microphones, or routes. Transmission preparation does not transmit. Transmission execution rechecks target, route, artifact, grants, policy, expiry, owner, and exact confirmation, then consumes preparation before playback to prevent reuse. Only an already-available default output route is supported. Communication, financial, credential/security, and admin targets fail closed. No microphone recording, transcription, CAPTCHA/MFA bypass, automatic recap, or written-message delivery is present.

Session-bound Control Room projections use owner context derived from the MCP server session; owner IDs are never accepted from HTTP input. Forge runtime records carry that owner binding for new runs, while legacy records without binding fail closed from session-scoped views. Scheduler records remain inert, local governance metadata and never imply execution. Pagination, date ranges, cursors, response size, and screenshot metadata are bounded and validated.
