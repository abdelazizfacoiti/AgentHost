# AgentHost System Architecture

## 1. Architecture overview

AgentHost is built around a simple idea:

> The AI agent plans. AgentHost executes through safe, structured local tools.

```text
┌──────────────────────────────────────────────────────────────┐
│ AI agent / Codex                                             │
│ - understands prompt                                         │
│ - plans workflow                                             │
│ - chooses tools                                              │
│ - writes scripts if needed                                   │
│ - validates results                                          │
└─────────────────────────────┬────────────────────────────────┘
                              │ MCP
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ AgentHost MCP Server                                         │
│ - exposes tools                                              │
│ - validates schemas                                          │
│ - runs safety preflight                                      │
│ - supports dry-run previews                                  │
│ - verifies confirmation tokens                               │
│ - returns structured ToolResult objects                      │
└─────────────────────────────┬────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ Safety Kernel / Core                                         │
│ - types                                                      │
│ - config                                                     │
│ - policy profiles                                            │
│ - risk classification                                        │
│ - app/data sensitivity classification                        │
│ - path and shell safety                                      │
│ - redaction                                                  │
│ - preview result format                                      │
│ - confirmation metadata types                                │
│ - audit logger                                               │
│ - capability registry                                        │
└───────────────┬──────────────────────────────┬───────────────┘
                │                              │
                ▼                              ▼
┌──────────────────────────────┐   ┌───────────────────────────┐
│ Universal Tool Layer          │   │ App Adapter Layer          │
│ - system                      │   │ - optional adapters        │
│ - apps                        │   │ - Blender adapter          │
│ - shell                       │   │ - browser later            │
│ - files                       │   │ - Gmail later              │
│ - guide                       │   │ - VS Code later            │
│ - desktop                     │   │ - user-generated later     │
│ - windows                     │   │                           │
│ - accessibility               │   │                           │
└───────────────┬──────────────┘   └────────────┬──────────────┘
                │                               │
                ▼                               ▼
┌──────────────────────────────────────────────────────────────┐
│ OS Adapter Layer                                             │
│ - Linux first                                                │
│ - X11 desktop backend                                        │
│ - Wayland capability detection / clean unsupported results   │
│ - Windows later                                              │
│ - macOS later                                                │
└─────────────────────────────┬────────────────────────────────┘
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ Real computer                                                │
│ - desktop apps                                               │
│ - shell                                                      │
│ - files                                                      │
│ - browser                                                    │
│ - OS windows                                                 │
│ - accessibility tree                                         │
└──────────────────────────────────────────────────────────────┘
```

## 2. Package responsibilities

### `packages/core`

App-agnostic shared product logic.

Responsibilities:

- shared types
- `ToolResult`
- `RiskLevel`, `ApprovalStatus`, `AutomationStrategy`
- policy profile types
- capability types
- preview/confirmation result types
- redaction
- safety classification
- audit log data shapes
- capability registry

Rule:

> `core` must not contain Linux-specific or app-specific implementation.

### `packages/mcp-server`

MCP runtime and tool orchestration.

Responsibilities:

- stdio MCP server
- tool schemas
- tool runner
- safety preflight integration
- dry-run preview path
- confirmation manager
- confirmation token verification
- tool result construction
- JSONL logging
- adapter runtime wiring

Important Phase 11 component:

```text
packages/mcp-server/src/confirmation.ts
```

This manages in-memory, session-bound, expiring, single-use confirmation tokens.

### `packages/os-linux`

Linux-specific implementation.

Responsibilities:

- system detection
- dependency checks
- shell execution
- file operations
- app detection/opening
- X11 desktop capability detection
- active window inspection
- screenshot backend
- window list/focus
- AT-SPI accessibility tree and element operations
- clean unsupported results for Wayland where safe backends are unavailable

### `packages/app-blender`

Optional Blender adapter.

Responsibilities:

- `createBlenderAdapter`
- `blender.run_python`
- background Blender execution
- output validation
- coffee cup demo

Rule:

> Blender remains an optional adapter and must not shape the core architecture.

### Future `packages/app-browser`

Browser adapter.

Responsibilities later:

- controlled browser sessions
- DOM reading
- URL opening
- form preparation
- safe browser actions with preview/confirmation
- never submit sensitive forms without approval

### Future `packages/app-gmail`

