# Overlay progress: see what the agent is doing

AgentHost can show a compact native GTK3 card while long work runs. The card is
driven by a plain library API, not by MCP tool calls:

```ts
import { createOverlayRenderer, OverlayManager, TaskProgressOverlay } from "@agenthost/app-overlay";

const sessionId = "my-session";
const manager = new OverlayManager(createOverlayRenderer("auto", { sessionId }), { sessionId });
const progress = new TaskProgressOverlay({
  manager,
  taskId: "task_123",
  title: "Researching salaries",
  steps: [
    { id: "collect", label: "Collect review pages" },
    { id: "extract", label: "Extract salary bands" }
  ],
  onAction: (action) => console.log(`operator asked to ${action}`)
});
await progress.start();
await progress.setStep("extract");
await progress.waitingForApproval("task_123");
await progress.complete("Report ready");
```

The card shows status, a checklist, `Step n / m`, elapsed time, the exact
approval command, and Pause/Resume/Stop controls. Pause is cooperative at a
step boundary; Stop is a request and never kills the current tool call. The
card hides itself 15 seconds after a terminal state.

## Try it

```bash
npm run build
npm run demo:overlay
npm run demo:task-progress
```

`demo:overlay` is a static pointer/highlight/tooltip/card tour.
`demo:task-progress` simulates a multi-step run so the controls can be tried
without touching a target application.

Implementation: `packages/app-overlay/src/task-progress.ts`,
`packages/app-overlay/src/manager.ts`, and
`packages/app-overlay/runtime/gtk3-renderer.py`.
