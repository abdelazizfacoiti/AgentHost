# AgentHost Product Specification

## 1. Product summary

**AgentHost** is a universal local runtime that gives AI agents a safe, permissioned way to operate a real computer.

It acts as a bridge between an AI agent such as Codex and the user’s local machine.

AgentHost exposes structured tools for:

- inspecting the operating system
- reading and writing approved files
- running safe shell commands
- detecting and opening apps
- focusing windows
- observing the desktop
- using browser workflows
- guiding unsupported app workflows
- controlling desktop apps through approved automation strategies
- using optional app-specific adapters
- requesting user approvals
- writing audit logs
- saving reusable workflow traces and skills

The goal is **not** to build a bot that randomly clicks around.

The goal is to build:

> A safe local host that lets AI agents automate real workflows across many apps through structured tools, policies, permissions, and logs.

## 2. Core idea

Codex and other AI agents are strong at reasoning, planning, code generation, and debugging.

Their limitation is not intelligence. Their limitation is controlled access to the real computer.

AgentHost gives the agent a safe “body”:

```text
AI agent / Codex
  ↓
AgentHost MCP server
  ↓
Safety + policy + approval system
  ↓
Universal automation layer
  ↓
OS adapter + optional app adapters
  ↓
Real apps, files, shell, browser, desktop
```

## 3. Product positioning

AgentHost should be positioned as:

> A universal local automation host for AI agents.

Not:

> A Blender automation app.

Blender may be used as a demo later, but the architecture must support many apps.

## 4. Target users

### Early users

- developers
- AI power users
- Linux users
- Codex users
- automation builders
- people building AI agents
- creators who want to automate repetitive app workflows

### Later users

- designers
- video editors
- support workers
- office workers
- students
- companies that want local workflow automation
- teams that need auditable AI-assisted desktop operations

## 5. Main use cases

### 5.1 App automation from prompt

User says:

```text
Open the app, do the task, export the result, and prepare a message with the output.
```

AgentHost helps the AI:

1. detect the app
2. choose the safest automation strategy
3. execute through approved tools
4. validate the result
5. stop before risky final actions

### 5.2 Guided assistance for unsupported apps

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

### 5.3 Reusable skills

When a workflow works, AgentHost should be able to save a trace and turn it into a reusable skill.

Example:

```text
resize-images-in-gimp.skill.json
prepare-monthly-report.skill.json
create-3d-model-in-blender.skill.json
```

### 5.4 Local-first automation

AgentHost should run locally by default. It should not expose a public server or send private files/screenshots externally without approval.

## 6. Universal automation strategy

For any app or task, AgentHost should choose the best available strategy in this order:

1. **App-specific adapter**
2. **Official API or plugin API**
3. **CLI/script interface**
4. **Browser automation**
5. **Accessibility tree**
6. **GUI screenshot/click/type fallback**
7. **Guide mode only**

This priority order is central to the product.

Screen clicking is a fallback, not the foundation.

## 7. MVP scope

The first MVP should be:

> A local MCP server that exposes universal, safe, app-agnostic automation tools to Codex.

### MVP platform

- Ubuntu Linux first
- GNOME desktop preferred
- Windows/macOS later

### MVP client

- Codex through MCP

### MVP tools

- `system.get_info`
- `system.list_capabilities`
- `system.check_dependency`
- `app.detect`
- `app.open`
- `app.get_strategy`
- `shell.run_safe`
- `file.write`
- `file.read`
- `file.exists`
- `file.list`
- `file.ensure_dir`
- `approval.request`
- `log.get_recent`

### MVP non-goals

Do not implement these in the first milestone:

- Blender adapter
- GUI clicking
- GUI typing
- browser automation
- email sending
- Windows support
- macOS support
- skill recording
- autonomous background operation

## 8. Product principles

1. **Universal first**  
   The core must work for many apps, not one app.

2. **Safe by default**  
   Dangerous actions require approval or are blocked.

3. **Local-first**  
   Files, screenshots, logs, and tools stay local unless the user approves otherwise.

4. **Inspectable**  
   Every action should be logged and explainable.

5. **Extensible**  
   New app adapters can be added without changing the core architecture.

6. **Reliable over magical**  
   Prefer APIs, scripts, and deterministic tools over visual guessing.

7. **Human remains in control**  
   The user can approve, deny, pause, stop, or switch to guide mode.

## 9. Success criteria for first milestone

Phase 0 + Phase 1 are successful when:

- the repo is created as a TypeScript monorepo
- the MCP server starts
- Codex can connect to the MCP server
- `system.get_info` works
- `system.list_capabilities` works
- core types exist
- tool result format is consistent
- a capability registry exists
- config loading works
- JSONL logging works
- basic policy profiles exist
- no app-specific code is hardcoded into the core
