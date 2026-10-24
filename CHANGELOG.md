# Changelog

## Unreleased

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

- Minimal-v2 runtime: 37 MCP tools in computer, filesystem, shell, desktop,
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
