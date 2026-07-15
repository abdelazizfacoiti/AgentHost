# AgentHost Build Week Demo

## Project

AgentHost is Linux-first universal local MCP runtime and visual copilot. It gives Codex and other agents safe, permissioned workstation body through adapters, APIs, CLI/scripts, browser DOM, accessibility, local OCR/vision, pointer fallback, and guide mode.

Provider names are examples only. Demo is provider-agnostic.

## Build Week additions

Milestone A3 turns A1 operator control surface and A2 read-only assistance/template foundation into deterministic local Visual Copilot walkthrough:

- public source-controlled fixture;
- explicit operator start and events;
- safe local screen-point grounding;
- stale-target warning and bounded explicit recovery;
- renderer health/fallback diagnostics;
- visible terminal completion.

No browser, desktop, accessibility, file, shell, Forge, workflow, scheduler, send, submit, upload, delete, pay, or buy action occurs.

## Baseline and eligible range

- baseline tag: `build-week-baseline`
- eligible implementation range: `build-week-baseline..HEAD`

## Setup

```bash
npm install
npm run build
npm test
npm run lint
npm run smoke:mcp
```

Supported visible mode: Linux X11 with GTK3/PyGObject, PyCairo, and `xdotool`. Wayland or missing dependencies receives honest fallback guidance.

Before visible demo, verify dependencies in same desktop session:

```text
echo "$XDG_SESSION_TYPE"
test -n "$DISPLAY"
command -v xdotool
python3 -c "import cairo; import gi; gi.require_version('Gtk','3.0'); gi.require_version('Gdk','3.0'); from gi.repository import Gdk, Gtk; print('gtk3-cairo-ok')"
```

## Demo

```bash
npm run demo:visual-copilot
```

Diagnostics only:

```bash
npm run demo:visual-copilot -- --diagnose
```

Headless capability check (no visible flow, safe for CI):

```bash
npm run demo:visual-copilot -- --headless
```

Require visible renderer:

```bash
npm run demo:visual-copilot -- --require-gui
```

Launcher uses isolated demo metadata, public fixture text, explicit prompts, bounded retries, truthful terminal completion checks, renderer-health checks, signal cleanup, and cleanup. It never installs dependencies or requests sudo. `--diagnose` reports capability state; `--headless` does not simulate visible rendering.

Manual GUI verification:

1. Build from repository root and run dependency checks above in same X11 session.
2. Run `npm run demo:visual-copilot -- --diagnose`; confirm GTK3/X11 is available.
3. Run `npm run demo:visual-copilot -- --require-gui`; press Enter through every prompt.
4. Confirm control surface progress updates after each step, stale-target warning appears, explicit refresh restores pointer/highlight, and final status is `completed`.
5. Confirm target application and real pointer remain unchanged.
6. Press Ctrl-C during a prompt; confirm owned overlays disappear and process exits without an orphan renderer.

## Safety model

Overlay and assistance tools are visual-only. Target refresh validates current-step target binding but does not render automatically or invoke another tool. Overlay IDs expire on TTL/renderer restart. No confirmation token or permission grant is created. Logs and diagnostics contain safe status codes only.

## Verification

```bash
npm run build
npm test
npm run lint
npm run smoke:mcp
git diff --check
```

## Codex/GPT-5.6 usage

Implementation used Codex with GPT-5.6-style code planning, repository inspection, scoped approval, tests, and human-reviewed safety boundaries. No private session identifiers are recorded here.

## Video outline (60–90 seconds)

1. Start command and renderer status.
2. Explicitly start visual assistance.
3. Show control surface, progress, and safe target pointer.
4. Let target expire; show stale-target explanation.
5. Explicitly refresh target and retry rendering.
6. Accept final visual steps and show completed state.

## Limitations

This milestone is visual-only. It does not control target applications, support remote endpoints, provide Windows/macOS rendering, run scheduler jobs, replay skills, or provide autonomous operation.
