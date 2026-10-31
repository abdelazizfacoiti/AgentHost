# Performance and overlay findings

## Resume audit — 2026-10-29

Baseline is green: build, lint, 371 tests in 60 files, MCP smoke, and diff
whitespace checks pass.

### Why the card could appear only when requested

The action path starts the frame and target-ring primitive requests and then
waits for the target-ring lead interval before rendering the action widget.
Those requests share the renderer's bounded JSONL in-flight queue and GTK
acknowledgement path. On a cold renderer, frame/ring paint acknowledgements can
consume the 150 ms routine first-paint budget before `showWidget` is serviced.
The runner then continues correctly and records `overlay: "unavailable:..."`,
which made the card look opt-in even though the action was governed.

This is an overlay scheduling issue, not a policy or trigger-classification
issue: `activity.test.ts` covers every registered computer-action family, and
`runTool` calls `actionOverlay.begin` before safety preview/handler work.

### Other confirmed explanations for a missing card

- `overlay.mode: "off"` intentionally disables automatic cards.
- `overlay.mode: "on_change"` intentionally omits read-only computer actions.
- A timestamped hide marker is honored only by managers already running, and
  an operator dismissal sticks until the next action lifecycle.
- Headless/Wayland/GTK-unavailable environments use an honest non-visible
  fallback; they do not claim a native card.
- A renderer crash can briefly leave a card absent while the bounded respawn
  path recovers; the renderer test covers this and diagnostics expose it.
- Schema-invalid calls do not begin a card because the runner avoids rendering
  before it can validate the input.

The GTK runtime on this machine lacks `gi._gi_cairo`; frame and target-ring
animation therefore use per-widget GTK CSS providers rather than Cairo. The
fallback was verified on the real display by capturing the ambient frame at two
points in its pulse and observing the border pixel change. Static primitives
still render when reduced motion is requested.
