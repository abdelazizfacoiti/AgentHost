# AgentHost System Architecture

## Runtime shape

```text
Codex / agent -> MCP stdio server -> schemas, risk, policy, grants
-> dry-run/confirmation -> adapters, browser bridge, OS tools, Forge runtime
-> structured result and redacted audit record
```

Core is app-agnostic. App-specific and Linux-specific implementations stay outside `packages/core`.

## Packages and modules

### `packages/core`

Shared types and safety primitives: policy/grants, risk and app sensitivity, redaction, logging shapes, capability registry, Forge manifest/runtime types, vision types, workflow traces/skills, checkpoints, checkpoint-template validation, and parameter binding.

### `packages/mcp-server`

MCP server, context, tool runner, confirmation manager, audit integration, policy/grant wiring, Forge store/tools, runtime subprocess/sandbox modules, vision evidence store, workflow store, browser/desktop/vision/checkpoint/workflow tools.

Important modules include `runtime/forge-subprocess.ts`, `runtime/forge-sandbox.ts`, `vision-evidence.ts`, `workflow-store.ts`, and checkpoint/template tool modules.

### `packages/os-linux`

Linux system/app/shell/file/window/accessibility/desktop implementations, X11 backends, Wayland detection, screenshots, local Tesseract OCR, sandbox-support probe, and clean unsupported results.

### `packages/app-browser`

Firefox/Chromium unpacked WebExtension and localhost bridge. Fixed tab/DOM commands, sanitized page context/text, short-lived element references, element policy, URL sensitivity, and redaction. No arbitrary script, cookies, storage, debugger, or communication API.

### `packages/app-blender`

Optional app adapter; it does not shape core architecture.

## Tool request flow

```text
MCP request -> schema -> risk/sensitivity -> policy/grants
-> dry-run -> exact confirmation -> safe backend execution
-> result/checkpoint validation -> redacted audit -> ToolResult
```

Browser content tools classify sanitized tab metadata before requesting content. Element actions require a fresh, unique, tab-bound, short-lived `elementId`, then revalidate page, visibility, enabled state, identity, and ambiguity.

Browser setup prepares stable unpacked Firefox/Chromium folders, enables local bridge config only through explicit user command, and exposes setup/diagnostic/verification tools. Pairing/session failures return state codes and recovery steps without tokens. When bridge is unavailable, strategy routing may recommend accessibility, local vision, pointer, or guide mode; it never silently runs a fallback.

Vision never acts. Trusted screenshot evidence is session-bound, hash-checked, and valid for 10 seconds. Handoff can only produce a `desktop.click` dry-run suggestion.

## Forge runtime boundary

Generated artifacts are inert metadata until registration and runtime eligibility pass. Runtime uses only `runtime/handler.json` bounded JSON operations through a fixed child process. It does not import generated code. Runtime grants, limits, environment allowlists, output folders, timeouts, and optional OS sandbox backend are recorded per run.

Preferred sandbox backend: bubblewrap/bwrap, then firejail, then safe unshare, with fixed-runner fallback in `auto` mode. No network, GUI/DBus, secrets, broad filesystem, shell, or arbitrary code.

## Workflow/checkpoint boundary

Workflow store persists redacted records under `workflows/traces` and `workflows/skills`. Skills contain metadata, blocked actions, grants, steps, and optional reviewable checkpoint templates. Binding uses only declared `{{parameterName}}` interpolation. Skill tools never execute workflow actions. Checkpoint tools observe state only.

## Local data layout

```text
~/.agenthost/
  config.json
  logs/
  outputs/
  screenshots/
  forge/
    manifests/ artifacts/ registrations/ runtime-runs/
  workflows/
    traces/ skills/
  browser/
    pairing-token
```

Checkpoint-template review metadata lives inside skill records; separate review UI/folder is future work.

## Platform safety

Linux/X11 is primary for pointer control. Wayland reports support status without unsafe fallback. Browser bridge is localhost-only and disabled until explicitly configured and paired. No public HTTP server is enabled by default.