Gmail adapter.

Responsibilities later:

- official Gmail API / OAuth
- read-only email summaries first
- no sending/deleting/archiving in MVP
- strict private-data handling

### Future `apps/control-room`

Desktop/tray app.

Responsibilities later:

- MCP server lifecycle
- connected agents
- approval queue
- confirmation preview cards
- logs viewer
- permissions and profiles
- emergency stop
- capability viewer
- installed tools/adapters/skills

## 3. Tool execution flow

Every meaningful tool follows:

```text
MCP tool request
  ↓
schema validation
  ↓
risk classification
  ↓
policy check
  ↓
dry-run preview? ── yes ─→ target resolution if applicable
  │                       ↓
  │                   preview result
  │                       ↓
  │                   optional confirmation token
  │                       ↓
  │                   audit log
  │
  no
  ↓
confirmation token required? ── yes ─→ verify token
  │                                  ↓
  │                             reject if mismatch/expired/reused
  │
  ↓
approval if needed
  ↓
execute through tool/adapter/OS layer
  ↓
result validation/postcondition check
  ↓
audit log
  ↓
ToolResult returned to Codex
```

## 4. Confirmation token architecture

Phase 11 adds a confirmation manager in the MCP runtime/session layer.

Tokens are:

- in-memory
- session-bound
- short-lived, currently 3 minutes by default
- single-use
- bound to tool name
- bound to normalized input fingerprint
- bound to target fingerprint when applicable
- bound to risk level
- not allowed to contain raw secrets
- not logged raw

Execution with a token still runs safety preflight. Tokens do not bypass safety or Codex approval.

## 5. Dry-run preview architecture

Phase 10 added `dryRun: true` to state-changing tools instead of a separate `action.preview` tool.

Dry-run previews:

- never execute side effects
- still validate schema
- still run safety preflight
- resolve targets when possible
- return whether execution would happen
- indicate whether action would be blocked
- may mint a confirmation token if exact, safe, and unambiguous

## 6. Universal automation strategy

Strategy order remains:

1. app-specific adapter
2. official API/plugin API
3. CLI/script interface
4. browser automation
5. accessibility
6. GUI screenshot/click/type fallback
7. guide mode

## 7. Current repository structure

Representative structure after Phase 11:

```text
agenthost/
  package.json
  tsconfig.json
  AGENTS.md
  docs/

  packages/
    core/
      src/
        types.ts
        result.ts
        capabilities.ts
        safety/
        logging/
        config/

    mcp-server/
      src/
        index.ts
        server.ts
        context.ts
        tool-runner.ts
        confirmation.ts
        tools/
          system.ts
          app.ts
          shell.ts
          file.ts
          guide.ts
          adapter.ts
          blender.ts
          desktop.ts
          window.ts
          accessibility.ts
          preview.ts

    os-linux/
      src/
        system.ts
        shell.ts
        files.ts
        apps.ts
        desktop.ts
        accessibility.ts

    app-blender/
      src/
        adapter.ts
        runner.ts
        python-safety.ts
        coffee-cup-demo.ts
```

Future structure should add:

```text
packages/tool-forge/
packages/skills/
packages/app-browser/
packages/app-gmail/
apps/control-room/
```

## 8. Local data folder

Default local folder:

```text
~/.agenthost/
```

Typical structure:

```text
~/.agenthost/
  config.json
  logs/
    agenthost.jsonl
  outputs/
  screenshots/
  tmp/
  skills/
  traces/
  policies/
  tools/
  manifests/
```

## 9. Cross-platform design rule

The core must never assume Linux.

Use OS adapters:

```ts
interface OSAdapter {
  getSystemInfo(): Promise<SystemInfo>;
  checkDependency(name: string): Promise<DependencyResult>;
  openApp(input: OpenAppInput): Promise<ToolResult>;
}
```

Current implementation is Linux-first. Windows and macOS should be later phases with explicit capability matrices and permission docs.

## 10. Future architecture additions inspired by OpenClaw

AgentHost should adopt these product layers later:

- Control Room UI
- plugin/tool manifests
- skill registry
- memory files
- sub-agent/task runner with restricted permissions
- optional channel/mobile approval gateway
- loop detector and circuit breaker

AgentHost should not copy OpenClaw’s chat-first positioning. It should remain a workstation capability platform for coding agents.
