# AgentHost

AgentHost is a universal local MCP server that gives Codex-style agents a safe, permissioned body on a real computer.

This repository currently implements Phase 0 + Phase 1 only:

- TypeScript npm-workspaces monorepo
- MCP stdio server skeleton
- `system.get_info`
- `system.list_capabilities`
- app-agnostic core types
- capability registry
- config loader
- JSONL audit logger
- basic policy profile structure

The implementation deliberately does not include Blender, GUI clicking/typing, browser automation, email sending, Windows/macOS support, skill recording, or autonomous background operation.

## Repository Layout

```text
packages/
  core/        App-agnostic contracts, config, logging, policies, and registry.
  os-linux/    Linux system-info boundary for the first supported platform.
  mcp-server/  AgentHost stdio MCP server and system tools.
scripts/
  smoke-mcp.mjs
implimentation_documents/
  Product, architecture, security, tool, and roadmap docs.
```

## Setup

```bash
npm install
npm run build
```

## Run The MCP Server

```bash
npm run start:mcp
```

The server uses stdio transport and must not write normal diagnostics to stdout. Audit logs default to:

```text
~/.agenthost/logs/agenthost.jsonl
```

For local development, set `AGENTHOST_HOME` to redirect logs:

```bash
AGENTHOST_HOME=.agenthost npm run start:mcp
```

## Test

## Browser bridge (Phase 25)

Browser tools are disabled by default. Enable the local bridge in `~/.agenthost/config.json`:

```json
{
  "browserBridge": { "enabled": true, "port": 43117 }
}
```

One-time local setup. This explicitly creates/updates local bridge config, prepares stable bundles, and prints pairing token. It never installs extension automatically.

```bash
npm run browser:setup
```

Restart AgentHost MCP server. Then load Firefox/Chromium bundle and paste displayed token into popup.

Prepare only, without config/token change:

```bash
npm run browser:extension:firefox
# or
npm run browser:extension:chromium
```

Firefox: open `about:debugging#/runtime/this-firefox`, select **Load Temporary Add-on…**, then select `~/AgentHost/browser-extension/firefox/manifest.json`. Temporary Firefox add-ons disappear after browser restart; reload same manifest.

Chromium: open `chrome://extensions`, enable Developer mode, select **Load unpacked**, then select `~/AgentHost/browser-extension/chromium`.

Use `browser.setup_status` and `browser.diagnose_bridge` for safe setup state. Generate token through `browser.generate_pairing_token` with dry-run/confirmation, paste returned token into popup, click **Pair / Re-pair**, then call `browser.verify_pairing`. `browser.reset_pairing` revokes current pairing without returning token. Tokens never enter audit logs. Bridge binds only to `127.0.0.1`; it never exposes cookies, saved passwords, storage, browser debugging, or arbitrary JavaScript.

Full state checklist, restart recovery, manual smoke, blocked-action, and explicit fallback validation: [Browser Setup Validation](docs/06_BROWSER_SETUP_VALIDATION.md).

Forge bounded runtime defaults to `forgeRuntimeSandboxMode: "auto"`. It uses Bubblewrap only when `bwrap` and unprivileged user namespaces are available; otherwise it keeps existing fixed child runner and records fallback warning. Set `forgeRuntimeSandboxMode` in `~/.agenthost/config.json`, or `AGENTHOST_FORGE_RUNTIME_SANDBOX_MODE` to `auto`, `none`, `bubblewrap`, `firejail`, or `unshare`. Explicit `firejail`/`unshare` currently fail closed: no reviewed allow-only filesystem profile exists.

Run unit tests:

```bash
npm test
```

Run a smoke test that imports the compiled packages, calls both Phase 0/1 tools, and confirms JSONL logging:

```bash
npm run smoke:mcp
```

The smoke test sets `AGENTHOST_HOME=.agenthost/smoke` so it writes only inside the ignored local workspace folder.

## Workflow traces and skills (Phase 27)

Start tracing explicitly with `workflow.trace_start`, then use normal AgentHost tools. While active, AgentHost stores only bounded redacted summaries under:

```text
~/.agenthost/workflows/traces/
~/.agenthost/workflows/skills/
```

Stop a trace with `workflow.trace_stop`, save its safe generic plan using `workflow.skill_save_from_trace`, and inspect it with `workflow.skill_run_dryrun`. Skills are draft, preview-only metadata in this phase: they cannot execute tools, create confirmation tokens, send, submit, upload, or bypass safety/grants.

## Local OCR grounding (Phase 28)

`vision.analyze_image`, `vision.find_text`, and `vision.find_target` inspect approved local AgentHost screenshot/output images. They use installed local `tesseract` when available, return bounded redacted OCR bounds and image-relative candidate coordinates, and never click, type, upload, cache image bytes, or call cloud services. Missing Tesseract returns `ocr_backend_unavailable`; AgentHost never installs it.

`vision.prepare_pointer_action` accepts only fresh in-session screenshot and target evidence, then returns a `desktop.click` payload with `dryRun:true`. It never calls pointer tools or creates confirmation tokens.

## Semantic checkpoints (Phase 30)

`checkpoint.evaluate` checks bounded read-only browser, accessibility, desktop, file, or manual conditions once. `checkpoint.wait_for` polls those same conditions for at most 30 seconds. Both return redacted summaries only and never click, type, retry an action, create confirmation tokens, or run background loops.

For a raw stdio protocol check, pipe JSON-RPC messages into the built server:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual","version":"0.0.0"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"system.get_info","arguments":{}}}\n' | AGENTHOST_HOME=.agenthost/manual AGENTHOST_PROFILE=dev AGENTHOST_STDIO_EXIT_ON_STDIN_END=1 node packages/mcp-server/dist/index.js
```

## Codex MCP Config Example

After building, point Codex at the compiled server:

```json
{
  "mcpServers": {
    "agenthost": {
      "command": "node",
      "args": ["/absolute/path/to/agenthost/packages/mcp-server/dist/index.js"],
      "env": {
        "AGENTHOST_HOME": "/absolute/path/to/.agenthost"
      }
    }
  }
}
```

## Phase 2 Next

Phase 2 should add the universal safety engine: risk classification, app sensitivity classification, protected path checks, approval requirement modeling, and redaction utilities. It should still remain app-agnostic and should not add GUI/browser/email automation yet.
