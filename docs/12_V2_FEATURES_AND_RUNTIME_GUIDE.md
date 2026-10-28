# AgentHost minimal-v2 — Features and Runtime Guide

> **Scope:** the live minimal-v2 tree, package version `0.1.0`. “v2” here means
> the current minimal-v2 architecture, not a published 2.x release. Historical
> documents mention removed or aspirational surfaces; this guide covers only
> what this tree actually registers and executes.
>
> The live MCP registry, `docs/03_MCP_TOOLS_AND_ADAPTERS.md`, and
> `docs/04_SECURITY_PERMISSIONS_AND_LOGGING.md` remain authoritative if this
> guide ever drifts from source.

## 1. What AgentHost is

AgentHost is a local, provider-agnostic MCP server that gives an AI agent
controlled access to a Linux workstation:

```text
MCP client / model
  -> stdio MCP server
  -> schema validation
  -> risk + policy + grants
  -> stop / takeover / pause gate
  -> effect preview and confirmation when required
  -> tool handler
  -> bounded ToolResult
  -> redacted audit log
```

It is not a browser extension, cloud service, daemon, or autonomous scheduler.
It is a foreground MCP runtime composed by the agent per task.

Primary design goals:

- Local-first and private by default.
- Provider-agnostic through MCP stdio.
- Observable behavior with on-screen cards.
- Exact confirmation for consequential actions.
- Honest failure reporting rather than false success.
- Operator control independent of the model.
- Application-agnostic core with optional adapters outside it.

## 2. Runtime architecture

```text
packages/
  core/          App-agnostic risk tiers, permissions, policies, types, stores
  mcp-server/    MCP server, tools, runner, resources, overlays, task state
  agenthost-cli/ Operator CLI
  app-overlay/   GTK3 renderer, overlay manager, task progress card
  os-linux/      Linux desktop, filesystem, shell, window, OCR backends
  app-blender/   Optional adapter; no live MCP tool factory in this tree
  app-ssh/       Optional device adapter; no live MCP tool factory in this tree
```

Architecture rules:

- `packages/core` stays application-agnostic.
- `packages/core` does not import Linux-specific implementations.
- Optional adapters live outside core and require explicit enablement.
- Every tool passes through one central execution runner.
- `tools/list`, `system.list_capabilities`, and capability resources are
  projected from the same loaded tool set.

The strategy order is advisory cost guidance, not a capability boundary:

```text
app adapter -> official API -> CLI/script -> browser automation
-> accessibility -> local OCR/vision -> GUI input -> guide mode
```

Browser DOM, accessibility MCP tools, and guide mode are not live surfaces in
this tree. Browser work uses ordinary desktop automation when policy allows.

## 3. Live surface

The current server exposes **36 base MCP tools** and **3 resources**.

Tool counts are generated from the loaded set at startup. The authoritative
source is always:

- MCP `tools/list`
- `system.list_capabilities`
- `agenthost://capabilities`
- `agenthost://capabilities.md`

### Tool inventory

| Family | Tools | Behavior |
|---|---|---|
| System | `system.get_info`, `system.list_capabilities`, `system.check_dependency` | Runtime/system information, live capability inventory, dependency availability |
| Adapters | `adapter.list`, `adapter.get` | Inspect registered optional adapters |
| Computer observation | `computer.observe_state`, `computer.wait_for` | Active window, screen geometry, capabilities, window list, bounded condition waits with state snapshots |
| Governed plans | `computer.run_steps` | Up to 20 nested governed calls with plan-scoped low/medium approval |
| Windows | `window.list`, `window.focus` | Enumerate windows; focus and verify by ID/app/title/PID |
| Desktop | `desktop.screenshot`, `desktop.click`, `desktop.pointer`, `desktop.hotkey`, `desktop.type_text` | Screenshot, click, pointer movement/scroll/drag, key chords, typing |
| Files | `file.read`, `file.list`, `file.exists`, `file.write`, `file.ensure_dir`, `file.copy`, `file.move`, `file.delete` | Bounded local file operations; file-only deletion |
| Shell | `shell.run` | Governed argv execution without an implicit shell |
| Vision | `vision.analyze_image`, `vision.find_text`, `vision.find_target` | Local OCR and image-relative target suggestions |
| Tasks | `task.create`, `task.status`, `task.list`, `task.update`, `task.update_status`, `task.add_event` | Persistent task state and definition-of-done tracking |
| Agent control | `agent.status`, `agent.stop`, `agent.takeover_begin` | Runtime flags and emergency controls |

