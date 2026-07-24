# Browser Setup and Pairing Validation

## Scope

This runbook validates the current browser setup and pairing path. It does not expand browser capabilities. Use a user-controlled public/test page only; provider names are examples, never required test targets.

## Fast path: installed CLI

Choose one supported browser and run the explicit setup flow:

```bash
agenthost browser setup --browser firefox --apply
# or:
agenthost browser setup --browser chromium --apply
```

The CLI prepares the unpacked artifact, enables the loopback bridge, waits for
browser-side enrollment, asks for explicit extension-identity approval, and
verifies reconnect before returning `state: ready`.

## Source checkout setup

```bash
npm run browser:setup
```

For isolated development, use the same environment for setup and MCP:

```bash
export AGENTHOST_HOME="$PWD/.agenthost"
export AGENTHOST_CONFIG="$PWD/.agenthost/config.json"
export AGENTHOST_BROWSER_EXTENSION_DIR="$PWD/.agenthost/browser-extension"
npm run browser:setup
npm run start:mcp
```

The command explicitly
prepares development-only unpacked Firefox/Chromium bundles and enables local
bridge config. It does not install an extension or create pairing credentials
silently.

Load the printed bundle, then use browser-side enrollment:

- Firefox development: `about:debugging#/runtime/this-firefox`, **Load Temporary Add-on…**, select the prepared `firefox/manifest.json` path printed by setup.
- Chromium: `chrome://extensions`, enable Developer mode, **Load unpacked**, select the prepared `chromium` directory printed by setup.

Open the extension popup, keep the configured port (default `43117`), choose
**Pair with AgentHost**, and approve the exact extension identity in AgentHost.
Then call `browser.verify_pairing`. Browser stores a device reconnect secret;
AgentHost stores only its hash.

One-time token pairing through `browser.generate_pairing_token` remains a
legacy repair path for an explicitly approved reset or older extension. It is
not required for a fresh setup and must never be pasted into chat or logs.

Public signed/store artifacts are not yet available; current public setup uses
the unpacked development path described in
[`docs/07_BROWSER_EXTENSION_RELEASE.md`](07_BROWSER_EXTENSION_RELEASE.md).

## Setup-state checklist

| State | Expected result | Recovery |
|---|---|---|
| `bridge_disabled` | `browser.setup_status` reports disabled; no listener. | Run `npm run browser:setup`; restart MCP server. |
| `bridge_unavailable` | Config enabled, listener unavailable. | Restart AgentHost MCP server; verify configured port is free. |
| `extension_not_seen` | Bridge running, no extension request. | Prepare bundle, load extension, check popup port. |
| `unpaired` | Extension seen without active session. Existing device may reconnect automatically. | Select Retry; use browser-side enrollment or legacy token repair only when needed. |
| `token_invalid` | Legacy token repair rejected; no session. | Generate a fresh repair token and use it once. |
| `token_expired` | Legacy one-time repair token expired. | Generate a fresh repair token, or use browser-side enrollment. |
| `pairing_revoked` | Stored browser device no longer matches active AgentHost pairing state. | Generate fresh token and enroll again. |
| `version_mismatch` | Extension/protocol version outside supported range. | Upgrade AgentHost or extension. |
| `device_state_corrupt` | Persistent pairing ledger failed strict validation. | Reset pairing, then enroll again. |
| `paired` | `browser.verify_pairing` returns `verified: true`. | Continue browser DOM tools. |
| `manifest_missing` | Extension package validation found no valid prepared manifest. This is setup/package state, not a bridge listener state. | Run `npm run browser:extension:firefox` or `browser:extension:chromium`. |

`browser.diagnose_bridge` returns safe bridge state and next steps. It never
returns a raw token, page content, or private URLs. A normal setup is repaired
by opening the popup and selecting **Retry** or **Pair with AgentHost**. A
legacy token mismatch is repaired by generating a fresh token and using it once;
running a token file is never required.

## Manual smoke

1. Fresh setup: run CLI or source setup, load extension, choose **Pair with AgentHost**, approve the identity, and verify pairing.
2. Inspect: call `browser.list_tabs`, then `browser.get_active_tab`; expect sanitized metadata only.
3. Discovery: on safe user-controlled public/test page, call `browser.find_element`; expect bounded metadata and opaque short-lived `elementId`.
4. Safe fill: use visible non-password local/test text field. First `browser.fill_text` dry-run, then exact confirmation. Expect one draft-only fill, never submit.
5. Blocked action: find Send/Submit/Post/Upload/Delete/Pay/Buy target. `browser.click_element` must block; target remains untouched.
6. Reset: dry-run and confirm `browser.reset_pairing`; old session and device credential fail. Re-enroll from the extension popup and verify reconnect.
7. Restart: Firefox temporary extension disappears after Firefox restart; reload same manifest and re-pair. Chromium unpacked extension remains explicit Developer-mode install; verify it remains enabled after restart.
8. Unavailable extension: disable/remove extension. Browser tools return clean bridge error. Agent must suggest accessibility, local OCR/vision, pointer fallback, or guide mode explicitly; no fallback executes automatically.

## Fallback order

```text
app adapter/API -> CLI/script -> browser DOM -> accessibility
-> local OCR/vision -> pointer GUI fallback -> guide mode
```

Browser extension is recommended for reliable structured DOM work, not mandatory. Browser tool failure never silently invokes accessibility, OCR, pointer, or guide tools.

## Safety assertions

- Bridge binds only `127.0.0.1`; pairing required.
- No cookies, passwords, browser storage, secrets, debugger, or arbitrary JavaScript exposed.
- Direct selector actions do not exist. Actions require short-lived, tab/page-bound opaque `elementId` and revalidation.
- No silent send, submit, upload, delete, archive, pay, buy, or publish.
- No CAPTCHA, MFA, login, payment, or security bypass.
- Pairing/session tokens never enter audit logs. Do not paste pairing token into chat, screenshots, or source.
