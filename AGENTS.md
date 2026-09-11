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
  app-browser/       browser extension + background.js
  app-overlay/       GTK3 renderer + overlay manager
  app-control-room/  Control Room web UI
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
| `npm run browser:pair` | Pair browser bridge |
| `npm run control-room` | Start Control Room |
| `agenthost task watch <id> [--follow] [--notify]` | Tail redacted task progress; notify on done |
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

- `~/.agenthost/` — config (`config.json`), logs, screenshots, runtime data, control-room stores
- `~/.bridge/config.json` — browser bridge config (port `43117`)
- `~/.agenthost/logs/` — JSONL audit logs
- `~/.agenthost/screenshots/` — captured screenshots
- `~/.agenthost/control-room/` — activity.jsonl + screenshots.jsonl

## Environment gotchas

- **AZERTY keyboard**: `xdotool type` breaks for special chars (`:/#`). Use `xdotool key` or clipboard paste instead.
- **Draw.io**: Requires account/signup prompt that blocks automation. Use **Excalidraw** for quick drawing tasks.
- **Firefox bridge**: Paired but connection can be unstable. `--auto` works for Chromium, fails closed for Firefox.
- **Second Firefox window**: `xdotool windowactivate` may fail with `BadWindow`. Use `xdotool search --name <pattern>` to find correct window ID.
- **Control Room screenshot limit**: Default pagination limit is **50** (`limit()` in `control-room-store.ts` caps at `Math.min(100, Math.max(1, Math.floor(value)))`). Do not exceed 50 screenshots in a single query to avoid truncation errors.
- **Live progress without watching apps**: `GET /api/v1/activity?limit=20` (same pagination bounds) feeds the Control Room “Live background work” panel; `browser.background_status` reports placement + isolated headless profile args without launching anything.

## Browser extension

Extension auto-enrolls on Chromium startup with `--load-extension`. Firefox `--auto` fails closed. Prepare with `npm run browser:extension:prepare` or `npm run browser:setup`.

## Testing quirks

- ~94 files, ~540 tests across `__tests__/` dirs
- Tests use Vitest (no separate config file; defaults from `vitest`)
- `packages/mcp-server/src/__tests__/general-purpose-agent.test.ts` — 10-test suite for general-purpose agent flow
- `packages/core/src/__tests__/capability-manifest.test.ts` — new manifest tests
- `packages/mcp-server/src/__tests__/resources.test.ts` — resource discovery tests
- `packages/mcp-server/src/__tests__/guide-overlay-tools.test.ts` — guide overlay tests
- Integration tests may require browser bridge connection and X11 display (`:0`)

## Development workflow

Before major changes:
1. inspect repo
2. read docs (`docs/README.md`, `docs/01-04`, `06`, `08`)
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

## Bridge / runtime

- Bridge port: `43117` (from `~/.bridge/config.json`)
- Connection can be unstable; retry may be needed
- `agenthost browser setup` to re-pair
- MCP server entry: `packages/mcp-server/src/index.ts`
- Server entry: `packages/mcp-server/src/server.ts`
- Tool definitions in `packages/mcp-server/src/tools/`
