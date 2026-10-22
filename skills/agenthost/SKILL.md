---
name: agenthost
description: >
  Route any laptop-control action through the local AgentHost MCP server instead of
  ad-hoc automation. Use when the user asks to open or control apps, click, type,
  press keys, take screenshots, manage windows, automate a browser, run shell
  commands outside the workspace, or read/write files outside the project. AgentHost
  adds risk tiers, operator approvals, emergency stop, and audit logging so the agent
  has a safe body on a real computer. Trigger: desktop control, computer use, GUI
  automation, laptop control, screenshot, window focus, type text, click, browser
  automation, "do it on my machine".
---

# AgentHost — permissioned laptop control

AgentHost is a local MCP server exposing computer-use tools. When a task needs the
real machine, use AgentHost tools — never raw `pyautogui`/`xdotool` scripts, never
silent GUI actions.

## When this applies

Use AgentHost when the request needs any of:

- operate a GUI app, click, type, drag, press keys, scroll
- take or inspect screenshots, find a visual target
- open/focus/enumerate windows
- automate a website or an app that has no API
- run shell commands or touch files outside the current workspace
- any multi-app workflow the user wants performed "on my laptop"

Do **not** use it for normal code edits or commands inside this project — use the
coding tools directly.

## Hard rules

1. **Inspect before acting.** Start with `computer.observe_state`, `window.list`,
   or `desktop.screenshot`; never click blind.
2. **Preferred order:** app-specific adapter → official API/plugin → CLI/script →
   browser automation → accessibility tree → GUI screenshot/click/type → guide
   mode. GUI clicking is the fallback, not the default.
3. **Respect confirmation.** Every state-changing action, including
   `desktop.screenshot`, needs an exact preview. Call the tool with
   `dryRun: true`; the result includes a token ID. Ask the operator to run
   `agenthost confirm <tokenId>` (or `deny <tokenId>`), then retry the exact
   same call with `confirmationToken: "<tokenId>"`. Never bypass a blocked
   action. For repeated low/medium work, the operator can run
   `agenthost task approve <activeTaskId> [--max-risk low|medium]`; that does
   not cover high-risk effects.
4. **Respect stop.** If output contains `emergency_stop_requested` or
   `human_takeover_active`, halt state-changing work immediately. `agent.stop`
   and `agent.takeover_begin` request those gates; only the operator can clear
   them with `agenthost agent resume --stop` or `--takeover`.
5. **No secrets through the GUI.** Never type passwords, API keys, tokens, or
   payment data. Ask the operator to enter them.
6. **Track work.** For multi-step jobs use `task.create`, `task.update`, and
   `task.add_event` so progress survives failures and the operator can watch it.
   Use `task.update_status` to pause, resume, complete, or cancel. Do not start
   a new task until the current one is finished unless the user asks.
7. **Prefer bulk text entry.** Use `desktop.type_text` for text, not per-character
   key presses; use `desktop.hotkey` for shortcuts.
8. **Leave the machine as found.** Restore focus/state when the task ends; report
   what changed.

## Tool map

| Need | Tool |
|---|---|
| Observe desktop state | `computer.observe_state` |
| Capture screenshot (state-changing) | `desktop.screenshot` |
| Wait for a condition | `computer.wait_for` |
| Click / move pointer | `desktop.click`, `desktop.pointer` |
| Type text / shortcuts | `desktop.type_text`, `desktop.hotkey` |
| Windows | `window.list`, `window.focus` |
| Files | `file.read`, `file.write`, `file.list`, `file.copy`, `file.move`, `file.delete`, `file.exists`, `file.ensure_dir` |
| Shell | `shell.run` |
| Vision / OCR | `vision.find_text`, `vision.find_target`, `vision.analyze_image` |
| Tasks / progress | `task.create`, `task.status`, `task.update`, `task.add_event`, `task.list` |
| Apps / adapters | `adapter.list`, `adapter.get` |
| Safety / system | `policy.get_profile`, `policy.list_profiles`, `system.get_info`, `system.list_capabilities`, `system.check_dependency` |

MCP clients may prefix tool names (for example `mcp__agenthost__desktop_click` or
`agenthost_desktop_click`). Match on the suffix (`desktop.click` → `desktop_click`).

## Operator controls

The human can always intervene outside the chat:

- `agenthost status` — server and run-flag summary
- `agenthost confirmations` — list pending exact-preview tokens
- `agenthost confirm <tokenId>` / `deny <tokenId>` — resolve one preview
- `agenthost task approve <taskId> [--max-risk low|medium]` — 30-minute
  approval for an active task's low/medium effects
- `agenthost task pause <taskId>` / `task resume <taskId>` — task lifecycle
- `agenthost task watch <taskId> --overlay [--follow]` — live progress card
- Every state-changing tool automatically shows a small action card; it never
  replaces confirmation or stop controls
- `agenthost overlay hide` — hide persistent cards immediately
- `agenthost overlay status` — renderer and hide-marker state
- `agenthost agent stop` — runtime stop when the client owns the MCP process
- `agenthost agent resume --stop|--takeover` — operator-only gate clear

Progress cards persist until explicitly dismissed, so a finished task remains
visible until the operator closes it.

## If AgentHost is not available

Resources: pull `agenthost://capabilities.md` for the compact tool brief and
`agenthost://status` for live stop/takeover/approval state. There is no
`agenthost://skills` MCP resource.

If no AgentHost MCP tools are exposed: say so, and ask the operator to run
`agenthost start` (or register the server with their client, e.g.
`agenthost integrations codex add --apply`). Do not silently substitute another
automation library; that bypasses approvals and audit logging.
