# AgentHost Implementation Roadmap v2

> **Historical milestone document.** This tree is minimal-v2 and does not register the browser, speech, Control Room, scheduler, or Forge surfaces described below. See `docs/03_MCP_TOOLS_AND_ADAPTERS.md` for the live inventory.

## Development and documentation loop

Use plan, explicit approval, scoped implementation, build/test/lint/smoke, review, and documentation sync. Verify implementation claims against source and tests. Preserve schema validation, execution metadata, policy, grants, dry-run, confirmation, redaction, receipts, checkpoints, and audit boundaries.

## Current product state

AgentHost is a Linux-first universal local capability runtime and visual copilot. Browser, desktop, accessibility, file, shell, vision, Forge, workflow, replay-governance, overlay, and scheduler-governance foundations exist. Some tools are functional/executable under policy; overlays are visual-only; workflow replay and scheduler records remain non-executable; optional adapters are experimental and opt-in.

The live tool inventory and `system.list_capabilities` use one validated loaded set. Generated Forge tools never become independent live MCP tools.

## V2 status

V2-A Unified Dynamic Visual Copilot is implemented: explicit renderer modes, honest headless/disabled/WebKit-unavailable reporting, native GTK3/X11 handshake/draw-ready/live-registration checks, strict visual-surface envelopes and fixed components, one coordinator for projection/suppression/restart, and no target-app actions from visual events. V2-B Adaptive Reliable Action Routing is implemented as `strategy.route_preview`: action-level advisory candidates, bounded health observation, deterministic safety/verification-aware scoring, explicit fallback budget, and verified-only local route metrics. Actual execution remains in original governed tools; no autonomous loop, scheduler, or silent fallback exists.

### Goal-oriented planning readiness

The core now contains bounded, app-agnostic advisory contracts for `AgentGoal`,
`ExecutionPlan`, `PlanStep`, `ActionRoute`, `VerificationCheckpoint`, and
`GoalOutcome`. Validators reject unknown fields, private/raw content, executable
payloads, unsafe interpolation, and unbounded budgets. Decision levels (0–3),
safety-first plan comparison, stable tie-breaking, target invalidation, and
fresh-confirmation requirements on material replans are structural only. These
contracts do not execute tools, create confirmations, start replay sessions, or
run in the background. `strategy.goal_plan_preview` exposes a bounded redacted
goal/plan/route/checkpoint advisory preview; `strategy.capability_graph` exposes a TTL-bounded graph with optional live route-health overrides and
`strategy.failure_memory` exposes only verified, fingerprinted route evidence.
None of these surfaces executes a route or creates a permission.

## Milestone A — Visual Copilot Productization

### Goal

Turn the existing visual renderer and assistance-session foundation into a clear operator-facing control surface.

### Scope and dependencies

Build on `packages/app-overlay`, renderer diagnostics/setup, target grounding, bounded widgets, and assistance sessions. Keep browser/accessibility/OCR target evidence separate and safety-gated.

### Deliverables

- operator-facing control surface;
- `overlay.control_surface_show`, `overlay.control_surface_get`, `overlay.control_surface_update`, `overlay.control_surface_hide`, and `overlay.control_surface_apply_event`;
- assistance-session UX;
- read-only step preview and session explanation;
- constrained visual-flow template validate/preview/save/get/list/archive/instantiate lifecycle;
- renderer/setup diagnostics;
- reviewable visual flow templates;
- explicit fallback and Wayland guidance.
- deterministic local Visual Copilot runtime-smoke launcher; internal visual fixtures remain test-only;
- bounded current-step target refresh and stale-target recovery;
- human-readable visual state/recovery projections.

### Exclusions and risk

Overlay events and control-surface actions must not trigger target-app actions, create confirmation tokens, grant permissions, or start replay. Main risks are stale renderer bindings, private content leakage, replayed operator events, and confusing renderer state.

### Done

An operator can inspect renderer/session health, preview the next safe visual step, explain session state, create draft visual-assistance sessions from bounded templates, and run deterministic local Visual Copilot demo with no hidden target-app execution. Milestone A Workstreams A1, A2, and A3 are complete.

## Milestone B — Adaptive Capability System

### Goal

Help agents identify capability gaps and choose the safest available strategy.

### Scope and dependencies

Use the existing strategy order, app/adapter discovery, browser/accessibility/vision evidence, grants, and reviewed Forge proposals.

### Deliverables

- capability-gap detection;
- safest-strategy selection;
- reviewed Forge proposals;
- provider-agnostic adapter contracts.

### R2 status

Persistent capability strategy registry and deterministic selection are complete. Built-in structural strategies, bounded local proposals/reviews, live prerequisite checks, Browser Bridge preference, bounded fallbacks, signed-receipt outcome verification, confidence/degradation, and redacted Control Room projection are implemented. Strategy selection remains advisory; no generic executor or autonomous fallback exists.

### R3 status — complete

