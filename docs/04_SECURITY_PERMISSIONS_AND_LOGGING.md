# AgentHost Security, Permissions, and Logging

## Security goal

AgentHost is local-first, visible, permissioned, previewable, confirmation-bound,
bounded, auditable, and conservative. It must never behave like malware,
spyware, credential theft software, stealth remote control, or an unattended
automation service.

## Hard non-negotiables

- No silent send, submit, post, upload, delete, archive, pay, buy, publish, or
  destructive overwrite.
- No login, CAPTCHA, MFA, payment, security, or approval bypass.
- No password, cookie, browser-storage, token, API-key, private-key, or secret
  extraction.
- No public listener, remote access, stealth control, hidden persistence,
  unsupported background process, sudo, package installation, or unsafe
  network access.
- No arbitrary generated JavaScript or Python execution.
- No generated tools as independent live MCP tools.

## Risk and confirmation model

The current risk levels are `observe`, `low`, `medium`, `high`, and `blocked`.
There is one autonomous runtime policy; routine local actions run directly.
Consequential effects — external sends/uploads, destructive actions,
private-data reads, financial effects, or high risk — require an exact preview
and single-use token; an active task approval may cover low/medium effects.
Blocked effects remain denied even with a token.

Confirmation-bearing tools accept:

- `dryRun: true` — resolve the actual target, risk, policy decision, and
  blocked reasons; execute nothing; return a single-use token when allowed.
- `confirmationToken` — the token ID approved for that exact preview.

Routine local actions do not need either field.

Tokens are stored under `~/.agenthost/run/confirmations/` with mode `0600`,
expire after 15 minutes, and are bound to:

- tool name;
- canonical tool arguments (excluding `dryRun` and `confirmationToken`);
- target fingerprint.

Tokens are single use. The runner atomically claims and consumes a token before
calling the handler. Changed arguments, tool, or target return a mismatch error
and leave the token available for the correct call. Rejected, expired, or
already-used tokens fail closed. Tokens are intentionally not session-bound in
minimal-v2 because MCP clients may start a fresh server process per call; the
fingerprint and target binding provide the exact-preview proof.

Dangerous or blocked effects are denied even with a token. Confirmation proves
operator intent; it does not bypass policy, grants, path checks, or handler
checks.

## Emergency stop and human takeover

The runtime flags are:

- `~/.agenthost/run/stop.requested`;
- `~/.agenthost/run/takeover.active`;
- `~/.agenthost/run/pause.requested`.

An unreadable flag fails closed. The central runner checks stop and takeover
before every state-changing call. A requested stop returns
`emergency_stop_requested`; takeover returns `human_takeover_active`. Read-only
observation remains available.

Control paths:

- MCP: `agent.status`, `agent.stop`, `agent.takeover_begin`.
- CLI: `agenthost agent status|pause|stop|takeover-begin`.
- Clearing is operator-only: `agenthost agent resume --stop`,
  `agenthost agent resume --takeover`, `agenthost agent resume --pause`, or a
  combination of flags.
- `agenthost stop` writes the stop flag and terminates an AgentHost-managed
  background process if one exists.
- There is intentionally no MCP tool to clear a stop or takeover.

## Central execution baseline

Every call to a registered tool passes through one runner:

1. Zod schema validation. Invalid input returns `invalid_input` and never
   reaches the handler.
2. Stop/takeover gate for state-changing tools.
3. Effect preview resolution (actual target, target fingerprint, risk,
   approval, blocked reason). Previews never execute.
4. Dry-run returns the preview plus a pending token when confirmation is
   required. Routine actions return no token.
5. Non-dry execution runs directly unless confirmation is required. A
   consequential call without a token returns `confirmation_required`. An
   active task approval may auto-chain only low/medium effects for an active
   task; the runner creates and consumes the exact token server-side.
6. The runner consumes the token exactly once.
7. The handler reruns path/shell/target safety checks with
   `confirmationSatisfied` set only for an accepted confirmation, then executes.
8. One redacted audit entry is written.

The handler does not create or consume confirmation tokens. It revalidates
safety against the same arguments and target.

## Control-plane protection

AgentHost protects its own control plane from agent writes and deletes:

