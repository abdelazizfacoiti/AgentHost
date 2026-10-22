# AgentHost Product Specification

> **Current minimal-v2 status:** only the 37 tools documented in
> `docs/03_MCP_TOOLS_AND_ADAPTERS.md` are registered. Browser Bridge,
> accessibility, speech, Forge, workflow/scheduler, checkpoints/receipts,
> Control Room, and `task.execute_plan` are not live surfaces in this tree.
> Sections describing them below are historical roadmap/spec material.

## Product definition

AgentHost is a local general-purpose computer-use agent: a safe, permissioned body for Codex and other agents on a real workstation. The model reasons about a user goal and uses the computer's available interfaces to accomplish it — inspecting the environment, planning, acting, observing results, verifying outcomes, and recovering from failures. It is also a visual copilot for showing bounded, operator-visible guidance. The core is provider-agnostic and application-agnostic; product examples never become hardcoded architecture.

```text
Codex / agent
  -> AgentHost MCP server
  -> schema + execution metadata + risk + policy + grants
  -> dry-run and confirmation when required
  -> safest available local strategy
  -> bounded result + redacted audit record
```

## Capability model

AgentHost exposes capability families — computer, filesystem, shell,
applications/adapters, MCP, vision, OCR, tasks, and agent control — and the model
composes them dynamically per task. The strategy order below survives only as
an internal cost/optimization heuristic; it never defines what AgentHost is
capable of doing.

## Strategy priority (advisory cost order, not a capability boundary)

1. app adapter/API
2. official API/plugin API
3. CLI/script
4. browser DOM
5. accessibility
6. local screenshot OCR/vision grounding
7. pointer GUI fallback
8. guide mode

When a browser adapter is not loaded, use GUI desktop automation. No fallback silently invokes another strategy; OCR, pointer, and guide alternatives remain explicit and independently safety-gated.

## Current implementation status

V2-A unifies dynamic visual projection behind one owner/session-bound coordinator. Native GTK3/X11 is the selected visible backend; `auto`, `gtk3-native` (legacy `gtk3-x11` alias), `headless`, `disabled`, and diagnostic-only `webkit-gtk-react` are explicit modes. Visible success requires authenticated handshake, renderer epoch, transparent mapped windows, draw-ready acknowledgement, live registration, and post-acknowledgement projection. Headless reports `available:true`, `visible:false`, and `reason:visible_renderer_unavailable`.

V2-B adds `strategy.route_preview`, an advisory action-level router over loaded browser, adapter, accessibility, OCR/vision, desktop, and guide families. It is deterministic, safety-first, bounded, verification-aware, and metrics-backed only by verified outcomes. It does not execute or silently switch tools.

R5 adds an honest Linux x86_64 release-candidate surface around general-purpose computer-use capabilities: rootless archive installation, `agenthost` CLI, resumable setup, redacted doctor diagnostics, Codex MCP integration with preview/backup/rollback, controlled lifecycle, browser/overlay/Control Room/speech onboarding, and deterministic release scans. Packaging adds no execution capability and keeps host dependencies explicit.

The default loaded registry currently contains 247 tools with validated explicit execution metadata (optional adapters are conditional):

- 62 `read_only`
- 7 `diagnostic`
- 116 `metadata_only`
- 32 `state_changing`
- 30 `visual_only`
- 0 `inert` (class reserved for future explicit definitions)

Missing or contradictory execution metadata fails registration; tool names never infer execution class.

R2 adds persistent installation-level capability strategies. `strategy.select` ranks only compatible active records after live capability, profile, grant, adapter, and Browser Bridge health checks. It returns bounded advisory steps and fallbacks; it never executes an underlying tool. Built-in strategies are trusted structural metadata. Local proposals require review plus two independently verified signed-receipt outcomes before activation. Strategy records persist no task content, secrets, screenshots, OCR, transient IDs, shell, code, or dynamic tool names.

The Goal-Oriented Adaptive Planner adds bounded structural `AgentGoal`, `ExecutionPlan`, `PlanStep`, `ActionRoute`, `VerificationCheckpoint`, and `GoalOutcome` contracts. `strategy.goal_plan_preview` returns a redacted bounded ordered plan with route/checkpoint projection, candidate-plan comparison, decision level 0–3, and the smallest useful visual surface; it performs no action. `strategy.capability_graph` exposes a TTL-bounded relevant capability subgraph; `strategy.failure_memory` exposes only verified, fingerprinted route evidence. Plans remain mutable and advisory; actual actions still use the original governed tools.

