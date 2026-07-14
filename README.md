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
- review-only scheduler jobs, activation, preflight, acknowledgement, manual-run, approval, expiry, and staleness governance.

State-changing tools remain policy/grant/dry-run/confirmation gated. Overlay and assistance tools are visual-only. Workflow replay and scheduler records are metadata-only and non-executable. Generated Forge tools are not independent live MCP tools. Blender is experimental, optional, and disabled by default.

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

This prepares explicit unpacked bundles, enables local bridge configuration, and prints a pairing token once. It does not install an extension silently. Restart AgentHost, then load the prepared bundle:

- Firefox: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → `~/AgentHost/browser-extension/firefox/manifest.json`.
- Chromium: `chrome://extensions` → Developer mode → **Load unpacked** → `~/AgentHost/browser-extension/chromium`.

Paste the token into the extension popup, keep the configured port, pair, and verify with `browser.verify_pairing`. Use `browser.setup_status` and `browser.diagnose_bridge` for recovery. Pairing/session tokens are never logged. Token files are text data; read them with a safe tool or `cat`, never execute them and never use `sudo` on them.

Full state checks, restart recovery, blocked-action tests, and explicit fallback routing are in [Browser Setup Validation](docs/06_BROWSER_SETUP_VALIDATION.md).

If the extension is unavailable, AgentHost may recommend accessibility, local OCR/vision, pointer fallback, or guide mode. It never executes a fallback silently.

## Overlay setup

The default overlay mode is safe headless state. For an opt-in local visual demo in a supported GTK3/X11 session:

```bash
npm run build
npm run demo:overlay
```

Use `overlay.renderer_status`, `overlay.renderer_diagnose`, and `overlay.renderer_setup_instructions` for diagnostics. AgentHost does not install GTK/PyGObject dependencies or request privilege escalation. Wayland limitations are reported honestly; headless fallback remains available.

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
