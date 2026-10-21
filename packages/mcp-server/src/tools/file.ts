import path from "node:path";
import { readFile, writeFile, mkdir, rm, readdir, stat, copyFile, rename } from "node:fs/promises";
import { toolFailure, toolSuccess, normalizePathForPolicy, evaluateSafety, type ToolResult, type FileExistsResult } from "@agenthost/core";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";
import { createSafetyEvaluationContext } from "../grants.js";

const baseSchema = z.object({
  path: z.string().trim().min(1).max(1000)
}).strict();

const readInput = baseSchema.extend({
  encoding: z.enum(["utf8", "base64"]).optional(),
  maxBytes: z.number().int().min(1).max(100 * 1024 * 1024).optional()
}).strict();

const writeInput = baseSchema.extend({
  content: z.string().min(0).max(100 * 1024 * 1024),
  encoding: z.enum(["utf8", "base64"]).optional(),
  createParents: z.boolean().optional()
}).strict();

const listInput = baseSchema.extend({
  limit: z.number().int().min(1).max(10000).optional()
}).strict();

const existsInput = baseSchema.strict();

const ensureDirInput = baseSchema.strict();

const copyInput = z.object({
  source: z.string().trim().min(1).max(1000),
  destination: z.string().trim().min(1).max(1000)
}).strict();

const moveInput = z.object({
  source: z.string().trim().min(1).max(1000),
  destination: z.string().trim().min(1).max(1000)
}).strict();

const deleteInput = baseSchema.extend({
  recursive: z.boolean().optional()
}).strict();

function resolvedPath(inputPath: string, context: AgentHostMcpContext): string {
  return normalizePathForPolicy(inputPath, { agentHostDir: context.config.agentHostDir });
}

function safetyCheck(tool: string, actionType: "file_read" | "file_write" | "file_delete", filePath: string, context: AgentHostMcpContext) {
  return evaluateSafety(
    { tool, actionType, filePath, strategy: "cli_or_script" },
    context.policy,
    createSafetyEvaluationContext(context)
  );
}

function failure(tool: string, safety: ReturnType<typeof evaluateSafety>): ToolResult<never> {
  return toolFailure({
    tool,
    riskLevel: safety.riskLevel,
    approval: safety.approval,
    error: {
      code: safety.blocked ? "safety_blocked" : "approval_required",
      message: safety.blocked ? "Blocked by safety engine." : "Requires approval.",
      details: safety
    },
    observations: safety.reasons
  });
}

