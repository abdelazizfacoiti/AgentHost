# AgentHost Security, Permissions, and Logging

## 1. Security goal

AgentHost gives AI agents access to real local capabilities. That makes safety central to the product.

The system must be:

- local-first
- visible
- permissioned
- logged
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
- read current AgentHost profile
- get recent logs

### `low`

Low-impact inspection.

Examples:

- check if command exists
- check if file exists in approved output folder
- list AgentHost output directory

### `medium`

Changes local state.

Examples:

- write a file under approved output folder
- open an app
- focus a window
- run a safe local command
- generate local output
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

## 4. App sensitivity categories

AgentHost should classify apps and sites.

### Normal apps

Examples:

- Blender
- GIMP
- LibreOffice
- VS Code

Medium-risk automation may be allowed with profile permissions.

### Communication apps

Examples:

- Gmail
- Outlook
- Slack
- Discord
- WhatsApp Web

Typing, sending, attaching, or posting is high risk unless reviewed.

### Financial/payment apps

Examples:

- banking
- checkout pages
- crypto wallets

Autonomous execution should be blocked by default. Guide mode only.

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
  "blockHighRiskByDefault": true
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
  "blockHighRiskByDefault": true
}
```

### autopilot

Future profile only. Do not use in MVP.

```json
{
  "allowScreenshots": true,
  "allowAppLaunch": true,
  "allowShell": true,
  "allowGenericClick": true,
  "allowGenericType": true,
  "requireApprovalForHighRisk": true,
  "blockHighRiskByDefault": false
}
```

## 6. Shell safety

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

Prefer `spawn(command, args)` over raw shell strings when possible.

## 7. File safety

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

Do not read arbitrary personal files unless the user explicitly asks and policy allows it.

## 8. Communication safety

MVP must not send communications automatically.

This includes:

- email
- chat messages
- social posts
- form submissions
- comments
- support replies

Allowed in MVP:

- prepare draft text
- open compose page
- show recipient/subject/body
- show attachment path
- guide user manually

Blocked by default:

- sending
- posting
- submitting
- silent file upload
- silent attachment

## 9. GUI automation safety

GUI automation includes:

- screenshots
- click
- type
- hotkey

This should not be implemented in Phase 0 + Phase 1.

When added later:

- screenshots require permission
- clicks require active window context
- typing passwords is forbidden
- communication apps are high-risk
- financial apps are guide-only
- generic GUI control is disabled in strict profile
- guide mode is preferred for unsupported apps

## 10. Approval requests

Approval prompts must include:

- action summary
- app/site
- automation strategy
- exact command if shell
- files affected
- data sent or changed
- risk level
- consequence
- approve/deny/edit options

Example:

```text
Approval required

Action: Attach file to email draft
App: Gmail
Recipient: example@gmail.com
Attachment: ~/.agenthost/outputs/result.blend
Risk: high

This may expose the file to the recipient.
```

## 11. Audit logging

All tool calls must be logged locally as JSONL.

Default folder:

```text
~/.agenthost/logs/
```

Each log entry should include:

```json
{
  "timestamp": "2026-07-07T21:00:00.000Z",
  "sessionId": "session_123",
  "tool": "system.get_info",
  "riskLevel": "observe",
  "strategy": "guide_only",
  "inputSummary": "Get system info",
  "approvalStatus": "not_required",
  "ok": true,
  "durationMs": 12,
  "outputSummary": "Returned platform and capabilities"
}
```

Do not log:

- passwords
- API keys
- auth tokens
- cookies
- private keys
- full sensitive files
- full private email/message content
- screenshots by default

## 12. Emergency stop

Future control room UI must include an emergency stop.

Emergency stop should:

- cancel queued actions
- kill child processes started by AgentHost
- disable further tool calls in the session
- write a stop entry to logs
- return cancelled errors to Codex

## 13. Security non-negotiables

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
