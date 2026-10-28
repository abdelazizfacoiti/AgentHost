# AgentHost — Codex Instructions

## Project mission

**AgentHost** is a universal local MCP server giving agents a safe, permissioned body on a real computer. It automates many apps/workflows — not one specific app. Blender is only an optional future adapter.

```text
Codex / agent brain
  ↓ MCP tool calls
AgentHost MCP server
  ↓ safety + policy + approval
Universal automation layer
  ↓ OS adapters + optional app adapters
  ↓ any app / terminal / browser / file workflow
```

## Automation strategy order

For any task, prefer:
1. app-specific adapter → 2. official API/plugin → 3. CLI/script → 4. browser automation → 5. accessibility tree → 6. GUI screenshot/click/type → 7. guide mode

GUI clicking/typing is fallback only. Use guide mode for unsupported or sensitive apps.

## Current milestone

**P0 Trust & Truth**. Make advertised safety guarantees real (schema validation, previews/dry-run, single-use confirmation tokens, stop/takeover, audit/provenance), keep tool manifests/resources truthful, and verify source, tests, build, and smoke before claiming completion.

## Architecture rules

- **Core must be app-agnostic** — no app-specific imports in `packages/core`
- **Core must not import Linux-specific implementations**
- App-specific adapters are optional; Blender code lives only in `packages/app-blender/` or `packages/app-adapters/blender/`

## Package map

```
packages/
  core/              @agenthost/core — risk tiers, capability permissions, policies, types
  mcp-server/        @agenthost/mcp-server — MCP server, tools, server, resources
  agenthost-cli/     CLI tool (bin: agenthost)
  app-overlay/       GTK3 renderer + overlay manager + task progress card
  os-linux/          OS adapters (filesystem, desktop, dependencies, window mgmt)
  app-blender/       optional Blender adapter
```

## Key commands

| Command | What it does |
|---|---|
| `npm run build` | `tsc -b` — build all packages |
| `npm run lint` | `tsc -b --pretty false` |
| `npm run test` | `vitest run` — all packages |
| `npm start:mcp` | Run MCP server |
| `npm run smoke:mcp` | Smoke test |
| `npm run benchmark:agent` | Non-destructive runner/plan overhead benchmark in an isolated home |
| `npm run benchmark:desktop` | Non-destructive Linux desktop-backend latency benchmark |
| `agenthost integrations <client> add\|status\|remove [--apply]` | Register/preview/remove the MCP server for opencode, Claude, Codex, Copilot (VS Code + CLI), or Cursor |
| `npm run skill:install -- --target all` | Install portable `skills/agenthost` skill and register the MCP server (opencode/Claude/Codex/Copilot VS Code + CLI/Cursor); `--no-mcp` for skill text only |
| `agenthost task watch <id> [--follow] [--notify] [--overlay]` | Tail redacted task progress; `--overlay` shows a persistent card |
| `agenthost overlay hide [--orphans]` / `overlay status` | Cross-process hide marker + renderer diagnostics |
| `agenthost task export <id> [--format md\|html]` | Shareable redacted run report |
| `agenthost confirmations` / `confirm <tokenId>` / `deny <tokenId>` | Inspect and resolve exact-preview confirmation tokens |
| `agenthost task pause <id>` / `task resume <id>` | Task lifecycle transitions (not a stop-flag clear) |
| `agenthost agent status` / `pause` / `stop` / `takeover-begin` / `resume --stop\|--takeover\|--pause` | Runtime pause/stop/takeover flags; resume is operator-only |

**Test order**: `build → lint → test`. Run a single test file: `npx vitest run packages/core/src/__tests__/<file>.test.ts`. Tests live in `__tests__/` dirs inside each package's `src/`.

**Build is project-wide**: `tsc -b` reads `tsconfig.json` references. Build individual packages with `npx tsc -b packages/core`.

## Default policy

AgentHost has one autonomous runtime policy. There are no named profiles and no profile selector. Routine local actions — app launch, GUI click/type/hotkey, window focus, screenshots, shell, and file reads/writes — execute directly. Communication/private-data, external sends/uploads, destructive actions, and financial effects are `approval_required` and require an exact single-use confirmation. Credential/security apps, secret data, protected system paths, and the AgentHost control plane stay blocked. The current minimal-v2 tree does not register browser DOM tools.

## Safety model

Every tool passes through: schema validation → stop/takeover gate → effect preview → dry-run token or explicit confirmation → execution → redacted audit logging.

