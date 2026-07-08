import type {
  ApprovalInfo,
  AutomationStrategy,
  RiskLevel,
  GrantDecision,
  ToolConfirmationInfo,
  ToolError,
  ToolResult
} from "./types.js";

export function noApprovalRequired(): ApprovalInfo {
  return {
    required: false,
    status: "not_required"
  };
}

export interface ToolSuccessInput<T> {
  tool: string;
  riskLevel: RiskLevel;
  data: T;
  strategy?: AutomationStrategy;
  preview?: boolean;
  confirmation?: ToolConfirmationInfo;
  grantDecision?: GrantDecision;
  approval?: ApprovalInfo;
  observations?: string[];
}

export function toolSuccess<T>(input: ToolSuccessInput<T>): ToolResult<T> {
  const result: ToolResult<T> = {
    ok: true,
    tool: input.tool,
    riskLevel: input.riskLevel,
    ...(input.preview === true ? { preview: true } : {}),
    ...(input.confirmation === undefined ? {} : { confirmation: input.confirmation }),
    ...(input.grantDecision === undefined ? {} : { grantDecision: input.grantDecision }),
    approval: input.approval ?? noApprovalRequired(),
    data: input.data,
    observations: input.observations ?? [],
    error: null
  };

  if (input.strategy !== undefined) {
    result.strategy = input.strategy;
  }

  return result;
}

export interface ToolFailureInput {
  tool: string;
  riskLevel: RiskLevel;
  error: ToolError;
  strategy?: AutomationStrategy;
  preview?: boolean;
  confirmation?: ToolConfirmationInfo;
  grantDecision?: GrantDecision;
  approval?: ApprovalInfo;
  observations?: string[];
}

export function toolFailure<T = never>(input: ToolFailureInput): ToolResult<T> {
  const result: ToolResult<T> = {
    ok: false,
    tool: input.tool,
    riskLevel: input.riskLevel,
    ...(input.preview === true ? { preview: true } : {}),
    ...(input.confirmation === undefined ? {} : { confirmation: input.confirmation }),
    ...(input.grantDecision === undefined ? {} : { grantDecision: input.grantDecision }),
    approval: input.approval ?? noApprovalRequired(),
    data: null,
    observations: input.observations ?? [],
    error: input.error
  };

  if (input.strategy !== undefined) {
    result.strategy = input.strategy;
  }

  return result;
}