## R3 local speech

R3 adds provider-agnostic Linux local speech. Provider and voice discovery are offline/read-only; eSpeak NG is preferred when present, with optional Piper and Speech Dispatcher detection. Synthesis, artifact ownership, playback, stop, device diagnostics, routing diagnostics, and governed transmission are separate primitives. Audio artifacts are bounded, opaque, owner-scoped, expiring local resources. No cloud TTS, automatic installation, model download, microphone recording, transcription, meeting join, route creation, or written recap exists.

Transmission uses two phases: preparation validates an existing route, artifact, target, grants, and limits; execution revalidates exact bindings and requires fresh confirmation. Communication, financial, credential/security, and admin contexts remain protected.

## R4 global runtime activity overlay

R4 adds one optional global, non-blocking activity indicator for real AgentHost work. An owner-scoped bounded store normalizes direct tools and subsystem activity into safe lifecycle states, allowlisted labels, elapsed time, authoritative progress, blocker/warning codes, terminal verification, renderer binding, and screenshot-suppression status. Approval waits and policy blocks receive deterministic priority over background metadata.

The indicator is visual-only: click-through, non-focus-stealing, no keyboard interception, and no target-app action. It never renders raw prompts, arguments, page/OCR text, messages, private URLs, filesystem paths, credentials, tokens, or screenshots. GTK3/X11 requires explicit `auto` or `gtk3-x11` renderer configuration; headless and unsupported Wayland sessions report unavailable visibility without claiming success. Screenshots use acknowledged hide/capture/restore. Renderer epochs invalidate stale bindings; Control Room reads same redacted store.

The execution model also defines `inert`, but no currently loaded tool materializes with that class. Review-only and generated metadata are currently represented as `metadata_only`; `inert` remains available for future explicit definitions.

### Functional and executable when policy permits

- local app opening;
- approved file operations and bounded safe shell execution;
- window and accessibility operations;
- desktop and pointer actions on supported Linux/X11 environments;
- browser DOM observation and guarded actions through the paired bridge;
- local screenshot OCR and vision grounding;
- bounded Forge JSON runtime dispatch through `forge.run_sandboxed_tool` and `forge.dispatch_generated_tool`.

All state-changing execution remains subject to schema validation, execution metadata, policy, grants, dry-run, confirmation, target checks, and audit logging.

### Visual-only

Overlay primitives, the GTK/X11 renderer, bounded widgets, visual-assistance sessions, operator control surfaces, overlay events, and `overlay.emergency_hide` are visual/session state only. They never click, type, navigate, or invoke another AgentHost tool. Control surfaces are one-per-owned-assistance-session, expose strict local operator intents, and report current step/progress, blockers, warnings, and renderer health. Emergency hide affects AgentHost-owned overlays only; it is not a global circuit breaker.

Read-only assistance projections (`overlay.assistance_step_preview` and `overlay.assistance_session_explain`) expose current-step, waiting, renderer, target-freshness, progress, and blocker summaries without rendering or mutating sessions. Visual-flow templates are constrained metadata records: existing visual primitives/widgets only, declared scalar parameters, literal `{{parameterName}}` substitution, and typed target placeholders. Template preview is read-only; save/archive/instantiate are metadata-only; instantiation creates draft assistance metadata and never starts or renders a session.

Visual surface selection is goal-aware: compact activity for short work, progress for multistep plans, checklist for setup, instruction for operator guidance, approval for pending effects, recovery for failed prerequisites, and result summary only after verified completion. Visual events remain session-state only.

Milestone A3 supplies one demo-ready local Visual Copilot runtime smoke. It uses authoritative redacted runtime activity, verified renderer state, and terminal cleanup; internal visual fixtures remain test-only. `overlay.assistance_target_refresh` revalidates only current-step visual binding; it never invokes browser, desktop, accessibility, file, shell, Forge, workflow, or scheduler tools. Visible launcher mode requires GTK3/X11, PyCairo, and `xdotool`; unavailable or degraded rendering is reported and exits safely. `--headless` is a lifecycle check only. Launcher never installs dependencies.

### Metadata-only, inert, or review-only