### Execution classes

- `read_only`: observation and discovery.
- `diagnostic`: dependency checks.
- `metadata_only`: task and agent control records.
- `state_changing`: GUI, filesystem, shell, and window changes.

Missing or contradictory execution metadata fails server startup. Tool names
never infer execution class.

Every callable tool returns a `ToolResult`. Tool errors are recoverable data,
not terminal protocol failures. Successful and failed results can carry server
version and entry-path provenance from the live runtime.

## 4. Capability details

### Computer observation

`computer.observe_state` returns:

- Active window context.
- Screen geometry.
- Desktop backend and capability information.
- Optional visible-window list.

`computer.wait_for` polls active-window, any-window, and/or screen conditions
every ~150 ms until they match or the timeout expires. It returns a timestamped
state snapshot and short fingerprint on success or timeout, replacing fixed
sleeps with one bounded wait.

### Window control

`window.list` enumerates visible windows, optionally with titles. It uses a
short-lived cache to avoid repeated expensive enumeration.

`window.focus` supports window ID, app name, title, or PID. It:

- Returns the previous window when available.
- Verifies that focus actually changed.
- Falls back to `xdotool windowactivate --sync`.
- Fails with `focus_failed` if focus cannot be established.

### Desktop automation

All GUI input tools require explicit active-window context and validate it
immediately before execution.

| Tool | Capability |
|---|---|
| `desktop.click` | Left/middle/right click at absolute coordinates |
| `desktop.hotkey` | One or more key combinations |
| `desktop.type_text` | Up to 10,000 characters into the active window |
| `desktop.pointer` | Pointer movement, scrolling, and drag primitives |
| `desktop.screenshot` | Full-screen, active-window-only, or region PNG/JPEG capture with scale/quality |

Typing behavior:

- ASCII letters, digits, and spaces use `xdotool type`.
- Other text uses clipboard paste.
- Missing clipboard tooling produces an explicit failure instead of mistyped
  input.

Screenshot behavior:

- Creates output directories with mode `0700`.
- Removes stale output first.
- Rejects missing, empty, or zero-byte captures.
- Suppresses AgentHost overlays during capture and restores them afterward.
- Supports optional `region`, `scale`, `format: "jpeg"`, and `quality`; native
  `scrot -a` region capture avoids post-processing, while crop/scale/JPEG
  conversion requires `ffmpeg` and fails explicitly when unavailable.
- Returns image dimensions and capture options in `screenshotMetadata` when
  readable.

Desktop backends report unsupported or failed actions explicitly. A tool does
not report success unless the backend confirms that the action was performed.

### Vision and OCR

Vision tools operate on approved local images only:

- Default approved sources: AgentHost screenshots and outputs.
- Other paths require a matching grant.
- Maximum image size: 20 MB.
- Formats: PNG, JPEG, WebP, BMP, TIFF.
- Local Tesseract OCR only; no upload or cloud OCR.
- Credential/security windows are blocked.
- Communication-app images are treated as sensitive.

Capabilities:

- `vision.analyze_image`: bounded redacted OCR text boxes.
- `vision.find_text`: locate OCR text.
- `vision.find_target`: rank target suggestions with image-relative
  coordinates.

Vision never clicks or types. Repeated OCR on the same image reuses cached
results. Coordinates are image-relative and remain suggestions until validated
and acted on through a governed desktop tool.

### Filesystem

Read-only:

- `file.read`
- `file.list`
- `file.exists`

