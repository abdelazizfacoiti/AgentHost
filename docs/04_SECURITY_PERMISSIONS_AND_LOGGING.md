# AgentHost Security, Permissions, and Logging

## 1. Security goal

AgentHost gives AI agents access to real local capabilities. Safety is the product.

The system must be:

- local-first
- visible
- permissioned
- logged
- previewable
- confirmation-bound
- reversible where possible
- conservative by default

AgentHost must never act like malware, spyware, credential theft software, or stealth remote control software.

## 2. Safety layers

Every meaningful action should pass through:

```text
schema validation
  ↓
risk classification
  ↓
policy check
  ↓
dry-run preview if requested
  ↓
confirmation token check if required
  ↓
approval request if needed
  ↓
execution
  ↓
result validation
  ↓
audit log
```

## 3. Risk levels

### `observe`

No state change.

Examples:

- get OS info
- list capabilities
- inspect current profile
- read recent logs

### `low`

Low-impact inspection.

Examples:

- check if command exists
- check if file exists in approved output folder
- list AgentHost output directory
- list visible windows
- inspect accessibility metadata

### `medium`

Changes local state.

Examples:

- write a file under approved output folder
- open an app
- focus a window
- run a safe local command
- generate local output
- accessibility action on normal app
- prepare a draft without sending

### `high`

External, sensitive, destructive, irreversible, or user-visible communication.

Examples:

- send email
- post message
- upload file
- delete files
- overwrite important files
- run `sudo`
- install packages
- change system settings
- access secrets
- submit forms
- interact with banking/payment sites
- publish content

### `blocked`

Forbidden by default.

Examples:

- hidden persistence
- stealth control
- credential extraction
- bypassing OS security
- CAPTCHA bypass
- disabling security tools
- destructive actions without explicit user intent
- exfiltrating private files
- typing/sending secret data by default

## 4. App sensitivity categories

### Normal apps

Examples:

- Blender
- GIMP
- LibreOffice
- VS Code
- terminal

Medium-risk automation may be allowed with profile permissions.

### Communication apps

Examples:

- Gmail
- Outlook
- Slack
- Discord
- WhatsApp Web

Reading private data requires explicit user intent. Typing, sending, attaching, posting, or submitting is high risk unless reviewed.

### Financial/payment apps

Examples:

- banking
- checkout pages
- crypto wallets

Autonomous execution should be blocked by default. Guide mode only unless a very explicit future policy says otherwise.

### Credential/security apps

Examples:

- password managers
- SSH key folders
- browser profile secrets
- keyrings

Reading, exporting, typing, or uploading secrets is blocked by default.

### System settings

Changing settings is high-risk.

## 5. Policy profiles

### strict

For normal users.

```json
{
  "allowScreenshots": true,
  "allowAppLaunch": true,
  "allowShell": false,
  "allowFileWriteRoots": ["~/.agenthost"],
  "allowGenericClick": false,
  "allowGenericType": false,
  "allowEmailSend": false,
  "allowUploads": false,
  "requireApprovalForMediumRisk": true,
  "blockHighRiskByDefault": true,
  "requireConfirmationForStateChanging": true
}
```

### dev

For development.

```json
{
  "allowScreenshots": true,
  "allowAppLaunch": true,
  "allowShell": true,
  "allowFileWriteRoots": ["~/.agenthost", "~/Desktop/agenthost-output"],
  "allowGenericClick": false,
  "allowGenericType": false,
  "allowEmailSend": false,
  "allowUploads": false,
  "requireApprovalForMediumRisk": false,
  "blockHighRiskByDefault": true,
  "requireConfirmationForStateChanging": true
}
```

### gui-dev

For local GUI testing only.

```json
{
  "allowScreenshots": true,
  "allowAppLaunch": true,
  "allowShell": true,
  "allowGenericClick": true,
  "allowGenericType": true,
  "requireDryRunForGuiActions": true,
  "requireConfirmationForStateChanging": true,
  "blockHighRiskByDefault": true
}
```

### autopilot

Future profile only. Do not use in MVP.

Autopilot must still preserve blocked categories and confirmation for high-risk actions.

## 6. Dry-run previews

State-changing tools should support:

```json
{
  "dryRun": true
}
```

Dry-run previews must:

- never execute side effects
- still validate schema
- still run safety preflight
- resolve targets where possible
- detect ambiguity
- redact secrets
- return whether the action would execute
- return whether approval or confirmation would be required
- mint a confirmation token only when exact, unambiguous, allowed, and eligible

## 7. Confirmation tokens

Phase 11 adds confirmation tokens.

Tokens are:

