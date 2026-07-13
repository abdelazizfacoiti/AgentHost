# AgentHost Security, Permissions, and Logging

## Security goal

AgentHost is local-first, visible, permissioned, previewable, confirmation-bound, auditable, and conservative. It must never behave like malware, spyware, credential theft software, or stealth remote control.

Every tool follows schema validation, risk/sensitivity classification, policy and grant checks, dry-run when required, confirmation when required, bounded execution, result/checkpoint validation, and safe audit logging.

## Hard non-negotiables

- no silent send, submit, post, upload, delete, archive, pay, buy, publish, or destructive overwrite
- no login, CAPTCHA, MFA, payment, security, or approval bypass
- no passwords, cookies, browser storage, tokens, API keys, private keys, or secret extraction
- no public browser bridge, remote access, stealth control, hidden persistence, background autonomy, sudo, package installation, or unsafe network access
- generated runtime has no network, shell, GUI/DBus, private-data, or arbitrary-code capability

## Policy and grants

Profiles include strict, dev, gui-dev, demo-unlocked-local, private-data, and future-disabled autopilot. Grants are explicit, scoped, session/persistent, and rechecked immediately before execution. Demo mode reduces friction only for approved local/demo roots and normal apps; hard safety blocks remain.

State-changing tools retain dry-run and exact confirmation requirements unless a narrow profile/grant explicitly permits local behavior. Tokens are session-bound, short-lived, single-use, fingerprint-bound, and never logged raw.

Communication apps (mail, chat, collaboration, social messaging) are private/high-risk. Financial, payment, credential/security, password-manager, and system-admin apps are blocked or guide-only for sensitive reads/actions.

## Browser bridge safety

Firefox/Chromium WebExtension bridge is disabled by default, binds only to `127.0.0.1`, uses a protected pairing token plus rotating session token, permits one active session, and has bounded body/command/long-poll limits. Extension origin and tokens are validated; invalid/missing tokens fail cleanly.

Fixed commands expose sanitized tabs, URLs, page context/text, element discovery, safe actions, and state waits. There is no arbitrary JavaScript, CDP/debugger, cookies, storage, history, webRequest, password API, upload, submit, send, or form command.

Setup diagnostics return state/error codes, prepared paths, timestamps, and recovery steps only. They never return browser URLs, page data, session tokens, pairing tokens, cookies, or storage. Pairing-token rotation/reset is dry-run and confirmation gated; only explicit token generation returns raw token once.

Extension absence does not weaken policy. Accessibility, local OCR/vision, pointer, and guide alternatives remain separately safety-gated and must be selected explicitly. No browser failure may silently trigger click/type/action fallback.

Browser `elementId` values are opaque, short-lived, tab/page-bound references. Actions require a unique reference, revalidate URL/session, visibility, enabled state, identity, and ambiguity. Direct selectors cannot act. Stale or changed references fail.

## Browser content and action policy

URLs are normalized and redacted before results/logs. Email, phone, token, auth-looking, query, fragment, and credential material is redacted. Communication content requires explicit private-data grants. Financial/credential/security/admin content is blocked or guide-only. Fill is draft-only; send/submit/post/upload/delete/pay/buy remain blocked or high-risk.

## OCR and vision safety

Vision accepts only approved AgentHost screenshot/output roots unless separately granted. It uses local Tesseract only; no cloud OCR, upload, network, or dependency installation. Protected active windows and sensitive paths are blocked. OCR results are bounded and redacted; logs contain no image bytes or full private text.

`vision.find_target` returns suggestions only. `vision.prepare_pointer_action` requires session match, image hash, coordinate-space proof, dimensions, active-window match, fresh evidence within 10 seconds, bounds, confidence, and risk checks. It returns only a `desktop.click` dry-run suggestion and never clicks or types.

## Checkpoint safety

`checkpoint.evaluate` and `checkpoint.wait_for` are read-only. They inspect metadata/state through existing safety boundaries and return bounded evidence summaries. Secret checkpoints block. Private checkpoints require grants. File paths, browser URLs, accessibility queries, and vision evidence retain path, app sensitivity, grant, and redaction checks.

Checkpoint templates are review metadata, not action scripts. They accept only declared parameters and literal `{{parameterName}}` interpolation. No expressions, shell/env/glob expansion, code execution, or hidden tool calls. Secret/private literal expectations are rejected or blocked; sensitive bindings stay in memory and never enter skill records, traces, ToolResults, or logs. Skills cannot replay actions or create confirmation tokens.

## Tool Forge and OS sandboxing

Forge manifests declare capabilities and risk. Reviews, artifact validation, registration gates, runtime eligibility, and grants precede execution. Generated artifacts remain non-live and absent from `system.list_capabilities` live tools.

Runtime runs execute only bounded `runtime/handler.json` JSON operations in a fixed child runner. Generated JavaScript/Python is not imported or executed. Inputs/outputs, stdout/stderr, runtime, environment, and filesystem are capped. Network, GUI/DBus, secrets, broad filesystem, shell, private data, and dangerous capabilities are denied.

Optional sandbox selection prefers bubblewrap/bwrap, then firejail, then safe unshare. Auto mode falls back to the fixed runner with limitations when unavailable. No install or sudo is used. Run records include backend, limitations, grants, limits, env key names, status, and redacted summaries.

## Files and logs

Default writable roots are `~/.agenthost/` and approved AgentHost output roots. Protected paths include system roots, home-wide private data, SSH/GnuPG/keyrings, browser profiles, and credentials.

JSONL audit logs contain tool name, risk, policy decision, grant IDs/status, sanitized origin/app, counts, sizes, truncation, backend, and safe error codes. They never contain pairing/session/confirmation tokens, secrets, raw OCR text, page content, screenshots, private messages, full sensitive paths, or hidden environment values.