Standard local speech is implemented Linux-first. eSpeak NG is preferred; Piper and Speech Dispatcher are optional detected providers. Provider/voice/device/routing discovery, bounded synthesis, opaque expiring artifacts, owned local playback/stop, and two-phase governed transmission are separate tools. No network TTS, installation, model download, recording, transcription, meeting adapter, route creation, or automatic recap exists. Transmission remains grant-, policy-, exact-target-, and confirmation-gated.

### R4 status — complete

Global runtime activity overlay is implemented as one owner-scoped redacted authoritative store. Direct MCP work is normalized into strict lifecycle states and safe labels, rendered through the existing click-through GTK3/X11/headless boundary, prioritized deterministically, suppressed around screenshots with acknowledgement, and reprojected after renderer epoch changes. Control Room consumes the same projection. No target-app action, permission grant, confirmation creation, background loop, or private-content storage was added. R5 packaging is tracked separately below.

## R5 — Minimal Public Linux Release Candidate Packaging

R5 packages existing capabilities as a rootless Linux x86_64 archive with the `agenthost` CLI, resumable setup, redacted doctor diagnostics, safe Codex MCP integration, lifecycle controls, browser/overlay/Control Room/speech onboarding, deterministic release scans, manual update/rollback, and ownership-scoped uninstall. No new automation capability, scheduler execution, remote endpoint, system service, or privileged installation is included.

## R6 — V1 Release Audit and Freeze

R6 hardens release packaging and verification only: repository/artifact hygiene, checksum enforcement, repository-independent installed-runtime checks, Codex/config safety verification, browser/strategy/speech/overlay/Control Room manual validation, privacy/security audit, storage/documentation reconciliation, and deterministic release-candidate freeze. R6 adds no product capability, scheduler execution, autonomy, provider adapter, remote endpoint, or platform support. Recommended candidate tag: `v0.1.0-rc2`; final `v0.1.0` waits for manual desktop and external distribution sign-off.

### Exclusions and risk

No automatic generated-tool execution, arbitrary source execution, provider-specific core architecture, or autonomous fallback. Risk is accidental escalation from recommendation to execution.

### Done

Recommendations are explainable, policy-aware, and remain advisory until the original governed tool path is invoked.

## Milestone C — Safe Execution Runtime

### Goal

Strengthen proof that one approved action targets the intended current state.

### Scope and dependencies

Build on Patch 2 central metadata/policy/grant enforcement, confirmation envelopes, handler exact-target checks, receipts, checkpoints, and one-step replay.

### Deliverables

- global circuit-breaker design;
- scoped emergency stop with explicit boundaries;
- stronger target-proof contracts;
- gradual preview/prepare/execute migration where valuable;
- receipt/checkpoint-backed one-step execution.

### Exclusions and risk

No autonomous loops initially, no hidden retries, no scheduler workers, and no confirmation-token bypass. Emergency controls must state exactly what they can stop.

### Done

Each state-changing action has a verifiable preview/confirmation/target/result path, and interruption behavior is tested without weakening domain checks.

## Milestone D — Visible Scheduling

### Goal

Only after execution proof is mature, add a visible, disabled-by-default worker.

### Scope and dependencies

Use the existing scheduler job, activation, manual-run, expiry, staleness, receipt, and checkpoint governance records.

### Deliverables

- disabled-by-default worker;
- explicit activation and cancellation;
- run receipts and stop-on-failure;
- local notifications and delivery drafts;
- visible lifecycle and no hidden persistence.

### Exclusions and risk

No silent external delivery, unbounded recurrence, hidden background work, or automatic confirmation. The main risk is turning governance metadata into implicit execution.

### Done

Every run is visible, explicitly activated, cancellable, revalidated, receipted, checkpointed, and stopped on failure.

## Milestone E — Product Surface and Packaging

### Goal

Make local setup and operation understandable for developers and operators.

### Scope and dependencies

Build on browser packaging/pairing, renderer diagnostics, configuration schemas, stores, and current Linux support.

### Deliverables

- full Control Room;
- browser extension packaging;
- installer and onboarding;
- configuration/store migrations;
- public developer alpha.

### Exclusions and risk

No hidden extension install, public bridge, credential access, or unsupported platform claims. Risk is packaging that silently broadens permissions.

### Done

A user can install, diagnose, pair, review permissions, reset state, and recover safely with documented limits.

## Milestone F — Ecosystem and Platforms

### Goal

Expand reusable reviewed capabilities without making any provider or app a hardcoded core target.

### Scope and dependencies

Build on generic adapters, workflow/skill review, protected-context policy, and the local safety model.

### Deliverables

- reviewed skill library;
- protected-context framework;
- reference adaptive workflows;
- Windows/macOS support.

### Exclusions and risk

No provider-specific architecture, credential extraction, security bypass, or unsupported cross-platform guarantee. Risk is ecosystem content becoming an unsafe permission shortcut.

### Done

Extensions remain provider-agnostic, reviewed, revocable, and subject to the same central and handler-specific safety boundaries on each supported platform.

## Roadmap governance

