# Changelog

## Unreleased

- Added `agenthost integrations <client> add|status|remove` for opencode,
  Claude Code, Codex, Copilot (VS Code + CLI), and Cursor. `--apply` writes
  one server entry, preserves existing settings, and backs up an existing
  config. The
  skill installer now registers the MCP server for the same clients, and the
  skill can self-register when its tools are missing.
- Added an automatic persistent current-task card that shows the active goal,
  phase/current action, definition-of-done checklist, running-task count, and
  Pause/Resume/Stop. It restores the latest active task on startup and honors
  an explicit close.
- Fixed overlay buttons failing when multiple cards shared one manager: events
  are now routed per overlay instead of being drained by the first poller.
  Pause reasons are scoped, Stop failures are reported instead of shown as
  halted, and a stopped task card exposes Dismiss immediately.
- Fixed GTK renderer event polling overlapping an in-flight update, which
  could kill a healthy renderer and make the automatic task card disappear.
  Task-card Pause now requests the scoped global pause and shows Paused with a
  Resume control immediately.
- Approval waits now raise the action card and send a best-effort desktop
  notification to run `agenthost confirmations`; token values are never
  included.
- Added overlay Pause/Resume/Stop/Dismiss controls, raised approval cards, and
  task definition-of-done verification gates.
- Added fast task-decision guidance (inspect once, act, verify) and earlier
  duplicate-call nudges.
- Fixed release installs rewriting relative workspace symlinks to absolute
  temporary paths, which made the installed `agenthost start` fail with
  `ERR_MODULE_NOT_FOUND` and left MCP clients disconnected. Install now copies
  symlinks verbatim and rejects any symlink that escapes the install root.
- Replaced named policy profiles with one autonomous runtime policy. Routine
  local actions execute directly; external, destructive, private-data, and
  financial effects require exact confirmation. Removed
  `policy.get_profile` and `policy.list_profiles`, leaving 35 live tools.
- Added one automatic, public, click-through action card for every
  state-changing MCP tool, including waiting-for-approval, preview, done,
  halted, and error states.
- Added screenshot suppression so AgentHost cards never appear in captured
  screenshots.
- Enforced single-use, exact-preview confirmation tokens; active-task approval
  is limited to low/medium effects and only while the task is active.
- Enforced operator stop and human-takeover gates for state-changing tools,
  with redacted audit logging and repo-control-plane path protection.

## 0.1.0

- Minimal-v2 runtime: 37 MCP tools at release time in computer, filesystem, shell, desktop,
  vision/OCR, window, task, and agent-control families.
- Persistent task lifecycle with watch, export, pause/resume, and scoped
  approval commands.
- GTK3/X11 overlay renderer with task progress cards, pointer primitives, and
  cross-process hide/status handling.
- Linux release packaging, integrity scanning, Apache-2.0 licensing, and
  generated third-party notices.

No browser bridge, speech surface, scheduler execution, Control Room,
autonomous replay, remote listener, credential extraction, or hidden
background operation is included.
