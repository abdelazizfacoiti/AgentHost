import type { AgentCapability } from "./capability-permissions.js";

export const CAPABILITY_FAMILY_SUMMARIES: Record<AgentCapability, { summary: string; exampleTools: string[] }> = {
  computer: { summary: "Observe and verify machine state; wait for UI conditions.", exampleTools: ["computer.observe_state", "computer.wait_for", "desktop.screenshot"] },
  browser: { summary: "Website-agnostic tabs, navigation, and guarded DOM actions through the paired loopback bridge.", exampleTools: ["browser.list_tabs", "browser.open_url", "browser.click_element", "browser.fill_text"] },
  filesystem: { summary: "Read, write, copy, move, and approval-gated delete inside policy roots.", exampleTools: ["file.read", "file.write", "file.copy", "file.move", "file.delete"] },
  shell: { summary: "Classified command execution with timeouts and output limits; dangerous patterns stay blocked.", exampleTools: ["shell.run_safe"] },
  applications: { summary: "Detect, list, open, and choose strategies for installed apps; optional adapters.", exampleTools: ["app.detect", "app.open", "adapter.list"] },
  mcp: { summary: "System/policy discovery, governed Forge sandbox dispatch, workflow and scheduler governance.", exampleTools: ["system.list_capabilities", "forge.dispatch_generated_tool"] },
  network: { summary: "Approval-gated external effects only; no open network access.", exampleTools: ["browser.open_url"] },
  vision: { summary: "Local OCR grounding with image-relative targets; suggestion-only pointer handoff.", exampleTools: ["vision.find_target", "vision.prepare_pointer_action"] },
  ocr: { summary: "Local Tesseract text extraction on approved images.", exampleTools: ["vision.analyze_image", "vision.find_text"] },
  speech: { summary: "Optional local synthesis/playback; transmission is two-phase and confirmation-gated.", exampleTools: ["speech.synthesize", "speech.play"] },
  skills: { summary: "Reusable skill catalog; combine multiple skills per task.", exampleTools: ["skills.list", "skills.get", "task.create"] }
};

export interface CapabilityManifestInput {
  version: string;
  profile: string;
  /** Omit for static briefs (CLI paste-into-config); live resources always fill it. */
  toolCount?: number;
  byExecutionClass?: Record<string, number>;
}

/** One small pull for agent clients (Codex, Claude Code, Copilot, OpenCode)
 * instead of ingesting hundreds of tool schemas up front. */
export function buildCapabilityMarkdown(input: CapabilityManifestInput): string {
  const families = (Object.keys(CAPABILITY_FAMILY_SUMMARIES) as AgentCapability[])
    .map((family) => {
      const info = CAPABILITY_FAMILY_SUMMARIES[family];
      return `- **${family}**: ${info.summary} (e.g. ${info.exampleTools.join(", ")})`;
    })
    .join("\n");
  const classes = Object.entries(input.byExecutionClass ?? {})
    .map(([name, count]) => `${name}:${count}`)
    .join(", ");
  const inventory = input.toolCount === undefined
    ? "live tool inventory via MCP"
    : `${input.toolCount} tools${classes.length > 0 ? ` [${classes}]` : ""}`;
  return `# AgentHost capabilities (v${input.version}, profile ${input.profile}, ${inventory})

AgentHost is a local general-purpose computer-use runtime. Work the loop:
understand, plan, inspect, act, observe, verify, recover. Tool errors are
recoverable, never terminal.

${families}

Execution model: LOW effects run automatically, MEDIUM with logging, HIGH
needs approval, CRITICAL needs explicit confirmation; every state-changing
tool uses dry-run plus a single-use confirmation token. \`agent.stop\` and
\`agenthost stop\` halt state-changing tools immediately; guides
(\`overlay.guide_present\`) and tasks (\`task.*\`) organize long work.
Pull \`agenthost://skills\` for the skill catalog and
\`agenthost://status\` for live stop/takeover state before starting.
`;
}

export function buildCapabilitiesJson(input: CapabilityManifestInput): Record<string, unknown> {
  return {
    product: "agenthost",
    version: input.version,
    profile: input.profile,
    ...(input.toolCount === undefined ? {} : { toolCount: input.toolCount }),
    ...(input.byExecutionClass === undefined ? {} : { byExecutionClass: input.byExecutionClass }),
    families: CAPABILITY_FAMILY_SUMMARIES,
    loop: ["understand", "plan", "inspect", "act", "observe", "verify", "recover"],
    resources: ["agenthost://capabilities", "agenthost://capabilities.md", "agenthost://skills", "agenthost://status"]
  };
}