Routine state-changing:

- `file.write`
- `file.ensure_dir`
- `file.copy`
- `file.move`

Consequential:

- `file.delete` requires a single-use confirmation.
- Directory deletion is not exposed.
- A directory target returns `directory_delete_unsupported`.

Default write roots are `~` and `/tmp`; exact per-path decisions come from the
safety evaluator. AgentHost control-plane files are write/delete blocked.

### Shell

`shell.run` executes command + argv without an implicit shell.

Features:

- Timeout: 100 ms to 5 minutes.
- Bounded output.
- Filtered environment.
- Rejects overrides of `PATH`, `HOME`, `LD_PRELOAD`, `LD_LIBRARY_PATH`,
  `NODE_OPTIONS`, `PYTHONPATH`, `BASH_ENV`, and `ENV`.
- Classifies destructive commands, wrapper shells, inline interpreters,
  package/service changes, credential paths, and protected control-plane
  access.
- `sudo`, unsafe metacharacter patterns, and mutating AgentHost control
  commands are blocked.

High-risk shell effects require exact confirmation. Some lower-risk commands
may execute directly.

## 5. Safety and confirmation model

AgentHost has one autonomous runtime policy.

Risk levels are `observe`, `low`, `medium`, `high`, and `blocked`.

### Routine local actions

These execute directly:

- GUI click, type, hotkey, pointer.
- Window focus.
- Screenshots.
- Routine file writes, copies, moves, and directory creation.
- Classified-safe shell commands.

### Consequential actions

These require an exact preview and single-use confirmation token:

- Destructive actions.
- External sends/uploads.
- Private-data access.
- Financial or communication effects.
- High-risk effects.

### Blocked actions

These remain denied even with a valid token:

- Credential and security apps.
- Secret data.
- Protected system paths.
- AgentHost control-plane writes and deletes.
- Actions blocked by policy or grants.

### Dry-run envelope

A consequential tool accepts:

```json
{ "dryRun": true }
```

This returns:

- Resolved target.
- Target fingerprint.
- Risk level.
- Policy decision.
- Blocked reasons.
- A token when confirmation is required.

Nothing executes.

### Token properties

- Valid for 15 minutes.
- Single use.
- Stored under `~/.agenthost/run/confirmations/` with mode `0600`.
- Bound to:
  - tool name;
  - canonical arguments;
  - target fingerprint.
- `dryRun` and `confirmationToken` are excluded from the argument binding.
- Changed tool, arguments, or target causes a mismatch.
- Tokens are not session-bound because MCP clients may launch a fresh server
  process per call.
- The runner claims and consumes a token atomically before the handler runs.
- Handlers revalidate safety with `confirmationSatisfied` only after an
  accepted exact confirmation.

Operator commands:

```bash
agenthost confirmations
agenthost confirm <tokenId>
agenthost deny <tokenId>
```

### Active task approval

```bash
agenthost task approve <taskId> [--max-risk low|medium]
```

- Valid for 30 minutes.
- Only for an active task.
- Only covers low/medium effects.
- The runner creates and consumes the exact token server-side.
- High, destructive, external, private-data, and blocked effects still require
  per-action confirmation.
- Creating, completing, or cancelling a task clears approval.
- Stop and takeover clear approval.
- Paused, completed, cancelled, missing, or expired tasks do not get auto-chain.

### Plan approval

`computer.run_steps` accepts up to 20 named tool calls. Its own preview is bound
to the exact plan fingerprint, and a confirmed plan token covers only the
low/medium effects inside that exact plan:

- Every nested call still re-enters schema, policy, runtime gates, safety
  preview, audit, and execution metadata.
- High-risk steps still need their own per-step token.
- Preview-only nested calls never mint, consume, or log a token.
- Nested `computer.run_steps` calls are rejected.
- Stop/pause/takeover is rechecked after the state-changing execution lane is
  acquired.

### Grants