- in-memory
- session-bound
- short-lived, currently 3 minutes by default
- single-use
- bound to tool name
- bound to normalized input fingerprint
- bound to target fingerprint when applicable
- bound to risk level
- not logged raw
- not allowed to contain secrets

Execution with token must verify:

- token exists
- token not expired
- token not reused
- same session
- same tool
- same normalized input
- same target fingerprint
- risk did not increase

A token does **not** bypass:

- schema validation
- safety engine
- approval prompts
- Codex approval layer

## 8. Shell safety

Dangerous patterns must be high-risk or blocked.

Examples:

```text
rm -rf
sudo
dd if=
mkfs
chmod -R 777 /
chown -R
curl ... | bash
wget ... | sh
kill -9 -1
commands touching ~/.ssh
commands touching ~/.gnupg
commands touching browser profile secrets
```

Shell commands should have:

- timeout
- working directory
- max output size
- stdout/stderr capture
- structured errors
- risk classification before execution
- dry-run classification
- confirmation token when required

Prefer `spawn(command, args)` or `execFile` over raw shell strings.

## 9. File safety

Default writable roots:

```text
~/.agenthost/
~/Desktop/agenthost-output/
```

Do not write outside approved roots unless explicitly approved.

Protected paths:

```text
/
~/
~/.ssh
~/.gnupg
~/.config
~/.local/share/keyrings
browser profile folders
system folders
```

File writes should support dry-run and confirmation.

## 10. Communication safety

MVP must not send communications automatically.

This includes:

- email
- chat messages
- social posts
- form submissions
- comments
- support replies

Allowed near-term:

- prepare draft text
- open compose page
- show recipient/subject/body
- read user-approved email data through official API
- summarize user-approved private data
- guide user manually

Blocked by default:

- sending
- posting
- submitting
- silent file upload
- silent attachment
- deleting/archiving email without explicit confirmation

## 11. GUI automation safety

GUI automation includes:

- screenshots
- click
- type
- hotkey
- focus window

Rules:

- screenshots are privacy-sensitive
- clicks require active window context
- typing passwords/secrets is forbidden
- communication apps are high-risk
- financial apps are guide-only
- generic GUI control is disabled in strict profile
- accessibility is preferred before raw GUI
- dry-run preview is required for state-changing GUI actions
- confirmation token should be required where configured

## 12. Accessibility safety

Accessibility is safer than raw coordinates but still powerful.

Rules:

- read-only tree/element inspection is low risk
- state-changing actions are medium/high depending on app/action/data
- ambiguous targets must be rejected
- hidden/password/secret fields must not expose values
- secret set_value is blocked by default
- no fallback to raw click/type unless explicitly requested and policy allows
- action previews should include element summary and ambiguity status

## 13. Approval requests

Approval prompts must include:

- action summary
- app/site
- automation strategy
- exact command if shell
- files affected
- data sent or changed
- target window/element if UI action
- risk level
- consequence
- dry-run preview if available
- confirmation token status
- approve/deny/edit options

## 14. Audit logging

All tool calls must be logged locally as JSONL.

Default folder:

```text
~/.agenthost/logs/
```

Each log entry should include:

```json
{
  "timestamp": "2026-07-08T21:00:00.000Z",
  "sessionId": "session_123",
  "tool": "shell.run_safe",
  "riskLevel": "medium",
  "strategy": "cli_or_script",
  "inputSummary": "Run node --version",
  "approvalStatus": "not_required",
  "preview": false,
  "confirmation": {
    "used": true,
    "accepted": true,
    "tokenId": "token_abcd"
  },
  "ok": true,
  "durationMs": 12,
  "outputSummary": "Command exited 0"
}
```

Do not log:

- passwords
- API keys
- auth tokens
- cookies
- private keys
- raw confirmation tokens
- full sensitive files
- full private email/message content
- screenshots by default
- raw secret values

## 15. Emergency stop

Future Control Room UI must include emergency stop.

Emergency stop should:

- cancel queued actions
- kill child processes started by AgentHost
- disable further tool calls in the session
- write stop entry to logs
- return cancelled errors to Codex

## 16. Tool Forge security

Future generated tools must require:

- manifest
- permission declaration
- allowed domains
- allowed file roots
- declared risk levels
- tests
- dry-run support for state-changing actions
- confirmation support where needed
- user approval before registration

Generated tools must not run with arbitrary unrestricted access.

## 17. Security non-negotiables

AgentHost must never:

- hide its actions
- bypass OS permissions
- bypass login/CAPTCHA/payment confirmations
- silently send communications
- silently upload files
- steal credentials
- install hidden persistence
- disable security tools
- control another person’s computer without consent
- use generated tools to bypass safety policy