- `$AGENTHOST_HOME/run/`;
- `$AGENTHOST_HOME/logs/`;
- `$AGENTHOST_HOME/setup/`;
- `$AGENTHOST_HOME/tasks/approvals/`;
- `$AGENTHOST_HOME/config.json`;
- the configured config and log paths.

Reads are medium risk; writes and deletes are blocked. Shell commands that
touch these paths or run mutating `agenthost` commands
(`task approve|stop`, `confirm`, `deny`, `resume`, `stop`, `takeover`,
`overlay hide`, `integrations --apply`) are blocked. Inline interpreter code
(`python -c`, `node -e`, and similar) is high risk. Wrapper shells,
metacharacters, destructive file commands, package/service changes, `sudo`,
filesystem formatting, credential paths, and browser-profile paths remain
blocked or high risk.

`shell.run` rejects attempts to override `PATH`, `HOME`, `LD_PRELOAD`,
`LD_LIBRARY_PATH`, `NODE_OPTIONS`, `PYTHONPATH`, `BASH_ENV`, or `ENV`.

## Policy and grants

AgentHost has one autonomous runtime policy. It permits routine local shell,
file, GUI input, screenshot, and optional adapter discovery directly.
Communication, private-data, external, destructive, and financial effects are
gated as `approval_required`; credential/security apps, secret data, protected
system paths, and the AgentHost control plane stay blocked. No policy bypasses
schema validation, preview, token, stop/takeover, or audit requirements.

Persistent grants are validated and scoped by capability. A grant does not
replace a confirmation token for a high-risk, external, destructive, or
private-data effect.

## Task approval

`agenthost task approve <taskId> [--max-risk low|medium]` creates a 30-minute
approval for an **active** task. It is operator-only. The runner may auto-chain
low/medium effects covered by that approval, but:

- high, external, destructive, private-data, and blocked effects still require
  `agenthost confirm <tokenId>`;
- paused, completed, cancelled, missing, or expired tasks do not get
  auto-chain;
- creating a new task clears active approval;
- completing or cancelling a task clears active approval;
- `agenthost stop`, `agenthost task stop`, MCP/CLI agent stop, and human
  takeover clear active approval.

## Audit logging

Every governed tool call is logged as JSONL under `~/.agenthost/logs/` with
`0700` directory and `0600` file permissions. Each entry includes:

- timestamp, session ID, tool, risk level, and strategy;
- server version and server entry path;
- preview and confirmation status;
- input summary, approval status, ok/failure, duration, and error code;
- output summary.

Audit summaries are redacted and bounded. Logs never contain passwords, API
keys, session/confirmation token values, cookies, private keys, full
sensitive files, screenshots, raw OCR/page text, or hidden environment values.
A local audit write failure is swallowed so a completed action is not repeated.

## Overlay safety

Overlay surfaces are visual only. They never invoke target-app tools or create
grants/tokens. Persistent cards must use public, non-sensitive summary content.
Automatic action cards use tool names, redacted input summaries, risk, elapsed
time, and error codes; they never display confirmation-token IDs. The action
card is click-through. Interactive card windows are reserved for
Pause/Resume/Stop; fullscreen pointer, highlight, and spotlight surfaces remain
click-through and never intercept clicks. Screenshots suppress and restore
overlays around capture. `agenthost overlay hide` writes `run/overlay.hide` and
sweeps orphaned renderers. Headless/Wayland fallback reports limitations
instead of claiming unsupported coordinates or visible success.

## Optional adapters

`packages/app-ssh` and `packages/app-blender` can be enabled in the adapter
registry (key authentication only for SSH). This minimal-v2 server does not
register an MCP tool factory for those adapters, so `ssh.run_command` and
`blender.run_python` do not appear in `tools/list`. Any future factory must use
the same central runner, metadata, preview/token, stop/takeover, and audit path.

## Removed product surfaces

Control Room, Browser Bridge, browser DOM tools, the runtime-activity service,
receipts/replay, checkpoints, Forge, workflow/scheduler tools, speech tools,
accessibility MCP tools, and `task.execute_plan` are not registered in the
current minimal-v2 tree. Sections in other documents that describe them are
historical.
