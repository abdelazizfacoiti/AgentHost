# AgentHost MCP Tools and Adapter Specification

All callable tools return `ToolResult`. MCP transport is stdio. The current
minimal-v2 server exposes 35 base tools. This number is generated from the
loaded set at startup; treat `system.list_capabilities` and
`agenthost://capabilities` as authoritative instead of hard-coding counts.

Every loaded definition carries explicit execution metadata. Missing,
contradictory, or duplicate declarations fail registration. MCP `tools/list`,
`system.list_capabilities`, and the capability resources are projected from
the same loaded set.

## Inventory

### Observation and discovery

| Tool | Risk | Execution |
|---|---|---|
| `system.get_info` | observe | read_only |
| `system.list_capabilities` | observe | read_only |
| `system.check_dependency` | low | diagnostic |
| `adapter.list` | observe | read_only |
| `adapter.get` | observe | read_only |
| `computer.observe_state` | observe | read_only |
| `computer.wait_for` | observe | read_only |
| `window.list` | low | read_only |
| `file.read` | low | read_only |
| `file.list` | low | read_only |
| `file.exists` | observe | read_only |
| `vision.analyze_image` | low | read_only |
| `vision.find_text` | low | read_only |
| `vision.find_target` | low | read_only |

### State-changing desktop and filesystem tools

| Tool | Risk | Execution |
|---|---|---|
| `desktop.screenshot` | medium | state_changing (routine) |
| `desktop.click` | medium | state_changing (routine) |
| `desktop.pointer` | medium | state_changing (routine) |
| `desktop.hotkey` | medium | state_changing (routine) |
| `desktop.type_text` | medium | state_changing (routine) |
| `window.focus` | medium | state_changing (routine) |
| `file.write` | medium | state_changing (routine) |
| `file.ensure_dir` | medium | state_changing (routine) |
| `file.copy` | medium | state_changing (routine) |
| `file.move` | medium | state_changing (routine) |
| `file.delete` | high | state_changing + exact confirmation |
| `shell.run` | high (classifier may lower) | state_changing; high effects confirm |

### Agent control and tasks

| Tool | Risk | Execution |
|---|---|---|
| `agent.status` | observe | read_only |
| `agent.stop` | medium | metadata_only |
| `agent.takeover_begin` | medium | metadata_only |
| `task.create` | low | metadata_only |
| `task.status` | observe | metadata_only |
| `task.list` | observe | metadata_only |
| `task.update` | low | metadata_only |
| `task.update_status` | low | metadata_only |
| `task.add_event` | low | metadata_only |

`task.create` starts a persistent task, accepts observable `definitionOfDone`
criteria (max 12), and clears any active task approval.
`task.update_status` supports `paused`, `active`, `completed`, and `cancelled`.
Completing a task that has criteria requires `verifiedCriteria` covering every
criterion; otherwise the call fails with `definition_of_done_unverified` and no
state changes. Verified criteria are logged as `verification` events.
Completed and cancelled tasks are terminal and clear active approval.

`agent.stop` and `agent.takeover_begin` are not gated by the flags they set.
There is intentionally no MCP tool to resume or clear a stop/takeover; those
are operator-only CLI actions. Agent/task control tools are metadata-only so a
model can organize work or request a stop without minting action tokens.

## Execution and confirmation model

For every tool call the central runner performs, in order:

1. Zod schema validation; invalid input returns `invalid_input` and never
   reaches the handler.
2. Stop/takeover gate for state-changing tools. A requested stop returns
   `emergency_stop_requested`; human takeover returns
   `human_takeover_active`. Read-only observation remains available.
3. Effect preview resolution: actual target path, target fingerprint, risk,
   policy approval, and blocked reason. Previews never execute the action.
4. `dryRun: true` returns the preview. If the effect needs confirmation, it
   also mints a single-use token. Routine local actions return no token.
   No action is executed.
5. A non-dry call executes directly when no confirmation is required.
   Consequential calls without a token return `confirmation_required` plus the
   CLI command to approve them. An active task approval can auto-chain only
   low/medium effects for an active task; it creates and consumes the exact
   token server-side. High, external, destructive, private-data, and blocked
   effects still require explicit per-action confirmation.
6. The token is consumed atomically. It is bound to tool, canonical arguments,
   and target fingerprint. Tokens are single-use, expire after 15 minutes, and
   are rejected if the tool, arguments, or target changed.
7. The handler runs with `confirmationSatisfied` set only for an accepted exact
   confirmation. Handlers revalidate safety and return a `ToolResult`.
8. The runner writes one redacted JSONL audit entry with tool, risk, approval
   status, preview/confirmation status, duration, error code, and server
   version/entry path provenance. Audit write failure does not turn a
   completed action into a second action.

Operator commands:

