# Minimal-v2 progress ledger

Updated 2026-10-29 during resume.

| Item | Status | Evidence | Remaining |
|---|---|---|---|
| Phase R baseline and audit | DONE | `npm run build`, `npm run lint`, `npm test` (360 tests/58 files), `npm run smoke:mcp` (36 tools/3 resources), and `git diff --check` pass. Renderer respawn and always-mode coverage tests are present. | Keep ledger current after each work item. |
| Phase R documentation | DONE | This ledger, the named performance findings note, and the AGENTS overlay contract are updated. | None. |
| Phase 1B overlay polish | PARTIAL | Card-first paint ordering, focus-window geometry lookup, monitor-edge ring clamping, nearest-free-corner placement, and a mocked ordering regression test are implemented; action/activity tests and Python compilation pass. | Add dedicated mocked clamping/collision/reduced-motion assertions. |
| Phase 2 round-trip reduction | PARTIAL | Central runner now attaches bounded state snapshots for state-changing `desktop/window/file/shell` calls, GUI tools accept `target` selectors with focus verification, and `task` metadata updates active-task bookkeeping. Dedicated state/task tests pass; existing governed `computer.run_steps` stops on failed steps and rechecks runtime gates. | Add dedicated target/failing-plan/mid-batch-stop assertions. |
| Phase 3 input/observation reduction | PARTIAL | Existing X11/clipboard fallback and screenshot region/scale/format behavior are tested. | Add typing tuning, unchanged screenshots, OCR freshness/cache, wait conditions, and read-only file batch tools. |
| Phase 4 guidance | PARTIAL | Portable skill, guide §17, and tools/adapters documentation now describe fidelity ladder, `target`, state-in-result, and routine `task` metadata. | Reconcile final Phase 3 surfaces and validation counts. |
| Phase 5 benchmarks/report | TODO | `benchmark:agent`, `benchmark:desktop`, and audit analysis exist. | Add isolated end-to-end task scenarios, benchmark script, before/after numbers, and final validation snapshot. |
