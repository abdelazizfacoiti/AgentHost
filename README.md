# AgentHost

AgentHost is a local general-purpose computer-use agent runtime. It gives Codex
and other agents a governed body on a Linux workstation: the model reasons
about a goal and composes computer, browser, filesystem, shell, application,
MCP, vision/OCR, speech, and skill capabilities to accomplish it — observing
each result, verifying outcomes, and recovering from failures.

The runtime exposes capabilities; the model decides how to use them.
Permissions are capability-based and configurable; safety (isolation, secrets,
audit, emergency stop) is enforced by the runtime.

AgentHost is universal and provider-agnostic. Gmail, WhatsApp, Slack, Blender,
and other application names are examples only—not built-in product targets.

## Status and support

The current public boundary is a Linux x86_64 source checkout or verified
Linux archive/CLI release.

- Node.js 20+ and Python 3 are required host prerequisites.
- X11 is the verified visible-overlay path; Wayland reports honest limitations.
- Firefox and Chromium Browser Bridge extensions are currently unpacked/manual
  development artifacts until signed/store releases are published.
- The MCP server is stdio-based; browser and Control Room listeners are
  loopback-only and disabled unless explicitly enabled.
- The root npm package remains private; npm publication is not promised.

The agent works in a loop: understand → plan → inspect → act → observe →
verify → recover. Every important action has an observation path
(`computer.observe_state`, screenshots, accessibility, browser state, command
output). Tool errors are recoverable, not terminal; repeated identical
failures trigger a change of capability, not a blind retry.

Consequence tiers replace the old per-tool confirmation tax: LOW executes
automatically, MEDIUM executes with logging, HIGH requires approval, CRITICAL
requires explicit confirmation. `agenthost stop` (or Control Room Stop)
halts state-changing tools immediately, independent of the model. Workflow
replay and scheduler records remain metadata-only. Visual surfaces never
control target applications.

## Fastest start: release archive

For a downloaded, checksum-verified Linux archive:

```bash
sha256sum -c agenthost-v0.1.0-linux-x64.tar.gz.sha256
tar -xzf agenthost-v0.1.0-linux-x64.tar.gz
cd agenthost-v0.1.0-linux-x64
./bin/agenthost.mjs doctor
./bin/agenthost.mjs setup
./bin/agenthost.mjs integrations codex add --apply
./bin/agenthost.mjs start
```

The archive wrapper can be run directly. A local release install can instead
create the `agenthost` command under `~/.local/bin`:

```bash
npm run release:install -- release/agenthost-v0.1.0-linux-x64.tar.gz
agenthost doctor
agenthost setup
agenthost integrations codex add --apply
agenthost start
```

AgentHost writes only its own user directories. These commands do not use
`sudo`, install system packages, create a system service, or install a browser
extension silently. See [release operations](docs/08_RELEASE_AND_OPERATIONS.md)
for updates, rollback, and diagnostics.

## Source checkout

Use this path for contributors and local development:

```bash
git clone https://github.com/abdelazizfacoiti/AgentHost.git
cd AgentHost
npm install
npm run build
npm run smoke:mcp
```

Start the MCP server in a separate terminal. An isolated home keeps development
state out of your normal AgentHost installation:

```bash
export AGENTHOST_HOME="$PWD/.agenthost"
export AGENTHOST_CONFIG="$PWD/.agenthost/config.json"
npm run start:mcp
```

Run the complete local verification suite with:

```bash
npm test
npm run lint
npm run benchmark:routing
```

## MCP client configuration

After a release install, an MCP client can start AgentHost with:

```json
{
  "mcpServers": {
    "agenthost": {
      "command": "agenthost",
      "args": ["start"]
    }
  }
}
```

For a source checkout, use the built MCP entrypoint and set the isolated home
and config in the client environment:

```json
{
  "mcpServers": {
    "agenthost": {
      "command": "node",
      "args": ["/absolute/path/to/AgentHost/packages/mcp-server/dist/index.js"],
      "env": {
        "AGENTHOST_HOME": "/absolute/path/to/AgentHost/.agenthost",
        "AGENTHOST_CONFIG": "/absolute/path/to/AgentHost/.agenthost/config.json"
      }
    }
  }
}
```

The server keeps normal diagnostics off stdout so MCP stdio remains valid.

## Browser Bridge: get connected quickly

The Browser Bridge gives AgentHost structured tab and DOM information without
cookies, passwords, browser storage, arbitrary JavaScript, or direct selector
execution. It is disabled by default and binds only to `127.0.0.1`.

### Installed release

Choose one browser and run the explicit setup flow:

```bash
agenthost browser setup --browser firefox --apply
# or:
agenthost browser setup --browser chromium --apply
# or (Chromium only): let AgentHost launch and pair the browser itself —
# no manual extension install, no popup click:
agenthost browser setup --browser chromium --auto --apply --approve
```

The command prepares the unpacked extension, enables the local bridge, waits
for enrollment, verifies reconnect, and prints the exact extension directory.
While it waits:

1. Firefox: open `about:debugging#/runtime/this-firefox`, choose **Load
   Temporary Add-on…**, and select the printed `manifest.json`.
2. Chromium: open `chrome://extensions`, enable **Developer mode**, and choose
   **Load unpacked** on the printed browser directory.
