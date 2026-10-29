# Minimal-v2 progress ledger

Updated 2026-10-29 during resume.

| Item | Status | Evidence | Remaining |
|---|---|---|---|
| Phase R baseline and audit | DONE | `npm run build`, `npm run lint`, `npm test` (362 tests/58 files), `npm run smoke:mcp` (38 tools/3 resources), and `git diff --check` pass. Renderer respawn and always-mode coverage tests are present. | Keep ledger current after each work item. |
| Phase R documentation | DONE | This ledger, the named performance findings note, and the AGENTS overlay contract are updated. | None. |
| Phase 1B overlay polish | PARTIAL | Card-first paint ordering, focus-window geometry lookup, monitor-edge ring clamping, nearest-free-corner placement, and mocked ordering/reduced-motion regressions are implemented; action/activity tests and Python compilation pass. | Add a dedicated mocked renderer assertion for clamp/collision geometry; real-display behavior remains manual. |
| Phase 2 round-trip reduction | DONE | Central runner attaches bounded state snapshots for state-changing `desktop/window/file/shell` calls, GUI tools accept `target` selectors with focus verification, `task` metadata updates active-task bookkeeping, window-focus geometry reaches the target ring, repeated failing plans warn, and governed batches stop on failed expectations. Dedicated tests pass. | None for the scoped Phase 2 items. |
| Phase 3 input/observation reduction | PARTIAL | Existing X11/clipboard fallback now uses zero-delay short ASCII typing, bounded large-payload clipboard paste with save/restore, and explicit missing-backend errors; screenshot results now expose bounded `unchanged` frame hashes; governed `file.read_many`, bounded recursive `file.list`, `file.search`, `computer.wait_for` window/title/file conditions, and fresh `vision.find_text_on_screen` absolute-coordinate suggestions are implemented. | Add OCR region/scale cache-key tuning and persistent-worker measurement. |
| Phase 4 guidance | PARTIAL | Portable skill, guide §17, and tools/adapters documentation now describe fidelity ladder, `target`, state-in-result, and routine `task` metadata. | Reconcile final Phase 3 surfaces and validation counts. |
| Phase 5 benchmarks/report | TODO | `benchmark:agent`, `benchmark:desktop`, and audit analysis exist. | Add isolated end-to-end task scenarios, benchmark script, before/after numbers, and final validation snapshot. |
