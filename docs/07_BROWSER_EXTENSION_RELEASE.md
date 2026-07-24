# Browser Extension Release

AgentHost browser bridge has separate development and public distribution paths.
The current public repository ships source and deterministic unsigned review
artifacts only. Signed Firefox and Chromium store releases require external
publisher accounts and review; do not describe unsigned artifacts as public
installers.

## Deterministic artifacts

```bash
npm run browser:extension:build
```

Output under `release/browser/`:

- deterministic unsigned Firefox XPI;
- deterministic Chromium MV3 ZIP;
- `artifacts.json`;
- `SHA256SUMS`.

Build validates fixed loopback host, required permissions, forbidden permissions, stable Firefox ID, and stable Chromium development identity. Metadata reports `signed:false` and `publicInstallable:false`. Never relabel unsigned artifact.

## Firefox public installation (future external release)

1. Build unsigned XPI.
2. Submit XPI through Mozilla Add-ons Developer Hub using release-owner account.
3. Complete Mozilla automated/manual review.
4. Download Mozilla-signed XPI.
5. Verify manifest ID remains `browser-bridge@agenthost.local`, version matches AgentHost release matrix, and checksum is recorded in release manifest.
6. Attach signed XPI and checksum to AgentHost release.
7. Public instructions install signed XPI once through normal Firefox UI.

Signing credentials remain outside the repository. Until Mozilla returns a
signed artifact, public Firefox installation is blocked. Temporary
`about:debugging` loading is the supported development path.

## Chromium public installation (future external release)

1. Build MV3 ZIP.
2. Upload ZIP through Chrome Web Store developer console.
3. Complete store disclosure/review.
4. Record published extension ID and store URL in release metadata.
5. Verify published version and protocol compatibility.
6. Public instructions use verified store listing.

Until a verified store listing exists, unpacked loading is the supported
development path. Store credentials remain outside the repository.

## Pairing lifecycle

1. Operator starts `agenthost browser setup --browser <firefox|chromium> --apply`, or the equivalent source setup.
2. Extension requests local enrollment from `127.0.0.1` after the operator selects **Pair with AgentHost**.
3. AgentHost shows the exact extension identity for explicit approval.
4. AgentHost enrolls exact origin, extension identity, browser family, protocol, and compatible version.
5. Extension stores a random device reconnect secret locally; AgentHost stores only its SHA-256 hash.
6. Browser and AgentHost restarts use `/v1/reconnect` to obtain a fresh memory-only session.
7. Reset revokes devices and deletes pending enrollment state.

One-time token pairing remains available only as a legacy repair path through
`browser.generate_pairing_token`; it is not the normal public setup flow.

Reconnect uses bounded exponential backoff with jitter, maximum 30-second interval and five-minute retry bursts. Existing browser alarm checks reset one bounded burst approximately once per minute while the extension remains installed, so AgentHost restarts recover without a permanent `reconnect_exhausted` dead-end. Operator Retry remains available for immediate recovery.

## Uninstall

1. Run confirmation-gated `browser.reset_pairing`.
2. Remove extension through browser extension manager.
3. Remove development folders under `~/AgentHost/browser-extension/` if used.

Never execute token file and never use `sudo` for pairing.
