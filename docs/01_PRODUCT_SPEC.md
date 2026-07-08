# AgentHost Product Specification

## 1. Product summary

**AgentHost** is a local workstation capability runtime for AI agents. It gives Codex-style agents a safe, permissioned “body” on a real computer.

The product direction is:

> Give Codex safe superpowers on your computer.

AgentHost is not a Blender automation tool, a generic chatbot, or a bot that randomly clicks around. It is a local capability platform that exposes structured tools for apps, files, shell, desktop UI, accessibility, adapters, previews, confirmations, and future tool creation.

## 2. Core idea

Codex and similar AI agents are strong at reasoning, planning, code generation, debugging, and tool use. Their limitation is controlled access to the real machine.

AgentHost provides the missing layer:

```text
Codex / AI agent
  ↓
AgentHost MCP server
  ↓
Safety kernel + policy + dry-run preview + confirmation token
  ↓
Universal tools + app adapters + OS adapters
  ↓
Real apps, files, shell, browser, desktop, APIs
```

Mental model:

```text
Codex = pilot / brain
AgentHost = suit / sensors / tools / safety system
```

## 3. Product positioning

AgentHost should be positioned as:

> A local AI workstation capability suit for Codex and other agents.

Not:

> A Blender app.
> A remote-control app.
> A chat assistant clone.

Blender is only the first optional adapter demo. Gmail, browser, VS Code, terminal workflows, document tools, and user-generated tools should become adapters or capabilities later.

## 4. Target users

### Early users

- developers
- AI power users
- Codex users
- Linux users
- automation builders
- people building local AI agents
- creators who want auditable app automation

### Later users

- designers
- video editors
- office workers
- support teams
- companies that want local workflow automation
- teams that need auditable AI-assisted desktop operations

## 5. Main use cases

### 5.1 Codex gains local capabilities

User asks:

```text
Use the local app, inspect the output, run the safe command, write the result, and verify it.
```

AgentHost helps Codex:

1. list available capabilities
2. detect apps and desktop/session state
3. choose the safest strategy
4. preview state-changing actions
5. require confirmation tokens for exact execution
6. validate postconditions
7. log every action

### 5.2 App automation from prompt

User asks:

```text
Open the app, do the task, export the result, and prepare a message with the output.
```

AgentHost helps the AI:

1. detect the app
2. choose the safest strategy
3. use an adapter/API/CLI/accessibility first
4. use GUI fallback only when policy allows
5. stop before risky final actions

### 5.3 Guided assistance for unsupported apps

If AgentHost cannot safely automate an app, it should guide the user instead.

Example:

```text
I do not have a safe adapter for this app yet. I can guide you step by step.
```

Guide mode can include:

- instructions
- commands to copy
- menu paths
- warnings
- later UI overlays

### 5.4 Reusable skills and generated tools

When a workflow works, AgentHost should be able to save it as a reusable skill.

When a needed capability does not exist, future AgentHost should allow Codex to propose a new tool through **Tool Forge**:

```text
Codex proposes tool
  ↓
AgentHost creates isolated tool package
  ↓
Manifest declares permissions
  ↓
Tests run
  ↓
User approves
  ↓
Tool becomes available with limited permissions
```

### 5.5 Gmail/browser style workflows

The goal is not to blindly click around Gmail. For Gmail or browser workflows, AgentHost should prefer:

1. official API adapter
2. browser DOM adapter
3. accessibility
4. GUI fallback only with strict preview/confirmation
5. guide mode for sensitive actions

Example future behavior:

```text
Read today's Gmail emails and summarize them.
```

Preferred implementation:

```text
gmail.readonly adapter
  → list today's emails
  → read selected messages
  → summarize
  → never send/delete/archive without explicit approval
```

## 6. Universal automation strategy

For any app or task, AgentHost chooses the best available strategy in this order:

1. **App-specific adapter**
2. **Official API or plugin API**
3. **CLI/script interface**
4. **Browser automation**
5. **Accessibility tree**
6. **GUI screenshot/click/type fallback**
7. **Guide mode only**

