# Privacy, support, and verification boundary

AgentHost is local-first. The MCP server, overlay renderer, OCR backend, task
store, confirmations, and audit logs are local components. There is no public
listener, cloud OCR, credential extraction, telemetry upload, or remote bridge.

Release support is documented in `SUPPORT.md`; security reports belong in
`SECURITY.md` and must be sent privately with redacted diagnostics.

## Data boundary

- Confirmation tokens are generated locally, stored restrictively, and never
  written to audit logs.
- OCR returns bounded redacted text boxes and never uploads images. Screenshots
  and page content are excluded from audit logs and overlays.
- Audit logs contain tool name, risk, policy profile, approval state,
  duration, error code, and provenance — never raw arguments, secrets, or
  private file content.
- Task records contain the goal, status, and bounded event summaries; exported
  reports are redacted.
- Overlay cards are public by construction and never include target content.

## Support states

The safe fallback order is app adapter, CLI/script, local OCR/vision, governed
desktop input, then guide mode. Missing GTK/PyGObject, X11 support, OCR, or
optional adapters produce explicit diagnostics; AgentHost does not silently
switch to an unsafe route.

## Manual checks before a public release

1. Run `agenthost doctor --json` and confirm no credential-like output.
2. On X11, run a state-changing tool with `dryRun: true`; confirm one visible,
   click-through action card appears and clears or persists as configured.
3. Run `agenthost overlay status` and `agenthost overlay hide`; confirm no
   orphaned renderers remain.
4. Run `npm run release:scan` and confirm no raw private values, absolute
   checkout paths, or runtime artifacts are included.

Host dependencies remain operator responsibilities. Manual desktop checks are
not replaced by headless tests.

## Non-negotiables

No silent send/submit/upload/delete/pay/buy, no CAPTCHA/MFA/login/payment
bypass, no secret extraction, no public listener, no sudo/package installation,
no arbitrary generated code, no autonomous background work, and no hidden
fallback that changes target or confirmation binding.
