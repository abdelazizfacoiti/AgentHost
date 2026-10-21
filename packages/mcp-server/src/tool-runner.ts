import type { AgentHostMcpContext } from "./context.js";
import type { ToolResult, RiskLevel, ToolExecutionMetadata } from "@agenthost/core";

export interface AgentHostToolDefinition<Input, Output, Context = AgentHostMcpContext> {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  inputSchema: any;
  mcpInputSchema: any;
  inputSummary: string | ((input: Input) => string);
  safety: { actionType: string; getInput?: (input: Input) => any };
  handler: (input: Input, context: Context, runtime?: ToolExecutionMetadata) => Promise<ToolResult<Output>>;
  auditInputSummary?: (input: Input) => string;
  auditOutputSummary?: (result: ToolResult<Output>) => string;
  preview?: { isDryRun?: (input: Input) => boolean; resolveEffect?: (input: Input, context: Context) => any };
  execution?: ToolExecutionMetadata;
  requiredGrantIds?: string[];
}

export type AnyAgentHostToolDefinition<Context = AgentHostMcpContext> = AgentHostToolDefinition<any, any, Context>;

export async function runTool<Input>(
  tool: AnyAgentHostToolDefinition<AgentHostMcpContext>,
  input: Input,
  context: AgentHostMcpContext
): Promise<ToolResult> {
  try {
    return await tool.handler(input, context);
  } catch (error) {
    return {
      ok: false,
      tool: tool.name,
      riskLevel: tool.riskLevel,
      approval: { required: false, status: "not_required" },
      data: null,
      observations: ["Tool execution failed."],
      error: { code: "execution_failed", message: error instanceof Error ? error.message : String(error) }
    };
  }
}

export type { AgentHostMcpContext } from "./context.js";