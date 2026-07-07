# AgentHost MCP Tools and Adapter Specification

## 1. MCP server goal

The AgentHost MCP server exposes local computer capabilities to Codex and other AI agents.

The server should be named:

```text
agenthost
```

The MVP transport should be:

```text
stdio
```

Do not expose a public HTTP server by default.

If HTTP transport is added later, bind only to:

```text
127.0.0.1
```

## 2. Server instruction

The MCP server should explain itself clearly to Codex:

```text
AgentHost is a universal local automation host. It can help operate many apps through layered strategies: app adapters, official APIs, CLI/scripts, browser automation, accessibility, GUI fallback, and guide mode. Prefer reliable app APIs and adapters over GUI clicking. Use GUI click/type only as fallback and only when policy allows. High-risk actions require approval.
```

## 3. Universal automation strategies

AgentHost supports these strategy names:

```ts
type AutomationStrategy =
  | "app_adapter"
  | "official_api"
  | "cli_or_script"
  | "browser_automation"
  | "accessibility"
  | "gui_control"
  | "guide_only";
```

Meaning:

### `app_adapter`

Use a dedicated AgentHost adapter for the app.

Example:

- future Blender adapter
- future VS Code adapter
- future LibreOffice adapter

### `official_api`

Use an official API, plugin API, extension API, or scripting API.

### `cli_or_script`

Use a command-line interface or script.

Examples:

- shell command
- Python script
- app CLI

### `browser_automation`

Use a controlled browser automation layer.

Not Phase 0 + Phase 1.

### `accessibility`

Use OS accessibility tree.

Not Phase 0 + Phase 1.

### `gui_control`

Use screenshot, click, type, and hotkeys.

Not Phase 0 + Phase 1.

### `guide_only`

Do not control the app. Generate user-facing steps.

Useful for unsupported or sensitive apps.

## 4. Phase 0 + Phase 1 tools

These are the first tools to implement.

### `system.get_info`

Purpose:

Return OS, platform, Node version, AgentHost folder, config profile, and basic capabilities.

Input:

```json
{}
```

Example output data:

```json
{
  "platform": "linux",
  "arch": "x64",
  "nodeVersion": "v22.0.0",
  "agentHostDir": "/home/user/.agenthost",
  "profile": "dev"
}
```

Risk:

```text
observe
```

### `system.list_capabilities`

Purpose:

Return the capabilities AgentHost currently exposes.

Input:

```json
{}
```

Example output data:

```json
{
  "strategies": [
    "app_adapter",
    "official_api",
    "cli_or_script",
    "browser_automation",
    "accessibility",
    "gui_control",
    "guide_only"
  ],
  "tools": [
    {
      "name": "system.get_info",
      "riskLevel": "observe",
      "description": "Returns local system information."
    },
    {
      "name": "system.list_capabilities",
      "riskLevel": "observe",
      "description": "Lists AgentHost capabilities."
    }
  ]
}
```

Risk:

```text
observe
```

## 5. Phase 2+ tools

These should be added after the safety engine exists.

### `system.check_dependency`

Checks whether a command or app exists.

### `app.detect`

Detects whether an app is available and what strategies can control it.

Example:

```json
{
  "appName": "GIMP"
}
```

Output:

```json
{
  "found": true,
  "appId": "gimp",
  "recommendedStrategy": "guide_only",
  "availableStrategies": ["gui_control", "guide_only"],
  "adapterAvailable": false
}
```

### `app.open`

Opens an app.

Risk:

```text
medium
```

### `app.get_strategy`

Given an app and task type, recommends the best strategy.

### `shell.run_safe`

Runs a classified shell command with timeout.

### `file.write`

Writes to approved folders only.

### `file.exists`

Checks path existence.

### `file.list`

Lists approved folders.

### `approval.request`

Requests user approval.

### `log.get_recent`

Returns recent audit logs.

## 6. Future tools

### Desktop tools

```text
desktop.screenshot
desktop.click
desktop.type_text
desktop.hotkey
```

These are powerful but risky. Add only after safety and approvals are stable.

### Browser tools

```text
browser.open_url
browser.controlled_session
browser.fill_form
```

Do not submit forms without approval.

### Communication tools

```text
email.prepare_draft
message.prepare_draft
```

Do not send messages automatically in MVP.

### Skill tools

```text
skill.save_trace
skill.list
skill.run
```

## 7. App adapter system

AgentHost should support optional app adapters.

Adapters are not required for the core to run.

### App adapter interface

```ts
interface AppAdapter {
  id: string;
  displayName: string;
  supportedPlatforms: string[];
  getCapabilities(): AppCapability[];
  execute(action: unknown, context: ToolContext): Promise<ToolResult>;
}
```

### Adapter registry

The adapter registry should:

- register adapters
- list adapters
- find adapter by app id
- list adapter capabilities
- avoid loading unsupported adapters
- keep app-specific code out of the core

### Example future adapter: Blender

Blender is a good demo because it has a Python API.

But it should live outside the core:

```text
packages/app-blender/
```

The core must not import Blender-specific code directly.

## 8. Unknown app behavior

AgentHost must handle unknown apps gracefully.

If no adapter exists:

```json
{
  "appId": "unknown:some-app",
  "adapterAvailable": false,
  "availableStrategies": ["guide_only"],
  "recommendedStrategy": "guide_only",
  "reason": "No adapter, CLI, API, browser, or accessibility method is available yet."
}
```

If GUI control is enabled by policy:

```json
{
  "availableStrategies": ["gui_control", "guide_only"],
  "recommendedStrategy": "guide_only",
  "reason": "GUI control is possible but risky. Guide mode is safer."
}
```

## 9. Tool result standard

All tools must return:

```ts
interface ToolResult<T = unknown> {
  ok: boolean;
  tool: string;
  riskLevel: RiskLevel;
  strategy?: AutomationStrategy;
  approval: {
    required: boolean;
    status: ApprovalStatus;
    reason?: string;
  };
  data: T | null;
  observations: string[];
  error: null | {
    code: string;
    message: string;
    details?: unknown;
  };
}
```

## 10. Codex behavior expectation

Codex should:

- call `system.list_capabilities` before assuming tools exist
- prefer app adapters over GUI control
- prefer guide mode for unsupported sensitive apps
- validate outputs after actions
- avoid sending communications without explicit approval
- avoid shell commands that are destructive or unnecessary
