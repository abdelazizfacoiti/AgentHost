# AgentHost canonical documentation

AgentHost is a Linux-first, provider-agnostic local capability runtime and visual copilot. These documents describe the product and its explicit limits. The current minimal-v2 tree does not include Control Room, Browser Bridge, or the runtime-activity service; sections that mention them are historical. See `README.md` and `DEMO.md` for current behavior and overlay demos.

| Document | Use it for |
| --- | --- |
| [Product spec](01_PRODUCT_SPEC.md) | Product boundary, Visual Copilot, and safety posture |
| [System architecture](02_SYSTEM_ARCHITECTURE.md) | Packages, stores, renderer, goal/planning, and routing |
| [MCP tools and adapters](03_MCP_TOOLS_AND_ADAPTERS.md) | Tool inventory and adapter boundaries |
| [Security, permissions, and logging](04_SECURITY_PERMISSIONS_AND_LOGGING.md) | Grants, confirmations, redaction, and privacy |
| [Roadmap and prompts](05_IMPLEMENTATION_ROADMAP_AND_CODEX_PROMPTS.md) | Milestone status, goals/plans, and future scope |
| [Browser setup validation](06_BROWSER_SETUP_VALIDATION.md) | Pairing, reconnect, diagnostics, and fallback |
| [Browser extension release](07_BROWSER_EXTENSION_RELEASE.md) | Deterministic extension artifacts |
| [Speech setup](07_SPEECH_SETUP_AND_THIRD_PARTY_NOTICES.md) | Local providers and notices |
| [Release and operations](08_RELEASE_AND_OPERATIONS.md) | Rootless packaging and lifecycle |
| [Release audit](09_RELEASE_AUDIT.md) | Release evidence and manual sign-off |
| [Performance and benchmarks](10_PERFORMANCE_AND_BENCHMARKS.md) | Adaptive-routing, goal-planning, and bounded performance measurements |
| [Privacy and support](11_PRIVACY_AND_SUPPORT.md) | Data boundaries and manual checks |

Provider names in examples are illustrative only. Browser, overlay, planner, and routing features never bypass the original governed tools.
