# Linux Release and Operations

AgentHost ships as a local Linux x86_64 archive with an `agenthost` CLI. The
root npm package remains private; no npm publication is promised. The runtime
is provider-agnostic and uses MCP over stdio.

## Supported boundary

- Ubuntu/Debian-compatible Linux, x86_64 first.
- Node.js 20+; Python 3 and GTK3/PyGObject are needed for the visible overlay.
- X11 is the verified visible-overlay path. Wayland reports limited or
  unavailable global-overlay features.
- The live MCP surface is the 35 tools and 3 resources documented in
  `docs/03_MCP_TOOLS_AND_ADAPTERS.md`.
- Optional adapters are not registered unless explicitly enabled; this tree
  registers no browser bridge, speech, scheduler, Forge, or Control Room
  surface.

## Install

The supported public artifact is the GitHub source tree and Linux x86_64
archive/CLI.

```bash
npm run build
npm run release:build
npm run release:scan
npm run release:verify
(cd release && sha256sum -c agenthost-v0.1.0-linux-x64.tar.gz.sha256)
npm run release:install -- release/agenthost-v0.1.0-linux-x64.tar.gz
```

When consuming a downloaded archive directly, verify its sidecar checksum,
extract it, and run `./bin/agenthost.mjs doctor` from the extracted directory.
The wrapper is self-contained and does not require `sudo`.

Install writes only AgentHost-owned locations:

```text
~/.local/share/agenthost/
~/.local/bin/agenthost
~/.config/agenthost/config.json
~/.agenthost/
```

No root privileges, package installation, system service, or hidden browser
installation is used.

## CLI

```text
agenthost version
agenthost doctor [--json]
agenthost setup [--resume]
agenthost start
agenthost stop
agenthost status
agenthost confirmations [list] / confirm <tokenId> / deny <tokenId>
agenthost agent status / pause / stop / takeover-begin / resume --stop|--takeover|--pause
agenthost task [list|status|pause|resume|stop|approve]
agenthost task watch <id> [--follow] [--notify] [--overlay]
agenthost task export <id> [--format md|html] [--out <path>]
agenthost capabilities
agenthost permissions
agenthost overlay hide [--orphans] / overlay status
agenthost integrations <client> add|status|remove [--apply] [--project DIR]
agenthost config validate|show
agenthost update --archive <archive> [--sha256 <64-hex-digest>] [--apply]
agenthost update --rollback
agenthost uninstall [--dry-run] [--remove-data]
```

`agenthost start` runs in the foreground. There is no daemon, cron, systemd
unit, restart loop, or hidden background execution. Output never contains
secrets, private file content, screenshots, OCR text, or raw private paths.

## MCP client integration

`agenthost integrations <client> add` previews one AgentHost entry; `--apply`
is the only write path. Existing servers and unrelated settings remain
untouched, and an existing file is backed up before changes. Supported clients:

| Client | Config |
|---|---|
| `opencode` | `~/.config/opencode/opencode.json[c]` under `mcp` |
| `claude` | `~/.claude.json` under `mcpServers` |
| `codex` | `~/.codex/config.toml` under `[mcp_servers.agenthost]` |
| `copilot` | `<project>/.vscode/mcp.json` under `servers` |
| `copilot-cli` | `~/.copilot/mcp-config.json` under `mcpServers` |
| `cursor` | `<project>/.cursor/mcp.json` under `mcpServers` |

The entry uses the installed `agenthost start`, never a repository path.
`--project DIR` selects the project for Copilot and Cursor. `XDG_CONFIG_HOME`,
`CODEX_HOME`, and `COPILOT_HOME` override the default user config roots.
Invalid JSON/TOML, ambiguous TOML, and unsupported layouts are rejected
without writing.
A JSONC write may normalize formatting and drop comments; the backup retains
the original text. After `--apply`, reload or restart the client so it spawns
AgentHost. Running `agenthost start` manually does not attach tools to a client
session; it is the stdio server the client owns.

`npm run skill:install -- --target all` installs the skill text and applies the
same MCP registration for all six targets. Use `--no-mcp` for skill text only.

## Setup and doctor

`agenthost setup` is local, resumable, idempotent, and optional-step aware.

`agenthost doctor` checks runtime versions, config, permissions, MCP
availability, X11, GTK/PyGObject import support, OCR availability, storage, and
stale process state. JSON output uses stable status fields and redacted path
labels.

Supported environment overrides are `AGENTHOST_HOME`, `AGENTHOST_CONFIG`, `AGENTHOST_LOG_FILE`, and
`AGENTHOST_OVERLAY_MODE`. The legacy `AGENTHOST_PROFILE` variable is ignored.
Values are schema-validated; environment overrides do not bypass grants,
confirmation, redaction, or stop/takeover gates.

## Lifecycle and recovery

MCP operation is foreground. `agenthost start` runs the server in the
foreground, and `agenthost stop` writes the runtime stop flag. No daemon, cron,
systemd unit, restart loop, or hidden persistence exists.

Updates require an operator-provided archive, checksum verification, preflight,
backup, health check, and rollback on failure. Uninstall removes only
AgentHost-owned installation files by default and leaves runtime data and
system dependencies intact.

## Release contents and scanning

The archive contains compiled runtime, production dependencies, renderer
assets, version manifest, documentation, legal files, and per-file hashes. The
release directory also contains archive `SHA256SUMS` sidecars. The project is
Apache-2.0 licensed; `LICENSE`, `NOTICE`, and generated
`THIRD_PARTY_NOTICES` are copied and verified. The artifact excludes runtime
state, logs, screenshots, OCR/page text, confirmations, credentials, caches,
temporary files, development tests/maps, absolute checkout links, and dangling
development symlinks.

Public repository governance files (`CODE_OF_CONDUCT.md`, `SECURITY.md`, and
`SUPPORT.md`) are copied into the archive. The root npm package remains
private; the supported public artifact is the Linux archive and CLI.

`release:scan` fails on credential-like material, token formats, current-user
absolute paths, private media/log artifacts, oversized files, or unsafe release
contents. `release:verify` validates manifest fingerprints.

## Security guarantees

Packaging does not alter AgentHost safety boundaries: no public bridge, no
secret extraction, no CAPTCHA/MFA/login/payment bypass, no silent
send/submit/upload/delete/pay/buy, no sudo, no arbitrary generated code, and no
autonomous background operation. Every MCP tool passes through schema
validation, stop/takeover gating, preview, execution, and redacted audit
logging. Routine local actions execute directly; consequential effects add an
exact preview and single-use confirmation token. `agenthost agent
stop` writes the runtime flag so state-changing calls halt even if the model
does not cooperate. Human takeover pauses agent action until the operator
resumes control.
