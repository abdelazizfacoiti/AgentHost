import type {
  FileEnsureDirResult,
  FileExistsResult,
  FileListResult,
  FileReadResult,
  FileWriteResult,
  ToolResult
} from "@agenthost/core";
import { toolSuccess } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";
import type { AgentHostMcpContext } from "../context.js";

const pathSchema = z.string().trim().min(1).max(1000);
const encodingSchema = z.enum(["utf8", "base64"]);

const writeInputSchema = z
  .object({
    path: pathSchema,
    content: z.string(),
    encoding: encodingSchema.optional(),
    createParents: z.boolean().optional()
  })
  .strict();
const readInputSchema = z
  .object({
    path: pathSchema,
    encoding: encodingSchema.optional(),
    maxBytes: z.number().int().min(1).max(1024 * 1024).optional()
  })
  .strict();
const pathOnlyInputSchema = z.object({ path: pathSchema }).strict();
const listInputSchema = z
  .object({
    path: pathSchema,
    limit: z.number().int().min(1).max(500).optional()
  })
  .strict();

type WriteInput = z.infer<typeof writeInputSchema>;
type ReadInput = z.infer<typeof readInputSchema>;
type PathOnlyInput = z.infer<typeof pathOnlyInputSchema>;
type ListInput = z.infer<typeof listInputSchema>;

const pathOnlyMcpInputSchema = {
  type: "object",
  properties: {
    path: {
      type: "string",
      minLength: 1,
      maxLength: 1000
    }
  },
  required: ["path"],
  additionalProperties: false
};

export function createFileTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const write: AgentHostToolDefinition<WriteInput, FileWriteResult, AgentHostMcpContext> = {
    name: "file.write",
    description: "Writes a new file inside approved roots only.",
    riskLevel: "medium",
    inputSchema: writeInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          minLength: 1,
          maxLength: 1000
        },
        content: {
          type: "string"
        },
        encoding: {
          type: "string",
          enum: ["utf8", "base64"]
        },
        createParents: {
          type: "boolean"
        }
      },
      required: ["path", "content"],
      additionalProperties: false
    },
    inputSummary: "Write file",
    safety: {
      actionType: "file_write",
      getInput: (input) => ({ filePath: input.path })
    },
    async handler(input, context): Promise<ToolResult<FileWriteResult>> {
      const writeInput: {
        path: string;
        content: string;
        encoding?: "utf8" | "base64";
        createParents?: boolean;
      } = {
        path: input.path,
        content: input.content
      };

      if (input.encoding !== undefined) {
        writeInput.encoding = input.encoding;
      }

      if (input.createParents !== undefined) {
        writeInput.createParents = input.createParents;
      }

      return toolSuccess({
        tool: "file.write",
        riskLevel: "medium",
        data: await context.linux.writeFile(writeInput),
        observations: ["Wrote a new file inside approved roots."]
      });
    }
  };

  const read: AgentHostToolDefinition<ReadInput, FileReadResult, AgentHostMcpContext> = {
    name: "file.read",
    description: "Reads a file when path safety policy allows it.",
    riskLevel: "low",
    inputSchema: readInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          minLength: 1,
          maxLength: 1000
        },
        encoding: {
          type: "string",
          enum: ["utf8", "base64"]
        },
        maxBytes: {
          type: "integer",
          minimum: 1,
          maximum: 1048576
        }
      },
      required: ["path"],
      additionalProperties: false
    },
    inputSummary: "Read file",
    safety: {
      actionType: "file_read",
      getInput: (input) => ({ filePath: input.path })
    },
    async handler(input, context): Promise<ToolResult<FileReadResult>> {
      const readInput: { path: string; encoding?: "utf8" | "base64"; maxBytes?: number } = {
        path: input.path
      };

      if (input.encoding !== undefined) {
        readInput.encoding = input.encoding;
      }

      if (input.maxBytes !== undefined) {
        readInput.maxBytes = input.maxBytes;
      }

      return toolSuccess({
        tool: "file.read",
        riskLevel: "low",
        data: await context.linux.readFile(readInput),
        observations: ["Read file after path safety classification."]
      });
    }
  };

  const exists: AgentHostToolDefinition<PathOnlyInput, FileExistsResult, AgentHostMcpContext> = {
    name: "file.exists",
    description: "Checks whether a path exists when path safety policy allows it.",
    riskLevel: "low",
    inputSchema: pathOnlyInputSchema,
    mcpInputSchema: pathOnlyMcpInputSchema,
    inputSummary: "Check file exists",
    safety: {
      actionType: "file_read",
      getInput: (input) => ({ filePath: input.path })
    },
    async handler(input, context): Promise<ToolResult<FileExistsResult>> {
      return toolSuccess({
        tool: "file.exists",
        riskLevel: "low",
        data: await context.linux.fileExists(input),
        observations: ["Checked path existence after path safety classification."]
      });
    }
  };

  const list: AgentHostToolDefinition<ListInput, FileListResult, AgentHostMcpContext> = {
    name: "file.list",
    description: "Lists a directory non-recursively when path safety policy allows it.",
    riskLevel: "low",
    inputSchema: listInputSchema,
    mcpInputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          minLength: 1,
          maxLength: 1000
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 500
        }
      },
      required: ["path"],
      additionalProperties: false
    },
    inputSummary: "List directory",
    safety: {
      actionType: "file_read",
      getInput: (input) => ({ filePath: input.path })
    },
    async handler(input, context): Promise<ToolResult<FileListResult>> {
      const listInput: { path: string; limit?: number } = {
        path: input.path
      };

      if (input.limit !== undefined) {
        listInput.limit = input.limit;
      }

      return toolSuccess({
        tool: "file.list",
        riskLevel: "low",
        data: await context.linux.listDirectory(listInput),
        observations: ["Listed directory after path safety classification."]
      });
    }
  };

  const ensureDir: AgentHostToolDefinition<PathOnlyInput, FileEnsureDirResult, AgentHostMcpContext> = {
    name: "file.ensure_dir",
    description: "Creates an approved directory if needed.",
    riskLevel: "medium",
    inputSchema: pathOnlyInputSchema,
    mcpInputSchema: pathOnlyMcpInputSchema,
    inputSummary: "Ensure directory",
    safety: {
      actionType: "file_write",
      getInput: (input) => ({ filePath: input.path })
    },
    async handler(input, context): Promise<ToolResult<FileEnsureDirResult>> {
      return toolSuccess({
        tool: "file.ensure_dir",
        riskLevel: "medium",
        data: await context.linux.ensureDir(input),
        observations: ["Ensured directory inside approved roots."]
      });
    }
  };

  return [write, read, exists, list, ensureDir];
}
