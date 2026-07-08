import { lstat } from "node:fs/promises";
import path from "node:path";
import {
  classifyPath,
  normalizePathForPolicy,
  toolFailure,
  toolSuccess,
  type AgentHostConfig,
  type PolicyProfile,
  type ToolResult
} from "@agenthost/core";
import { ensureLinuxDir, findCommandPath, runSafeLinuxCommand, writeLinuxFile } from "@agenthost/os-linux";
import { COFFEE_CUP_DEMO_ID, getCoffeeCupDemoScript } from "./coffee-cup-demo.js";
import { reviewBlenderPython } from "./python-safety.js";

export interface BlenderRunPythonInput {
  script?: string;
  demo?: typeof COFFEE_CUP_DEMO_ID;
  outputDir?: string;
  expectedOutputs?: string[];
  timeoutMs?: number;
}

export interface BlenderRunPythonOutput {
  adapterId: "blender";
  capabilityId: "blender.run_python";
  blenderCommand: string;
  outputDir: string;
  outputs: Array<{ path: string; exists: true; bytes: number }>;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface BlenderRunnerDependencies {
  ensureDir?: typeof ensureLinuxDir;
  findBlenderPath?: (command: string) => Promise<string | undefined>;
  now?: () => number;
  runCommand?: typeof runSafeLinuxCommand;
  statFile?: (filePath: string) => Promise<{ exists: boolean; bytes: number }>;
  writeFile?: typeof writeLinuxFile;
}

function deniedApproval(reason: string) {
  return {
    required: false,
    status: "denied" as const,
    reason
  };
}

function resolveExpectedOutputs(input: BlenderRunPythonInput): string[] | { error: string } {
  const expectedOutputs = input.expectedOutputs ?? [input.demo === COFFEE_CUP_DEMO_ID ? "coffee-cup.blend" : "scene.blend"];

  if (expectedOutputs.length === 0) {
    return { error: "At least one expected output file is required." };
  }

  for (const name of expectedOutputs) {
    if (!/^[A-Za-z0-9._-]+\.blend$/.test(name)) {
      return { error: `Expected output must be a relative .blend filename: ${name}` };
    }
  }

  return expectedOutputs;
}

function resolveOutputDir(input: BlenderRunPythonInput, config: AgentHostConfig, now: number): string {
  const requested = input.outputDir ?? path.join(config.agentHostDir, "outputs", "blender", `run-${now}`);
  return normalizePathForPolicy(requested, { agentHostDir: config.agentHostDir });
}

function validateOutputDir(outputDir: string, policy: PolicyProfile, config: AgentHostConfig): string | undefined {
  const decision = classifyPath(outputDir, policy, { agentHostDir: config.agentHostDir, access: "write" });

  if (!decision.isAllowedWriteRoot || decision.riskLevel === "blocked" || decision.riskLevel === "high") {
    return `Output directory is outside approved AgentHost write roots: ${outputDir}`;
  }

  return undefined;
}

function validateOutputFiles(outputDir: string, names: string[], policy: PolicyProfile, config: AgentHostConfig): string | undefined {
  for (const name of names) {
    const outputPath = normalizePathForPolicy(path.join(outputDir, name), { agentHostDir: config.agentHostDir });
    const decision = classifyPath(outputPath, policy, { agentHostDir: config.agentHostDir, access: "write" });

    if (!decision.isAllowedWriteRoot || decision.riskLevel === "blocked" || decision.riskLevel === "high") {
      return `Output file is outside approved AgentHost write roots: ${outputPath}`;
    }

    const relative = path.relative(outputDir, outputPath);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return `Output file escapes the output directory: ${name}`;
    }
  }

  return undefined;
}

function buildWrappedScript(userScript: string, outputDir: string, expectedOutputs: string[]): string {
  const primaryOutput = path.join(outputDir, expectedOutputs[0] ?? "scene.blend");
  const expectedOutputList = expectedOutputs.map((name) => JSON.stringify(path.join(outputDir, name))).join(", ");

  return `
import bpy
import math
import os

AGENTHOST_OUTPUT_DIR = ${JSON.stringify(outputDir)}
AGENTHOST_PRIMARY_OUTPUT = ${JSON.stringify(primaryOutput)}
AGENTHOST_EXPECTED_OUTPUTS = [${expectedOutputList}]

bpy.ops.wm.read_factory_settings(use_empty=True)

${userScript.trim()}

os.makedirs(AGENTHOST_OUTPUT_DIR, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=AGENTHOST_PRIMARY_OUTPUT)
`;
}

async function defaultStatFile(filePath: string): Promise<{ exists: boolean; bytes: number }> {
  try {
    const stats = await lstat(filePath);
    return {
      exists: stats.isFile(),
      bytes: stats.isFile() ? stats.size : 0
    };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return {
        exists: false,
        bytes: 0
      };
    }

    throw error;
  }
}

