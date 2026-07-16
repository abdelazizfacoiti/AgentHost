# Browser Extension Release

AgentHost browser bridge has separate development and public distribution paths.

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

## Firefox public installation

1. Build unsigned XPI.
2. Submit XPI through Mozilla Add-ons Developer Hub using release-owner account.
3. Complete Mozilla automated/manual review.
4. Download Mozilla-signed XPI.
5. Verify manifest ID remains `browser-bridge@agenthost.local`, version matches AgentHost release matrix, and checksum is recorded in release manifest.
6. Attach signed XPI and checksum to AgentHost release.
7. Public instructions install signed XPI once through normal Firefox UI.

Signing credentials remain outside repository. Until Mozilla returns signed artifact, Firefox public installation is blocked. Temporary `about:debugging` loading remains development-only.

## Chromium public installation

1. Build MV3 ZIP.
2. Upload ZIP through Chrome Web Store developer console.
3. Complete store disclosure/review.
4. Record published extension ID and store URL in release metadata.
5. Verify published version and protocol compatibility.
6. Public instructions use verified store listing.

Unpacked loading remains development-only. Store credentials remain outside repository.

## Pairing lifecycle

1. Operator generates short-lived token through confirmation-gated AgentHost tool.
2. Extension presents token once from loopback origin.
3. AgentHost enrolls exact origin, extension identity, browser family, protocol, and compatible version.
4. Extension stores random device reconnect secret locally; AgentHost stores only SHA-256 hash.
5. Browser and AgentHost restarts use `/v1/reconnect` to obtain fresh memory-only session.
6. Rotation revokes previous devices before issuing new enrollment token.
7. Reset revokes devices and deletes pending enrollment token.

Reconnect uses bounded exponential backoff with jitter, maximum 30-second interval and five-minute automatic retry window. Recovery after exhaustion requires operator Retry.

## Uninstall

1. Run confirmation-gated `browser.reset_pairing`.
2. Remove extension through browser extension manager.
3. Remove development folders under `~/AgentHost/browser-extension/` if used.

Never execute token file and never use `sudo` for pairing.
