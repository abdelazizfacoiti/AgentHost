import { toolFailure, toolSuccess, type ToolResult } from "@agenthost/core";
import type { LinuxClipboardResult } from "@agenthost/os-linux";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";

const setInput = z.object({
  text: z.string().max(100_000),
  dataSensitivity: z.enum(["none", "low", "sensitive", "secret"]).optional()
}).strict();
const getInput = z.object({}).strict();

export function createClipboardTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const set: AgentHostToolDefinition<z.infer<typeof setInput>, LinuxClipboardResult, AgentHostMcpContext> = {
    name: "clipboard.set",
    description: "Places text on the system clipboard (for a later Ctrl+V or to hand the user a value). desktop.type_text already pastes on its own; use this when the paste happens later or in another app.",
    riskLevel: "low",
    inputSchema: setInput,
    mcpInputSchema: { type: "object", properties: { text: { type: "string", maxLength: 100000 }, dataSensitivity: { type: "string", enum: ["none", "low", "sensitive", "secret"] } }, required: ["text"], additionalProperties: false },
    inputSummary: "Set clipboard",
    auditInputSummary: (i) => `Set clipboard (${i.text.length} chars).`,
    safety: { actionType: "gui_type", getInput: (i) => (i.dataSensitivity === undefined ? {} : { dataSensitivity: i.dataSensitivity }) },
    async handler(input, context): Promise<ToolResult<LinuxClipboardResult>> {
      if (context.linux.setClipboard === undefined) return toolFailure({ tool: "clipboard.set", riskLevel: "low", error: { code: "unsupported", message: "Clipboard is not available on this host." } });
      const data = await context.linux.setClipboard({ text: input.text });
      if (!data.supported) return toolFailure({ tool: "clipboard.set", riskLevel: "low", error: { code: "clipboard_failed", message: data.reason } });
      return toolSuccess({ tool: "clipboard.set", riskLevel: "low", data, observations: [`Clipboard now holds ${input.text.length} characters.`] });
    }
  };

  const get: AgentHostToolDefinition<z.infer<typeof getInput>, LinuxClipboardResult, AgentHostMcpContext> = {
    name: "clipboard.get",
    description: "Reads the system clipboard text. The clipboard may hold anything the user copied (including secrets), so each read needs an exact operator confirmation.",
    riskLevel: "medium",
    inputSchema: getInput,
    mcpInputSchema: { type: "object", properties: {}, additionalProperties: false },
    inputSummary: "Read clipboard",
    // Treated as a sensitive private-data read: the runner mints a confirmation token first.
    safety: { actionType: "inspect", getInput: () => ({ dataSensitivity: "sensitive" as const }) },
    async handler(_input, context): Promise<ToolResult<LinuxClipboardResult>> {
      if (context.linux.getClipboard === undefined) return toolFailure({ tool: "clipboard.get", riskLevel: "medium", error: { code: "unsupported", message: "Clipboard is not available on this host." } });
      const data = await context.linux.getClipboard();
      if (!data.supported) return toolFailure({ tool: "clipboard.get", riskLevel: "medium", error: { code: "clipboard_empty", message: data.reason } });
      return toolSuccess({ tool: "clipboard.get", riskLevel: "medium", data, observations: ["Read the clipboard text."] });
    }
  };

  return [set, get];
}