Persistent grants are validated and scoped by capability. A grant can restrict
or allow specific tools, action types, apps, sensitivities, file roots,
commands, and related bindings. It does not replace a confirmation token for a
high-risk, external, destructive, or private-data effect.

The default policy includes one communication-read grant allowing observation
and reads up to medium risk. Sends and external effects remain
confirmation-gated.

## 6. Tasks and definition of done

Tasks are persistent records under `~/.agenthost/tasks/`.

### Lifecycle

1. `task.create` with a goal and up to 12 observable `definitionOfDone`
   criteria.
2. `task.update` changes phase and current action.
3. `task.add_event` records:
   - `progress`
   - `observation`
   - `error`
   - `recovery`
   - `verification`
   - `note`
4. `task.update_status` supports:
   - `active`
   - `paused`
   - `completed`
   - `cancelled`

Completion with criteria requires `verifiedCriteria` to cover every criterion.
Otherwise:

- The task is not changed.
- `definition_of_done_unverified` is returned.
- Missing criteria are listed.

Verified criteria become `verification` events.

Completed and cancelled tasks are terminal and clear active task approval.

### Anti-loop behavior

The runner tracks identical calls for non-control tools. It adds guidance on the
3rd and 6th identical call to force verification, a strategy change, or
reporting the blocker.

## 7. Agent control and operator authority

### MCP tools

- `agent.status`: stop, takeover, pause, active task approval, server
  provenance.
- `agent.stop`: writes the emergency-stop flag and clears active task approval.
- `agent.takeover_begin`: marks human takeover and clears active task approval.

Neither stop nor takeover is gated by the flag it sets, so the agent can request
them safely.

There is intentionally **no MCP tool to resume**. Only the operator can clear
stop, takeover, or pause from the CLI.

### Enforcement

The runner checks:

- `run/stop.requested`
- `run/takeover.active`
- `run/pause.requested`

These gates apply to state-changing tools only. Observation remains available.

### CLI controls

```bash
agenthost agent status
agenthost agent pause [--reason text]
agenthost agent stop [--reason text]
agenthost agent takeover-begin [--reason text]
agenthost agent resume --stop
agenthost agent resume --takeover
agenthost agent resume --pause
```

Flags can be combined when clearing multiple gates.

## 8. Overlay and visual behavior

The overlay is not exposed as MCP tools. The server owns it internally.

### Modes

| Mode | Behavior |
|---|---|
| `always` | Cards for computer-action families and state-changing tools; implicit activity card |
| `on_change` | Cards only for state-changing actions plus confirmation fallback |
| `off` | No automatic action or task cards; explicit `task watch --overlay` still works |

Computer-action families:

- `computer.*`
- `desktop.*`
- `window.*`
- `vision.*`
- `file.*`
- `shell.*`
- optional `browser.*`, `blender.*`, `ssh.*`

### Action card

- Opens before preview/handler work.
- Shows running, waiting, preview-ready, done, failed, or halted state.
- Click-through except small control windows.
- Waits at most 150 ms for first paint in routine work, or 1.5 seconds on
  approval waits, then continues in the background.
- Holds a fast visible card for at least 400 ms; the handler already finished.
- Never blocks execution if rendering fails.
- Reports `overlay: "unavailable:<reason>"` and sends one rate-limited
  best-effort desktop notification when the card cannot render.
- Raises on approval waits and sends one best-effort desktop notification.
- Never displays confirmation-token values.
- Honors `overlay.persistent` and `overlay.autoHideMs`.

### Current-task card

Shows:

- Goal.
- Phase/current action.
- Definition-of-done checklist.
- Running-task count.
- Elapsed time.
- Pause/Resume/Stop.
- Latest error/recovery summary.

Behavior:

- Restores the most recent active/paused task on startup within 24 hours.
- Without a real task, `always` mode shows an implicit “Computer activity” card.
- Creating a task replaces the implicit card.
- Dismissal sticks for that card.
- Terminal cards remain until dismissed.
- Elapsed time freezes at terminal state.
- Pause requests a task-scoped global pause.
- Stop does not kill an in-flight tool call.
- `overlay.mode: "off"` skips automatic task and activity cards.

