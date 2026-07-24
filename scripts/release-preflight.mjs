#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const required = [
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "SUPPORT.md",
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/ISSUE_TEMPLATE/question.yml",
  ".github/PULL_REQUEST_TEMPLATE.md"
];
const failures = [];
for (const relative of required) {
  if (!(await stat(path.join(root, relative)).then((value) => value.isFile()).catch(() => false))) failures.push(`missing:${relative}`);
}
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (packageJson.private !== true) failures.push("package:must_remain_private");
if (packageJson.license !== "Apache-2.0") failures.push("package:license");
const readme = await readFile(path.join(root, "README.md"), "utf8");
const security = await readFile(path.join(root, "SECURITY.md"), "utf8");
const docs = await readFile(path.join(root, "docs/03_MCP_TOOLS_AND_ADAPTERS.md"), "utf8");
for (const match of readme.matchAll(/\]\(([^)#:\s]+)(?:#[^)]+)?\)/gu)) {
  const target = match[1];
  if (target?.startsWith("http")) continue;
  if (target !== undefined && !(await stat(path.join(root, target)).then((value) => value.isFile()).catch(() => false))) failures.push(`docs:link_missing:${target}`);
}
if (!/Scheduler records are review-only metadata|scheduler records are metadata-only/i.test(readme)) failures.push("docs:scheduler_non_execution");
if (!/do not create timers, workers|no scheduler execution/i.test(security)) failures.push("security:scheduler_non_execution");
if (!/scheduler\.job_.*metadata-only|metadata-only.*scheduler\.job_/is.test(docs)) failures.push("docs:mcp_scheduler_non_execution");
if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checked: required.length, npmPublication: false, schedulerExecution: false }, null, 2));
