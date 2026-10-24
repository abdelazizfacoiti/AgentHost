## Summary

Describe the bounded change and affected package.

## Safety checklist

- [ ] No hidden persistence, public listener, or autonomous worker was added.
- [ ] External, destructive, sensitive, and state-changing effects retain policy,
      grant, dry-run, confirmation, target-binding, verification, and cleanup checks.
- [ ] No secrets, tokens, private content, screenshots, OCR, or raw paths enter
      logs, fixtures, metrics, or release artifacts.
- [ ] No removed or unregistered product surface is re-added without execution
      metadata, bounded tests, and the full safety path.
- [ ] Visual events remain non-executing.

## Verification

- [ ] `npm run build`
- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `npm run smoke:mcp`
- [ ] `git diff --check`
