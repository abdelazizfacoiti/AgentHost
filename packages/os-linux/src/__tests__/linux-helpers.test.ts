import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkLinuxDependency,
  detectLinuxApp,
  ensureLinuxDir,
  linuxFileExists,
  listLinuxDirectory,
  readLinuxFile,
  runSafeLinuxCommand,
  writeLinuxFile
} from "../index.js";
import { getPolicyProfile } from "@agenthost/core";

describe("Linux helpers", () => {
  it("checks commands without executing them", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agenthost-dep-"));
    const commandPath = path.join(dir, "sample-command");
    await writeFile(commandPath, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(commandPath, 0o700);

    await expect(
      checkLinuxDependency({ name: "sample-command", kind: "command" }, { env: { PATH: dir } })
    ).resolves.toMatchObject({
      found: true,
      kind: "command",
      commandPath
    });
  });

  it("detects unknown apps as guide-only", async () => {
    await expect(
      detectLinuxApp({ appName: "definitely-not-installed-agenthost-test" }, getPolicyProfile("dev"), {
        env: { PATH: "" },
        homeDir: path.join(os.tmpdir(), "agenthost-empty-home")
      })
    ).resolves.toMatchObject({
      found: false,
      recommendedStrategy: "guide_only",
      availableStrategies: ["guide_only"],
      guideSuggestion: {
        suggestedTool: "guide.create_steps",
        input: {
          workflowKind: "unknown_app"
        }
      }
    });
  });

  it("prefers guide suggestions for sensitive apps", async () => {
    await expect(
      detectLinuxApp({ appName: "Gmail" }, getPolicyProfile("dev"), {
        env: { PATH: "" },
        homeDir: path.join(os.tmpdir(), "agenthost-empty-home")
      })
    ).resolves.toMatchObject({
      recommendedStrategy: "guide_only",
      appSensitivity: "communication",
      guideSuggestion: {
        strategy: "guide_only",
        warning: expect.stringContaining("will not send messages")
      }
    });
  });

  it("runs safe commands with shell disabled", async () => {
    await expect(runSafeLinuxCommand({ command: process.execPath, args: ["--version"] })).resolves.toMatchObject({
      exitCode: 0,
      timedOut: false
    });
  });

  it("writes, reads, checks, lists, and ensures directories", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agenthost-files-"));
    const filePath = path.join(dir, "nested", "hello.txt");

    await expect(writeLinuxFile({ path: filePath, content: "hello", createParents: true })).resolves.toMatchObject({
      path: filePath,
      bytesWritten: 5,
      created: true
    });
    await expect(readFile(filePath, "utf8")).resolves.toBe("hello");
    await expect(readLinuxFile({ path: filePath })).resolves.toMatchObject({
      content: "hello",
      bytesRead: 5,
      truncated: false
    });
    await expect(linuxFileExists({ path: filePath })).resolves.toMatchObject({
      exists: true,
      type: "file"
    });
    await expect(listLinuxDirectory({ path: path.dirname(filePath) })).resolves.toMatchObject({
      entries: [
        {
          name: "hello.txt",
          type: "file"
        }
      ],
      truncated: false
    });
    await expect(ensureLinuxDir({ path: path.join(dir, "created") })).resolves.toMatchObject({
      exists: true,
      created: true
    });
  });

  it("does not overwrite existing files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agenthost-no-overwrite-"));
    const filePath = path.join(dir, "hello.txt");
    await writeFile(filePath, "already here", "utf8");

    await expect(writeLinuxFile({ path: filePath, content: "new" })).rejects.toMatchObject({
      code: "EEXIST"
    });
  });
});
