#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import path from "node:path";
import { startStdioServer } from "./server.js";

export * from "./server.js";
export * from "./tool-runner.js";
export * from "./tools/system.js";
export * from "./tools/vision.js";
export * from "./tools/desktop.js";
export * from "./tools/file.js";
export * from "./tools/shell.js";
export * from "./tools/window.js";
export * from "./tools/computer.js";
export * from "./tools/adapter.js";
export * from "./tools/tasks.js";

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] === undefined ? "" : path.resolve(process.argv[1]);

if (invokedFile === currentFile) {
  startStdioServer().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
