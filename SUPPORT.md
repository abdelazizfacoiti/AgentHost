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

For visible overlays, check `npm run agenthost -- overlay status` and
`npm run agenthost -- doctor --json` first. Headless mode is deterministic; a
headless acknowledgement is never proof of visible pixels. GTK3/X11 and
PyGObject remain operator-installed dependencies.

## What to include

Provide the AgentHost version, command, safe error code, platform/session type,
and the smallest redacted reproduction. Do not attach home-directory paths,
tokens, private page text, screenshots, OCR output, credentials, or full logs.
