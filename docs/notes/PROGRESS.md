# Minimal-v2 progress ledger

Updated 2026-10-29 during resume.

| Item | Status | Evidence | Remaining |
|---|---|---|---|
| Phase R baseline and audit | DONE | `npm run build`, `npm run lint`, `npm test` (369 tests/59 files), `npm run smoke:mcp` (39 tools/3 resources), and `git diff --check` pass. Renderer respawn and always-mode coverage tests are present. | Keep ledger current after each work item. |
| Phase R documentation | DONE | This ledger, the named performance findings note, and the AGENTS overlay contract are updated. | None. |
| Phase 1B overlay polish | PARTIAL | Card-first paint ordering, focus-window geometry lookup, monitor-edge ring clamping, nearest-free-corner placement, and mocked ordering/reduced-motion regressions are implemented; action/activity tests and Python compilation pass. | Add a dedicated mocked renderer assertion for clamp/collision geometry; real-display behavior remains manual. |
| Phase 2 round-trip reduction | DONE | Central runner attaches bounded state snapshots for state-changing `desktop/window/file/shell` calls, GUI tools accept `target` selectors with focus verification, `task` metadata updates active-task bookkeeping, window-focus geometry reaches the target ring, repeated failing plans warn, and governed batches stop on failed expectations. Dedicated tests pass. | None for the scoped Phase 2 items. |
| Phase 3 input/observation reduction | PARTIAL | Existing X11/clipboard fallback now uses zero-delay short ASCII typing, bounded large-payload clipboard paste with save/restore, and explicit missing-backend errors; screenshot results now expose bounded `unchanged` frame hashes; governed `file.read_many`, bounded recursive `file.list`, `file.search`, `computer.wait_for` window/title/file conditions, and fresh `vision.find_text_on_screen` absolute-coordinate suggestions are implemented. | Add OCR region/scale cache-key tuning and persistent-worker measurement. |
| Phase 4 guidance | DONE | Portable skill, guide §17, and tools/adapters documentation describe the fidelity ladder, `target`, state-in-result, routine `task` metadata, bounded file batches/search, wait conditions, and fresh screen OCR suggestions. | None for the scoped guidance. |
| Phase 5 benchmarks/report | DONE | `benchmarks/tasks/scenarios.json` contains 20 scenarios; `npm run benchmark:tasks` completed 20/20 with 22 governed calls and 839.4 ms total in an isolated home; README records historical/current desktop measurements and the guide has the 369-test validation snapshot. | Real-display animation, dock, and multi-monitor checks remain manual. |
