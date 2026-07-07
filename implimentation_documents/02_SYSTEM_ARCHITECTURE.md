# AgentHost System Architecture

## 1. Architecture overview

AgentHost is built around a simple idea:

> The AI agent plans. AgentHost executes through safe, structured local tools.

```text
┌──────────────────────────────────────────────────────────┐
│ AI agent / Codex                                          │
│ - understands prompt                                      │
│ - plans workflow                                          │
│ - chooses tools                                           │
│ - writes scripts if needed                                │
│ - validates results                                       │
└───────────────────────┬──────────────────────────────────┘
                        │ MCP
                        ▼
┌──────────────────────────────────────────────────────────┐
│ AgentHost MCP Server                                      │
│ - exposes tools                                           │
│ - exposes resources                                       │
│ - validates schemas                                       │
│ - returns structured ToolResult objects                   │
└───────────────────────┬──────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────┐
│ AgentHost Core                                            │
│ - types                                                   │
│ - config                                                  │
│ - policy profiles                                         │
│ - safety engine                                           │
│ - approval manager                                        │
│ - audit logger                                            │
│ - capability registry                                     │
│ - app registry                                            │
│ - skill trace model                                       │
└───────────────┬──────────────────────┬───────────────────┘
                │                      │
                ▼                      ▼
┌──────────────────────────────┐ ┌─────────────────────────┐
│ Universal Automation Layer    │ │ App Adapter Layer        │
│ - app detection               │ │ - optional adapters      │
│ - app open/focus              │ │ - Blender later          │
│ - shell/file tools            │ │ - browser later          │
│ - windows                     │ │ - office apps later      │
│ - screenshots later           │ │ - creative apps later    │
│ - click/type later            │ │                         │
│ - guide mode                  │ │                         │
└───────────────┬──────────────┘ └────────────┬────────────┘
                │                             │
                ▼                             ▼
┌──────────────────────────────────────────────────────────┐
│ OS Adapter Layer                                          │
│ - Linux adapter first                                     │
│ - Windows adapter later                                   │
│ - macOS adapter later                                     │
└───────────────────────┬──────────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────────┐
│ Real computer                                             │
│ - desktop apps                                            │
│ - shell                                                   │
│ - browser                                                 │
│ - files                                                   │
│ - OS windows                                              │
└──────────────────────────────────────────────────────────┘
```

## 2. Recommended repository structure

```text
agenthost/
  package.json
  tsconfig.base.json
  README.md
  AGENTS.md

  docs/
    01_PRODUCT_SPEC.md
    02_SYSTEM_ARCHITECTURE.md
    03_MCP_TOOLS_AND_ADAPTERS.md
    04_SECURITY_PERMISSIONS_AND_LOGGING.md
    05_IMPLEMENTATION_ROADMAP_AND_CODEX_PROMPTS.md

  packages/
    shared/
      src/
        index.ts

    core/
      src/
        types/
        config/
        logging/
        policies/
        capabilities/
        safety/
        approvals/
        app-registry/
        skills/
        index.ts

    mcp-server/
      src/
        index.ts
        server.ts
        tools/
        resources/
        prompts/

    automation/
      src/
        UniversalAutomation.ts
        ToolRegistry.ts
        StrategySelector.ts

    os-linux/
      src/
        LinuxAdapter.ts
        system.ts
        shell.ts
        files.ts
        apps.ts
        windows.ts

    app-adapters/
      src/
        AppAdapter.ts
        AdapterRegistry.ts

    app-browser/
      src/

    app-blender/
      src/

  apps/
    control-room/
      src/

  examples/
    prompts/
    workflows/

  tests/
```

## 3. Package responsibilities

### `packages/shared`

Contains shared utilities that are safe to use from any package.

Examples:

- string utilities
- path helpers
- common constants

### `packages/core`

Contains the main product logic.

Responsibilities:

- shared types
- tool result format
- risk and approval types
- automation strategy types
- policy profile types
- config loading
- audit logging
- capability registry
- app registry interfaces
- safety engine
- approval manager
- skill trace model

`core` must not contain Linux-specific or app-specific implementation.

### `packages/mcp-server`

Contains MCP server wiring.

Responsibilities:

- start stdio MCP server
- expose AgentHost tools
- expose resources
- validate inputs
- call core and adapters
- return `ToolResult`
- log every tool call

### `packages/automation`

Contains app-agnostic automation orchestration.

Responsibilities:

- choose automation strategies
- route actions to OS adapters or app adapters
- expose universal tool handlers
- keep tools app-agnostic

### `packages/os-linux`

Contains Linux-specific implementation.

Responsibilities:

- get OS info
- check commands
- run shell safely
- app detection
- open apps
- file operations
- window operations later
- screenshot/input later

### `packages/app-adapters`

Contains the adapter interface and registry.

Responsibilities:

- register optional app adapters
- expose adapter capabilities
- route app-specific actions

### `packages/app-browser`

Optional future adapter for browser workflows.

### `packages/app-blender`

Optional future adapter for Blender demo.

Important: the core must not depend on this package.

### `apps/control-room`

Future Electron UI.

Responsibilities:

- approval dialogs
- logs
- emergency stop
- tool call viewer
- screenshots
- capability viewer
- skill library

Do not build this in Phase 0 + Phase 1.

## 4. Core data types

### Risk level

```ts
type RiskLevel = "observe" | "low" | "medium" | "high" | "blocked";
```

### Approval status

```ts
type ApprovalStatus =
  | "not_required"
  | "required"
  | "approved"
  | "denied"
  | "expired";
```

### Automation strategy

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

### Tool result

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

### App capability

```ts
interface AppCapability {
  id: string;
  appId?: string;
  strategy: AutomationStrategy;
  riskLevel: RiskLevel;
  description: string;
  inputSchema?: unknown;
}
```

### App adapter

```ts
interface AppAdapter {
  id: string;
  displayName: string;
  supportedPlatforms: string[];
  getCapabilities(): AppCapability[];
  execute(action: unknown, context: unknown): Promise<ToolResult>;
}
```

## 5. Tool execution flow

Every future tool should follow the same flow:

```text
MCP tool request
  ↓
schema validation
  ↓
risk classification
  ↓
policy check
  ↓
approval request if needed
  ↓
execution through adapter/layer
  ↓
result validation
  ↓
audit log
  ↓
ToolResult returned to Codex
```

In Phase 0 + Phase 1, the safety engine may be incomplete, but the interfaces and flow should be designed so tools can be routed through it later.

## 6. Local data folder

Default local folder:

```text
~/.agenthost/
```

Suggested structure:

```text
~/.agenthost/
  config.json
  logs/
    agenthost.jsonl
  outputs/
  screenshots/
  skills/
  traces/
  policies/
```

## 7. Cross-platform design rule

The core must never assume Linux.

Use platform adapters:

```ts
interface OSAdapter {
  getSystemInfo(): Promise<SystemInfo>;
  checkDependency(name: string): Promise<DependencyResult>;
  openApp(input: OpenAppInput): Promise<ToolResult>;
}
```

Phase 0 + Phase 1 can include only Linux implementation stubs, but the architecture must be prepared for Windows and macOS.