3. Open the AgentHost extension popup and confirm the loopback port (default
   `43117`).
4. Choose **Pair with AgentHost**.
5. Approve the exact extension identity in the AgentHost terminal prompt.
6. Wait for reconnect verification, then run `agenthost browser status`.

### Source checkout

Prepare an isolated source setup, then start MCP in the same environment:

```bash
export AGENTHOST_HOME="$PWD/.agenthost"
export AGENTHOST_CONFIG="$PWD/.agenthost/config.json"
export AGENTHOST_BROWSER_EXTENSION_DIR="$PWD/.agenthost/browser-extension"
npm run browser:setup
```

`npm run browser:setup` prepares both unpacked artifacts and prints their exact
paths. It does not start enrollment. Choose one browser, then run the pairing
command in Terminal 1:

```bash
npm run build
npm run browser:pair -- --browser firefox --apply --approve
# or: npm run browser:pair -- --browser chromium --apply --approve
```

Leave that command running. It starts the bounded local enrollment session and
prints the exact manifest/directory to load. In Firefox use
`about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…**; in
Chromium use `chrome://extensions` → **Developer mode** → **Load unpacked**.
Open the extension popup and click **Pair with AgentHost**. After the command
reports that the Browser Bridge is ready, start normal MCP in Terminal 2:

```bash
npm run start:mcp
```

Do not use `npm run start:mcp` as the pairing command: it serves MCP but does
not create an enrollment session. Use `browser.setup_status`,
`browser.diagnose_bridge`, and `browser.verify_pairing` for recovery and live
status. Fresh setup uses browser-side enrollment; one-time tokens are only a
legacy repair path.

Browser-side enrollment is the normal pairing path. One-time token pairing is
retained only as a legacy repair flow; it is never required for a fresh setup.
Pairing credentials are not logged, and a second browser session is rejected.

### First safe browser check

Use a public or user-controlled local test page—not a communication, financial,
credential, MFA, CAPTCHA, or administration page—then call these fixed MCP
tools in order:

```text
browser.detect
browser.setup_status
browser.verify_pairing
browser.list_tabs
browser.get_active_tab
browser.current_url
browser.get_page_context
browser.find_element
```

Grant site access explicitly from the extension popup for the test origin.
Element actions require short-lived opaque `elementId` references and remain
subject to policy, grants, dry-run, confirmation, and verification. If the
extension is unavailable, AgentHost reports a clean failure and may recommend
accessibility, local OCR/vision, pointer fallback, or guide mode; it never
switches silently.

See [Browser Setup Validation](docs/06_BROWSER_SETUP_VALIDATION.md) and
[Browser Extension Release](docs/07_BROWSER_EXTENSION_RELEASE.md) for reset,
reconnect, signing, and troubleshooting details.

## Visual Copilot demo

The demo uses authoritative redacted runtime activity and never clicks, types,
navigates, moves the real pointer, or controls a target application:

```bash
npm run demo:visual-copilot -- --diagnose
npm run demo:visual-copilot -- --headless
npm run demo:visual-copilot -- --require-gui
```

Use `--diagnose` first on X11. `--require-gui` fails closed unless handshake,
transparency, mapping, draw-ready, epoch, live-registration, and visibility
acknowledgements all succeed. See [DEMO.md](DEMO.md) for manual checks.

## Safety boundary

AgentHost is designed to be explicit and inspectable:

- no public network listener, hidden persistence, or autonomous background work;
- no credential/secret extraction, CAPTCHA/MFA/login/payment bypass, or sudo;
- no silent send, submit, upload, delete, archive, pay, buy, or publish;
- no arbitrary generated JavaScript/Python execution;
- no browser cookies/storage/debugger access;
- no scheduler execution or workflow replay workers;
- no raw private page text, OCR, screenshots, tokens, or secrets in logs,
  receipts, metrics, overlays, or Control Room projections.

Supported external or destructive effects remain exact-target, grant,
confirmation, verification, and receipt governed. Unsupported, protected,
ambiguous, or unverifiable effects return precise diagnostics or guide mode.

## Documentation and contribution

- [Canonical documentation index](docs/INDEX.md)
- [Product specification](docs/01_PRODUCT_SPEC.md)
- [System architecture](docs/02_SYSTEM_ARCHITECTURE.md)
- [MCP tools and adapters](docs/03_MCP_TOOLS_AND_ADAPTERS.md)
- [Security, permissions, and logging](docs/04_SECURITY_PERMISSIONS_AND_LOGGING.md)
- [Release operations](docs/08_RELEASE_AND_OPERATIONS.md)
- [Privacy and support](docs/11_PRIVACY_AND_SUPPORT.md)
- [Contributing](CONTRIBUTING.md)
- [Security reporting](SECURITY.md)
- [Support](SUPPORT.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)

Provider names in examples are illustrative only. New capabilities must remain
app-agnostic, schema-validated, policy-gated, redacted, and auditable.

## License

AgentHost is licensed under Apache-2.0. See [LICENSE](LICENSE), [NOTICE](NOTICE),
and [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES). Host programs such as GTK3,
Tesseract, eSpeak NG, and Bubblewrap remain separately licensed and are not
bundled by AgentHost.