This priority order is central to the product.

Screen clicking is a fallback, not the foundation.

## 7. Current implemented capability state

As of Phase 11, AgentHost has implemented:

- TypeScript monorepo and MCP stdio server
- universal core types
- safety engine and policy profiles
- JSONL audit logging
- system/app/shell/file tools
- guide mode
- generic adapter registry
- optional Blender adapter with `blender.run_python`
- Linux desktop tools:
  - `desktop.get_capabilities`
  - `desktop.get_active_window`
  - `desktop.screenshot`
  - `desktop.click`
  - `desktop.type_text`
  - `desktop.hotkey`
- window tools:
  - `window.list`
  - `window.focus`
- accessibility tools:
  - `accessibility.get_tree`
  - `accessibility.find_element`
  - `accessibility.inspect_element`
  - `accessibility.invoke_action`
  - `accessibility.set_value`
  - `accessibility.focus_element`
- `dryRun: true` previews for state-changing tools
- confirmation tokens for execute-after-preview
- X11 support via safe tools such as `xdotool`, `wmctrl`, `scrot`, and AT-SPI
- clean unsupported results on Wayland when safe backends are unavailable

## 8. MVP scope after Phase 11

The current MVP is no longer just “hello-world MCP.” It is now:

> A local MCP runtime that lets Codex inspect and operate the local Linux workstation through safety-gated tools, dry-run previews, confirmation tokens, app adapters, and accessibility-aware targeting.

### MVP platform

- Ubuntu Linux first
- GNOME preferred
- X11 is currently best for desktop automation
- Wayland returns safe unsupported results where required
- Windows/macOS later

### MVP client

- Codex through MCP first
- other MCP clients later
- desktop control UI later

## 9. Non-goals for near-term MVP

Do not implement these until the permission model and UI are stable:

- autonomous background execution
- silent email/chat sending
- public HTTP server
- remote control without pairing
- bypassing login/CAPTCHA/payment confirmations
- secret extraction
- hidden persistence
- broad “approval never” autopilot
- raw GUI clicking as default
- skill recording/replay without confirmation and checkpoints

## 10. Product principles

1. **Universal first**  
   The core must work for many apps, not one app.

2. **Safe by default**  
   Dangerous actions require approval, preview, confirmation, or are blocked.

3. **Local-first**  
   Files, screenshots, logs, and tools stay local unless the user approves otherwise.

4. **Inspectable**  
   Every action should be logged and explainable.

5. **Extensible**  
   New adapters/tools can be added without changing core architecture.

6. **Reliable over magical**  
   Prefer APIs, scripts, CLI, accessibility, and deterministic tools over visual guessing.

7. **Preview before action**  
   State-changing tools should support `dryRun: true`.

8. **Exact confirmation before execution**  
   After Phase 11, eligible actions should execute only when the confirmation token still matches the exact previewed input/target/risk.

9. **Human remains in control**  
   The user can approve, deny, pause, stop, or switch to guide mode.

## 11. OpenClaw-inspired product lessons

OpenClaw is useful as a reference for channels, memory, plugin manifests, skills, sub-agents, and control UI. AgentHost should adopt the best product patterns without copying its chat-first positioning.

AgentHost should eventually add:

- plugin/tool manifests
- skill registry
- permission profiles and capability grants
- desktop/tray control room
- audit log viewer
- mobile approval notifications later
- optional channel gateway later
- Tool Forge for generated tools

AgentHost should remain differentiated as:

> A local workstation capability platform for coding agents, with stronger previews, confirmation tokens, permission manifests, and safety governance.

## 12. Success criteria for current technical foundation

Current foundation is successful when:

- Codex can connect to AgentHost
- capabilities can be listed
- app/desktop/session capabilities are detected
- safe shell/file tools work
- Blender adapter works as optional adapter
- accessibility can find/inspect elements on X11
- ambiguous actions are rejected
- secret data is blocked
- dry-run previews never execute
- confirmation tokens are session-bound, single-use, expiring, and exact-match
- build/test/lint/smoke pass
