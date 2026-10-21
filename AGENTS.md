# AgentHost — Codex Instructions

## Project mission

**AgentHost** is a universal local MCP server giving agents a safe, permissioned body on a real computer. It automates many apps/workflows — not one specific app. Blender is only an optional future demo adapter.

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

**P1 Safety Reconciliation + R6 Closure**. Implement only approved safety, metadata, parity, logging, and release-documentation work. Verify source and tests before claiming completion.

## Architecture rules

- **Core must be app-agnostic** — no app-specific imports in `packages/core`
- **Core must not import Linux-specific implementations**
- App-specific adapters are optional; Blender code lives only in `packages/app-blender/` or `packages/app-adapters/blender/`

## Package map

```
packages/
  core/              @agenthost/core — risk tiers, capability permissions, policies, types
  mcp-server/        @agenthost/mcp-server — MCP server, tools, server, resources
  agenthost-cli/     CLI tool (bin: agenthost-mcp)
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
| `npm run demo:overlay` | Static pointer/highlight/tooltip/card overlay tour |
| `npm run demo:task-progress` | Live progress card with Pause/Resume/Stop |
| `agenthost task watch <id> [--follow] [--notify]` | Tail redacted task progress; notify on done |
| `agenthost task export <id> [--format md\|html]` | Shareable redacted run report |
| `task.execute_plan` | Bounded tool sequence per task; dry-run each step for tokens first; fail-fast with replan hint |
| `AGENTHOST_EXECUTION_PLACEMENT=background` | Run browser/desktop work offscreen (isolated profile) |

**Test order**: `build → lint → test`. Run a single test file: `npx vitest run packages/core/src/__tests__/<file>.test.ts`. Tests live in `__tests__/` dirs inside each package's `src/`.

**Build is project-wide**: `tsc -b` reads `tsconfig.json` references. Build individual packages with `npx tsc -b packages/core`.

## Default profile

The default policy profile is **`general`** (not `strict`). It allows shell, files, GUI input, browser automation, screenshots. Gates communication/private-data/external/destructive as `approval_required`.

## Safety model

Every tool passes through: schema validation → risk classification → policy check → approval handling → execution → audit logging.

- Risk tiers: `LOW` / `MEDIUM` / `HIGH` / `CRITICAL`
- 11 capability families with trusted vs untrusted source boundaries
- `agenthost task approve <id> [--max-risk low|medium]` creates 30-min operator-only approval
- Stop enforcement via `stop-flag.ts`; `emergency_stop_requested`/`human_takeover_active` gates

## Logging

All tool calls logged as JSONL to `~/.agenthost/logs/`. Never log passwords, API keys, tokens, cookies, private keys, full sensitive files, or screenshots.

## Key files & paths

- `~/.agenthost/` — config (`config.json`), logs, screenshots, runtime data
- `~/.agenthost/logs/` — JSONL audit logs
- `~/.agenthost/screenshots/` — captured screenshots
- `~/.agenthost/outputs/` — task reports and generated artifacts

## Environment gotchas

- **AZERTY keyboard**: `desktop.type_text` auto-routes ASCII letters/digits/space through `xdotool type` and everything else through clipboard paste. Install `xclip` or `xsel` or non-ASCII typing reports `clipboard backend missing` instead of mistyping.
- **Second Firefox window**: `xdotool windowactivate` may fail with `BadWindow`. Use `xdotool search --name <pattern>` to find correct window ID.
- **Focus-safe desktop**: `window.focus` returns `previousWindow` (best effort) so agents can restore user focus; focus changes are reported, never silent.
- **Learning loop**: `strategy.record_episode` / `strategy.recall_episodes` feed redacted episodes (30-day TTL) that `strategy.select` scores; never store raw task content or secrets in lessons.
- **SSH device adapter**: second adapter, first remote device (`packages/app-ssh`, `ssh.run_command`, dry-run + token like Blender). Enable via `optionalAdapters.ssh.enabled`. Key auth only; blocked remote patterns stay blocked.
- **Task progress card**: `TaskProgressOverlay` (in `packages/app-overlay/src/task-progress.ts`) renders status, checklist, `Step n/m`, elapsed time, approval command, and Pause/Resume/Stop. Pause is cooperative at a step boundary; Stop never kills an in-flight tool call. Call `pollEvents()` to drain button events. Construct the renderer and manager with the **same sessionId**.
- **Overlay click-through**: small card windows are interactive; fullscreen surfaces are created only for pointer/arrow/highlight/spotlight primitives and must stay click-through. Do not reintroduce a fullscreen surface for ordinary cards.
- **Overlay updates**: use `manager.updateWidget()` for in-place changes. Do not `dismiss` + `show` on every tick; that causes flicker and resets controls.

## Testing quirks

- Tests live in `__tests__/` dirs inside each package's `src/`
- Tests use Vitest (no separate config file; defaults from `vitest`)
- `packages/app-overlay/src/__tests__/task-progress.test.ts` — progress card states, controls, auto-hide
- `packages/app-overlay/src/__tests__/linux-renderer.test.ts` — GTK IPC, fallback, restart, event drain
- `packages/core/src/__tests__/capability-manifest.test.ts` — capability manifest tests
- Integration tests may require an X11 display (`:0`).

## Development workflow

Before major changes:
1. inspect repo
2. read `README.md`, `DEMO.md`, and `docs/INDEX.md`; treat older milestone docs as historical
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
- `customize-opencode` skill — for opencode config changes only

## Important constraints from docs

- `overlay.assistance_target_refresh` validates ownership, kind, bounds, sensitivity, TTL; **two explicit refreshes maximum**
- Stale target or renderer epoch invalidates trust; requires explicit recovery
- Headless/Wayland fallback reports limitation instead of claiming unsupported coordinates
- Release scans reject credential-like material, token values, current-user absolute paths, screenshots/audio/logs, caches, runtime state, dangling dev symlinks, Python caches
- Uninstall preserves runtime data by default
- `agenthost overlay hide` kills orphaned GTK renderer processes
- Overlay renderer PID files and temporary demo scripts belong outside the repo; remove them after use

## Runtime

- MCP server entry: `packages/mcp-server/src/index.ts`
- Server entry: `packages/mcp-server/src/server.ts`
- Tool definitions in `packages/mcp-server/src/tools/`
