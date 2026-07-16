# AgentHost

AgentHost is a universal adaptive local MCP runtime: a safe, permissioned body and visual copilot for Codex and other agents. It exposes workstation capabilities through layered strategies—adapter/API, official API, CLI/script, browser DOM, accessibility, local OCR/vision, pointer GUI fallback, and guide mode—while keeping policy, grants, dry-runs, confirmations, receipts, checkpoints, redaction, and audit logging local.

Provider and application names are examples only. AgentHost is not a Gmail, WhatsApp, Blender, or single-app automation product.

## Current status

The Linux-first runtime currently provides:

- policy-gated app, file, shell, window, accessibility, desktop, pointer, and browser operations;
- paired Firefox/Chromium DOM inspection and guarded element actions;
- local screenshot OCR, vision grounding, and screenshot-to-click dry-run handoff;
- Tool Forge review, bounded JSON runtime dispatch, capability grants, and optional OS sandboxing;
- redacted workflow traces, skills, checkpoint templates, receipts, and one-step replay governance;
- visual-only GTK3/X11/headless overlays and bounded assistance sessions;
- operator-facing visual control surfaces with trusted ownership, bounded events, replay protection, and renderer-health summaries;
- read-only assistance step previews/session explanations plus owner-scoped visual-flow templates with literal parameter binding;
- review-only scheduler jobs, activation, preflight, acknowledgement, manual-run, approval, expiry, and staleness governance.
- persistent installation-level capability strategies with deterministic selection, Browser Bridge health preference, bounded fallbacks, signed-receipt outcome verification, confidence tracking, and degraded/revalidation lifecycle.

State-changing tools remain policy/grant/dry-run/confirmation gated. Overlay and assistance tools are visual-only. Workflow replay and scheduler records are metadata-only and non-executable. Generated Forge tools are not independent live MCP tools. Blender is experimental, optional, and disabled by default.

## Capability strategies

`strategy.list`, `strategy.get`, `strategy.health`, and `strategy.select` expose bounded structural strategy metadata. Selection checks current profile, grants, loaded capabilities, adapter/browser health, compatibility, and deterministic scores. Browser navigation prefers the paired Browser Bridge before accessibility, vision, pointer, or guide fallback. Selection is advisory: it never executes tools, creates confirmations, grants permissions, or stores task content.

Local proposals require review and two independently verified receipt-backed outcomes before activation. Strategies persist under `~/.agenthost/strategies/` with restrictive permissions and contain no passwords, tokens, page/file content, screenshots, OCR, arbitrary code, shell, dynamic tool names, or transient target IDs. Failed compatibility or verified outcomes degrade strategies; revalidation is explicit.

Unsupported by design: autonomous background operation, arbitrary generated code, silent send/submit/upload/delete/archive/pay/buy, credential or secret extraction, CAPTCHA/MFA/login/payment bypass, public browser access, sudo, package installation, and remote endpoints.

## Platform

Linux/X11 is the primary implementation. Wayland reports honest backend limitations and uses safe unavailable/headless behavior where global coordinates, layer-shell, or click-through cannot be guaranteed. Windows and macOS are future platform work.

## Repository layout

```text
packages/core/          App-agnostic contracts, policy, grants, metadata, redaction
packages/mcp-server/    MCP tools, runner, receipts, Forge, workflows, scheduler, overlay
packages/os-linux/      Linux system, desktop, accessibility, OCR, sandbox probes
packages/app-browser/   Firefox/Chromium extension and loopback bridge
packages/app-overlay/   Headless and GTK3/X11 overlay renderers
packages/app-blender/   Optional experimental reference adapter
scripts/                Browser preparation and opt-in overlay demo
docs/                   Canonical product, architecture, tools, security, roadmap, browser docs
```

## Setup and verification

```bash
npm install
npm run build
npm test
npm run lint
npm run smoke:mcp
```

The MCP server uses stdio and keeps normal diagnostics off stdout. Audit logs default to:

```text
~/.agenthost/logs/agenthost.jsonl
```

For local development, set `AGENTHOST_HOME` to an isolated directory:

```bash
AGENTHOST_HOME=.agenthost npm run start:mcp
```

## Browser bridge setup

The bridge is disabled by default and binds only to `127.0.0.1`.

