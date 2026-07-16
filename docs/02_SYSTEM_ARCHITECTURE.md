# AgentHost System Architecture

## Runtime shape

```text
Codex / agent
  -> MCP stdio server
  -> schema + execution metadata
  -> policy + grants + protected-context checks
  -> dry-run / confirmation envelope
  -> domain handler and local backend
  -> ToolResult + receipt + redacted audit record
```

Core is app-agnostic. Linux and application implementations stay outside `packages/core`.

## Packages and modules

### `packages/core`

Shared contracts and validators: policy profiles, grants, risk and sensitivity, redaction, logging shapes, execution metadata, optional-adapter policy, Forge manifest/runtime types, vision/evidence types, workflow/replay/checkpoint types, scheduler governance types, and capability registry.

### `packages/mcp-server`

MCP server and context, `tool-runner.ts`, `tool-metadata.ts`, confirmation manager, receipt manager, audit integration, policy/grant wiring, Forge stores/tools and runtime sandbox modules, browser/desktop/accessibility/vision/checkpoint/workflow/replay/scheduler/overlay tools, workflow stores, scheduler stores, capability strategy store/service/tools, overlay assistance store, assistance projections, and the owner-scoped visual-template store.

### Capability strategy boundary

`capability-strategy-store.ts` persists versioned structural definitions, reviews, bounded selections, and safe outcome summaries under `~/.agenthost/strategies/`. `capability-strategy-service.ts` performs deterministic compatibility/health ranking, Browser Bridge preference, bounded fallback planning, fixed read-only verification, receipt validation, confidence updates, and degradation. It has no generic executor; original MCP tools remain governed execution boundary.

## Local speech boundary

`packages/os-linux/src/speech.ts` owns fixed Linux provider, voice, device, routing, synthesis, and playback subprocess probes. `speech-service.ts` coordinates provider health, bounded artifacts, owner/session checks, preparation TTLs, and transmission revalidation. `speech-store.ts` stores only opaque artifact/preparation metadata under `~/.agenthost/speech/`; audio files never enter logs or Control Room projections. All commands use argument arrays, `shell:false`, filtered environment, bounded timeout/output, and cleanup.

Speech transmission is generic existing-route playback only. No provider-specific meeting adapter, recording, transcription, route mutation, or autonomous coordination exists. Owner-scoped artifact, playback, and preparation metadata projections remain bounded and redacted.

### `packages/os-linux`

Linux system/app/file/shell/window/accessibility/desktop backends, X11 detection, Wayland limitations, screenshots, local Tesseract OCR, and sandbox-support probing.

### `packages/app-browser`

Firefox/Chromium unpacked extension and fixed localhost bridge. It exposes sanitized tab/page state, bounded DOM context, short-lived element references, and fixed element actions. It does not expose cookies, storage, passwords, debugger, arbitrary JavaScript, or send/submit/upload commands.

### `packages/app-overlay`

Headless renderer plus optional GTK3/X11 renderer child. Renderer commands use bounded authenticated JSONL IPC. Overlay state, targets, widgets, animation, interaction events, health, restart, fallback, emergency-hide, and generic operator control surfaces are handled here. Control-surface state is kept in `packages/mcp-server` and binds only to trusted server session ownership.

### Optional adapters

`packages/app-blender` is the current experimental reference adapter. Optional external-process adapters are loaded only when explicitly enabled and must declare the generic execution policy.

## Live tool assembly and capability parity

Server startup loads base tool factories, conditionally loads explicitly enabled optional adapters, removes unavailable definitions, validates duplicate names and execution metadata, and materializes one `loadedTools` set. MCP `tools/list` and `system.list_capabilities` both derive from that set. `createBaseCapabilityRegistry()` is only bootstrap/test fallback after synchronization.

Generated Forge tool names never enter this set. Only the fixed Forge control tools are live.

## Central execution boundary

`tool-runner.ts` enforces the baseline before a handler runs:

1. Resolve the live definition and validated execution metadata.
2. Validate the input schema.
3. Evaluate broad policy, grants, protected context, risk, and guide-only restrictions.
4. Require the declared dry-run/confirmation contract for state-changing tools.
5. Verify the session/tool/input confirmation envelope without consuming it.
6. Invoke the domain handler.
7. Let the handler re-resolve and validate the current exact target.
8. Let the handler perform the single consuming confirmation verification.
9. Execute through the original backend.
10. Attach a verifiable receipt and write a redacted audit record.

Central verification does not replace domain checks. Confirmation envelopes do not consume tokens; handlers consume once. Narrow legacy preflight compatibility paths are explicit, named, and tested. Receipts prove provenance, not permission. Checkpoints observe semantic state and execute no action.

## Browser trust boundary

The bridge is disabled by default and binds to `127.0.0.1`. Initial enrollment uses one short-lived, single-use token. AgentHost then persists a revocable device record containing exact extension identity/origin and only a hash of the reconnect secret. Session tokens remain memory-only. Protocol and extension versions are checked on enrollment/reconnect; command/body/session queues are bounded. Extension receives only fixed commands. Browser content is sanitized and sensitivity-gated before it reaches a ToolResult. If extension is unavailable, AgentHost recommends accessibility, local vision/OCR, pointer, or guide strategies explicitly; it never silently executes a fallback.

## Overlay renderer boundary

The Node renderer client starts the GTK3/X11 child lazily. It sends bounded JSONL messages authenticated by a random session token and validates handshake, command, reply, payload, timeout, and crash state. The child receives a filtered environment and only renderer commands. It cannot invoke AgentHost tools. Headless state is the safe fallback.