### Diagnostics and cleanup

`run/activity.json` records the last action card:

- Started state.
- Visible state.
- Timeout state.
- Error.

Surfaced by:

- `agenthost overlay status` (including effective overlay/renderer mode)
- `agenthost doctor`
- `agenthost://status.lastActivity`

`agenthost overlay hide` writes a timestamped cross-process hide marker that
only already-running managers honor, and can sweep orphaned GTK renderers.
`agenthost overlay hide --orphans` only sweeps.

The renderer prewarms with the server unless overlay mode is `off`; startup and
shutdown also sweep orphaned renderers. On X11,
transparent, topmost, click-through surfaces are used when the compositor
supports them. Wayland, headless, or unavailable renderers report limitations
instead of claiming visible success.

## 9. MCP resources

Exactly three resources:

| Resource | Purpose |
|---|---|
| `agenthost://capabilities` | Live JSON inventory, execution classes, families |
| `agenthost://capabilities.md` | Compact agent-facing capability brief |
| `agenthost://status` | Stop/takeover/pause, active task approval, last activity overlay state |

There is no skills resource. The portable skill is installed on disk.

For static agent configs, prefer `agenthost://capabilities.md` or
`agenthost capabilities --markdown` instead of ingesting every tool schema on
every turn.

## 10. CLI features

### Setup and diagnostics

```bash
agenthost version
agenthost doctor [--json]
agenthost setup [--resume]
agenthost config show
agenthost config validate
```

`doctor` checks platform, architecture, Node, Python, X11, GTK/PyGObject, MCP
entry, MCP handshake, client config, storage, process state, and last activity.

`setup` is local, resumable, and does not install system dependencies
automatically.

### Runtime lifecycle

```bash
agenthost start
agenthost stop
agenthost status
agenthost sessions
```

`start` runs in the foreground. `start --background` is rejected. There is no
daemon, systemd unit, cron job, or restart loop.

`stop` writes the stop flag and terminates an AgentHost-managed background
process if one exists.

### Tasks

```bash
agenthost task list
agenthost task status <id>
agenthost task pause <id>
agenthost task resume <id>
agenthost task stop
agenthost task approve <id> [--max-risk low|medium]
agenthost task watch <id> [--follow] [--notify] [--overlay]
agenthost task export <id> [--format md|html] [--out <path>]
```

`task watch` tails redacted events. `task export` creates a shareable redacted
report.

### Discovery and permissions

```bash
agenthost capabilities
agenthost capabilities --markdown
agenthost permissions
```

### Overlay

```bash
agenthost overlay status
agenthost overlay hide
agenthost overlay hide --orphans
```

### Integrations

```bash
agenthost integrations status
agenthost integrations <client> add [--apply]
agenthost integrations <client> remove [--apply]
```

Supported clients:

- `opencode`
- `claude`
- `codex`
- `copilot`
- `copilot-cli`
- `cursor`

Preview is the default. `--apply` writes one entry, preserves unrelated config,
and backs up existing files. Reload or restart the client afterward so it
spawns AgentHost.

### Update and uninstall

```bash
agenthost update --archive <archive> [--sha256 <digest>] [--apply]
agenthost update --rollback [--apply]
agenthost uninstall [--dry-run] [--yes] [--remove-data]
```

Updates require checksum verification, preflight, backup, atomic switch, and
rollback support. Uninstall preserves runtime data by default.

## 11. MCP client integration and portable skill

Any MCP client can use:

```json
{
  "mcpServers": {
    "agenthost": { "command": "agenthost", "args": ["start"] }
  }
}
```

Known integration config locations:

| Client | Config |
|---|---|
| `opencode` | `~/.config/opencode/opencode.json[c]` under `mcp` |
| `claude` | `~/.claude.json` under `mcpServers` |
| `codex` | `~/.codex/config.toml` under `[mcp_servers.agenthost]` |
| `copilot` | `<project>/.vscode/mcp.json` under `servers` |
| `copilot-cli` | `~/.copilot/mcp-config.json` under `mcpServers` |
| `cursor` | `<project>/.cursor/mcp.json` under `mcpServers` |