```bash
npm run browser:setup
```

This command is development setup. It prepares unpacked bundles and enables local bridge configuration. It does not install an extension or create pairing credentials silently. Restart AgentHost, then use confirmation-gated `browser.generate_pairing_token`.

- Firefox development: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → `~/AgentHost/browser-extension/firefox/manifest.json`.
- Chromium development: `chrome://extensions` → Developer mode → **Load unpacked** → `~/AgentHost/browser-extension/chromium`.

Public installation is separate: Firefox uses a Mozilla-signed XPI and Chromium uses a verified Chrome Web Store release. Generate deterministic unsigned review artifacts with:

```bash
npm run browser:extension:build
```

Unsigned artifacts are not public-installable. Exact signing/publishing procedure: [Browser Extension Release](docs/07_BROWSER_EXTENSION_RELEASE.md).

Paste enrollment token once, keep configured port, and verify with `browser.verify_pairing`. Extension stores device-scoped reconnect credential locally; AgentHost stores only its hash. Pairing survives normal browser/AgentHost restarts, remains origin/identity/version bound, and can be revoked or rotated. Use `browser.setup_status` and `browser.diagnose_bridge` for recovery. Pairing/session credentials are never logged.

Full state checks and recovery: [Browser Setup Validation](docs/06_BROWSER_SETUP_VALIDATION.md).

If the extension is unavailable, AgentHost may recommend accessibility, local OCR/vision, pointer fallback, or guide mode. It never executes a fallback silently.

## Overlay setup

The default overlay mode is safe headless state. For an opt-in local visual demo in a supported GTK3/X11 session:

```bash
npm run build
npm run demo:overlay
```

Use `overlay.renderer_status`, `overlay.renderer_diagnose`, and `overlay.renderer_setup_instructions` for diagnostics. AgentHost does not install GTK/PyGObject dependencies or request privilege escalation. Wayland limitations are reported honestly; headless fallback remains available.

Visual assistance control surface tools (`overlay.control_surface_show/get/update/hide/apply_event`) manage one generic operator surface per owned assistance session. They change only AgentHost visual/session state. They never click, type, navigate, move the real pointer, invoke another tool, create confirmation tokens, or grant permissions. Renderer-bound overlay IDs are ephemeral and must be reacquired after restart.

R4 adds a global runtime activity indicator driven by the owner-scoped redacted activity store also used by Control Room. Direct MCP work is normalized into bounded states such as preparing, inspecting, acting, waiting for approval, blocked, and completed. Labels are allowlisted; raw prompts, arguments, page/OCR text, paths, messages, tokens, and screenshots never enter the overlay. Set `AGENTHOST_OVERLAY_MODE=auto` or `gtk3-x11` for visible X11 rendering; headless mode reports no visible overlay. The indicator is click-through and non-focus-stealing, hides with renderer acknowledgement before screenshots, then restores after capture. Renderer restart invalidates old bindings and re-projects only after a fresh acknowledgement.

A2 assistance tools (`overlay.assistance_step_preview`, `overlay.assistance_session_explain`, and `overlay.assistance_template_*`) expose bounded read-only projections and draft-only visual template metadata. Templates allow existing visual primitives, declared scalar parameters, literal `{{parameterName}}` substitution, and typed target placeholders. Preview never renders or advances. Instantiation creates a ready/draft assistance session only; it never starts, renders, invokes target tools, creates grants, or creates confirmation tokens.

Milestone A3 adds deterministic local Visual Copilot demo:

```bash
npm run build
npm run demo:visual-copilot
```

Demo uses public fixture data, explicit operator prompts, safe local screen-point grounding, bounded stale-target recovery, and terminal completion. It never controls target applications. Visible mode requires GTK3/X11, PyCairo, and `xdotool`, and fails honestly if renderer health degrades. `--diagnose` prints renderer capability guidance; `--headless` is a safe capability check for CI; `--require-gui` fails clearly when visible support is unavailable. `overlay.assistance_target_refresh` revalidates only current visual target, with two explicit refreshes maximum per step. No automatic retry exists.

Build Week walkthrough, setup, limitations, and video outline: [BUILD_WEEK.md](BUILD_WEEK.md).

## Forge runtime

