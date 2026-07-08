# AgentHost Implementation Roadmap and Codex Prompts

## 1. Development strategy

Build AgentHost in small milestones.

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
Build/test/lint/smoke
  ↓
Runtime test with AgentHost
  ↓
Commit
  ↓
Next phase
```

Recommended model usage:

```text
Planning:        GPT-5.5 + high
Implementation: GPT-5.4 + medium
Bug fixing:     GPT-5.4 + medium, then GPT-5.5 if stuck
Cleanup:        GPT-5.4 mini
```

Keep Codex in:

```text
sandbox_mode = "workspace-write"
approval_policy = "on-request"
```

Do not use global `approval: never` for AgentHost.

## 2. Completed phases

### Phase 0 — Repo and MCP hello world

Completed.

Delivered:

- TypeScript monorepo
- npm workspaces
- MCP server skeleton
- `system.get_info`
- initial setup instructions

### Phase 1 — Universal core

Completed.

Delivered:

- universal types
- `ToolResult`
- `AutomationStrategy`
- `AppCapability`
- `AppAdapter`
- config loader
- JSONL logger
- capability registry
- `system.list_capabilities`

### Phase 2 — Safety engine

Completed.

Delivered:

- risk classifier
- app sensitivity classifier
- shell command classifier
- protected path checks
- redaction utility
- policy profiles
- safety-gated tool runner

### Phase 3 — Generic Linux automation

Completed.

Delivered:

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

### Phase 4 — Guide mode

Completed.

Delivered:

- `guide.create_steps`
- `guide.explain_strategy`
- guide suggestions in app strategy results

### Phase 5 — App adapter system

Completed.

Delivered:

- adapter interface improvements
- adapter registry
- adapter discovery tools:
  - `adapter.list`
  - `adapter.get_capabilities`
  - `adapter.detect_for_app`

### Phase 6 — Optional Blender adapter demo

Completed and tested.

Delivered:

- `packages/app-blender`
- optional Blender adapter
- `blender.run_python`
- background execution
- coffee cup demo
- output validation
- clean missing-Blender errors

### Phase 7 — Safe generic GUI fallback

Completed.

Delivered:

- `desktop.get_active_window`
- `desktop.screenshot`
- `desktop.hotkey`
- `desktop.type_text`
- `desktop.click`
- active-window context requirements
- default policy blocking/gating for state-changing GUI actions
- clean Wayland unsupported results

### Phase 8 — Desktop introspection and accessibility routing

Completed.

Delivered:

- `desktop.get_capabilities`
- `window.list`
- `window.focus`
- `accessibility.get_tree`
- `accessibility.find_element`
- strategy routing prefers accessibility before raw GUI
- X11/Wayland capability detection
- AT-SPI support on Linux

### Phase 9 — Safe accessibility-driven actions

Completed.

Delivered:

- `accessibility.inspect_element`
- `accessibility.invoke_action`
- `accessibility.set_value`
- `accessibility.focus_element`
- ambiguous target rejection
- secret set_value blocking
- no raw GUI fallback

### Phase 9.1 — Accessibility null-field bugfix

Completed.

Delivered:

- `accessibility.find_element` no longer crashes on null AT-SPI fields
- safe string normalization
- regression tests

### Phase 10 — Dry-run previews

Completed.

Delivered:

- `dryRun:true` support for state-changing tools
- preview results with:
  - `wouldExecute`
  - `wouldRequireApproval`
  - `wouldBeBlocked`
  - `riskLevel`
  - `targetSummary`
  - `ambiguous`
  - `matchedRules`
  - `saferAlternative`

### Phase 11 — Confirmation tokens

Completed.

Delivered:

- in-memory session-bound confirmation manager
- preview token generation
- execute-after-preview with exact matching
- token expiry
- single-use replay protection
- wrong-tool rejection
- changed-input rejection
- changed-target rejection
- raw token redaction in logs
- secret redaction preserved

## 3. Current capability checkpoint

AgentHost can now:

- list tools/capabilities
- detect apps
- choose strategy
- run safe shell commands
- read/write approved files
- run Blender adapter
- inspect desktop capabilities
- list/focus windows on X11
- use AT-SPI accessibility reads/actions
- reject ambiguous UI actions
- preview state-changing actions
- issue confirmation tokens
- execute only exact previewed actions
- audit log every tool call

## 4. Recommended next phases

### Phase 12 — Permission profiles and capability grants

Goal:

Turn current safety logic into explicit user-facing permission grants.

Deliverables:

- formal profile schema:
  - strict
  - dev
  - gui-dev
  - work
  - private-data
- per-tool grants
- per-app grants
- per-directory grants
- per-domain grants later
- session vs persistent grants
- grant listing and revocation
- policy explanation output

Acceptance criteria:

- tools can explain why they are allowed/blocked
- user can grant only specific capabilities
- generated tools later must declare requested grants
- sensitive apps remain protected
- tests cover grant resolution

### Phase 13 — Tool Forge manifest foundation

Goal:

Let Codex propose/build new tools safely, with manifests and tests.

Deliverables:

- `agenthost.tool.json` manifest schema
- tool package scaffold
- permission declarations
- allowed network/domain declarations
- allowed filesystem declarations
- risk declaration
- dry-run/confirmation requirements
- test requirements
- `tool_forge.validate_manifest`
- `tool_forge.create_scaffold`
- `tool_forge.run_tests`

Acceptance criteria:

- generated tools cannot register without manifest
- manifest must declare permissions
- tests must pass
- no unrestricted tools
- no hidden network/file access

### Phase 14 — Skills registry

Goal:

Add reusable skills/workflows separate from tools.

Deliverables:

- `skills/<skill>/SKILL.md`
- skill metadata
- required tools
- risk policy
- guide steps
- dry-run recommendations
- capability checks
- skill list/inspect
- skill run dry mode

Acceptance criteria:

- Codex can discover skills
- skills do not bypass tool safety
- skills can recommend tools but not execute hidden actions

### Phase 15 — Control Room desktop app

Goal:

Make AgentHost visible and trustworthy.

Deliverables:

- tray app or Electron/Tauri desktop shell
- MCP server status
- connected sessions
- approval queue
- confirmation preview cards
- audit log viewer
- permissions profile selector
- emergency stop
- capability viewer
- installed adapters/tools/skills

Acceptance criteria:

- user can see what AgentHost is doing
- user can approve/deny actions
- user can stop a session
- logs are readable
- permissions are understandable

### Phase 16 — Browser adapter

Goal:

Add safer browser automation before using raw GUI for web apps.

Deliverables:

- controlled browser session
- open URL
- read page title/URL
- extract page text/DOM summary
- find element by selector/text
- prepare form fill
- click/fill dry-run
- no submit without confirmation

Acceptance criteria:

- browser actions are previewable
- no form submission without explicit confirmation
- sensitive sites are protected
- Gmail/browser workflows prefer DOM/API over GUI

### Phase 17 — Gmail read-only adapter

Goal:

Demonstrate private-data workflow safely using official API.

Deliverables:

- Gmail OAuth read-only scope
- `gmail.list_today`
- `gmail.read_thread`
- `gmail.summarize_today`
- no send/delete/archive
- private-data redaction/logging rules

Acceptance criteria:

- user can explicitly ask to summarize today’s emails
- no message body is logged in full
- no sending/deleting/archiving
- communication safety is enforced

### Phase 18 — Workflow memory

Goal:

Remember safe project/workstation facts transparently.

Deliverables:

- `AGENTHOST_MEMORY.md`
- daily memory files
- remembered app strategies
- remembered project commands
- user-approved preferences
- memory search/inspect
- no hidden memory writes

Acceptance criteria:

- memory is visible/editable
- private data is not saved by default
- Codex can use memory to avoid repeated setup mistakes

### Phase 19 — Loop detection and circuit breaker

Goal:

Prevent agents from getting stuck or repeating harmful attempts.

Deliverables:

- repeated tool-call detector
- repeated failed action detector
- repeated approval prompt detector
- screenshot/click loop detector
- per-session circuit breaker

Acceptance criteria:

- AgentHost can stop repetitive loops
- logs explain why circuit breaker fired
- user can resume manually

### Phase 20 — Optional gateway and mobile approvals

Goal:

Borrow the best of OpenClaw-style channels without becoming chat-first.

Deliverables:

- optional local gateway
- mobile approval notifications
- webhook/channel abstraction
- pairing/allowlist
- no public exposure by default

Acceptance criteria:

- local-first remains default
- remote access requires pairing
- sensitive tools remain restricted

## 5. Phase 12 planning prompt

Use GPT-5.5 + high in Plan mode.

```text
We finished Phase 11 for AgentHost.