Workflow traces and skills, checkpoint-template lifecycle, replay planning/session governance, scheduler jobs and activation/manual-run records, receipts, and Forge manifest/artifact/registration metadata are records and reviews. They do not create autonomous execution. Generated capabilities remain absent from the live MCP tool array.

Scheduler specifications may describe a bounded one-time, delayed, recurring,
cron, calendar, or future-condition schedule. Pause, resume, cancel, archive,
and remove are metadata-only review transitions bound to trusted owner context;
no schedule is registered with the operating system and no job is executed.

### Optional and experimental

Application adapters are optional. Blender is the current reference adapter: disabled by default, explicitly enabled only through configuration, experimental, reviewed, bounded, and not core product direction. Other adapters must follow the same generic optional-adapter policy.

### Unsupported or future

- autonomous workflow replay;
- scheduler execution workers and background jobs;
- live generated MCP tools;
- arbitrary generated JavaScript or Python execution;
- hidden persistence or background autonomy;
- remote browser bridges;
- Windows and macOS support;
- silent send, submit, upload, delete, archive, pay, or buy actions;
- CAPTCHA, MFA, login, payment, or security bypass.

## Browser and vision boundaries

The browser bridge is disabled by default, binds only to `127.0.0.1`, uses paired Firefox/Chromium WebExtension sessions, fixed commands, bounded bodies/timeouts, and short-lived tab-bound `elementId` references. Direct selectors cannot execute actions. Cookies, storage, debugger access, arbitrary JavaScript, passwords, and communication APIs are not exposed.

Vision uses local Tesseract when available. It analyzes approved local images, returns bounded redacted text boxes and target suggestions, and never clicks or types. `vision.prepare_pointer_action` validates fresh trusted evidence and returns only a `desktop.click` dry-run suggestion; it never executes the click.

Communication content requires explicit private-data grants. Financial, credential/security, password-manager, and administration contexts are blocked or guide-only. Provider names such as Gmail, WhatsApp, LinkedIn, Google, Zoom, Slack, and Outlook are examples only.

## Forge and workflow model

Forge follows:

```text
manifest -> review -> artifact -> static validation -> inert harness
-> registration gate -> runtime eligibility/grants -> fixed JSON handler runner
```

The runtime executes only bounded `runtime/handler.json` operations in a fixed child process. Generated source is not imported. The runner is capability-granted, timeout/output limited, environment-filtered, network-free, GUI-free, shell-free, and optionally wrapped by Bubblewrap. Auto mode falls back to the fixed runner when no verified OS sandbox is available.

Workflow traces are redacted. Skills, checkpoint templates, replay dry-runs, replay sessions, receipts, and scheduler governance remain manually controlled and non-autonomous. Replay prepares one step at a time; the caller must invoke the original tool and provide a trusted receipt. Scheduler records remain non-executable.

## Platform scope

Linux is first. X11 supports the GTK3 overlay and pointer/window backends when dependencies are available. Transparent composition is checked before visible windows are created; Cairo is preferred when its PyGObject bridge exists, with bounded GTK-widget rendering otherwise. Wayland reports honest limitations and uses safe unavailable/headless behavior where no supported backend exists. Windows and macOS are future platform work.

## Non-negotiables

- no silent send, submit, post, upload, delete, archive, pay, buy, or publish;
- no login, CAPTCHA, MFA, payment, security, or approval bypass;
- no passwords, cookies, tokens, private keys, browser storage, or secret extraction;
- no public bridge, stealth control, hidden persistence, background autonomy, sudo, dependency installation, or unsafe network access;
- optional adapters never become core features by implication;
- policy, grants, dry-run, confirmation, exact-target checks, stop/takeover, and redacted audit logging remain in force.

## Control Room MVP (Milestone A4)

Control Room is local workstation reporting surface for AgentHost runtime. It projects real workflow traces, visual-assistance sessions, Forge runtime metadata, direct tool activity, renderer/browser health, and genuine screenshot metadata into bounded redacted views. It does not create tasks or fabricate timeline events.

Control Room is disabled by default, loopback-only, token-protected, and read-only. It cannot execute tools, approve confirmations, grant permissions, start replay, start scheduler jobs, send or submit content, access arbitrary paths, or expose remote endpoints. Screenshot views use opaque IDs and metadata; raw private content remains unavailable.
