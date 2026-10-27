# Overlay and Latency Findings (Phase 0)

Status: investigation complete; Phase 1 implementation notes added below.
Branch: `v2-essential`, based on `8fb6c50`.
Environment: Linux X11 (`DISPLAY=:0`), GTK3 overlay available, `scrot` available,
`gnome-screenshot`/ImageMagick `import`/Tesseract/`xclip`/`xsel` unavailable.

## Method

- Called `createAgentHostMcpServer` and `runTool` directly with an isolated temporary
  `AGENTHOST_HOME` and an in-memory audit logger.
- Timed `runTool` with `performance.now()`; durations include schema validation,
  run-state gate, preview, confirmation, handler, and audit logging. They exclude MCP
  transport, model turn time, and operator approval wait.
- Compared `AGENTHOST_OVERLAY_MODE=disabled` against `gtk3-x11`.
- Exercised read-only calls, safe file/shell calls, a real terminal GUI sequence, a
  fresh-home screenshot, an exact confirmation flow, and GTK overlay lifecycle.
- Never inspected or stored screenshot/OCR contents.

## Primary overlay root cause

The renderer is healthy. The automatic overlay is not triggered for most computer work.

- `ToolActionOverlay.begin` is called only when
  `tool.execution?.executionClass === "state_changing"` in
  `packages/mcp-server/src/tool-runner.ts`.
- `TOOL_EXECUTION_DECLARATIONS` classifies `computer.observe_state`,
  `computer.wait_for`, `window.list`, `vision.*`, `file.read`, `file.exists`, and
  `file.list` as read-only. These calls never start an action card.
- `TaskActivityOverlay` only restores or observes persistent `task.*` tasks. If the
  agent does not call `task.create`, there is no task card either.
- Therefore a normal observation/read/verify sequence shows nothing unless it happens
  to include a state-changing call.

Measured evidence:

| Sequence | Active overlays |
|---|---|
| Initial state, no task | 0 |
| `computer.observe_state` | 0 |
| `window.list` | 0 |
| `file.exists` | 0 |
| failing `vision.analyze_image` | 0 |
| first `desktop.screenshot` | 1, visible widget |

With GTK enabled, a state-changing `file.write` produced a healthy renderer:
handshake `passed`, runtime `ready`, `lastRenderMs=7`, one visible widget in 160 ms.
The card was not missing because GTK failed; it was missing because read-only tools
never asked for a card.

Contributing causes:

- First card activation spawns the renderer and costs about 350 ms
  (362.8 ms first `file.write` versus 13.4-14.9 ms subsequent writes).
- `begin` waits for the render call. A slow or broken renderer can delay the tool or
  leave no card, while `begin`/`finish` errors are swallowed.
- There is no prewarm, no bounded visibility wait, and no visible fallback status when
  GTK cannot render.

## Ranked latency list

Measured server-side paths, highest impact first:

| Rank | Path | Measured | Main cause |
|---|---|---|---|
| 1 | App launch plus window readiness (`gnome-terminal`) | ~1.89 s total; 242-273 ms launch, 1.62 s until window exists | Process spawn and window-manager appearance; no change-condition wait |
| 2 | First automatic overlay activation | +349 ms on first state-changing call; 3-6 ms renderer work after startup | Renderer spawn/handshake is deferred until first card |
| 3 | Screenshot | 156-221 ms; ~39 KB window-only and ~309 KB full-screen captures | `scrot` full capture; no region/JPEG/downscale options |
| 4 | `computer.observe_state` | 133-166 ms | `getLinuxDesktopCapabilities` is 123-163 ms, dominated by an AT-SPI Python probe (132-160 ms) |
| 5 | `desktop.type_text` / `desktop.hotkey` | 126 ms successful type; 55 ms failed type; 66-71 ms hotkey | Two-step active-window verification plus `xdotool`; failures can silently no-op |
| 6 | `window.focus` failure and recovery | Tool returned `ok:true` with `focused:false`; `xdotool windowactivate` workaround 40 ms | `wmctrl -i -a` can exit 0 without changing focus; tool does not surface failure |
| 7 | Shell command | 14-22 ms safe `echo`; 242-273 ms app launch | Command execution is cheap; application start dominates |
| 8 | File operations | 1.2-12.1 ms | Local filesystem and audit write |
| 9 | Window inspection | 12-35 ms first; 0.1-0.5 ms cached | `wmctrl` plus `/proc` reads per window, already cached for 2 s |
| 10 | Exact confirmation token | 6.9 ms preview, 4.9 ms accept, 4.4 ms execute | Operator response time is outside the process and dominates |

Other raw measurements:

- Active-window lookup: 12-24 ms.
- Screen geometry: 5.6-8.4 ms.
- Full-screen screenshot: 155.8-201.9 ms.
- Disabled-overlay `file.write`: 9.5-12.1 ms.
- GTK overlay `file.write`: 362.8 ms first, then 13.3-14.9 ms.
- OCR attempt failed in 2.7 ms with `ocr_backend_unavailable`; cold OCR could not be
  measured because Tesseract is not installed.

