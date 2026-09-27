# Overlay narration: see what the agent is doing

AgentHost narrates desktop work automatically — no extra tool calls, no
added latency:

- **Working widget** (top corner): `Clicking target (520, 340)`,
  `Focusing window Firefox`, `Typing text 12 chars`, `Sending hotkey ctrl+l`.
  Typed text, titles, and tokens are never shown — only coordinates, app
  names, and character counts.
- **Click highlight**: every `desktop.click` / coordinate pointer action
  flashes a 1.2s highlight ring at its target, concurrently with the action.
  It is visual-only and best-effort: headless sessions silently skip it.
- **Task progress**: `agenthost task watch <id> --follow` tails the redacted
  event log; the Control Room `GET /api/v1/activity?limit=20` feed shows the
  same specific labels for dashboards.

## Try it

```bash
# Static widget/highlight tour (no target-app action):
npm run demo:overlay

# Watch live background work without looking at the apps:
# Control Room loopback UI -> "Live background work" panel
agenthost control-room
```

## Configuration

- `AGENTHOST_RUNTIME_ACTIVITY_OVERLAY_ENABLED=false` — disable the widget.
- `AGENTHOST_RUNTIME_ACTIVITY_OVERLAY_REDUCED_MOTION=true` — instant transitions.
- Screenshots automatically suppress the widget during capture so evidence
  stays clean, then restore it.

Implementation: `packages/mcp-server/src/action-announce.ts`,
`runtime-activity-service.ts` (`describeToolDetail`),
`runtime-activity-overlay.ts`.