GTK3/X11 supports transparent/topmost/click-through overlays and bounded widgets where the display and PyGObject probe succeed. Wayland does not claim global coordinates, layer-shell, or guaranteed click-through; it reports limited/unavailable support.

## Assistance UX and visual-template boundary

`overlay.assistance_step_preview` and `overlay.assistance_session_explain` read only owner-bound in-memory session state. They do not render, advance, allocate overlay IDs, resolve targets, invoke tools, or create grants/tokens. Restarted sessions without ephemeral step material fail closed.

`overlay.assistance_template_*` uses `overlays/assistance-templates/`. Templates contain only allowlisted visual step metadata, declared scalar parameters, literal `{{parameterName}}` placeholders, and typed target placeholders. Save/archive/instantiate change local metadata only. Instantiation validates bindings and creates a draft assistance session; it never starts, renders, or executes it. Records are atomic, owner-isolated, bounded, and redacted.

`overlay.assistance_target_refresh` is visual-only recovery boundary. It accepts no owner identity, validates only current step through existing target resolver, enforces TTL/bounds/sensitivity, and permits at most two explicit refreshes per step. Target-bound steps opt into required-target blocking; static unbound primitives retain existing behavior. Missing or stale required targets fail before renderer invocation. Renderer epoch changes invalidate overlay IDs; operator must explicitly re-show/retry. Recovery state derives from preview/explanation metadata.

`npm run demo:visual-copilot` runs production assistance/control-surface stores against public fixture in isolated demo home. Prompts gate start, target binding, events, retry, and completion. It performs no target-app operation. Visible mode requires GTK3/X11, PyCairo, and `xdotool`; renderer or geometry limitations are reported and the launcher exits safely. `--headless` is a capability check, not a simulated visible flow.

## Forge runtime boundary

Forge artifacts remain inert until review, validation, registration, runtime eligibility, and grants pass. Runtime execution is only the fixed `runtime/handler.json` JSON contract in a child process. Generated JavaScript/Python is not imported.

The runner caps input/output/stdout/stderr/runtime, uses a filtered environment with no GUI/DBus/secrets, denies network and shell, and writes only to the per-run directory. Sandbox mode is:

1. Bubblewrap/bwrap when verified and user namespaces are available;
2. fixed runner fallback in `auto` mode when unavailable;
3. `none` for explicit fixed-runner mode;
4. explicit `firejail` and `unshare` currently fail closed because no reviewed allow-only filesystem profile exists.

Bubblewrap mounts the generated project/runtime read-only and the run directory writable, with an isolated network namespace. No backend authorizes generated source execution.

## Workflow, receipts, and replay boundary

Workflow traces and skills store redacted summaries. Checkpoint templates accept declared `{{parameter}}` bindings only. Replay dry-run plans do not execute. Replay sessions prepare one current step; the caller invokes the original tool directly, then submits a signed receipt and read-only checkpoint result. Receipt reservation/consumption, step transitions, cancellation, terminal states, and missing ephemeral material fail closed.

## Scheduler governance boundary

Jobs, reviews, activations, manual-run contracts, preflights, acknowledgements, requests, approval reviews, expiry, and staleness diagnostics are local metadata. They do not create timers, workers, run sessions, replay sessions, notifications, files, or execution permission. Scheduler approval is never execution authorization.

## Local data layout

```text
~/.agenthost/
  config.json
  logs/
  outputs/
  screenshots/
  browser/pairing-token
  browser/paired-devices.json
  forge/
    manifests/ reviews/ artifacts/ proposals/ generated/
    validations/ harness-runs/ registrations/ runtime-runs/
  workflows/
    traces/ skills/ checkpoint-template-reviews/ replay-sessions/
  overlays/assistance-sessions/
  overlays/assistance-templates/
  overlays/control-surfaces/
  overlays/control-surface-event-ledger/
  control-room/
    activity.jsonl
    screenshots.jsonl
    access-token
  scheduler/
    jobs/ reviews/ activations/ activation-reviews/
    manual-run-contracts/ manual-run-reviews/ manual-run-preflights/
    manual-run-acknowledgements/ manual-run-requests/
    manual-run-request-reviews/
```

Records are local JSON with restrictive permissions and safe atomic writes where implemented. Receipt secrets and active receipt state are process-local; raw page text, OCR, credentials, tokens, and private payloads are not persisted.

The unpacked browser bundle is prepared separately under `~/AgentHost/browser-extension/{firefox,chromium}`.

## Control Room reporting boundary

`packages/app-control-room` serves dependency-free static HTML over a same-process Node loopback listener. `mcp-server` supplies redacted projections from existing workflow, assistance, Forge, scheduler metadata, overlay, browser, screenshot, and tool-activity records. Session-bound workflow, assistance, Forge, activity, and screenshot records are scoped to trusted MCP owner context; inert scheduler metadata is local AgentHost governance data. Service is opt-in, binds only to `127.0.0.1`, uses per-process token, rejects non-local origins, validates date/cursor queries, caps responses/pagination, and exposes only GET reporting routes. No MCP execution route or target-application control path exists.

## Platform and trust limitations

Linux/X11 is primary. Wayland reports limitations rather than making unsafe global-coordinate claims. Optional adapters are separate trust boundaries. No public HTTP endpoint, remote access, sudo, package installation, hidden persistence, or autonomous background operation is enabled.