export async function runBlenderPython(
  input: BlenderRunPythonInput,
  config: AgentHostConfig,
  policy: PolicyProfile,
  dependencies: BlenderRunnerDependencies = {}
): Promise<ToolResult<BlenderRunPythonOutput>> {
  const now = dependencies.now?.() ?? Date.now();
  const outputDir = resolveOutputDir(input, config, now);
  const outputDirError = validateOutputDir(outputDir, policy, config);

  if (outputDirError !== undefined) {
    return toolFailure({
      tool: "blender.run_python",
      riskLevel: "blocked",
      strategy: "app_adapter",
      approval: deniedApproval(outputDirError),
      error: {
        code: "blender_output_dir_blocked",
        message: outputDirError
      },
      observations: [outputDirError]
    });
  }

  const expectedOutputs = resolveExpectedOutputs(input);

  if (!Array.isArray(expectedOutputs)) {
    return toolFailure({
      tool: "blender.run_python",
      riskLevel: "blocked",
      strategy: "app_adapter",
      approval: deniedApproval(expectedOutputs.error),
      error: {
        code: "invalid_blender_output",
        message: expectedOutputs.error
      },
      observations: [expectedOutputs.error]
    });
  }

  const outputFilesError = validateOutputFiles(outputDir, expectedOutputs, policy, config);

  if (outputFilesError !== undefined) {
    return toolFailure({
      tool: "blender.run_python",
      riskLevel: "blocked",
      strategy: "app_adapter",
      approval: deniedApproval(outputFilesError),
      error: {
        code: "blender_output_file_blocked",
        message: outputFilesError
      },
      observations: [outputFilesError]
    });
  }

  const hasScript = input.script !== undefined;
  const hasDemo = input.demo !== undefined;

  if (hasScript === hasDemo) {
    return toolFailure({
      tool: "blender.run_python",
      riskLevel: "medium",
      strategy: "app_adapter",
      error: {
        code: "invalid_blender_input",
        message: "Exactly one of script or demo must be provided."
      },
      observations: ["Blender execution requires either a custom script or a built-in demo."]
    });
  }

  if (input.demo !== undefined && input.demo !== COFFEE_CUP_DEMO_ID) {
    return toolFailure({
      tool: "blender.run_python",
      riskLevel: "medium",
      strategy: "app_adapter",
      error: {
        code: "unknown_blender_demo",
        message: `Unknown Blender demo: ${input.demo}`
      }
    });
  }

  const userScript = input.demo === COFFEE_CUP_DEMO_ID ? getCoffeeCupDemoScript() : input.script ?? "";
  const review = reviewBlenderPython(userScript);

  if (!review.ok) {
    return toolFailure({
      tool: "blender.run_python",
      riskLevel: "blocked",
      strategy: "app_adapter",
      approval: deniedApproval(review.reasons.join(" ")),
      error: {
        code: "blender_python_rejected",
        message: "Blender Python script failed safety review.",
        details: review.reasons
      },
      observations: review.reasons
    });
  }

  const findBlenderPath = dependencies.findBlenderPath ?? ((command: string) => findCommandPath(command));
  const blenderPath = await findBlenderPath("blender");

  if (blenderPath === undefined) {
    return toolFailure({
      tool: "blender.run_python",
      riskLevel: "medium",
      strategy: "app_adapter",
      error: {
        code: "blender_not_found",
        message: "Blender is not installed or is not available on PATH."
      },
      observations: ["Install Blender separately and make sure the `blender` command is on PATH."]
    });
  }

  const ensureDir = dependencies.ensureDir ?? ensureLinuxDir;
  const writeFile = dependencies.writeFile ?? writeLinuxFile;
  const runCommand = dependencies.runCommand ?? runSafeLinuxCommand;
  const statFile = dependencies.statFile ?? defaultStatFile;
  const tempDir = path.join(config.agentHostDir, "tmp", "blender");
  const scriptPath = path.join(tempDir, `run-${now}.py`);
  const wrappedScript = buildWrappedScript(userScript, outputDir, expectedOutputs);

  await ensureDir({ path: outputDir }, { agentHostDir: config.agentHostDir });
  await ensureDir({ path: tempDir }, { agentHostDir: config.agentHostDir });
  await writeFile({ path: scriptPath, content: wrappedScript, createParents: true }, { agentHostDir: config.agentHostDir });

  const command = {
    command: blenderPath,
    args: ["--background", "--python", scriptPath],
    cwd: outputDir,
    timeoutMs: input.timeoutMs ?? 60_000
  };
  const result = await runCommand(command);

  if (result.exitCode !== 0 || result.signal !== null || result.timedOut) {
    return toolFailure({
      tool: "blender.run_python",
      riskLevel: "medium",
      strategy: "app_adapter",
      error: {
        code: "blender_execution_failed",
        message: "Blender execution did not complete successfully.",
        details: result
      },
      observations: ["Blender background execution failed."]
    });
  }

  const outputs: BlenderRunPythonOutput["outputs"] = [];

  for (const name of expectedOutputs) {
    const outputPath = path.join(outputDir, name);
    const stats = await statFile(outputPath);

    if (!stats.exists) {
      return toolFailure({
        tool: "blender.run_python",
        riskLevel: "medium",
        strategy: "app_adapter",
        error: {
          code: "blender_output_missing",
          message: `Expected Blender output was not created: ${outputPath}`
        },
        observations: ["Blender finished but did not create every declared output file."]
      });
    }

    outputs.push({
      path: outputPath,
      exists: true,
      bytes: stats.bytes
    });
  }

  return toolSuccess({
    tool: "blender.run_python",
    riskLevel: "medium",
    strategy: "app_adapter",
    data: {
      adapterId: "blender",
      capabilityId: "blender.run_python",
      blenderCommand: [command.command, ...(command.args ?? [])].join(" "),
      outputDir,
      outputs,
      exitCode: result.exitCode,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      timedOut: result.timedOut
    },
    observations: ["Ran Blender in background mode and validated the declared output files."]
  });
}
