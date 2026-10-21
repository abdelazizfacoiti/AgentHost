# Performance and deterministic benchmarks

AgentHost optimizes verified completion cost, not isolated click latency. Planning and routing surfaces are advisory metadata; they never probe an application, execute a route, capture a screenshot, or send data to a remote service.

Run the deterministic fixture benchmark after building:

```bash
npm run build
npm run benchmark:routing
```

Fixtures cover simple Browser Bridge selection, disconnected Bridge with accessibility fallback, OCR versus screenshot grounding, protected guide mode, failed-route replan, deterministic adapter selection, and bounded multistep routing. Output includes decision level, goal-classification/strategy/plan/route medians and p95s, estimated verified completion cost, bounded time-to-first-useful-action, verification duration, total verified completion, approximate token usage derived only from serialized fixture metadata, fallback/replan/retry counts, OCR/screenshot/desktop/model-call counters, bounded context bytes, candidate families, health, compatibility, verification class, and selected/expected route. It contains no prompt, URL, page text, screenshot, coordinate, element ID, message, recipient, tool argument, or secret. `generatedAt` is a fixed fixture marker for comparability.

The benchmark is not an end-to-end latency claim. It measures deterministic local metadata operations and uses declared fixture estimates for completion cost; no application probe or action runs. Each row reports `cacheHits`, `probeCount`, and a five-second `latencyWithinBound` assertion; zero probe calls is intentional for this fixture-only command. Runtime probes remain bounded and lazy; structured browser/accessibility evidence precedes OCR and screenshots; desktop and guide fallback remain explicit. Route metrics persist only redacted fingerprints and verified outcomes with expiry. Policy blocks, cancellations, protected-context refusals, and user aborts do not reduce route reliability.

Measure context sizes separately with serialized bounded MCP responses and retain only byte counts. Do not persist raw prompts to improve cache hit rate.

## Fast-actions lane (P1/R6-safe)

Goal: fewer model turns and less per-action overhead without changing the
safety pipeline (schema → risk → policy → approval → dry-run/confirmation →
exact-target → receipt → redacted audit).

- **Resources first**: pull `agenthost://capabilities.md`, then
  `agenthost://skills` and `agenthost://status`, then
  `agent.discover_capabilities`. Call `tools/list` last. This avoids
  ingesting 250+ schemas up front.
- **Folded observation**: `computer.observe_state` with `includeWindows`
  and `includeBrowserTabs` replaces three observation turns with one call;
  window/tab probes now run concurrently with active-window/capability/
  geometry probes.
- **No sleeps**: `computer.wait_for` polls active-window state at ~150ms
  and returns once the UI settles instead of burning a model turn waiting.
- **Batched plans**: `task.execute_plan` runs up to 10 steps under one plan
  token (each step still passes the full pipeline). Results carry per-step
  `durationMs` plus total `durationMs` for local measurement.
- **One-turn routine effects**: `agenthost task approve <id>` pre-approves
  low/medium non-external effects for 30 minutes; the central runner chains
  the exact dry-run + single-use confirmation server-side. Approval lookups
  are cached for 5s and invalidated on approve/clear.
- **Parallel sinks**: audit log, Control Room activity, and workflow-trace
  capture now run concurrently per tool call; audit is still awaited before
  return so no record is lost.

Verify with:

```bash
npm run build
npm run benchmark:routing
npm run benchmark:desktop
npx vitest run packages/mcp-server/src/__tests__/task-execute-plan.test.ts
npx vitest run packages/mcp-server/src/__tests__/general-purpose-agent.test.ts
```

Where OpenClaw optimizes for breadth (channels, multi-agent routing,
plugins, vector memory), AgentHost optimizes for verified local completion
cost: deterministic routing, exact-target bindings, receipts, redacted
audit, and stop/takeover gates on every state-changing step.

## OCR-to-click fast path

The screenshot → OCR → click chain keeps its full safety pipeline
(active-window validation, dry-run/confirmation, fresh-evidence handoff);
only redundant work was removed:

- `desktop.screenshot` with `includeActiveWindowOnly:true` captures a
  smaller image, which Tesseract analyzes much faster than full-screen.
- `vision.analyze_image`, `vision.find_text`, and `vision.find_target` on
  the same image share one hash-verified backend OCR cache (30s TTL,
  8 entries): analyze once, then query repeatedly for free.
- Each vision call reports its OCR time in observations; failures carry a
  recovery hint (fresh active-window-only screenshot on timeout/failure,
  re-observe on window mismatch).
- Screenshot evidence registration (PNG size, active window, geometry,
  bounds) now probes concurrently.

Fast recipe: `computer.observe_state` → `desktop.screenshot`
(active-window-only) → `vision.analyze_image` once → `vision.find_target`
(per target, cached) → `vision.prepare_pointer_action` (dry-run suggestion)
→ `desktop.click` with confirmation → `computer.wait_for` to verify.

## Styled task follow-up (visual-only, redacted)

Ongoing work is visible in three places without watching the app, and all
three now show state at a glance (badges, progress, elapsed, safe reason
codes — never private content):

- **Overlay working widget**: elapsed time (m/s past a minute), step
  progress (`Step n/m`), multi-task count, waiting-for-approval hint with
  the exact CLI command, and blocker/warning reason codes.
- **Control Room “Live background work”** (`GET /api/v1/activity?limit=20`):
  state badges, step progress bars, elapsed times, blocker/warning chips;
  task detail shows a status badge plus kind chips per timeline event.
- **CLI**: `agenthost task watch <id>` prints event counts by kind plus the
  latest error/recovery in the header; `agenthost task export <id>
  --format html` renders status badges, kind chips, and an events-by-kind
  summary (Markdown export includes the counts line too).
