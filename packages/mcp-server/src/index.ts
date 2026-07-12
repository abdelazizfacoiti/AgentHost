#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import path from "node:path";
import { startStdioServer } from "./server.js";

export * from "./server.js";
export * from "./tool-runner.js";
export * from "./tools/system.js";
export * from "./tools/workflow.js";
export * from "./workflow-store.js";
export * from "./tools/vision.js";

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] === undefined ? "" : path.resolve(process.argv[1]);

if (invokedFile === currentFile) {
  startStdioServer().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