Current state:
- Phases 0 through 11 are complete.
- AgentHost supports dryRun previews and confirmation tokens.
- Confirmation tokens are session-bound, short-lived, single-use, and exact-match.
- State-changing tools include shell/file/app/window/desktop/accessibility actions.
- Sensitive apps and secret data remain protected.
- Build/test/lint/smoke pass.

Now plan Phase 12 only: permission profiles and capability grants.

Do not implement yet.

Goal:
Turn AgentHost’s current safety/policy behavior into explicit user-facing permission profiles and capability grants.

Required:
1. Formal profile schema:
   - strict
   - dev
   - gui-dev
   - work
   - private-data
2. Capability grant model:
   - tool grants
   - app grants
   - file root grants
   - shell command family grants
   - desktop action grants
   - accessibility action grants
   - future network/domain grants
3. Session vs persistent grants.
4. Grant explanation:
   - why allowed
   - why blocked
   - what grant would be needed
5. Grant listing/revocation tools.
6. Tests for grant resolution.
7. Preserve all current safety behavior.

Constraints:
- Do not implement Tool Forge yet.
- Do not implement browser automation.
- Do not implement Gmail adapter.
- Do not implement Control Room UI yet.
- Do not weaken safety.
- Do not allow generated tools yet.
- Do not bypass approvals.
- Do not use sudo or install dependencies.

