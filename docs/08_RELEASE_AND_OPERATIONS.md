# Linux Release Candidate and Operations (R5/R6)

R5 packages existing AgentHost capabilities for local Linux use. It adds no automation capability and does not change safety policy.

## Supported boundary

- Ubuntu/Debian-compatible Linux, x86_64 first.
- Node.js 20+ and Python 3 are host requirements.
- X11 is the verified visible-overlay path.
- Wayland reports limited or unavailable global-overlay features.
- Firefox and Chromium extensions are unsigned/manual unless externally published.
- Control Room remains disabled by default and loopback-only.
- Speech remains local and optional.

## Install

```bash
npm run build
npm run release:build
npm run release:scan
npm run release:verify
(cd release && sha256sum -c agenthost-v0.1.0-linux-x64.tar.gz.sha256)
npm run release:install -- release/agenthost-v0.1.0-linux-x64.tar.gz
```

Install writes only AgentHost-owned locations:

```text
~/.local/share/agenthost/
~/.local/bin/agenthost
~/.config/agenthost/config.json
~/.agenthost/
```

No root privileges, package installation, system service, or silent browser installation is used.

## CLI

```text
agenthost version
agenthost doctor [--json]
agenthost setup [--resume]
agenthost start [--background]
agenthost stop
agenthost status
agenthost control-room
agenthost browser setup|status|reset
agenthost overlay doctor
agenthost speech doctor
agenthost integrations codex add|status|remove [--preview|--apply]
agenthost config validate|show
agenthost update --archive <archive> [--sha256 <64-hex-digest>] [--apply]
agenthost update --rollback
agenthost uninstall [--dry-run] [--remove-data]
```

Output never contains pairing tokens, Control Room tokens, secrets, private page/file content, screenshots, audio, or raw private paths.

## Codex integration

`agenthost integrations codex add` previews one AgentHost entry. `--apply` is the only write path. Existing MCP servers and unrelated settings remain untouched; a backup is written before changes. The entry uses installed `agenthost start`, never a repository path. Unsupported or ambiguous TOML is rejected with manual instructions.

## Setup and doctor

`agenthost setup` is local, resumable, idempotent, and optional-step aware. Its state records completed local checks separately from pending manual work. Browser installation and pairing, GTK/PyGObject setup, speech provider setup, and Control Room enablement remain explicit operator actions.

`agenthost doctor` checks runtime versions, config, permissions, MCP availability, browser artifacts/pairing, strategy registry, X11, actual GTK/PyGObject import support, Control Room, speech, storage, and stale process state. JSON output uses stable status fields and redacted path labels.

## Lifecycle and recovery

Foreground MCP operation is default. `--background` uses a local PID/lock record with stale-lock detection and bounded shutdown. No daemon, cron, systemd, restart loop, or hidden persistence exists.

Updates require an operator-provided archive, checksum verification, preflight, backup, health check, and rollback on failure. Uninstall removes only AgentHost-owned installation files by default and leaves runtime data and system dependencies intact. Browser extension removal remains manual.

## Release contents and scanning

The archive contains compiled runtime, production dependencies, renderer assets, extension source/artifacts, version manifest, documentation, legal files, and per-file hashes. The release directory also contains archive `SHA256SUMS` sidecars. The project is Apache-2.0 licensed; `LICENSE`, `NOTICE`, and generated `THIRD_PARTY_NOTICES` are copied and verified. The artifact excludes runtime state, logs, screenshots, OCR/page text, audio, pairing/reconnect state, Control Room tokens, confirmations, credentials, caches, temporary files, development tests/maps, absolute checkout links, and dangling development symlinks.

`release:scan` fails on credential-like material, token formats, current-user absolute paths, private media/log artifacts, oversized files, or unsafe release contents. `release:verify` validates manifest fingerprints.

## Security guarantees

Packaging does not alter AgentHost safety boundaries: no public bridge, no secret extraction, no CAPTCHA/MFA/login/payment bypass, no silent send/submit/upload/delete/pay/buy, no sudo, no arbitrary generated code, no scheduler execution, and no autonomous background operation.
