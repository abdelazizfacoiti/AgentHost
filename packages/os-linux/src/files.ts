import { constants } from "node:fs";
import { copyFile, lstat, mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import {
  normalizePathForPolicy,
  type FileEnsureDirResult,
  type FileExistsResult,
  type FileListEntry,
  type FileListResult,
  type FileReadResult,
  type FileWriteResult,
  type SafetyEvaluationContext
} from "@agenthost/core";

const DEFAULT_MAX_READ_BYTES = 64 * 1024;
const MAX_READ_BYTES = 1024 * 1024;
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(value), min), max);
}

function entryType(stats: { isFile(): boolean; isDirectory(): boolean }): "file" | "directory" | "other" {
  if (stats.isFile()) {
    return "file";
  }

  if (stats.isDirectory()) {
    return "directory";
  }

  return "other";
}

function normalize(inputPath: string, context: SafetyEvaluationContext = {}): string {
  return normalizePathForPolicy(inputPath, context);
}

export async function writeLinuxFile(
  input: { path: string; content: string; encoding?: "utf8" | "base64"; createParents?: boolean },
  context: SafetyEvaluationContext = {}
): Promise<FileWriteResult> {
  const normalizedPath = normalize(input.path, context);
  const bytes = input.encoding === "base64" ? Buffer.from(input.content, "base64") : Buffer.from(input.content, "utf8");

  if (input.createParents) {
    await mkdir(path.dirname(normalizedPath), { recursive: true });
  }

  const handle = await open(normalizedPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);

  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }

  return {
    path: normalizedPath,
    bytesWritten: bytes.byteLength,
    created: true
  };
}

export async function readLinuxFile(
  input: { path: string; encoding?: "utf8" | "base64"; maxBytes?: number },
  context: SafetyEvaluationContext = {}
): Promise<FileReadResult> {
  const normalizedPath = normalize(input.path, context);
  const maxBytes = clamp(input.maxBytes, DEFAULT_MAX_READ_BYTES, 1, MAX_READ_BYTES);
  const buffer = await readFile(normalizedPath);
  const sliced = buffer.subarray(0, maxBytes);
  const encoding = input.encoding ?? "utf8";

  return {
    path: normalizedPath,
    content: encoding === "base64" ? sliced.toString("base64") : sliced.toString("utf8"),
    encoding,
    bytesRead: sliced.byteLength,
    truncated: buffer.byteLength > maxBytes
  };
}

export async function linuxFileExists(
  input: { path: string },
  context: SafetyEvaluationContext = {}
): Promise<FileExistsResult> {
  const normalizedPath = normalize(input.path, context);

  try {
    const stats = await lstat(normalizedPath);
    return {
      path: normalizedPath,
      exists: true,
      type: entryType(stats)
    };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return {
        path: normalizedPath,
        exists: false
      };
    }

    throw error;
  }
}

export async function listLinuxDirectory(
  input: { path: string; limit?: number },
  context: SafetyEvaluationContext = {}
): Promise<FileListResult> {
  const normalizedPath = normalize(input.path, context);
  const limit = clamp(input.limit, DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);
  const dirents = await readdir(normalizedPath, { withFileTypes: true });
  const entries: FileListEntry[] = dirents.slice(0, limit).map((dirent) => ({
    name: dirent.name,
    path: path.join(normalizedPath, dirent.name),
    type: dirent.isFile() ? "file" : dirent.isDirectory() ? "directory" : "other"
  }));

  return {
    path: normalizedPath,
    entries,
    truncated: dirents.length > limit
  };
}

export async function ensureLinuxDir(
  input: { path: string },
  context: SafetyEvaluationContext = {}
): Promise<FileEnsureDirResult> {
  const normalizedPath = normalize(input.path, context);
  const before = await linuxFileExists({ path: normalizedPath }, context);

  if (before.exists && before.type !== "directory") {
    throw new Error(`Path exists and is not a directory: ${normalizedPath}`);
  }

  if (!before.exists) {
    await mkdir(normalizedPath, { recursive: true });
  }

  return {
    path: normalizedPath,
    exists: true,
    created: !before.exists
  };
}

export async function copyLinuxFile(
  input: { source: string; destination: string },
  context: SafetyEvaluationContext = {}
): Promise<{ source: string; destination: string; copied: boolean }> {
  const normalizedSource = normalize(input.source, context);
  const normalizedDestination = normalize(input.destination, context);
  await mkdir(path.dirname(normalizedDestination), { recursive: true });
  await copyFile(normalizedSource, normalizedDestination);
  return { source: normalizedSource, destination: normalizedDestination, copied: true };
}

export async function moveLinuxFile(
  input: { source: string; destination: string },
  context: SafetyEvaluationContext = {}
): Promise<{ source: string; destination: string; moved: boolean }> {
  const normalizedSource = normalize(input.source, context);
  const normalizedDestination = normalize(input.destination, context);
  await mkdir(path.dirname(normalizedDestination), { recursive: true });
  await rename(normalizedSource, normalizedDestination);
  return { source: normalizedSource, destination: normalizedDestination, moved: true };
}

export async function deleteLinuxPath(
  input: { path: string; recursive?: boolean },
  context: SafetyEvaluationContext = {}
): Promise<{ path: string; deleted: boolean }> {
  const normalizedPath = normalize(input.path, context);
  await rm(normalizedPath, { recursive: input.recursive === true, force: false });
  return { path: normalizedPath, deleted: true };
}
