# AgentHost Demo and Manual Verification Guide

AgentHost is a Linux-first local capability runtime. The demos in this guide
are intentionally bounded and visual-only: they report state but never click,
type, navigate, send, submit, upload, delete, pay, or control a target
application.

## Prepare the repository

From the repository root:

```bash
npm install
npm run build
npm test
npm run lint
npm run smoke:mcp
```

No command in this guide installs system packages or uses `sudo`.

## Overlay demo

Show the static overlay tour:

```bash
npm run demo:overlay
```

It displays a pointer, a highlight, a tooltip, and an interactive card. The
renderer uses native GTK3 windows on X11. Pointer and highlight primitives are
click-through; interactive cards are small popups, not a fullscreen surface.

## Live task progress demo

```bash
npm run demo:task-progress
```

The card shows:

- status (`Running`, `Paused`, `Pausing after this step`, `Stopping…`,
  `Waiting for approval`, `Done`, `Failed`, `Stopped`)
- a step checklist with active/done/failed markers
- `Step n / m`, progress, and elapsed time
- a run-wide `Tasks` count when more than one task is active
- the exact `agenthost task approve <id>` command while waiting for approval
- **Pause**, **Resume**, **Stop**, and **Dismiss** controls

Pause and Resume are cooperative: the demo stops at the next step boundary.
Stop requests the end of the run and shows `Stopping…`; it never freezes or
kills an in-flight tool call. The card auto-hides 15 seconds after a terminal
state.

## Desktop prerequisites

Check the same desktop session that will display the overlay:

```bash
echo "$XDG_SESSION_TYPE"
test -n "$DISPLAY"
python3 -c "import gi; gi.require_version('Gtk','3.0'); from gi.repository import Gtk; print('gtk3-ok')"
command -v xdotool
```

Wayland sessions use the honest headless fallback instead of claiming visible
success. A compositor with an RGBA visual is required for transparent windows.

## Manual checks

1. Run `npm run demo:overlay` and confirm the windows appear and disappear.
2. Run `npm run demo:task-progress` and confirm the step list advances.
3. Click **Pause**, confirm the status changes, then click **Resume**.
4. Click **Stop** and confirm the card shows the stopped state and exits.
5. Click through the transparent area around pointer/highlight primitives and
   confirm the desktop underneath still receives clicks.
6. Confirm the card reports `Done` and hides itself after about 15 seconds.
7. Press Ctrl-C during a run and confirm no renderer process or window remains.

## Safety and non-execution boundaries

- Overlay controls only emit events; they never invoke another tool.
- Visual surfaces never control target applications.
- Logs, receipts, overlays, and screenshots must not contain secrets, tokens,
  or raw private content.
- Headless and unsupported sessions report limitations instead of claiming
  visible success.

## Automated verification

Run the standard gates from the repository root:

```bash
npm run build
npm test
npm run lint
npm run smoke:mcp
git diff --check
```

Release validation additionally uses `npm run release:preflight`,
`npm run release:build`, `npm run release:scan`, and
`npm run release:verify`. These checks do not claim visible pixel success;
that still requires a normal supported X11 desktop.
