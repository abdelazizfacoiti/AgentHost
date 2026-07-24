# Contributing

AgentHost is provider-agnostic and safety-first. Changes must preserve schema validation, policy/grant checks, dry-run and confirmation boundaries, owner isolation, target freshness, redaction, receipts, checkpoints, and audit logging.

Before submitting a change:

```bash
npm run build
npm test
npm run lint
npm run smoke:mcp
git diff --check
```

Do not add hidden persistence, public listeners, arbitrary generated-code execution, credential extraction, CAPTCHA/MFA bypass, silent send/submit/upload/delete/pay actions, scheduler workers, or autonomous loops. Optional adapters stay explicitly opt-in. Do not include private content, secrets, screenshots, OCR text, or runtime tokens in tests, fixtures, logs, or release artifacts.

Scheduler changes are limited to owner-scoped review metadata and must remain
non-executable. New schedule forms or lifecycle states require validation and
redacted persistence tests. The public artifact is the Linux archive/CLI; the
root npm package is intentionally private.