Forge executes only bounded `runtime/handler.json` JSON operations through a fixed child runner. Generated JavaScript/Python is never imported. Default sandbox mode is `auto`: Bubblewrap is used only when safely available; otherwise the fixed runner remains active with a limitation warning. `firejail` and `unshare` are currently detection-only and fail closed when explicitly requested.

Configuration accepts `forgeRuntimeSandboxMode` values `auto`, `none`, `bubblewrap`, `firejail`, or `unshare`. No install, sudo, network, GUI/DBus, secrets, broad filesystem, or shell capability is delegated.

## Workflows, replay, and scheduler governance

Workflow traces and skills store bounded redacted summaries. Checkpoint templates use declared parameters and literal `{{parameter}}` interpolation only. Replay dry-runs and sessions prepare one step at a time; the caller must invoke the original tool and provide a trusted receipt. No autonomous replay exists.

Scheduler records are review-only metadata. Jobs, activation, manual-run contracts, acknowledgements, approvals, and expiry diagnostics create no timers, workers, run sessions, replay sessions, notifications, messages, files, or execution permission.

## Optional adapters

Optional adapters are disabled by default and must declare the generic execution policy. Blender is the current experimental reference adapter. When explicitly enabled, it runs only reviewed Python through a bounded shell-free subprocess with output-root validation, static safety review, dry-run, exact confirmation, filtered environment, and redacted audit output. It is not core product direction.

## Safety model

The central runner validates execution metadata, schema, policy, grants, protected contexts, dry-run requirements, and the non-consuming confirmation envelope. Domain handlers revalidate exact targets and consume confirmation once. Receipts provide provenance only. Checkpoints observe semantic state only. Logs omit secrets, tokens, private content, screenshots, raw OCR, and hidden environment values.

## Roadmap v2

Future work uses milestones, not new numbered phases:

- Milestone A — Visual Copilot Productization
- Milestone B — Adaptive Capability System
- Milestone C — Safe Execution Runtime
- Milestone D — Visible Scheduling
- Milestone E — Product Surface and Packaging
- Milestone F — Ecosystem and Platforms

See [Implementation Roadmap v2](docs/05_IMPLEMENTATION_ROADMAP_AND_CODEX_PROMPTS.md) and the other [canonical documents](docs/01_PRODUCT_SPEC.md).

## MCP configuration example

After building, point Codex at the compiled server:

```json
{
  "mcpServers": {
    "agenthost": {
      "command": "node",
      "args": ["/absolute/path/to/agenthost/packages/mcp-server/dist/index.js"],
      "env": { "AGENTHOST_HOME": "/absolute/path/to/.agenthost" }
    }
  }
}
```

## Control Room MVP (Milestone A4)

Control Room is optional, local, read-only runtime reporting. It shows redacted task projections, source-backed timelines, genuine screenshot metadata, and subsystem health. It cannot call MCP tools, approve confirmations, grant permissions, replay skills, run scheduler jobs, or control target applications.

## Local speech (R3)

AgentHost supports local/offline speech primitives. `speech.list_providers`, `speech.list_voices`, `speech.list_languages`, `speech.devices_list`, and `speech.routing_diagnose` perform read-only discovery. `speech.artifact_get`, `speech.playback_state`, and `speech.transmission_get` return owner-scoped metadata only. eSpeak NG is preferred when installed; Piper and Speech Dispatcher are detected only when already installed/configured. AgentHost never installs providers, downloads models, or uses cloud TTS.

`speech.synthesize` creates a bounded owner-scoped local artifact after dry-run and confirmation. `speech.play` and `speech.stop` control only AgentHost-owned playback. `speech.transmission_prepare` validates an existing local default output route without transmitting; `speech.transmission_execute` requires fresh grants, exact preparation/artifact/route/target binding, policy approval, and one-time confirmation. Arbitrary device routing and route creation are unsupported. No meeting adapter, recording, transcription, automatic recap, or message sending is included.

Enable explicitly:

```bash
npm run build
AGENTHOST_CONTROL_ROOM_ENABLED=1 npm run start:mcp
```

AgentHost prints loopback URL with one session token to stderr. Control Room binds only to `127.0.0.1` (default port `43118`), stores token with restrictive permissions, and exposes no public or remote endpoint. Disable by omitting flag/config. `npm run control-room` is local helper that enables same mode.
