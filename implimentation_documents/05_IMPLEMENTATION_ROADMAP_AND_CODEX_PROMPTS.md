# AgentHost Implementation Roadmap and Codex Prompts

## 1. Development strategy

Build AgentHost in small milestones.

Do not ask Codex to implement everything at once.

Use this loop:

```text
Plan mode
  ↓
Codex proposes files and steps
  ↓
You approve
  ↓
Normal mode implementation
  ↓
Build/test/lint
  ↓
Review
  ↓
Next phase
```

Start with Phase 0 + Phase 1 only.

## 2. Phase roadmap

### Phase 0 — Repo and MCP hello world

Goal:

Create the basic TypeScript monorepo and a working MCP server skeleton.

Deliverables:

- npm workspaces
- strict TypeScript setup
- package structure
- basic MCP server
- `system.get_info` tool
- README setup instructions

Acceptance criteria:

- repo installs dependencies
- repo builds
- MCP server starts
- Codex can connect to MCP server
- `system.get_info` returns a structured `ToolResult`

### Phase 1 — Universal core

Goal:

Create app-agnostic foundations.

Deliverables:

- `RiskLevel`
- `ApprovalStatus`
- `AutomationStrategy`
- `ToolResult`
- `AppCapability`
- `AppAdapter`
- `PolicyProfile`
- `SystemInfo`
- config loader
- JSONL logger
- capability registry
- `system.list_capabilities`

Acceptance criteria:

- no app-specific dependency in core
- no Blender hardcoding
- capabilities can be listed
- logs are written locally
- config can be loaded
- tests pass

### Phase 2 — Safety engine

Goal:

Implement universal risk and policy logic.

Deliverables:

- risk classifier
- app sensitivity classifier
- shell command classifier
- protected path checks
- redaction utility
- approval model
- strict/dev/autopilot profiles

Acceptance criteria:

- dangerous shell patterns are blocked/high-risk
- protected paths are detected
- communication/financial/security apps are classified
- high-risk actions require approval or are blocked
- tests cover risk rules

### Phase 3 — Generic Linux automation

Goal:

Implement app-agnostic Linux tools.

Deliverables:

- `system.check_dependency`
- `app.detect`
- `app.list_installed`
- `app.open`
- `app.get_strategy`
- `shell.run_safe`
- `file.write`
- `file.read`
- `file.exists`
- `file.list`
- `file.ensure_dir`

Acceptance criteria:

- can detect common commands/apps
- can run safe shell commands
- can write only to approved roots
- unknown apps return guide-mode strategy
- all tools log actions

### Phase 4 — Guide mode

Goal:

Support apps that do not have adapters.

Deliverables:

- `guide.create_steps`
- structured guide step format
- recommended strategy for unsupported apps
- text-based guide output

Acceptance criteria:

- unsupported app workflows do not fail
- system recommends guide mode when automation is unsafe
- no clicking required

### Phase 5 — First optional app adapter demo

Goal:

Prove the app adapter system.

Recommended demo adapter:

- Blender, because it has a Python API and a visual output

Deliverables:

- optional `packages/app-blender`
- adapter registration
- `blender.run_python`
- example script
- output validation

Acceptance criteria:

- Blender adapter is optional
- core does not import Blender-specific code
- if Blender missing, clean error is returned

### Phase 6 — Browser/email draft workflow

Goal:

Show cross-app workflow without unsafe sending.

Deliverables:

- `browser.open_url`
- `email.prepare_draft`
- attachment guidance
- sending blocked by default

Acceptance criteria:

- draft can be prepared
- user must review/send manually
- no silent sending

### Phase 7 — GUI fallback

Goal:

Add generic screen control carefully.

Deliverables:

- `desktop.screenshot`
- `desktop.click`
- `desktop.type_text`
- `desktop.hotkey`
- active window context
- strict approvals

Acceptance criteria:

- disabled by default in strict profile
- requires approval/session permission
- guide mode preferred for sensitive apps

### Phase 8 — Control room UI

Goal:

Make AgentHost visible and trustworthy.

Deliverables:

- Electron app
- approval dialogs
- logs viewer
- current action viewer
- emergency stop
- capability viewer
- config profile selector

### Phase 9 — Skill recording and replay

Goal:

Turn successful workflows into reusable skills.

Deliverables:

- trace format
- skill save
- skill list
- skill replay
- parameter extraction
- validation checkpoints

### Phase 10 — More app adapters

Add adapters based on demand:

- GIMP
- LibreOffice
- VS Code
- terminal workflows
- browser workflows
- file manager
- DaVinci Resolve
- Photoshop if feasible
- Figma if feasible

### Phase 11 — Windows and macOS

Add platform adapters:

- Windows adapter
- macOS adapter
- capability matrix
- platform permission docs

## 3. Prompt 1 — Plan mode before implementation

Use this first in Codex Plan mode.