- Risk tiers: `observe` / `low` / `medium` / `high` / `blocked`
- Routine state-changing tools execute directly. Consequential actions — external/destructive effects, private-data reads, or high risk — require a dry-run preview and exact confirmation; metadata-only task/agent control is exempt.
- Dry-run for a consequential action mints a 15-minute single-use token bound to tool, canonical arguments, and target. `agenthost confirm <tokenId>` approves one exact preview; `deny` rejects it. Accepted confirmation sets `confirmationSatisfied` for the handler safety recheck.
- `agenthost task approve <id> [--max-risk low|medium]` creates a 30-min approval for an **active** task; the runner auto-chains only low/medium effects. High and consequential effects still need per-action tokens.
- `computer.run_steps` executes up to 20 named tool calls through the same runner. A confirmed plan token covers only low/medium effects inside that exact plan fingerprint; high-risk steps still require their own token, and nested plans are rejected.
- Stop/pause enforcement via `run/stop.requested`, `run/takeover.active`, and `run/pause.requested`; `emergency_stop_requested`/`human_takeover_active`/`pause_requested` gate only state-changing calls.
- The automatic action card exposes Pause/Resume/Stop and a close button; approval waits stay visible, raise above other windows, send a best-effort desktop notification, and the close button still works after the MCP server exits.
- AgentHost control-plane paths (`run/`, `logs/`, `setup/`, `tasks/approvals/`, config) are read-medium and write/delete-blocked.

## Logging

All tool calls logged as JSONL to `~/.agenthost/logs/`. Never log passwords, API keys, tokens, cookies, private keys, full sensitive files, or screenshots.

## Key files & paths

- `~/.agenthost/` — config (`config.json`), logs, screenshots, runtime data
- `~/.agenthost/logs/` — JSONL audit logs
- `~/.agenthost/screenshots/` — captured screenshots
- `~/.agenthost/outputs/` — task reports and generated artifacts
- `~/.agenthost/tasks/` — persistent task JSON
- `~/.agenthost/run/confirmations/` — pending/accepted single-use tokens
- `~/.agenthost/run/stop.requested`, `run/takeover.active` — operator gates

## Environment gotchas

- **AZERTY keyboard**: `desktop.type_text` auto-routes ASCII letters/digits/space through `xdotool type` and everything else through clipboard paste. Install `xclip` or `xsel` or non-ASCII typing reports `clipboard backend missing` instead of mistyping.
- **Second Firefox window**: `xdotool windowactivate` may fail with `BadWindow`. Use `xdotool search --name <pattern>` to find correct window ID.
- **Focus-safe desktop**: `window.focus` returns `previousWindow` (best effort) so agents can restore user focus; focus changes are reported, never silent.
- **Strategy learning**: core strategy/episode helpers exist, but `strategy.*` tools are not registered in the minimal-v2 MCP server. Never store raw task content or secrets in lessons.
- **Optional adapters**: `packages/app-ssh` and `packages/app-blender` can be enabled in the adapter registry, but this tree registers no MCP tool factory for `ssh.run_command` or `blender.run_python`; they do not appear in `tools/list`.
- **Automatic action card**: `overlay.mode` selects triggers (default `always`: computer-action families plus state-changing; `on_change`: state-changing plus confirmation fallback; `off`: none). Cards open before preview/handler work in `packages/mcp-server/src/action-overlay.ts`, show running/waiting/preview/done/failed/halted in place, honor persistence/auto-hide, wait at most 150ms for a routine first paint (1.5s while approval is pending), and never block execution on overlay failure. Startup prewarms the renderer and sweeps orphans.
- **Automatic current-task card**: `TaskActivityOverlay` (`packages/mcp-server/src/task-overlay.ts`) keeps one persistent public card for the active task, mirroring goal/phase/current action, definition-of-done checklist, running-task count, and Pause/Resume/Stop from `task.*`. Without an explicit task, `always` mode shows an implicit `Computer activity` card; a real task replaces it and an explicit dismissal sticks. It restores recent active/paused tasks on server start (24h freshness), keeps terminal cards until dismissed, and fails best-effort. `overlay.mode: "off"` skips it; `agenthost task watch <id> --overlay` remains optional.
- **Task progress card**: `TaskProgressOverlay` (in `packages/app-overlay/src/task-progress.ts`) renders status, checklist, `Step n/m`, elapsed time, approval command, and Pause/Resume/Stop. Pause requests the scoped global pause and shows Paused with Resume immediately; Stop never kills an in-flight tool call. Construct the renderer and manager with the **same sessionId**.
- **Overlay event routing**: multiple cards share one `OverlayManager`; call `pollEvents(overlayId)` so each card consumes only its own events. The manager buffers unmatched events for other cards. Pause reasons are scoped: action-card resume clears only `agent_action_card_pause`; task-card resume clears only `agent_task_overlay_pause:<taskId>`.
- **Renderer concurrency**: `LinuxOverlayRenderer` must treat a child with a passed handshake as started even while `runtimeState === "rendering"`. Event polling can overlap an in-flight update; restarting or killing the renderer in that window makes task cards disappear.
- **Overlay visibility status**: `run/activity.json` records the last action card's started/visible/error state; `agenthost overlay status`, `agenthost doctor`, and `agenthost://status.lastActivity` surface it so a silent fallback is visible.
- **Approval signaling**: a new `confirmation_required` result raises the action card via warning styling and sends one best-effort `notify-send` per 5s window. The notification names `agenthost confirmations`, never a token value.
- **Fast decisions**: `task.create` guidance tells the agent to inspect once, act, then verify; the runner nudges on the 3rd and 6th identical call.
- **Plans and traces**: `computer.run_steps` audits the wrapper plus every nested call; preview-only nested calls never mint tokens. Set `AGENTHOST_TRACE=1` for timestamped redacted phase traces under `~/.agenthost/logs/traces/`; trace failures never affect execution.
- **State-changing concurrency**: one MCP context serializes state-changing handlers through `execution-gate.ts`, allows read-only calls concurrently, and rechecks stop/takeover after queueing. `run_steps` nested calls are reentrant in the same async lane.
- **Screenshot options**: `desktop.screenshot` supports `format`, `quality`, `scale`, and `region`; native `scrot -a` avoids crop post-processing, and JPEG/crop/scale require `ffmpeg` or fail explicitly.
- **Screenshot suppression**: `desktop.screenshot` captures through `overlayScreenshotSuppression`; screenshot content must never include AgentHost cards. Direct `showWidget`/`updateWidget` calls are rejected while suppression is active, then surfaces are restored.
- **Overlay click-through**: the automatic action card is click-through; small interactive card windows are reserved for Pause/Resume/Stop controls. Fullscreen surfaces are created only for pointer/arrow/highlight/spotlight primitives and must stay click-through. Do not reintroduce a fullscreen surface for ordinary cards.
- **Overlay updates**: use `manager.updateWidget()` for in-place changes. Do not `dismiss` + `show` on every tick; that causes flicker and resets controls.

