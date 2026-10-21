# Privacy, support, and manual verification boundary

AgentHost is local-first. The MCP server, overlay renderer, OCR, speech providers, stores, and logs are local components. There is no public listener, cloud OCR/TTS, credential extraction, or automatic extension installation.

Release support is documented in `SUPPORT.md`; security reports belong in
`SECURITY.md` and must be sent privately with redacted diagnostics. Scheduler
records remain owner-scoped review metadata only and never become background
jobs.

## Data boundary

- Local tokens are generated locally, stored restrictively, and never written to logs or projections.
- OCR/vision returns bounded redacted boxes and never uploads images. Screenshots and page content are excluded from audit logs, route metrics, failure memory, and overlays.
- Planner, capability graph, route metrics, and safe failure memory store structural fingerprints and bounded status only; no raw prompts, private content, coordinates, or target IDs.
- Speech artifacts are local opaque metadata and are not transmitted automatically.

## Support states

The safe fallback order is app adapter, accessibility, local OCR/vision, governed desktop, then guide mode. Missing GTK/PyGObject, X11 transparency, OCR, speech providers, or optional adapters produce explicit diagnostics; AgentHost does not silently switch to an unsafe route.

## Manual checks before a public demo

1. Run `agenthost doctor --json` and confirm no credential-like output.
2. On a normal X11 session, run `npm run demo:overlay`; confirm a real acknowledged visible card and click-through pointer/highlight surfaces.
3. Run `npm run demo:task-progress`; confirm step progress, elapsed time, and Pause/Resume/Stop controls.
4. Run local speech provider/voice/device diagnostics only when providers are already installed.
5. Verify `npm run benchmark:routing` and release checks contain no raw private values.

Host dependencies remain operator responsibilities. Manual desktop checks are not replaced by headless tests.

## Non-negotiables

No silent send/submit/upload/delete/pay/buy, no CAPTCHA/MFA/login/payment bypass, no secret extraction, no public listener, no sudo/package installation, no arbitrary generated code, no scheduler execution, no autonomous background work, and no hidden fallback that changes target or confirmation binding.
