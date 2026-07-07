import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { getPolicyProfile } from "./policies.js";
import type { AgentHostConfig, PolicyProfileName } from "./types.js";

const policyProfileNameSchema = z.enum(["strict", "dev"]);

const configFileSchema = z
  .object({
    agentHostDir: z.string().min(1).optional(),
    logFile: z.string().min(1).optional(),
    profile: policyProfileNameSchema.optional()
  })
  .strict();

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  configPath?: string;
}

function expandHome(input: string, homeDir: string): string {
  if (input === "~") {
    return homeDir;
  }

  if (input.startsWith("~/")) {
    return path.join(homeDir, input.slice(2));
  }

  return input;
}

function resolveLocalPath(input: string, homeDir: string): string {
  const expanded = expandHome(input, homeDir);
  return path.isAbsolute(expanded) ? expanded : path.resolve(expanded);
}

async function readConfigFile(configPath: string): Promise<z.infer<typeof configFileSchema>> {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return configFileSchema.parse(parsed);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

export async function loadAgentHostConfig(options: LoadConfigOptions = {}): Promise<AgentHostConfig> {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const defaultAgentHostDir = path.join(homeDir, ".agenthost");
  const initialAgentHostDir = resolveLocalPath(env.AGENTHOST_HOME ?? defaultAgentHostDir, homeDir);
  const configPath = resolveLocalPath(options.configPath ?? path.join(initialAgentHostDir, "config.json"), homeDir);
  const fileConfig = await readConfigFile(configPath);

  const agentHostDir = resolveLocalPath(env.AGENTHOST_HOME ?? fileConfig.agentHostDir ?? initialAgentHostDir, homeDir);
  const profile = (env.AGENTHOST_PROFILE ?? fileConfig.profile ?? "strict") as PolicyProfileName;
  const parsedProfile = policyProfileNameSchema.parse(profile);
  const logFile = resolveLocalPath(
    env.AGENTHOST_LOG_FILE ?? fileConfig.logFile ?? path.join(agentHostDir, "logs", "agenthost.jsonl"),
    homeDir
  );

  return {
    agentHostDir,
    configPath,
    logFile,
    profile: parsedProfile,
    policy: getPolicyProfile(parsedProfile)
  };
}
