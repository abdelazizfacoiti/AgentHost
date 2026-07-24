# Security Policy

AgentHost runs locally and handles files, applications, browser state, and
desktop capabilities. Treat all reports and diagnostic output as potentially
sensitive.

## Reporting

Do not open a public issue for a vulnerability. Contact the maintainers
privately using the project support channel described in `SUPPORT.md`. Include
the affected version, a minimal reproduction, and a redacted impact summary.
Never send passwords, API keys, pairing tokens, cookies, screenshots, page
content, OCR text, private messages, or complete audit logs.

## Safety baseline

The MCP server and browser bridge are local/loopback components. Pairing,
grants, dry-run, confirmation, target binding, verification, and redacted
audit logging remain mandatory. Scheduler records are review-only metadata;
they do not create timers, workers, or background execution. Visual overlays
do not control target applications. Do not weaken these boundaries in a bug
fix or adapter.

Supported releases are Linux-first archives. Optional adapters are disabled
unless explicitly enabled and must retain their bounded subprocess and
environment policies.
