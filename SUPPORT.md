# Support

AgentHost is a Linux-first local MCP server. The supported public artifact is
the versioned Linux archive and `agenthost` CLI; the root npm package remains
private and is not an npm publication target.

## Before asking for help

Run the read-only checks that match the issue:

```bash
npm run build
npm test
npm run lint
npm run smoke:mcp
npm run agenthost -- doctor
```

For browser setup, use `npm run browser:setup`, load the unpacked extension,
and pair it with a freshly generated token. If the extension is unavailable,
AgentHost reports that state and may use accessibility, local OCR, desktop, or
guide mode only when the requested route is safe and supported.

For visible overlays, run `npm run demo:visual-copilot -- --diagnose` first.
Headless mode is deterministic; a headless acknowledgement is never proof of
visible pixels. GTK3/X11 and PyGObject remain operator-installed dependencies.

## What to include

Provide the AgentHost version, command, safe error code, platform/session type,
and the smallest redacted reproduction. Do not attach home-directory paths,
tokens, private page text, screenshots, OCR output, credentials, or full logs.
Scheduler, workflow, and Control Room records are intentionally metadata-only
and non-executable; support cannot enable hidden background execution.