```text
We are building AgentHost, a universal local MCP server that gives Codex-style agents a safe, permissioned body on a real computer.

The product must be app-agnostic. It should eventually automate many apps through layered strategies:
1. app-specific adapter
2. official API/plugin API
3. CLI/script interface
4. browser automation
5. accessibility tree
6. GUI screenshot/click/type fallback
7. guide mode

Blender is only a possible future demo adapter. Do not hardcode the architecture around Blender.

Read these docs in /docs:
- 01_PRODUCT_SPEC.md
- 02_SYSTEM_ARCHITECTURE.md
- 03_MCP_TOOLS_AND_ADAPTERS.md
- 04_SECURITY_PERMISSIONS_AND_LOGGING.md
- 05_IMPLEMENTATION_ROADMAP_AND_CODEX_PROMPTS.md

Also read AGENTS.md if it exists.

Your job right now is NOT to implement everything.

First, inspect the workspace and produce a concrete implementation plan for Phase 0 + Phase 1 only.

Phase 0:
- TypeScript monorepo
- npm workspaces
- MCP server skeleton
- system.get_info hello-world tool
- README setup

Phase 1:
- app-agnostic core types
- ToolResult format
- AutomationStrategy type
- AppCapability type
- AppAdapter interface
- capability registry
- JSONL logger
- config loader
- basic policy profile structure
- system.list_capabilities tool

Before writing code, output:
1. the repo structure you plan to create
2. exact files to create or edit
3. package/dependency choices and why
4. how the design stays app-agnostic
5. how app-specific adapters will be added later without changing core
6. how to run and test the result
7. what “done” means for Phase 0 + Phase 1
8. risks or assumptions

Constraints:
- Do not implement Blender yet.
- Do not implement GUI clicking yet.
- Do not implement GUI typing yet.
- Do not implement browser automation yet.
- Do not implement email sending.
- Do not implement Windows/macOS yet.
- Do not implement skill recording yet.
- Do not use dangerous full access.
- Every future tool must pass through safety, policy, approval, and logging.
- Ask me for approval before implementation.
```

## 4. Prompt 2 — Approval to implement Phase 0 + Phase 1

Use this after Codex gives you a good plan.

```text
Approved. Implement only Phase 0 + Phase 1 from your plan.

Keep the implementation universal and app-agnostic.

Important:
- Do not implement Blender yet.
- Do not hardcode Blender into core.
- Do not implement GUI clicking/type yet.
- Do not implement browser automation yet.
- Do not implement email sending.
- Do not start Phase 2.

After implementation:
- show final file tree
- show changed files
- explain how to run the MCP server
- explain how to test system.get_info
- explain how to test system.list_capabilities
- run available build/test/lint commands
- summarize what Phase 2 should be next
```

## 5. Prompt 3 — Create or update AGENTS.md

Use this if Codex has not created `AGENTS.md`.

```text
Create or update AGENTS.md at the project root.

It should instruct future Codex sessions that:
- AgentHost is a universal local MCP server for automating many apps safely.
- The architecture must be app-agnostic.
- Blender is only an optional future demo adapter.
- The automation strategy order is:
  1. app-specific adapter
  2. official API/plugin API
  3. CLI/script interface
  4. browser automation
  5. accessibility tree
  6. GUI screenshot/click/type fallback
  7. guide mode
- Current milestone is Phase 0 + Phase 1 unless I say otherwise.
- Do not implement Blender, GUI clicking, email sending, browser automation, Windows/macOS, or skill recording yet.
- Every future tool must go through schema validation, risk classification, policy, approval if needed, execution, and audit logging.
- Core must not depend on app-specific or OS-specific implementation.
- Add tests for core behavior.
- Run build/test/lint before finishing when scripts exist.
```

## 6. Prompt 4 — Phase 2 safety engine later

Use only after Phase 0 + Phase 1 are complete.

```text
Now implement Phase 2: universal safety engine.

Requirements:
- risk classifier
- app sensitivity classifier
- shell command classifier
- protected path policy
- approval requirement model
- redaction utility
- policy profiles: strict, dev, autopilot

The safety engine must be app-agnostic.

Risk should consider:
- tool name
- action type
- app/site category
- automation strategy
- file path
- shell command
- whether data is external, sensitive, destructive, or communicative

Add tests for:
- safe shell commands
- dangerous shell patterns
- protected paths
- communication apps
- financial apps
- security/credential apps
- generic click/type risk
- email send blocked
- unknown actions defaulting conservative
```

## 7. Prompt 5 — Phase 3 generic Linux automation later

Use only after Phase 2 is complete.

```text
Now implement Phase 3: generic Linux automation.

Requirements:
- system.check_dependency
- app.detect
- app.list_installed best effort
- app.open
- app.get_strategy
- shell.run_safe
- file.write
- file.read
- file.exists
- file.list
- file.ensure_dir

Keep these app-agnostic.

Do not add Blender yet.

If an app has no adapter, app.detect should return available fallback strategies and recommend guide_only by default. If policy permits GUI control, include gui_control as available but still prefer guide_only unless the user explicitly asks for automation.

All tools must go through safety/policy/logging.
```

## 8. Prompt 6 — Phase 5 optional adapter demo later

Use only after generic foundations are stable.

```text
Now implement Phase 5: first optional app adapter demo.

Use Blender only as an optional adapter example, not as core functionality.

Requirements:
- implement the shared AppAdapter interface
- place code in packages/app-blender or packages/app-adapters/blender
- expose blender.run_python only through adapter registration
- run Blender Python in background mode
- save outputs under approved AgentHost output folder
- validate output files
- include one demo workflow

The core packages must not import Blender-specific code directly.
```

## 9. Recommended Codex settings

For this project, use:

```text
Plan mode first.
```

Then approve only the current phase.

Use safe permissions:

```text
workspace-write
approval: on-request
```

Avoid:

```text
danger-full-access
approval: never
```

This project will eventually touch OS automation, shell, files, and desktop apps, so small approved milestones are important.

## 10. First done definition

Phase 0 + Phase 1 are done when you can say:

```text
AgentHost has a clean TypeScript monorepo, a working MCP server skeleton, universal core types, a capability registry, config loading, JSONL logging, and two observe-level tools: system.get_info and system.list_capabilities.
```