`XDG_CONFIG_HOME`, `CODEX_HOME`, and `COPILOT_HOME` override default config
roots. Invalid JSON/TOML, ambiguous TOML, and unsupported layouts are rejected
without writing.

Portable skill installation:

```bash
npm run skill:install -- --target all
npm run skill:install -- --target all --no-mcp
npm run skill:install -- --print
```

The skill teaches an assistant when to route laptop-control work through
AgentHost. `--no-mcp` installs skill text only.

## 12. Configuration

AgentHost loads one strict JSON config with `schemaVersion: 1`.

Main fields:

| Field | Purpose |
|---|---|
| `agentHostDir` | Runtime data directory |
| `logFile` | Audit log path |
| `overlay` | Renderer mode, activity mode, theme, density, persistence, placement, width, monitor policy |
| `grants` | Capability-scoped allow/deny/guide-only rules |
| `optionalAdapters` | Explicit enablement map for optional adapters |

Overlay fields include:

- `rendererMode`
- `mode`
- `theme`
- `density`
- `reducedMotion`
- `persistent`
- `autoHideMs`
- `preferredPosition`
- `maxWidth`
- `multiMonitor`

Renderer modes include `auto`, `gtk3-native` (`gtk3-x11` alias), `headless`, and
`disabled`. `webkit-gtk-react` is diagnostic-only. Wayland and missing GTK3
dependencies report limited or unavailable visibility rather than claiming
visible success.

Documented environment overrides:

- `AGENTHOST_HOME`
- `AGENTHOST_CONFIG`
- `AGENTHOST_LOG_FILE`
- `AGENTHOST_OVERLAY_MODE`

`AGENTHOST_PROFILE` is ignored. Legacy settings may be accepted for
configuration compatibility, but they do not register removed tools. Removed
top-level config keys such as `runtimeActivityOverlay`, `browserBridge`,
`controlRoom`, and `profile` are stripped before strict validation.

## 13. Data, privacy, and logging

### Runtime data

```text
~/.agenthost/
  logs/
  screenshots/
  outputs/
  tasks/
  run/
    confirmations/
    stop.requested
    takeover.active
    pause.requested
    activity.json
    overlay.hide
```

Installed public config lives under `~/.config/agenthost/`. Installation files
live under `~/.local/share/agenthost/` with the launcher at
`~/.local/bin/agenthost`.

### Audit logging

Every governed tool call writes one JSONL entry with:

- Timestamp, session, tool, risk.
- Execution strategy.
- Server version and entry path.
- Preview/confirmation status.
- Redacted input summary.
- Approval status, success/failure, duration, error code.
- Numeric `timings` for action-card wait, safety gate, preview, handler, audit
  preparation, and total.
- Bounded output summary.

Logs never include:

- Passwords, API keys, cookies, private keys.
- Confirmation-token values.
- Full sensitive files.
- Screenshots.
- Raw OCR or page text.
- Hidden environment values.

A failed audit write does not repeat a completed action.

### Local-only boundary

- MCP over stdio.
- No public listener.
- No telemetry upload.
- No cloud OCR.
- No browser cookies, storage, or debugger access.
- No credential extraction.
- No CAPTCHA, MFA, login, payment, or security bypass.
- No generated code execution in this tree.

## 14. Packaging and release

AgentHost ships as a Linux x86_64 archive with a rootless CLI:

```text
~/.local/share/agenthost/
~/.local/bin/agenthost
~/.config/agenthost/config.json
~/.agenthost/
```

No sudo, system service, package installation, or hidden browser installation.

Release workflow:

```bash
npm run build
npm run release:build
npm run release:scan
npm run release:verify
npm run release:install -- release/agenthost-v0.1.0-linux-x64.tar.gz
```