- Codex recommendations are advisory.
- Small hardening tasks belong inside the owning milestone.
- Do not create a new numbered phase for one schema, status, diagnostic, or test.
- Roadmap changes require an explicit documentation update.
- “Done” must distinguish functional, state-changing, visual-only, metadata-only, inert/review-only, headless, optional, unsupported, and productized behavior.
- Claims must be verified from source and tests.
- Optional adapters do not automatically become core product features.
- Provider and application names are examples, never hardcoded architecture.

## Historical implementation ledger

Historical phases remain a record of shipped work, not the future architecture.

- Phase 0 — TypeScript/npm workspace foundation.
- Phase 1 — MCP skeleton, core contracts, registry, config, logging.
- Phase 2 — Safety engine, risk/sensitivity, paths, shell, redaction.
- Phase 3 — Linux system/app/file/shell foundations.
- Phase 4 — Guide mode and adapter registry.
- Phase 5 — Universal automation strategy foundations.
- Phase 6 — Optional Blender reference adapter.
- Phase 7 — Linux desktop/window foundations.
- Phase 8 — Accessibility tree and actions.
- Phase 9 — Dry-run and confirmation foundations.
- Phase 10 — Protected contexts and policy profiles.
- Phase 11 — Initial browser/desktop safety hardening.
- Phase 12 — Permission profiles and capability grants.
- Phase 13 — Tool Forge manifest foundation.
- Phase 14 — Reviewed artifact lifecycle.
- Phase 15 — Inert generated project scaffolding/static validation.
- Phase 16 — Inert validation harness.
- Phase 17 — Inert registration gate.
- Phase 18 — Runtime boundary and metadata-only stub.
- Phase 19 — Bounded subprocess runner.
- Phase 20 — Runtime capability grants.
- Phase 21 — Desktop pointer actions.
- Phase 22 — Sandbox support probe.
- Phase 23 — Optional OS-level Forge sandboxing.
- Phase 24 — Controlled generated capability dispatch.
- Phase 25 — Browser bridge foundation.
- Phase 26 — Browser element actions.
- Phase 27 — Universal workflow traces and skills.
- Phase 28 — Local screenshot grounding/OCR.
- Phase 29 — Safe screenshot-to-action handoff.
- Phase 30 — Semantic post-action checkpointing.
- Phase 31 — Reviewable checkpoint templates.
- Phase 31.5 — Browser extension packaging and pairing reliability.
- Phase 31.6 — Browser setup validation and documentation sync.
- Phase 32 — Local checkpoint-template review/edit lifecycle.
- Phase 33 — Universal skill replay dry-run.
- Phase 34 — Controlled stepwise replay runner.
- Phase 35 — Original tool result receipts.
- Phase 36 — Receipt-backed replay hardening review.
- Phase 37 — Atomic receipt reservation and replay transition matrix.
- Phase 38 — Replay recovery, cancellation, and diagnostics.
- Phase 39 — Review-only scheduled job specification and policy.
- Phase 40 — Review-only job readiness and activation diagnostics.
- Phase 41 — Review-only controlled job activation lifecycle.
- Phase 42 — Review-only one-shot manual-run contract.
- Phase 43 — Review-only operator preflight checklist.
- Phase 44 — Operator acknowledgement ledger and request audit.
- Phase 45 — Manual-run request approval/revocation lifecycle.
- Phase 46 — Approval expiry and staleness diagnostics.
- Phases 47–49 — Visual Copilot overlay foundation, schemas, manager, grounding, and MCP tools.
- Phase 50 — Bounded real GTK3/X11 overlay renderer.
- Phase 51 — Overlay packaging/diagnostics and visual assistance sessions.
- Safety Patch 1 — Strict runtime grants, execution metadata, loaded-tool/capability parity, generic optional-adapter policy, Blender opt-in.
- Safety Patch 2 — Central fail-closed baseline for state-changing tool invocation.

## V2 verification and manual boundary

Automated verification covers headless protocol, strict surface validation, suppression ordering, mode selection, route scoring, metrics redaction, and advisory-only behavior. A normal X11 desktop is still required for visible pixel verification; use `npm run demo:overlay` and `npm run demo:task-progress`. No CI run claims visible success from a headless renderer.

## Verification contract

Every implementation milestone must finish with:

```text
npm run build
npm test
npm run lint
npm run smoke:mcp
git diff --check
```

Documentation-only changes must also run stale-claim searches and manual heading/link/code-block checks.

## Milestone A status

Milestone A1, A2, A3, and A4 are complete for the current visual-copilot product scope. A4 adds optional local read-only Control Room reporting with redacted projections, bounded polling UI, loopback token protection, and no execution surface.

P1 Safety Reconciliation and R6 Closure remain the release-hardening boundary. Final Release Polish adds only inert scheduler schedule/lifecycle metadata, deterministic route-cache measurements, authoritative visual-runtime regression coverage, and public-repository/release consistency. Milestone B remains future planning only. Provider-specific workflows, scheduler execution, skill replay, remote clients, accounts, and autonomous operation remain out of scope.
