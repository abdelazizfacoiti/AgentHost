# AgentHost canonical documentation

AgentHost is a Linux-first, provider-agnostic local MCP runtime and visual
copilot. The current minimal-v2 tree exposes the tools documented in
`docs/03_MCP_TOOLS_AND_ADAPTERS.md`; older milestone documents describe
surfaces that are not registered in this tree.

| Document | Use it for |
| --- | --- |
| [Product spec](01_PRODUCT_SPEC.md) | Product boundary, visual assistance, and safety posture |
| [System architecture](02_SYSTEM_ARCHITECTURE.md) | Packages, stores, renderer, and runtime flow |
| [MCP tools and adapters](03_MCP_TOOLS_AND_ADAPTERS.md) | Live tool inventory and adapter boundaries |
| [Security, permissions, and logging](04_SECURITY_PERMISSIONS_AND_LOGGING.md) | Grants, confirmations, redaction, and privacy |
| [Release and operations](08_RELEASE_AND_OPERATIONS.md) | Packaging, install, CLI, and release checks |
| [Privacy and support](11_PRIVACY_AND_SUPPORT.md) | Data boundary, support states, and manual checks |

Provider names in examples are illustrative only. Safety is enforced by the
runtime; documentation never grants permission or bypasses confirmation.
