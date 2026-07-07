# AgentHost — Codex Instructions

## Project mission

We are building **AgentHost**, a universal local MCP server that gives Codex-style agents a safe, permissioned body on a real computer.

AgentHost should help agents automate **many apps and workflows**, not one specific app.

The product is:

```text
A safe local runtime that gives AI agents controlled access to apps, files, shell, browser workflows, and desktop actions.
```

The product is not:

```text
A Blender automation script.
```

Blender is only an optional future demo adapter.

## Automation strategy order

For any app or task, prefer this order:

1. app-specific adapter
2. official API/plugin API
3. CLI/script interface
4. browser automation
5. accessibility tree
6. GUI screenshot/click/type fallback
7. guide mode only

Use GUI clicking and typing only as fallback and only when policy allows it.

For unsupported or sensitive apps, prefer guide mode.

## Current milestone

If no milestone is specified, assume we are working on:

```text
Phase 0 + Phase 1 only
```

That means:

- TypeScript monorepo
- npm workspaces
- MCP server skeleton
- `system.get_info`
- `system.list_capabilities`
- app-agnostic core types
- `ToolResult`
- `AutomationStrategy`
- `AppCapability`
- `AppAdapter`
- capability registry
- config loader
- JSONL logger
- basic policy profile structure

Do not implement:

- Blender
- GUI clicking/type
- browser automation
- email sending
- Windows/macOS
- skill recording
- autonomous background operation

## Architecture rules

Core must be app-agnostic.

Core must not import app-specific implementations.

Core must not import Linux-specific implementations.

Use this shape:

```text
Codex / agent brain
  ↓ MCP tool calls
AgentHost MCP server
  ↓ safety + policy + approval
Universal automation layer
  ↓ OS adapters + optional app adapters
  ↓ any app / terminal / browser / file workflow
```

## Package direction

Recommended structure:

```text
packages/
  core/
  mcp-server/
  automation/
  os-linux/
  app-adapters/
  app-browser/
  app-blender/
  shared/
```

App-specific adapters must be optional.

Blender-specific code belongs only in:

```text
packages/app-blender/
```

or:

```text
packages/app-adapters/blender/
```

## Safety rules

Every future tool must pass through:

1. schema validation
2. risk classification
3. policy check
4. approval handling if needed
5. execution
6. audit logging

High-risk actions include:

- sending emails
- posting messages
- uploading files
- deleting files
- overwriting important files
- running sudo
- installing packages
- changing system settings
- accessing secrets
- interacting with financial/payment sites
- submitting forms
- publishing content
- destructive shell commands

Never implement:

- hidden persistence
- stealth control
- credential extraction
- security bypasses
- CAPTCHA bypass
- disabling security tools
- malware-like behavior

## Logging rules

All tool calls should be logged locally as JSONL.

Default path:

```text
~/.agenthost/logs/
```

Do not log:

- passwords
- API keys
- tokens
- cookies
- private keys
- full sensitive files
- full private messages
- screenshots by default

## Development workflow

Before major changes:

1. inspect repo
2. read docs
3. summarize current state
4. propose exact files to create/edit
5. implement only approved milestone

After implementation:

1. show changed files
2. explain how to run
3. explain how to test
4. run available build/test/lint commands
5. summarize next phase
6. do not start next phase unless asked