The archive contains compiled runtime, production dependencies, renderer
assets, version manifest, documentation, legal files, and per-file hashes.
Release scans reject credential-like material, current-user absolute paths,
runtime state, logs, screenshots, caches, temporary files, and unsafe release
contents.

No npm publication is promised; the supported public artifact is the Linux
archive and CLI. The project is Apache-2.0 licensed. Host programs such as
GTK3, Tesseract, eSpeak NG, and Bubblewrap remain separately licensed and are
never bundled.

## 15. Reliability and performance behavior

Current v2 safeguards include:

- Capability probing cached for 30 seconds.
- Cache bypass when a custom accessibility probe is supplied.
- Window list caching.
- OCR result caching per image.
- `computer.wait_for` instead of fixed sleeps, with state snapshots/fingerprints.
- `computer.run_steps` for bounded multi-step plans without a model round trip
  between each step; every nested call still re-enters the governed runner.
- Plan-scoped confirmation for low/medium effects; high-risk steps still need
  their own token.
- State-changing execution is serialized per MCP session; read-only calls may
  run concurrently and stop/takeover is rechecked after queueing.
- Optional `AGENTHOST_TRACE=1` writes redacted timestamped phase traces under
  `~/.agenthost/logs/traces/<session>.jsonl`.
- Active-window verification before GUI input.
- Focus verification and fallback.
- Screenshot directory creation, stale-file removal, and zero-byte rejection.
- Explicit `type_failed`, `hotkey_failed`, `click_failed`, `pointer_failed`,
  `screenshot_failed`, and `focus_failed` errors.
- Overlay prewarming with non-blocking execution.
- Redacted duplicate-call nudges at the 3rd and 6th repeated call.

## 16. Host requirements and limits

### Supported boundary

- Linux x86_64 first.
- Node.js 20+.
- X11 is the verified visible-overlay path.
- Python 3 and GTK3/PyGObject are needed for the visible overlay.
- Tesseract is required for OCR/vision.
- `xdotool` is needed for desktop input and window control.
- `xclip` or `xsel` is required for non-ASCII typing.
- Wayland reports limited or unavailable global-overlay features.

### What is not live in this tree

Do not treat these as available features:

- Browser DOM or Browser Bridge tools.
- Accessibility MCP tools.
- Speech tools.
- Forge runtime tools.
- Workflow, scheduler, replay, receipt, or checkpoint tools.
- Control Room.
- Runtime-activity MCP service.
- `task.execute_plan`.
- Generated MCP tools.
- Browser cookie, storage, or debugger automation.
- Background daemon or autonomous scheduling.
- Recursive directory deletion.
- MCP-side resume/clear of stop, takeover, or pause.
- Live `blender.run_python` or `ssh.run_command` MCP tools, even if adapters are
  enabled.

Optional adapters can appear in adapter discovery and capability metadata, but
this tree registers no base MCP tool factory for their execution tools.
Enabling them does not add `blender.run_python` or `ssh.run_command` to
`tools/list`.

## 17. Typical agent operating loop

```text
1. Read agenthost://capabilities.md
2. Create a task with observable completion criteria
3. Observe state with computer.observe_state
4. Inspect files, apps, windows, and OCR as needed
5. Act with the safest applicable tool
6. Observe and verify the result
7. Record progress, errors, and recovery events
8. Complete the task only after every criterion is verified
```

For consequential work:

```text
dryRun:true -> inspect exact preview -> operator confirm -> retry with token
```

For long or uncertain work:

```text
task.create -> task.update -> task.add_event -> task.update_status
```

## 18. Validation snapshot

At the time of writing, the tree passes:

- `npm run build`
- `npm run lint`
- `npm test` — 58 files, 353 tests
- `npm run smoke:mcp` — 36 tools, 3 resources
- `npm run benchmark:agent` — isolated, non-destructive runner overhead benchmark
- `git diff --check`

Real X11 screenshot capture was also verified with `scrot` at 386,291 bytes.
Counts are transient; use the live capability resources for authoritative
inventory.
