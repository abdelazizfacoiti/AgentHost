# AgentHost

[![ci](https://github.com/abdelazizfacoiti/AgentHost/actions/workflows/ci.yml/badge.svg)](https://github.com/abdelazizfacoiti/AgentHost/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![platform](https://img.shields.io/badge/platform-linux%20x86__64-lightgrey.svg)](docs/08_RELEASE_AND_OPERATIONS.md)
[![node](https://img.shields.io/badge/node-20%2B-green.svg)](docs/08_RELEASE_AND_OPERATIONS.md)

**Give any AI agent a safe, visible body on a real computer.** AgentHost is a
local, provider-agnostic computer-use runtime: the model reasons about a goal
and composes computer, browser, filesystem, shell, application, vision/OCR,
speech, and skill capabilities to accomplish it — observing each result,
verifying outcomes, and recovering from failures. Every action passes through
schema validation → risk classification → policy check → approval handling →
execution → audit logging. And unlike other computer-use tools, **you can see
every step as it happens**: an on-screen widget narrates each action and every
click flashes a highlight ring at its target.

## It really works — Hespress run, unedited screenshots

Asked to *"check the local news on Hespress"*, the agent focused Firefox,
searched, clicked the first result, and verified the homepage:

![Google results for hespress](.github/assets/demo-search-results.png)

![Hespress homepage](.github/assets/demo-hespress-home.png)

While it worked, the operator saw this — no extra calls, no delay:

```text
Focusing window Firefox          ✓ completed
Sending hotkey ctrl+t            ✓ completed
Typing text 8 chars              ✓ completed
Sending hotkey Enter             ✓ completed
Clicking target (970, 130)       ✓ completed
Clicking target (530, 365)       ✓ completed
```

Full sequence with exact tool calls: [`examples/web-research/`](examples/web-research/).

## 60-second start (release archive)

```bash
sha256sum -c agenthost-v0.1.0-linux-x64.tar.gz.sha256
tar -xzf agenthost-v0.1.0-linux-x64.tar.gz
cd agenthost-v0.1.0-linux-x64
./bin/agenthost.mjs doctor
./bin/agenthost.mjs setup
./bin/agenthost.mjs integrations codex add --apply
./bin/agenthost.mjs start
```

No `sudo`, no system services, no silent installs — AgentHost writes only its
own user directories. Then point any MCP client at it:

```json
{
  "mcpServers": {
    "agenthost": { "command": "agenthost", "args": ["start"] }
  }
}
```

Works with Codex, Claude Code, Copilot, OpenCode, and any MCP client. Agent
clients: don't ingest all 250+ tool schemas up front — pull
`agenthost://capabilities.md` first, or paste `agenthost capabilities --markdown`
into static configs. Contributors: [`git clone` path below](#source-checkout).

## Why AgentHost

| | AgentHost |
|---|---|
| **Safety model** | Risk tiers (LOW→auto, MEDIUM→logged, HIGH→approval, CRITICAL→explicit) + capability grants + exact-target confirmations + audit receipts on *every* tool |
| **Visibility** | Working widget narrates each action (`Clicking target (520, 340)`); clicks flash a highlight ring; `task watch --follow` + Control Room live feed |
| **Speed** | WindowId focus skips re-listing; 2s window-list cache; cached PATH lookups (see numbers below) |
| **Provider-agnostic** | Any model via MCP stdio; lazy capability/skill resources keep system prompts small |
| **Private by construction** | Loopback-only listeners, redacted logs/traces/overlays, emergency stop independent of the model |
| **Verified** | 580+ tests, `build → lint → test`, CI on every push, smoke-tested MCP handshake |

Browser control without the Browser Bridge? Structured DOM/tab access over a
loopback bridge with explicit pairing — no cookies, passwords, storage, or
arbitrary JS. When the bridge is unavailable, AgentHost degrades honestly to
accessibility, OCR/vision, pointer fallback, or guide mode — never silently.

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
  work uses a paired extension bridge; everything else uses OS adapters.
- **vs terminal coding agents** (e.g. OpenInterpreter, Cline): same local-first
  spirit, but AgentHost adds GUI grounding (click/type/focus with active-window
  verification), visual narration, and a uniform confirmation/audit pipeline
  across *all* tools instead of shell-only approvals.
- **vs cloud computer-use** (e.g. Claude/OpenAI operator-style products):
  AgentHost runs on your machine, under your policy, with your data never
  leaving the loopback interface. No account, no per-action API meter.

## CLI

```text
agenthost doctor [--json]
agenthost setup [--resume]
agenthost start [--background] / stop / status
agenthost control-room
agenthost browser setup|status|reset
agenthost task watch <id> [--follow] [--notify]
agenthost task export <id> [--format md|html] [--out <path>]
agenthost task approve <id> [--max-risk low|medium]
```

`task export` renders a run's redacted event log to shareable Markdown or
self-contained HTML — post your agent's runs in issues and PRs.
[Sample report](examples/task-reports/sample-hespress-run.md).

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

## Browser Bridge pairing

```bash
agenthost browser setup --browser chromium --auto --apply --approve
# ..or Firefox (manual one-time load, then pair):
agenthost browser setup --browser firefox --apply
```

Load the printed unpacked extension directory, choose **Pair with AgentHost**,
approve the exact identity in the terminal, and wait for reconnect
verification. Full steps and recovery:
[Browser Setup Validation](docs/06_BROWSER_SETUP_VALIDATION.md).

## Safety boundary

- No public listeners, hidden persistence, or autonomous background work.
- No credential extraction, CAPTCHA/MFA/login/payment bypass, or sudo.
- No silent send/submit/upload/delete/pay/buy; no arbitrary generated code.
- No browser cookies/storage/debugger access; no scheduler execution.
- No raw private content, tokens, or secrets in logs, receipts, overlays, or
  Control Room. Visual surfaces never control target applications.

Details: [Security, permissions, and logging](docs/04_SECURITY_PERMISSIONS_AND_LOGGING.md).

## Roadmap

- **P1 — less friction:** one-command pairing everywhere, `doctor --fix` for
  missing system deps, Control Room first-run tour, hosted docs site.
- **P2 — more humans:** macOS/Windows adapters (the `LinuxAutomation`
  interface is already the portability contract), `npx`/brew/Docker
  distribution, OSWorld-style eval harness, skill marketplace.
- If you want any of these, open an issue — P2 order follows demand.

## Documentation and contribution

- [Documentation index](docs/INDEX.md) · [Product spec](docs/01_PRODUCT_SPEC.md) · [Architecture](docs/02_SYSTEM_ARCHITECTURE.md) · [MCP tools](docs/03_MCP_TOOLS_AND_ADAPTERS.md) · [Security](docs/04_SECURITY_PERMISSIONS_AND_LOGGING.md) · [Release ops](docs/08_RELEASE_AND_OPERATIONS.md) · [Privacy](docs/11_PRIVACY_AND_SUPPORT.md)
- [Examples](examples/web-research/) · [Contributing](CONTRIBUTING.md) · [Security reporting](SECURITY.md) · [Support](SUPPORT.md) · [Code of Conduct](CODE_OF_CONDUCT.md)

If AgentHost does something cool on your machine, star the repo and post the
`task export` — shared runs are how this gets better.

## License

Apache-2.0. See [LICENSE](LICENSE), [NOTICE](NOTICE),
[THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES). Host programs (GTK3, Tesseract,
eSpeak NG, Bubblewrap) stay separately licensed and are never bundled.
