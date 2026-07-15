# AgentHost Implementation Roadmap v2

## Development and documentation loop

Use plan, explicit approval, scoped implementation, build/test/lint/smoke, review, and documentation sync. Verify implementation claims against source and tests. Preserve schema validation, execution metadata, policy, grants, dry-run, confirmation, redaction, receipts, checkpoints, and audit boundaries.

## Current product state

AgentHost is a Linux-first universal local capability runtime and visual copilot. Browser, desktop, accessibility, file, shell, vision, Forge, workflow, replay-governance, overlay, and scheduler-governance foundations exist. Some tools are functional/executable under policy; overlays are visual-only; workflow replay and scheduler records remain non-executable; optional adapters are experimental and opt-in.

The live tool inventory and `system.list_capabilities` use one validated loaded set. Generated Forge tools never become independent live MCP tools.

## Milestone A — Visual Copilot Productization

### Goal

Turn the existing visual renderer and assistance-session foundation into a clear operator-facing control surface.

### Scope and dependencies

Build on `packages/app-overlay`, renderer diagnostics/setup, target grounding, bounded widgets, and assistance sessions. Keep browser/accessibility/OCR target evidence separate and safety-gated.

### Deliverables

- operator-facing control surface;
- `overlay.control_surface_show`, `overlay.control_surface_get`, `overlay.control_surface_update`, `overlay.control_surface_hide`, and `overlay.control_surface_apply_event`;
- assistance-session UX;
- renderer/setup diagnostics;
- reviewable visual flow templates;
- explicit fallback and Wayland guidance.

### Exclusions and risk

Overlay events and control-surface actions must not trigger target-app actions, create confirmation tokens, grant permissions, or start replay. Main risks are stale renderer bindings, private content leakage, replayed operator events, and confusing renderer state.

### Done

An operator can inspect renderer/session health and follow bounded visual guidance with no hidden target-app execution.

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
