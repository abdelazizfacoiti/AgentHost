# Privacy, support, and manual verification boundary

AgentHost is local-first. The MCP server, Browser Bridge, overlay renderer, Control Room, OCR, speech providers, stores, and logs are local components. There is no public listener, cloud OCR/TTS, credential extraction, or automatic extension installation.

Release support is documented in `SUPPORT.md`; security reports belong in
`SECURITY.md` and must be sent privately with redacted diagnostics. Scheduler
records remain owner-scoped review metadata only and never become background
jobs.

## Data boundary

- Pairing and Control Room tokens are generated locally, stored restrictively, and never written to logs or projections.
- Browser tools redact URLs, email/phone-like values, tokens, cookies, passwords, and auth-looking strings. Element references are short-lived, tab-bound, and invalid after restart.
- OCR/vision returns bounded redacted boxes and never uploads images. Screenshots and page content are excluded from audit logs, route metrics, failure memory, overlays, and Control Room projections.
- Planner, capability graph, route metrics, and safe failure memory store structural fingerprints and bounded status only; no raw prompts, private content, coordinates, or target IDs.
- Speech artifacts are local opaque metadata and are not transmitted automatically.

## Support states

The safe fallback order is Browser Bridge/adapter, structured browser, accessibility, local OCR/vision, governed desktop, then guide mode. Missing pairing, GTK/PyGObject, X11 transparency, OCR, speech providers, or optional adapters produce explicit diagnostics; AgentHost does not silently switch to an unsafe route.

## Manual checks before a public demo

1. Run `agenthost doctor --json` and confirm no credential-like output.
2. Pair one Firefox or Chromium extension on `127.0.0.1`; verify `browser.setup_status` and `browser.verify_pairing`.
3. On a normal X11 session, run `npm run demo:visual-copilot -- --diagnose`, then `--require-gui`; confirm a real acknowledged visible surface.
4. Start Control Room explicitly and verify loopback authentication, empty/loading/error states, bounded timelines, and no execution routes.
5. Run local speech provider/voice/device diagnostics only when providers are already installed.
6. Verify `npm run benchmark:routing` and release checks contain no raw private values.

Firefox temporary add-ons and Chromium unpacked extensions are development paths, not public installation. Signed/published artifacts and host dependencies remain operator responsibilities. Manual desktop checks are not replaced by headless tests.

## Non-negotiables

No silent send/submit/upload/delete/pay/buy, no CAPTCHA/MFA/login/payment bypass, no secret extraction, no public browser bridge, no sudo/package installation, no arbitrary generated code, no scheduler execution, no autonomous background work, and no hidden fallback that changes target or confirmation binding.