export function createFileTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const read: AgentHostToolDefinition<z.infer<typeof readInput>, unknown, AgentHostMcpContext> = {
    name: "file.read",
    description: "Reads a file from an approved path.",
    riskLevel: "low",
    inputSchema: readInput,
    mcpInputSchema: {
      type: "object",
      properties: { path: { type: "string" }, encoding: { type: "string", enum: ["utf8", "base64"] }, maxBytes: { type: "integer" } },
      required: ["path"],
      additionalProperties: false
    },
    inputSummary: "Read file",
    safety: { actionType: "file_read", getInput: (i) => ({ filePath: i.path }) },
    async handler(input, context) {
      const fp = resolvedPath(input.path, context);
      const safety = safetyCheck("file.read", "file_read", fp, context);
      if (!safety.allowed) return failure("file.read", safety);
      try {
        const content = input.encoding === "base64"
          ? (await readFile(fp)).toString("base64")
          : await readFile(fp, "utf8");
        return toolSuccess({ tool: "file.read", riskLevel: "low", data: { path: fp, content, truncated: false }, observations: ["Read file."] });
      } catch (e) {
        return toolFailure({ tool: "file.read", riskLevel: "low", error: { code: "read_failed", message: e instanceof Error ? e.message : "Read failed" } });
      }
    }
  };

  const write: AgentHostToolDefinition<z.infer<typeof writeInput>, unknown, AgentHostMcpContext> = {
    name: "file.write",
    description: "Writes a file to an approved path.",
    riskLevel: "medium",
    inputSchema: writeInput,
    mcpInputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" }, encoding: { type: "string", enum: ["utf8", "base64"] }, createParents: { type: "boolean" } },
      required: ["path", "content"],
      additionalProperties: false
    },
    inputSummary: "Write file",
    safety: { actionType: "file_write", getInput: (i) => ({ filePath: i.path }) },
    async handler(input, context) {
      const fp = resolvedPath(input.path, context);
      const safety = safetyCheck("file.write", "file_write", fp, context);
      if (!safety.allowed) return failure("file.write", safety);
      try {
        if (input.createParents) {
          await mkdir(path.dirname(fp), { recursive: true });
        }
        const content = input.encoding === "base64" ? Buffer.from(input.content, "base64") : input.content;
        await writeFile(fp, content);
        return toolSuccess({ tool: "file.write", riskLevel: "medium", data: { path: fp, written: true }, observations: ["Wrote file."] });
      } catch (e) {
        return toolFailure({ tool: "file.write", riskLevel: "medium", error: { code: "write_failed", message: e instanceof Error ? e.message : "Write failed" } });
      }
    }
  };

  const list: AgentHostToolDefinition<z.infer<typeof listInput>, unknown, AgentHostMcpContext> = {
    name: "file.list",
    description: "Lists files in a directory.",
    riskLevel: "low",
    inputSchema: listInput,
    mcpInputSchema: {
      type: "object",
      properties: { path: { type: "string" }, limit: { type: "integer" } },
      required: ["path"],
      additionalProperties: false
    },
    inputSummary: "List directory",
    safety: { actionType: "file_read", getInput: (i) => ({ filePath: i.path }) },
    async handler(input, context) {
      const fp = resolvedPath(input.path, context);
      const safety = safetyCheck("file.list", "file_read", fp, context);
      if (!safety.allowed) return failure("file.list", safety);
      try {
        const entries = await readdir(fp, { withFileTypes: true });
        const files = entries.slice(0, input.limit ?? 1000).map(e => ({
          name: e.name,
          isDirectory: e.isDirectory(),
          isFile: e.isFile()
        }));
        return toolSuccess({ tool: "file.list", riskLevel: "low", data: { path: fp, files, truncated: entries.length > (input.limit ?? 1000) }, observations: ["Listed directory."] });
      } catch (e) {
        return toolFailure({ tool: "file.list", riskLevel: "low", error: { code: "list_failed", message: e instanceof Error ? e.message : "List failed" } });
      }
    }
  };

  const exists: AgentHostToolDefinition<z.infer<typeof existsInput>, FileExistsResult, AgentHostMcpContext> = {
    name: "file.exists",
    description: "Checks if a path exists.",
    riskLevel: "observe",
    inputSchema: existsInput,
    mcpInputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
    inputSummary: "Check file exists",
    safety: { actionType: "file_read", getInput: (i) => ({ filePath: i.path }) },
    async handler(input, context) {
      const fp = resolvedPath(input.path, context);
      const safety = safetyCheck("file.exists", "file_read", fp, context);
      if (!safety.allowed) return failure("file.exists", safety);
      try {
        await stat(fp);
        return toolSuccess({ tool: "file.exists", riskLevel: "observe", data: { path: fp, exists: true }, observations: ["Path exists."] });
      } catch {
        return toolSuccess({ tool: "file.exists", riskLevel: "observe", data: { path: fp, exists: false }, observations: ["Path does not exist."] });
      }
    }
  };

  const ensureDir: AgentHostToolDefinition<z.infer<typeof ensureDirInput>, unknown, AgentHostMcpContext> = {
    name: "file.ensure_dir",
    description: "Ensures a directory exists.",
    riskLevel: "medium",
    inputSchema: ensureDirInput,
    mcpInputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
    inputSummary: "Ensure directory",
    safety: { actionType: "file_write", getInput: (i) => ({ filePath: i.path }) },
    async handler(input, context) {
      const fp = resolvedPath(input.path, context);
      const safety = safetyCheck("file.ensure_dir", "file_write", fp, context);
      if (!safety.allowed) return failure("file.ensure_dir", safety);
      try {
        await mkdir(fp, { recursive: true });
        return toolSuccess({ tool: "file.ensure_dir", riskLevel: "medium", data: { path: fp, created: true }, observations: ["Directory ensured."] });
      } catch (e) {
        return toolFailure({ tool: "file.ensure_dir", riskLevel: "medium", error: { code: "mkdir_failed", message: e instanceof Error ? e.message : "Mkdir failed" } });
      }
    }
  };

  const copy: AgentHostToolDefinition<z.infer<typeof copyInput>, unknown, AgentHostMcpContext> = {
    name: "file.copy",
    description: "Copies a file.",
    riskLevel: "medium",
    inputSchema: copyInput,
    mcpInputSchema: { type: "object", properties: { source: { type: "string" }, destination: { type: "string" } }, required: ["source", "destination"], additionalProperties: false },
    inputSummary: "Copy file",
    safety: { actionType: "file_write", getInput: (i) => ({ filePath: i.destination }) },
    async handler(input, context) {
      const src = resolvedPath(input.source, context);
      const dst = resolvedPath(input.destination, context);
      const safety = safetyCheck("file.copy", "file_write", dst, context);
      if (!safety.allowed) return failure("file.copy", safety);
      try {
        await copyFile(src, dst);
        return toolSuccess({ tool: "file.copy", riskLevel: "medium", data: { source: src, destination: dst, copied: true }, observations: ["Copied file."] });
      } catch (e) {
        return toolFailure({ tool: "file.copy", riskLevel: "medium", error: { code: "copy_failed", message: e instanceof Error ? e.message : "Copy failed" } });
      }
    }
  };

  const move: AgentHostToolDefinition<z.infer<typeof moveInput>, unknown, AgentHostMcpContext> = {
    name: "file.move",
    description: "Moves a file.",
    riskLevel: "medium",
    inputSchema: moveInput,
    mcpInputSchema: { type: "object", properties: { source: { type: "string" }, destination: { type: "string" } }, required: ["source", "destination"], additionalProperties: false },
    inputSummary: "Move file",
    safety: { actionType: "file_write", getInput: (i) => ({ filePath: i.destination }) },
    async handler(input, context) {
      const src = resolvedPath(input.source, context);
      const dst = resolvedPath(input.destination, context);
      const safety = safetyCheck("file.move", "file_write", dst, context);
      if (!safety.allowed) return failure("file.move", safety);
      try {
        await rename(src, dst);
        return toolSuccess({ tool: "file.move", riskLevel: "medium", data: { source: src, destination: dst, moved: true }, observations: ["Moved file."] });
      } catch (e) {
        return toolFailure({ tool: "file.move", riskLevel: "medium", error: { code: "move_failed", message: e instanceof Error ? e.message : "Move failed" } });
      }
    }
  };

  const delete_: AgentHostToolDefinition<z.infer<typeof deleteInput>, unknown, AgentHostMcpContext> = {
    name: "file.delete",
    description: "Deletes a file or directory.",
    riskLevel: "high",
    inputSchema: deleteInput,
    mcpInputSchema: { type: "object", properties: { path: { type: "string" }, recursive: { type: "boolean" } }, required: ["path"], additionalProperties: false },
    inputSummary: "Delete file",
    safety: { actionType: "file_write", getInput: (i) => ({ filePath: i.path }) },
    async handler(input, context) {
      const fp = resolvedPath(input.path, context);
      const safety = safetyCheck("file.delete", "file_write", fp, context);
      if (!safety.allowed) return failure("file.delete", safety);
      try {
        await rm(fp, { recursive: input.recursive ?? false, force: true });
        return toolSuccess({ tool: "file.delete", riskLevel: "high", data: { path: fp, deleted: true }, observations: ["Deleted path."] });
      } catch (e) {
        return toolFailure({ tool: "file.delete", riskLevel: "high", error: { code: "delete_failed", message: e instanceof Error ? e.message : "Delete failed" } });
      }
    }
  };

  return [read, write, list, exists, ensureDir, copy, move, delete_];
}