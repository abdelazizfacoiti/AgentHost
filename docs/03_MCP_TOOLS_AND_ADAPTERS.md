# AgentHost MCP Tools and Adapter Specification

## 1. MCP server goal

The AgentHost MCP server exposes local computer capabilities to Codex and other AI agents.

The server name should be:

```text
agenthost
```

The MVP transport remains:

```text
stdio
```

Do not expose a public HTTP server by default.

If HTTP transport is added later, bind only to:

```text
127.0.0.1
```

and require pairing/authentication.

## 2. Server instruction

The MCP server should explain itself clearly to Codex:

```text
AgentHost is a universal local automation host. Prefer app adapters, official APIs, CLI/scripts, browser automation, and accessibility before GUI clicking. Use GUI click/type only as fallback and only when policy allows. For state-changing tools, preview with dryRun:true first, then execute only with a matching confirmation token when required. High-risk actions require approval or are blocked.
```

## 3. Universal automation strategies

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

Strategy priority:

1. app-specific adapter
2. official API/plugin API
3. CLI/script interface
4. browser automation
5. accessibility
6. GUI fallback
7. guide mode

## 4. Tool result standard

All tools return `ToolResult`.

Phase 10/11 extend normal results with preview and confirmation metadata when relevant.

```ts
interface ToolResult<T = unknown> {
  ok: boolean;
  tool: string;
  riskLevel: RiskLevel;
  strategy?: AutomationStrategy;
  preview?: boolean;
  confirmation?: {
    status: "previewGenerated" | "tokenUsed" | "tokenAccepted" | "tokenRejected";
    used: boolean;
    accepted: boolean;
    executed: boolean;
    reason: string;
    tokenId?: string;
    expiresAt?: string;
  };
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

## 5. Current tools by category

### Base tools currently returned by `system.list_capabilities`

These are the tools exposed by the default AgentHost runtime today:

```text
accessibility.find_element
accessibility.focus_element
accessibility.get_tree
accessibility.inspect_element
accessibility.invoke_action
accessibility.set_value
adapter.detect_for_app
adapter.get_capabilities
adapter.list
app.detect
app.get_strategy
app.list_installed
app.open
desktop.click
desktop.get_active_window
desktop.get_capabilities
desktop.hotkey
desktop.screenshot
desktop.type_text
file.ensure_dir
file.exists
file.list
file.read
file.write
guide.create_steps
guide.explain_strategy
shell.run_safe
system.check_dependency
system.get_info
system.list_capabilities
window.focus
window.list
```

### System tools

```text
system.get_info
system.list_capabilities
system.check_dependency
```

### App tools

```text
app.detect
app.list_installed
app.open
app.get_strategy
```

`app.open` supports `dryRun:true` and confirmation token execution.

### Shell tools

```text
shell.run_safe
```

`dryRun:true` classifies the command without running it.

Execution may require `confirmationToken`.

### File tools

```text
file.write
file.read
file.exists
file.list
file.ensure_dir
```

State-changing file tools support `dryRun:true` and confirmation tokens:

```text
file.write
file.ensure_dir
```

### Guide tools

```text
guide.create_steps
guide.explain_strategy
```

### Adapter discovery tools

```text
adapter.list
adapter.get_capabilities
adapter.detect_for_app
```

### Optional adapter-exposed tools

These are implemented, but they are not part of the default base capability list unless the adapter/tool is registered in the active runtime:

```text
blender.run_python
```

Blender is optional and app-specific. It runs in background mode, saves outputs only under approved folders, and validates expected `.blend` outputs.

### Desktop tools

```text
desktop.get_capabilities
desktop.get_active_window
desktop.screenshot
desktop.hotkey
desktop.type_text
desktop.click
```

State-changing desktop tools support dry-run and confirmation:

```text
desktop.hotkey
desktop.type_text
desktop.click
```

### Window tools

```text
window.list
window.focus
```

`window.focus` supports dry-run and confirmation.

### Accessibility tools

```text
accessibility.get_tree
accessibility.find_element
accessibility.inspect_element
accessibility.invoke_action
accessibility.set_value
accessibility.focus_element
```

State-changing accessibility tools support dry-run and confirmation:

```text
accessibility.invoke_action
accessibility.set_value
accessibility.focus_element
```

## 6. Dry-run and confirmation flow

For state-changing tools:

### Preview

```json
{
  "toolSpecificInput": "...",
  "dryRun": true
}
```

The tool should:

- validate schema
- run safety preflight
- resolve target if applicable
- detect ambiguity
- avoid all side effects
- return a structured preview

Preview data should include:

```json
{
  "preview": true,
  "wouldExecute": true,
  "wouldRequireApproval": false,
  "wouldBeBlocked": false,
  "riskLevel": "medium",
  "appSensitivity": "normal",
  "dataSensitivity": "none",
  "targetSummary": "Notes \"Draft\"",
  "ambiguous": false,
  "reasons": [],
  "matchedRules": [],
  "confirmationAvailable": true,
  "confirmationRequired": true,
  "confirmationToken": "<redacted in logs>",
  "tokenId": "token_...",
  "expiresAt": "...",
  "inputFingerprint": "input_...",
  "targetFingerprint": "target_...",
  "confirmationExplanation": "Use this token to execute the exact previewed action before it expires."
}
```

### Execute

```json
{
  "toolSpecificInput": "...",
  "confirmationToken": "<token-from-preview>"
}
```

Execution should verify:

- token exists
- token not expired
- token not used
- same session
- same tool
- same normalized input fingerprint
- same resolved target fingerprint when applicable
- same or safer risk

Then safety preflight still runs before execution.

## 7. App adapter system

AgentHost supports optional app adapters.

Adapters are not required for the core to run.

### App adapter interface

```ts
interface AppAdapter {
  id: string;
  displayName: string;
  supportedPlatforms: string[];
  getCapabilities(): AppCapability[];
}
```

Execution can be exposed either through adapter-specific MCP tools or a generic adapter execution path if added later.

### Adapter registry

The adapter registry should:

- register adapters
- list adapters
- find adapter by app id
- list adapter capabilities
- avoid loading unsupported adapters
- keep app-specific code out of the core

### Current adapter: Blender

```text
packages/app-blender/
```

Tool:

```text
blender.run_python
```

Capabilities:

- run built-in coffee cup demo
- run reviewed Blender Python
- save output under approved roots
- validate `.blend` outputs
- return clean `blender_not_found` if missing

## 8. Unknown app behavior

Unknown apps must not fail catastrophically.

If no adapter/CLI/API/accessibility/GUI method is available:

```json
{
  "appId": "unknown:some-app",
  "adapterAvailable": false,
  "availableStrategies": ["guide_only"],
  "recommendedStrategy": "guide_only",
  "reason": "No adapter, CLI, API, browser, accessibility, or GUI method is available yet."
}
```

If accessibility is available, prefer it before GUI control.

If GUI control is enabled by policy:

```json
{
  "availableStrategies": ["accessibility", "gui_control", "guide_only"],
  "recommendedStrategy": "accessibility",
  "reason": "Accessibility is safer than raw GUI control when available."
}
```

Sensitive apps should prefer guide mode or strict approval.

## 9. Future tools

### Browser tools

```text
browser.open_url
browser.get_page_context
browser.find_element
browser.click_selector
browser.fill_form
browser.extract_text
```

Do not submit forms without approval.

### Communication tools

```text
gmail.list_today
gmail.read_thread
email.prepare_draft
message.prepare_draft
```

Do not send messages automatically in MVP.

### Tool Forge tools

```text
tool_forge.propose_tool
tool_forge.create_scaffold
tool_forge.validate_manifest
tool_forge.run_tests
tool_forge.register_tool
```

Generated tools must have manifests, permission declarations, tests, and safety metadata.

### Skill tools

```text
skill.list
skill.inspect
skill.create
skill.run_dry
skill.run_confirmed
```

## 10. Codex behavior expectation

Codex should:

- call `system.list_capabilities` before assuming tools exist
- prefer app adapters over GUI control
- prefer official APIs over browser/GUI when available
- prefer accessibility over raw click/type
- use `dryRun:true` before state-changing actions
- execute with confirmation token only for the same target/input
- validate outputs after actions
- avoid sending communications without explicit approval
- avoid destructive shell commands
- use guide mode for sensitive or unsupported apps
