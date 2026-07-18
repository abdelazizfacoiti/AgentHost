# R6 Release Audit and Freeze Record

Status: `ready_with_manual_signoff` until desktop, browser, speech, Control Room, and external-distribution checks are recorded.

R6 adds no product capability. It audits and hardens R5 packaging, installation, lifecycle, privacy, security, and documentation.

## Verified automated baseline

- Linux x86_64 release target: `0.1.0`.
- `npm run build`: pass.
- `npm test`: pass; 87 suites, 492 tests (current tree).
- `npm run lint`: pass.
- `npm run smoke:mcp`: pass.
- Release build, scan, manifest verification, archive checksum, and deterministic rebuild: required gates.
- Installed archive CLI and MCP handshake: required outside-repository gate.

Archive build emits:

```text
release/agenthost-v0.1.0-linux-x64.tar.gz
release/agenthost-v0.1.0-linux-x64.tar.gz.sha256
release/SHA256SUMS
```

Record final archive SHA-256 from `release/agenthost-v0.1.0-linux-x64.tar.gz.sha256` after the last rebuild.

Archive installation requires the adjacent sidecar or explicit `--sha256`. Directory installation verifies `version.json` file hashes. Release scan rejects secrets, runtime state, private media, absolute checkout links, Python caches, and unsafe symlinks.

## Manual verification checklist

Run from a normal desktop terminal with disposable homes. Never modify real Codex configuration without explicit approval.

- [ ] Install archive in temporary `HOME`; run from `/tmp`.
- [ ] `agenthost version`, `doctor`, `setup`, `start`, `status`, `stop`.
- [ ] Installed MCP initialize/handshake, tool discovery, strategy discovery, harmless read-only call.
- [ ] Codex preview/apply/status/remove/rollback with isolated `CODEX_HOME`.
- [ ] Firefox temporary extension install, pair, browser restart, AgentHost restart, reset/revoke.
- [ ] Chromium unpacked install and equivalent reconnect/reset checks.
- [ ] Strategy selection with healthy, disconnected, incompatible, and unavailable bridge.
- [ ] eSpeak NG discovery, synthesis, playback, stop, cleanup, and governed transmission boundary.
- [ ] Visible GTK3/X11 overlay acknowledgement, suppression/restore, restart, epoch invalidation, Ctrl-C cleanup.
- [ ] Control Room loopback/auth/origin/GET-only/owner-isolation/shutdown checks.
- [ ] Update preview/apply, checksum mismatch, rollback, reinstall, uninstall preserve/remove-data paths.

## Support and limitations

| Area | Current boundary |
| --- | --- |
| Platform | Linux x86_64 release candidate; Node.js 20+, Python 3 required |
| Overlay | GTK3/X11 visible path; Wayland reports limited/unavailable support |
| Browser | Firefox temporary unsigned development install; Chromium unpacked development install; public signing/store publication external and pending |
| Speech | Local providers only; availability depends on host packages |
| Control Room | Disabled by default, loopback-only, authenticated, read-only |
| License | Apache-2.0 `LICENSE`, `NOTICE`, and generated `THIRD_PARTY_NOTICES` are required and included in release verification |

## Storage and privacy inventory

| Location | Content | Scope/retention |
| --- | --- | --- |
| `~/.agenthost/logs/` | Redacted JSONL audit records | Local user; bounded/retained by cleanup policy |
| `~/.agenthost/browser/` | Pairing hash and device metadata | Local user; reset/revocation removes active state |
| `~/.agenthost/speech/` | Opaque artifact/playback/preparation metadata and local audio | Local owner; TTL/cleanup applies |
| `~/.agenthost/runtime-activity/` | Bounded owner-scoped activity summaries | Local owner; bounded cleanup |
| `~/.agenthost/workflows/` | Redacted traces, skills, replay metadata | Local owner; no raw private content |
| `~/.agenthost/forge/` | Reviewed artifact/runtime metadata | Local owner; no generated source execution |
| `~/.agenthost/scheduler/` | Inert job, activation, preflight, acknowledgement, request metadata | Local governance only; no workers/timers |
| `~/.agenthost/overlays/` | Assistance/control-surface metadata | Owner-scoped; renderer IDs ephemeral |
| `~/.agenthost/control-room/` | Loopback access-token file | Mode `0600`; never projected |
| `~/.config/agenthost/` | Public config | User-owned; uninstall preserves unless explicitly removed |

Raw passwords, cookies, tokens, secrets, page/OCR text, screenshots, audio bytes, private messages, and confirmation values are not persisted in logs or projections.

## Freeze procedure

1. Complete automated gates and deterministic rebuild.
2. Complete every applicable manual checklist item.
3. Resolve or explicitly document environment-limited items.
4. Confirm clean Git status and `git diff --check`.
5. Commit one R6 release-hardening change set.
6. Create annotated `v0.1.0-rc2` only after mandatory R6 checks pass.
7. Create final `v0.1.0` only after manual desktop and external signing/publishing decisions are complete.

No tag is created automatically by R6 scripts.
