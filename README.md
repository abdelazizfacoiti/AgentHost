# AgentHost

[![ci](https://github.com/abdelazizfacoiti/AgentHost/actions/workflows/ci.yml/badge.svg)](https://github.com/abdelazizfacoiti/AgentHost/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![platform](https://img.shields.io/badge/platform-linux%20x86__64-lightgrey.svg)](docs/08_RELEASE_AND_OPERATIONS.md)
[![node](https://img.shields.io/badge/node-20%2B-green.svg)](docs/08_RELEASE_AND_OPERATIONS.md)

**Give any AI agent a safe, visible body on a real computer.** AgentHost is a
local, provider-agnostic computer-use runtime: the model reasons about a goal
and composes computer, filesystem, shell, vision/OCR, and desktop capabilities
to accomplish it — observing each result, verifying outcomes, and recovering
from failures. Every action passes through schema validation → risk
classification → policy check → preview/dry-run → confirmation → execution →
redacted audit logging. Unlike other computer-use tools, **you can see
what is happening**: an always-on current-task card shows the goal, current
phase, step checklist, elapsed time, and pause/resume/stop controls; approval
waits raise the card and send a desktop notification. Pointer primitives can
highlight a target without intercepting clicks.

## 60-second start (release archive)

```bash
sha256sum -c agenthost-v0.1.0-linux-x64.tar.gz.sha256
tar -xzf agenthost-v0.1.0-linux-x64.tar.gz
cd agenthost-v0.1.0-linux-x64
./bin/agenthost.mjs doctor
./bin/agenthost.mjs setup
./bin/agenthost.mjs integrations <client> add --apply
./bin/agenthost.mjs start
```

No `sudo`, no system services, no silent installs — AgentHost writes only its
own user directories. Register the MCP server for the client you use:

```bash
agenthost integrations <client> add --apply   # opencode, claude, codex, copilot, copilot-cli, cursor
```

Each command previews first. `--apply` writes one entry, preserves existing
servers, and backs up an existing config file. Reload the client so it spawns
`agenthost start`;
do not run `agenthost start` manually for a client session. Any other MCP
client can use the portable form:

```json
{
  "mcpServers": {
    "agenthost": { "command": "agenthost", "args": ["start"] }
  }
}
```

Works with Codex, Claude Code, Copilot (VS Code + CLI), OpenCode, Cursor, and
any MCP client. Agent clients: don't ingest every tool schema up front — pull
`agenthost://capabilities.md` first, or paste `agenthost capabilities --markdown`
into static configs. Contributors: [`git clone` path below](#source-checkout).

Teach the assistant *when* to reach for AgentHost with the portable skill. The
installer also registers the MCP server for the same clients:

```bash
npm run skill:install -- --target all          # skill + MCP config for opencode, Claude Code, Codex, Copilot (VS Code + CLI), Cursor
npm run skill:install -- --target copilot --project /path/to/repo
npm run skill:install -- --target all --no-mcp # skill text only
npm run skill:install -- --print               # paste into any other tool
```

The skill file lives at [`skills/agenthost/SKILL.md`](skills/agenthost/SKILL.md).

## Why AgentHost

| | AgentHost |
|---|---|
| **Safety model** | Risk tiers + capability grants + exact-preview, target-bound single-use tokens for consequential effects, with routine local actions direct + short-lived active-task approval for low/medium effects + a redacted audit entry on *every* call |
| **Visibility** | Automatic on-screen action card for every state change, plus an always-on active-task card with goal, step checklist, elapsed time, and pause/resume/stop controls; approval waits raise the card and send a desktop notification; pointer and highlight primitives pass clicks through |
| **Speed** | Inspect-once/act/verify task guidance, duplicate-call nudges, WindowId focus, 2s window-list cache, and cached PATH lookups |
| **Provider-agnostic** | Any model via MCP stdio; live capability resources keep system prompts small |
| **Private by construction** | Local stdio transport, redacted logs/traces/overlays, emergency stop independent of the model |
| **Verified** | Extensive Vitest suite, `build → lint → test` on every change, smoke-tested MCP handshake |

Browser work uses ordinary desktop automation — focus, hotkeys, typing,
screenshots, and OCR/vision — with no cookies, passwords, storage, or
arbitrary JavaScript. Sensitive pages remain policy-gated, and failures
surface honestly instead of pretending an action succeeded.

## Honest performance numbers

`npm run benchmark:desktop` on a live X11 workstation (non-destructive subset,
21 iterations, real backends):

| backend operation | median | p95 |
|---|---|---|
| active_window | 20.7 ms | 27.7 ms |
| window_list (cold) | 17.1 ms | 24.5 ms |
| window_list (warm cache) | 0.0 ms | 0.1 ms |
| focus by windowId (no listing) | 20.8 ms | 26.9 ms |
| screen geometry | 9.5 ms | 13.1 ms |
| screenshot | 278.4 ms | 305.8 ms |

No external benchmark claims — run it yourself and compare.

## How it compares

- **vs browser-only agents** (e.g. BrowserUse): AgentHost drives the whole
  desktop — any app, terminal, files, hotkeys — not just web pages. Browser
  work uses ordinary desktop automation instead of a bundled extension.
- **vs terminal coding agents** (e.g. OpenInterpreter, Cline): same local-first
  spirit, but AgentHost adds GUI grounding (click/type/focus with active-window
  verification), visual narration, and a uniform confirmation/audit pipeline
  across *all* tools instead of shell-only approvals.
- **vs cloud computer-use** (e.g. Claude/OpenAI operator-style products):
  AgentHost runs on your machine, under your policy, with your data never
  leaving the machine. No account, no per-action API meter.

## CLI

```text
agenthost doctor [--json]
agenthost setup [--resume]
agenthost start / stop / status
agenthost confirmations [list] / confirm <tokenId> / deny <tokenId>
agenthost agent status / pause / stop / takeover-begin / resume --stop|--takeover|--pause
agenthost task watch <id> [--follow] [--notify] [--overlay]
agenthost task export <id> [--format md|html] [--out <path>]
agenthost task approve <id> [--max-risk low|medium]
agenthost task pause <id> / task resume <id>
agenthost overlay hide [--orphans] / overlay status
agenthost integrations <client> add|status|remove [--project DIR] [--apply]
```

`start --background` is not supported: run `agenthost start` in the foreground
or let the MCP client spawn it. `task export` renders a run's redacted event
log to shareable Markdown or self-contained HTML — post your agent's runs in
issues and PRs. See [task reports](examples/task-reports/README.md).

## Source checkout

```bash
git clone https://github.com/abdelazizfacoiti/AgentHost.git
cd AgentHost
npm install
npm run build
npm run smoke:mcp
npm test && npm run lint && npm run benchmark:desktop
```

Isolated dev home so experiments never touch your install:

```bash
export AGENTHOST_HOME="$PWD/.agenthost"
export AGENTHOST_CONFIG="$PWD/.agenthost/config.json"
npm run start:mcp
```

## Safety boundary

- No public listeners, hidden persistence, or unsupported background process.
- No credential extraction, CAPTCHA/MFA/login/payment bypass, or sudo.
- No silent send/submit/upload/delete/pay/buy; no arbitrary generated code.
- No browser cookies, storage, or debugger access.
- No raw private content, tokens, or secrets in logs or overlays.
  Visual surfaces never control target applications.

Details: [Security, permissions, and logging](docs/04_SECURITY_PERMISSIONS_AND_LOGGING.md).

## Roadmap

- **P1 — less friction:** `doctor --fix` for missing system deps, clearer
  one-command setup, and a hosted docs site.
- **P2 — more humans:** macOS/Windows adapters (the `LinuxAutomation`
  interface is already the portability contract), `npx`/brew/Docker
  distribution, OSWorld-style eval harness, skill marketplace.
- If you want any of these, open an issue — P2 order follows demand.

## Documentation and contribution

- [Documentation index](docs/INDEX.md) · [Product spec](docs/01_PRODUCT_SPEC.md) · [Architecture](docs/02_SYSTEM_ARCHITECTURE.md) · [MCP tools](docs/03_MCP_TOOLS_AND_ADAPTERS.md) · [Security](docs/04_SECURITY_PERMISSIONS_AND_LOGGING.md) · [Release ops](docs/08_RELEASE_AND_OPERATIONS.md) · [Privacy](docs/11_PRIVACY_AND_SUPPORT.md)
- [Task reports](examples/task-reports/README.md) · [Contributing](CONTRIBUTING.md) · [Security reporting](SECURITY.md) · [Support](SUPPORT.md) · [Code of Conduct](CODE_OF_CONDUCT.md)

If AgentHost does something cool on your machine, star the repo and post the
`task export` — shared runs are how this gets better.

## License

Apache-2.0. See [LICENSE](LICENSE), [NOTICE](NOTICE),
[THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES). Host programs (GTK3, Tesseract,
eSpeak NG, Bubblewrap) stay separately licensed and are never bundled.