```bash
agenthost confirmations                 # list pending tokens
agenthost confirm <tokenId>            # approve one exact preview
agenthost deny <tokenId>               # reject one preview
agenthost task approve <taskId> [--max-risk low|medium]
agenthost task pause <taskId>
agenthost task resume <taskId>
agenthost agent status
agenthost agent pause [--reason text]
agenthost agent stop [--reason text]
agenthost agent takeover-begin [--reason text]
agenthost agent resume --stop|--takeover|--pause
```

`agenthost stop` kills an AgentHost-managed background process and writes the
stop flag. `agenthost agent pause` holds state-changing tools until
`agenthost agent resume --pause`. `agenthost agent stop` writes the run flag and
clears active task approval; it is the appropriate emergency stop when the MCP
process is owned by the client.

## Files and shell

Read-only: `file.read`, `file.list`, `file.exists`. Routine state-changing:
`file.write`, `file.ensure_dir`, `file.copy`, `file.move`. `file.delete`
requires an exact confirmation. `file.delete` is file-only; recursive
directory deletion is not exposed over MCP and a directory target returns
`directory_delete_unsupported`.

`shell.run` executes argv without an implicit shell. It never calls
`sudo`; control-plane paths, credential/browser-profile paths, wrapper
shells, inline interpreter code, metacharacters, destructive file commands,
and package/service changes are classified high or blocked. The handler
rejects attempts to override `PATH`, `HOME`, `LD_PRELOAD`, `LD_LIBRARY_PATH`,
`NODE_OPTIONS`, `PYTHONPATH`, `BASH_ENV`, or `ENV`.

AgentHost control-plane paths (`run/`, `logs/`, `setup/`, `tasks/approvals/`,
`config.json`, and the configured config/log paths) are protected:
reads are medium risk; writes and deletes are blocked. Shell commands that
touch those paths or invoke mutating `agenthost` commands are blocked.

## Desktop and vision

`desktop.click`, `desktop.pointer`, `desktop.hotkey`, and `desktop.type_text`
require an explicit active-window context and are validated again immediately
before execution. `desktop.type_text` routes ASCII letters/digits/space
through `xdotool type` and other text through clipboard paste; install
`xclip` or `xsel` for non-ASCII input. `window.focus` returns
`previousWindow` so focus can be restored.

`vision.analyze_image`, `vision.find_text`, and `vision.find_target` use local
Tesseract when available and return bounded, redacted suggestions. They never
click or type. `desktop.screenshot` writes under
`~/.agenthost/screenshots/` unless `outputDir` is supplied, so it follows the
routine direct-execution path; high-risk or consequential effects still use exact confirmation.

## MCP resources

The server exposes exactly three resources:

- `agenthost://capabilities` — live JSON inventory, families, and execution
  class counts.
- `agenthost://capabilities.md` — compact agent-facing brief generated from
  the same live inventory.
- `agenthost://status` — live stop/takeover/pause flags and the active task
  approval.

There is no `agenthost://skills` resource. Portable skill files are installed
on disk by `npm run skill:install`; they are not served over MCP.

For static config files (`AGENTS.md`, `CLAUDE.md`), paste
`agenthost capabilities --markdown`.

## Optional adapters

`packages/app-blender` and `packages/app-ssh` provide reviewed app/device
adapters. Enabling `optionalAdapters.blender.enabled` or
`optionalAdapters.ssh.enabled` registers adapter capabilities in
`system.list_capabilities`, but this minimal-v2 server does not currently
register a base MCP tool factory for `blender.run_python` or
`ssh.run_command`. They therefore do not appear in `tools/list` in this tree.
Any future tool factory must carry state-changing metadata and use the same
central runner, dry-run, confirmation, stop/takeover, and audit path.

## Removed product surfaces

Control Room, Browser Bridge, browser DOM tools, the runtime-activity service,
workflow/scheduler/Forge tool families, speech tools, accessibility tools,
and `task.execute_plan` are not registered in this minimal-v2 tree. Older
sections of documents that mention them are historical.

## Overlay lifecycle

Overlay is not exposed as MCP tools in minimal-v2. The server owns a
`VisualSurfaceCoordinator`; every state-changing MCP tool automatically opens
or updates one public, click-through action card before preview/handler work.
The card reports running, waiting-for-approval, preview-ready, done, failed, or
halted state in place. It never blocks tool execution when rendering fails and
honors `overlay.persistent` / `overlay.autoHideMs`. Local scripts use
`createOverlayRenderer`, `OverlayManager`, and `TaskProgressOverlay` from
`packages/app-overlay`.

Task progress cards are persistent by default and remain after terminal states
until dismissed, `agenthost overlay hide` is run, or the process exits.
Elapsed time freezes at terminal transition. Pause is cooperative at a step
boundary; Stop never kills an in-flight tool call. `agenthost overlay hide`
writes `run/overlay.hide` and sweeps orphaned renderers; `overlay status`
reports the registered renderer, marker, and live renderer count. Screenshot
capture temporarily removes and restores all overlay surfaces so AgentHost UI
is never embedded in a screenshot.