## Testing quirks

- Tests live in `__tests__/` dirs inside each package's `src/`
- Tests use Vitest (no separate config file; defaults from `vitest`)
- `packages/mcp-server/src/__tests__/action-overlay.test.ts` — automatic action card lifecycle, controls, persistence, auto-hide, and redaction
- `packages/mcp-server/src/__tests__/computer-tools.test.ts` — bounded condition waits and state snapshots
- `packages/mcp-server/src/__tests__/task-overlay.test.ts` — automatic current-task card, checklist updates, pause/stop, and dismissal
- `packages/app-overlay/src/__tests__/task-progress.test.ts` — progress card states, controls, event routing, persistence and hide-marker handling
- `packages/app-overlay/src/__tests__/linux-renderer.test.ts` — GTK IPC, fallback, restart, event drain
- `packages/core/src/__tests__/capability-manifest.test.ts` — capability manifest tests
- Integration tests may require an X11 display (`:0`).

## Development workflow

Before major changes:
1. inspect repo
2. read `README.md` and `docs/INDEX.md`; treat older milestone docs as historical
3. summarize current state
4. propose exact files to create/edit
5. implement only approved milestone

After implementation:
1. show changed files
2. explain how to run
3. explain how to test
4. run build/test/lint
5. summarize next phase

## Existing instruction files worth preserving

- `.agents/skills/cavecrew/` — subagent delegation guide (investigator/builder/reviewer)
- `.agents/skills/caveman/` — ultra-compressed communication mode
- `.agents/skills/caveman-commit/` — compressed commit message generator
- `.agents/skills/caveman-compress/` — compress memory files to caveman format
- `.agents/skills/caveman-help/` — quick-reference card
- `.agents/skills/caveman-review/` — compressed code review comments
- `.agents/skills/caveman-stats/` — token usage stats
- `skills/agenthost/SKILL.md` — portable laptop-control routing skill; installed by `scripts/install-agenthost-skill.mjs` (keep the `.agents/skills/agenthost/` copy in sync)
- `customize-opencode` skill — for opencode config changes only

## Important constraints from docs

- `overlay.assistance_target_refresh` validates ownership, kind, bounds, sensitivity, TTL; **two explicit refreshes maximum**
- Stale target or renderer epoch invalidates trust; requires explicit recovery
- Headless/Wayland fallback reports limitation instead of claiming unsupported coordinates
- Release scans reject credential-like material, token values, current-user absolute paths, screenshots/audio/logs, caches, runtime state, dangling dev symlinks, Python caches
- Uninstall preserves runtime data by default
- Progress cards persist after terminal states until explicit dismissal (Dismiss/Escape, `agenthost overlay hide`, emergency hide, or process exit); elapsed time freezes
- Persistent overlays must be `sensitivity: "public"`; legacy `overlay.terminalAutoHideMs` is accepted and ignored
- `agenthost overlay hide` writes `run/overlay.hide` (live managers poll it) and sweeps orphaned GTK renderers; `--orphans` only sweeps
- Overlay renderer PID files and temporary inspection scripts belong outside the repo; remove them after use

## Runtime

- MCP server entry: `packages/mcp-server/src/index.ts`
- Server entry: `packages/mcp-server/src/server.ts`
- Tool definitions in `packages/mcp-server/src/tools/`
