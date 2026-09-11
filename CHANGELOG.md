# Changelog

## Unreleased

- Added background browser execution: isolated headless Chromium profile, `browser.background_status`/`browser.background_launch`, session-holder visibility, and confirmation-gated `browser.release_session` handoff (verify with `browser.detect`).
- Added live background-work UX: Control Room `GET /api/v1/activity` feed plus panel, and `agenthost task watch <id> [--follow] [--notify]`.
- Added governed plan execution: `task.execute_plan` runs bounded tool sequences with per-step stop gates, task logging, and fail-fast recovery.
- Added episodic learning loop: redacted `strategy.record_episode`/`strategy.recall_episodes` feed `strategy.select` scoring.
- Added SSH device adapter (`ssh.run_command`, key auth only) as the second optional adapter behind the shared safety model.
- Hardened desktop input (layout-safe typing, focus-restore reporting) and Control Room response headers; rebuilt the release archive with the new package.
- Fixed a release-preflight README wording check and a release-builder package-list gap that excluded the new adapter.

## 0.1.0 release candidate

- Added authoritative runtime Visual Copilot smoke with honest visible/headless state.
- Added normalized Firefox/Chromium inventory, resumable pairing, reconnect verification, repair diagnostics, and Visual Copilot setup projection.
- Added bounded goal/planning contracts, capability graph, adaptive route preview, verified-only route metrics, safe failure memory, and deterministic fixture benchmarks.
- Added rootless Linux packaging, release integrity checks, Apache-2.0 licensing, and third-party notices.
- Added bounded inert scheduler schedule forms (`once`, `delayed`, `recurring`, `cron`, and `calendar`), trusted owner scoping, and metadata-only lifecycle reviews.
- Corrected adaptive route tie ordering and added bounded probe-cache hit metrics without eager OCR or screenshot probing.
- Added public repository governance templates and release support/security guidance.

No scheduler execution, autonomous replay, remote bridge, credential extraction, or provider-specific product capability is included.
