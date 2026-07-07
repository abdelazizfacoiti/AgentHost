import type {
  AdapterCapabilitiesResult,
  AdapterDetectionResult,
  AdapterListResult,
  ToolResult
} from "@agenthost/core";
import { toolSuccess } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";

const emptyInputSchema = z.object({}).strict();
const adapterIdSchema = z.string().trim().min(1).max(120);
const appIdSchema = z.string().trim().min(1).max(200);
const appNameSchema = z.string().trim().min(1).max(200);

const capabilitiesInputSchema = z
  .object({
    adapterId: adapterIdSchema.optional(),
    appId: appIdSchema.optional()
  })
  .strict();

const detectForAppInputSchema = z
  .object({
    appName: appNameSchema,
    appId: appIdSchema.optional()
  })
  .strict();

type EmptyInput = z.infer<typeof emptyInputSchema>;
type CapabilitiesInput = z.infer<typeof capabilitiesInputSchema>;
type DetectForAppInput = z.infer<typeof detectForAppInputSchema>;

const emptyMcpInputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false
};

function toCapabilitiesFilter(input: CapabilitiesInput): { adapterId?: string; appId?: string } {
  const filter: { adapterId?: string; appId?: string } = {};

  if (input.adapterId !== undefined) {
    filter.adapterId = input.adapterId;
  }

  if (input.appId !== undefined) {
    filter.appId = input.appId;
  }

  return filter;
}

function toDetectionInput(input: DetectForAppInput): { appName: string; appId?: string } {
  const detectionInput: { appName: string; appId?: string } = {
    appName: input.appName
  };

  if (input.appId !== undefined) {
    detectionInput.appId = input.appId;
  }

  return detectionInput;
}

export function createAdapterTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const list: AgentHostToolDefinition<EmptyInput, AdapterListResult, AgentHostMcpContext> = {
    name: "adapter.list",
    description: "Lists registered optional app adapters.",
    riskLevel: "observe",
    inputSchema: emptyInputSchema,
    mcpInputSchema: emptyMcpInputSchema,
    inputSummary: "List app adapters",
    safety: {
      actionType: "observe"
    },
    handler(_input, context): ToolResult<AdapterListResult> {
      return toolSuccess({
        tool: "adapter.list",
        riskLevel: "observe",
        data: {
          adapters: context.adapters.listAdapters()
        },
        observations: ["Listed registered app adapters without executing adapter actions."]
      });
    }
  };

  const getCapabilities: AgentHostToolDefinition<
    CapabilitiesInput,
    AdapterCapabilitiesResult,
    AgentHostMcpContext
  > = {
    name: "adapter.get_capabilities",
    description: "Lists capabilities exposed by registered app adapters.",
    riskLevel: "low",
    inputSchema: capabilitiesInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        adapterId: {
          type: "string",
          minLength: 1,
          maxLength: 120
        },
        appId: {
          type: "string",
          minLength: 1,
          maxLength: 200
        }
      },
      additionalProperties: false
    },
    inputSummary: "Get adapter capabilities",
    safety: {
      actionType: "inspect",
      getInput: (input) => {
        const safetyInput: { appId?: string } = {};

        if (input.appId !== undefined) {
          safetyInput.appId = input.appId;
        }

        return safetyInput;
      }
    },
    handler(input, context): ToolResult<AdapterCapabilitiesResult> {
      const filter = toCapabilitiesFilter(input);
      const data: AdapterCapabilitiesResult = {
        capabilities: context.adapters.listCapabilities(filter)
      };

      if (filter.adapterId !== undefined) {
        data.adapterId = filter.adapterId;
      }

      if (filter.appId !== undefined) {
        data.appId = filter.appId;
      }

      return toolSuccess({
        tool: "adapter.get_capabilities",
        riskLevel: "low",
        data,
        observations: ["Listed adapter capabilities without executing adapter actions."]
      });
    }
  };

  const detectForApp: AgentHostToolDefinition<DetectForAppInput, AdapterDetectionResult, AgentHostMcpContext> = {
    name: "adapter.detect_for_app",
    description: "Detects whether registered app adapters can support a given app.",
    riskLevel: "low",
    inputSchema: detectForAppInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        appName: {
          type: "string",
          minLength: 1,
          maxLength: 200
        },
        appId: {
          type: "string",
          minLength: 1,
          maxLength: 200
        }
      },
      required: ["appName"],
      additionalProperties: false
    },
    inputSummary: "Detect app adapters",
    safety: {
      actionType: "inspect",
      getInput: (input) => {
        const safetyInput: { appName: string; appId?: string } = {
          appName: input.appName
        };

        if (input.appId !== undefined) {
          safetyInput.appId = input.appId;
        }

        return safetyInput;
      }
    },
    handler(input, context): ToolResult<AdapterDetectionResult> {
      const data = context.adapters.detectForApp(toDetectionInput(input));

      return toolSuccess({
        tool: "adapter.detect_for_app",
        riskLevel: "low",
        strategy: data.recommendedStrategy,
        data,
        observations: ["Detected adapter support without executing adapter actions."]
      });
    }
  };

  return [list, getCapabilities, detectForApp];
}