Before writing code, output:
1. current repo state summary
2. exact files to create/edit
3. profile schema design
4. grant model design
5. session vs persistent grant behavior
6. how grant resolution integrates with safety preflight
7. new tools, if any
8. migration/backward compatibility
9. tests to add/update
10. build/test/lint/smoke commands
11. what done means

Ask for approval before implementation.
```

## 6. Phase 12 implementation prompt

Use GPT-5.4 + medium after approving the plan.

```text
Approved. Implement Phase 12 only: permission profiles and capability grants.

Current state:
- Phase 11 confirmation tokens are complete.
- Dry-run preview and exact confirmation are working.
- Build/test/lint/smoke pass.

Requirements:
- Add formal permission profile schema.
- Add capability grant model.
- Support session and persistent grants if feasible in scope.
- Add grant explanation to safety decisions/results where appropriate.
- Add tools if included in the approved plan, for example:
  - policy.get_profile
  - policy.list_grants
  - policy.explain_decision
  - policy.revoke_grant
- Do not create a UI yet.
- Do not implement Tool Forge yet.
- Preserve existing behavior by default.
- Keep strict/dev/gui-dev conservative.
- Sensitive apps remain blocked/high-risk.
- Confirmation tokens still required where configured.
- Add tests for profile/grant resolution.

After implementation:
- show changed files
- explain profile/grant API
- show allowed/blocked examples
- run:
  npm run build
  npm test
  npm run lint
  npm run smoke:mcp
- summarize Phase 13 recommendation
```

## 7. Documentation update prompt

Use after replacing these docs in the repo.

```text
Read the updated docs in /docs and compare them with the current implementation.

Verify:
- Phase roadmap matches current completed phases.
- Tool list matches system.list_capabilities.
- Security doc includes dryRun and confirmation tokens.
- Architecture doc includes confirmation manager and future Tool Forge.
- Product spec clearly positions AgentHost as a local Codex capability suit.

If anything is inconsistent, patch the docs only.
Do not change code.
Run markdown lint if available.
```