Not measured: MCP transport round trip, model/provider turn time, operator approval
time, and real terminal text verification after OCR. Model turn time is outside the
server process and is likely dominant across a multi-step task.

## Additional confirmed defects affecting perceived speed

1. Fresh-home screenshots fail silently.
   - With no `screenshots/` directory, `desktop.screenshot` returned `ok:true`,
     `supported:false`, and an observation claiming a screenshot was saved.
   - `scrot` does not create parent directories; the handler never calls `mkdir`.
   - After creating the directory, the same call succeeded in 220.7 ms.
   - This causes retries and false completion reports.

2. Layout-unsafe typing can silently do nothing.
   - `desktop.type_text` with `_` returned `ok:true` but `typed:false` because no
     `xclip`/`xsel` backend exists.
   - The follow-up Return was sent, so the intended command never ran.
   - The tool result must be a failure when `typed` is false.

3. Failed screenshots also return success.
   - `desktop.screenshot` maps `supported:false` to `ok:true`.
   - Callers only discover the failure when they try to use the missing path.

4. `window.focus` reports success when focus failed.
   - `wmctrl` returned exit 0 with `focused:false`; the handler still returned
     `ok:true`.
   - `xdotool windowactivate --sync` with the exact window ID focused the same window
     in ~40 ms.

5. `computer.observe_state` performs an expensive capability probe every call.
   - The AT-SPI accessibility probe spawns Python and costs ~135 ms even when the
     caller only needs the active window.
   - A short capability cache or cheaper support check would remove most of this cost.

6. OCR is unavailable in this environment.
   - Tesseract is not installed; `vision.analyze_image` fails fast with
     `ocr_backend_unavailable`.
   - The agent should report this limitation and avoid screenshot/OCR loops.

## Phase 1 implementation update

- The primary trigger defect is fixed: one central classifier now covers
  `computer.*`, `desktop.*`, `window.*`, `vision.*`, `file.*`, and `shell.*`
  under `overlay.mode: "always"`; `on_change` remains state-changing plus
  confirmation fallback and `off` disables automatic cards.
- A second confirmed cause was a stale cross-process hide marker. Any manager
  that polled later treated an old or untimestamped `run/overlay.hide` as a live
  dismissal, so the first new card could be hidden. Managers now record their
  creation time, honor only markers at or after that time, and remove legacy
  markers without hiding. Regression tests cover both stale and cross-process
  cases.
- The renderer prewarms during server startup, is awaited before production
  cards, respawns once after a previously ready child crashes, and is swept for
  orphans at startup and shutdown. CLI hide/status use the shared orphan helpers.
- Routine first paint is bounded at 150 ms (1.5 seconds while approval is
  pending); visible fast cards hold their terminal state for at least 400 ms.
  Overlay failure sets `ToolResult.overlay` to `unavailable:<reason>`, leaves the
  action result intact, and triggers one rate-limited desktop notification.
- `agenthost overlay status` now reports the effective `overlay.mode` and
  renderer mode alongside marker/renderer/activity diagnostics.
- Audit entries gained numeric `timings` for action-card wait, safety gate,
  preview, handler, audit preparation, and total. `scripts/analyze-audit.mjs`
  ranks handler time, overlay-wait share, idle gaps, and repeated tool
  sequences. `auditWrite` measures entry preparation before the JSONL append;
  actual append latency is not measured by these fields.
- Residual risk: headless/Wayland rendering remains best-effort and visible
  success is never claimed when the renderer cannot show the card. The minimum
  display can delay a completed tool's response by up to 400 ms when the card
  was visible, but not handler execution.

## Phase 1 requirements derived from these findings

1. Add one central `isComputerAction` classifier with a table-driven test. Cover
   observe, wait, screenshot, input, window, vision, file, shell, and optional adapter
   actions; exclude task/agent/system metadata control.
2. Trigger an overlay for every classified computer action when
   `overlay.mode=always`; preserve state-changing-only behavior for `on_change` and
   allow `off`.
3. Create one implicit activity session per MCP server session when no task exists, so
   read-only work is visible before `task.create`.
4. Prewarm the renderer at server startup and bound the visible-card wait to about
   1-1.5 s. Never let overlay startup block the action indefinitely.
5. Surface overlay failure in `agenthost overlay status`/`doctor` and a machine-readable
   status file; do not claim the card is visible when it is not.
6. Add tests for classifier coverage, read-only triggering, bounded startup, prewarm,
   fallback status, and a realistic terminal/file sequence.
7. Update `docs/03` and capability output to state which tool classes trigger cards,
   which config mode is active, and what fallback exists.

## Phase mapping for remaining latency work

- Phase 2: cache or make optional the AT-SPI capability probe; add `run_steps`, state
  snapshots, and condition-based `wait_for` to reduce model turns.
- Phase 3: create screenshot directories, support region/JPEG/downscale and faster
  backends, fix `desktop.type_text`/`desktop.screenshot`/`window.focus` false-success
  results, and report OCR dependency failures clearly.
- Phase 4: keep exact previews; add plan-scoped approval and read-only concurrency.
  Token overhead is already ~16 ms, so operator wait and model turns are the real costs.
- Phase 5: timestamped optional traces and repeatable real-task benchmarks.
