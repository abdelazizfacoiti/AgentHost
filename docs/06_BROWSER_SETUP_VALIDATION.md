# Browser Setup and Pairing Validation

## Scope

This runbook validates the current browser setup and pairing path. It does not expand browser capabilities. Use a user-controlled public/test page only; provider names are examples, never required test targets.

## One-time setup

```bash
npm run browser:setup
```

This explicitly prepares stable unpacked Firefox/Chromium bundles, enables local bridge config, and prints the pairing token once. It does not install an extension silently.

Restart AgentHost MCP server. Then load:

- Firefox: `about:debugging#/runtime/this-firefox`, **Load Temporary Add-on…**, select `~/AgentHost/browser-extension/firefox/manifest.json`.
- Chromium: `chrome://extensions`, enable Developer mode, **Load unpacked**, select `~/AgentHost/browser-extension/chromium`.

Paste the token into the popup, keep the configured port (default `43117`), select **Pair / Re-pair**, then call `browser.verify_pairing`. The token file is text data, not a command: use `cat` or the setup tools to read it; never execute it and never use `sudo` on it.

## Setup-state checklist

| State | Expected result | Recovery |
|---|---|---|
| `bridge_disabled` | `browser.setup_status` reports disabled; no listener. | Run `npm run browser:setup`; restart MCP server. |
| `bridge_unavailable` | Config enabled, listener unavailable. | Restart AgentHost MCP server; verify configured port is free. |
| `extension_not_seen` | Bridge running, no extension request. | Prepare bundle, load extension, check popup port. |
| `unpaired` | Extension seen, no valid session. | Paste pairing token; select Pair / Re-pair. |
| `token_invalid` | Pair rejected; no session. | Run setup or explicit token generation; paste current token again. |
| `token_expired` | A bridge request used an expired memory-only session. The setup status may subsequently show `unpaired`. | Select Pair / Re-pair. Generate a new token only if the pairing token itself is invalid or reset. |
| `paired` | `browser.verify_pairing` returns `verified: true`. | Continue browser DOM tools. |
| `manifest_missing` | Extension package validation found no valid prepared manifest. This is setup/package state, not a bridge listener state. | Run `npm run browser:extension:firefox` or `browser:extension:chromium`. |

`browser.diagnose_bridge` returns safe bridge state and next steps. It never returns a raw token, page content, or private URLs. A token mismatch is repaired by using the current token from setup/token generation and pairing again; running the token file is never required.

## Manual smoke

1. Fresh setup: run setup command, load extension, pair, verify pairing.
2. Inspect: call `browser.list_tabs`, then `browser.get_active_tab`; expect sanitized metadata only.
3. Discovery: on safe user-controlled public/test page, call `browser.find_element`; expect bounded metadata and opaque short-lived `elementId`.
4. Safe fill: use visible non-password local/test text field. First `browser.fill_text` dry-run, then exact confirmation. Expect one draft-only fill, never submit.
5. Blocked action: find Send/Submit/Post/Upload/Delete/Pay/Buy target. `browser.click_element` must block; target remains untouched.
6. Reset: dry-run and confirm `browser.reset_pairing`; old session fails. Re-pair with current token and verify connection.
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
