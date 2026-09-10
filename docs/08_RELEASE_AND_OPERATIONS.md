# Linux Release Candidate and Operations (R5/R6)

R5 packages AgentHost's general-purpose computer-use capabilities for local Linux use. It expands automation capability intentionally (general file operations, shell execution boundary, website-agnostic browser work, observe-verify-recover loop, tasks, skills, agent controls) while safety policy is enforced by the runtime: isolation, secret redaction, audit logging, loopback binding, permission boundaries, dangerous-action approval, and an emergency stop independent of the model.

## Supported boundary

- Ubuntu/Debian-compatible Linux, x86_64 first.
- Node.js 20+ and Python 3 are host requirements.
- X11 is the verified visible-overlay path.
- Wayland reports limited or unavailable global-overlay features.
- Firefox and Chromium extensions are unsigned/manual unless externally published.
- Control Room remains disabled by default and loopback-only.
- Speech remains local and optional.

## Install

The supported public artifact is the GitHub source tree and Linux x86_64
archive/CLI. The root npm package remains private; no npm install package is
promised.

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

No root privileges, package installation, system service, or silent browser installation is used.

## CLI

```text
agenthost version
agenthost doctor [--json]
agenthost setup [--resume]
agenthost start [--background]
agenthost stop
agenthost status
agenthost task [list|status|pause|resume|stop]
agenthost capabilities
agenthost permissions
agenthost skills
agenthost sessions
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

## Browser quickstart

For a packaged install, run:

```bash
agenthost browser setup --browser firefox --apply
# or:
agenthost browser setup --browser chromium --apply
# or (Chromium only, no manual install or popup click):
agenthost browser setup --browser chromium --auto --apply --approve
```

Manual flow: load the printed unpacked extension directory in the browser,
choose **Pair with AgentHost** in the popup, approve the exact extension
identity, and wait for reconnect verification. `--auto` instead launches
Chromium with the extension pre-loaded under an AgentHost-owned profile; the
extension enrolls itself on startup and you approve the identity once. The
bridge is loopback-only and pairing is explicit. Source-checkout setup is
documented in `docs/06_BROWSER_SETUP_VALIDATION.md`.

## Setup and doctor

`agenthost setup` is local, resumable, idempotent, and optional-step aware. Its state records completed local checks separately from pending manual work. Browser installation and pairing, GTK/PyGObject setup, speech provider setup, and Control Room enablement remain explicit operator actions.

`agenthost doctor` checks runtime versions, config, permissions, MCP availability, browser artifacts/pairing, strategy registry, X11, actual GTK/PyGObject import support, Control Room, speech, storage, and stale process state. JSON output uses stable status fields and redacted path labels.

Supported environment overrides are `AGENTHOST_HOME`, `AGENTHOST_CONFIG`,
`AGENTHOST_PROFILE`, `AGENTHOST_LOG_FILE`, `AGENTHOST_OVERLAY_MODE`,
`AGENTHOST_RUNTIME_ACTIVITY_OVERLAY_ENABLED`,
`AGENTHOST_RUNTIME_ACTIVITY_OVERLAY_REDUCED_MOTION`,
`AGENTHOST_FORGE_RUNTIME_SANDBOX_MODE`, `AGENTHOST_BROWSER_BRIDGE_ENABLED`,
`AGENTHOST_BROWSER_BRIDGE_PORT`, `AGENTHOST_BROWSER_PAIRING_TOKEN_FILE`,
`AGENTHOST_BROWSER_PAIRING_STATE_FILE`, `AGENTHOST_CONTROL_ROOM_ENABLED`,
`AGENTHOST_CONTROL_ROOM_PORT`, and `AGENTHOST_CONTROL_ROOM_TOKEN_FILE`.
Values are schema-validated; environment overrides do not bypass grants,
confirmation, redaction, loopback binding, or scheduler non-execution.

## Lifecycle and recovery

Foreground MCP operation is default. `--background` uses a local PID/lock record with stale-lock detection and bounded shutdown. No daemon, cron, systemd, restart loop, or hidden persistence exists.

Updates require an operator-provided archive, checksum verification, preflight, backup, health check, and rollback on failure. Uninstall removes only AgentHost-owned installation files by default and leaves runtime data and system dependencies intact. Browser extension removal remains manual.

## Release contents and scanning

The archive contains compiled runtime, production dependencies, renderer assets, extension source/artifacts, version manifest, documentation, legal files, and per-file hashes. The release directory also contains archive `SHA256SUMS` sidecars. The project is Apache-2.0 licensed; `LICENSE`, `NOTICE`, and generated `THIRD_PARTY_NOTICES` are copied and verified. The artifact excludes runtime state, logs, screenshots, OCR/page text, audio, pairing/reconnect state, Control Room tokens, confirmations, credentials, caches, temporary files, development tests/maps, absolute checkout links, and dangling development symlinks.

Public repository governance files (`CODE_OF_CONDUCT.md`, `SECURITY.md`, and
`SUPPORT.md`) are copied into the archive. The root npm package remains
private; the supported public artifact is the Linux archive and CLI.

`release:scan` fails on credential-like material, token formats, current-user absolute paths, private media/log artifacts, oversized files, or unsafe release contents. `release:verify` validates manifest fingerprints.

## Security guarantees

Packaging does not alter AgentHost safety boundaries: no public bridge, no secret extraction, no CAPTCHA/MFA/login/payment bypass, no silent send/submit/upload/delete/pay/buy, no sudo, no arbitrary generated code, no scheduler execution, and no autonomous background operation. Consequence tiers (LOW/MEDIUM/HIGH/CRITICAL) gate actions by actual effect; `agenthost stop` and Control Room Stop halt state-changing tools via `run/stop.requested` even if the model does not cooperate; human takeover pauses agent action until the operator returns control and the agent re-observes. External content (pages, files, documents, tool results) is untrusted data, never instructions.
