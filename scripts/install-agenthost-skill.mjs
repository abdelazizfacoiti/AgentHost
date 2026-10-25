#!/usr/bin/env node
/**
 * Install the portable AgentHost laptop-control skill into common AI assistants.
 *
 *   node scripts/install-agenthost-skill.mjs --target opencode
 *   node scripts/install-agenthost-skill.mjs --target claude
 *   node scripts/install-agenthost-skill.mjs --target codex
 *   node scripts/install-agenthost-skill.mjs --target copilot --project /path/to/repo
 *   node scripts/install-agenthost-skill.mjs --target copilot-cli
 *   node scripts/install-agenthost-skill.mjs --target cursor --project /path/to/repo
 *   node scripts/install-agenthost-skill.mjs --target all
 *   node scripts/install-agenthost-skill.mjs --target all --no-mcp
 *   node scripts/install-agenthost-skill.mjs --print   # manual copy
 *
 * The skill is advisory text only; it never executes machine actions. Unless
 * --no-mcp is set, it also runs the corresponding integrations command.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "../skills/agenthost/SKILL.md");
const home = os.homedir();
const markerStart = "<!-- agenthost-skill:start (managed by scripts/install-agenthost-skill.mjs) -->";
const markerEnd = "<!-- agenthost-skill:end -->";

function parseArgs(argv) {
  const targets = [];
  let project = process.cwd();
  let dryRun = false;
  let print = false;
  let mcp = true;
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--target") targets.push(argv[++index]);
    else if (item === "--project") project = path.resolve(argv[++index]);
    else if (item === "--dry-run") dryRun = true;
    else if (item === "--print") print = true;
    else if (item === "--no-mcp") mcp = false;
    else if (item === "--help" || item === "-h") {
      console.log("usage: install-agenthost-skill.mjs [--target opencode|claude|codex|copilot|copilot-cli|cursor|all] [--project DIR] [--dry-run] [--print] [--no-mcp]");
      process.exit(0);
    } else {
      console.error(`unknown argument: ${item}`);
      process.exit(2);
    }
  }
  return { targets, project, dryRun, print, mcp };
}

function splitFrontmatter(markdown) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(markdown);
  if (match === null) return { frontmatter: "", body: markdown };
  return { frontmatter: match[1], body: match[2] };
}

function description(frontmatter) {
  const fallback = "Route laptop-control actions through the AgentHost MCP server.";
  const lines = frontmatter.split("\n");
  const index = lines.findIndex((entry) => entry.startsWith("description:"));
  if (index < 0) return fallback;
  const first = lines[index].slice("description:".length).trim();
  const folded = first === ">" || first === "|" || first === "";
  const parts = folded ? [] : [first];
  if (folded) {
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/^\S/.test(lines[cursor])) break;
      parts.push(lines[cursor].trim());
    }
  }
  const joined = parts.join(" ").replace(/\s+/g, " ").trim();
  if (joined.length <= 500) return joined || fallback;
  return `${joined.slice(0, joined.lastIndexOf(" ", 497)).trim()}…`;
}

function markedSection(body) {
  return `${markerStart}\n${body.trim()}\n${markerEnd}\n`;
}

async function writeSkillFile(target, content, dryRun) {
  if (dryRun) {
    console.log(`[dry-run] would write ${target} (${content.length} bytes)`);
    return;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  console.log(`wrote ${target}`);
}

async function upsertMarkedFile(target, body, dryRun) {
  let existing = "";
  try { existing = await readFile(target, "utf8"); } catch { existing = ""; }
  const block = markedSection(body);
  const start = existing.indexOf(markerStart);
  const end = existing.indexOf(markerEnd);
  const updated = start >= 0 && end > start
    ? existing.slice(0, start) + block + existing.slice(end + markerEnd.length).replace(/^\n+/, "\n")
    : `${existing.replace(/\s*$/, "")}${existing.trim().length > 0 ? "\n\n" : ""}${block}`;
  if (dryRun) {
    console.log(`[dry-run] would update ${target} (${updated.length} bytes)`);
    return;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, updated, "utf8");
  console.log(`updated ${target}`);
}

function registerMcp(target, project, dryRun) {
  const cli = path.resolve(here, "..", "packages", "agenthost-cli", "dist", "index.js");
  if (!existsSync(cli)) {
    console.warn(`MCP registration skipped for ${target}: build AgentHost first (npm run build) or run agenthost integrations ${target} add --apply.`);
    return;
  }
  const args = [cli, "integrations", target, "add", "--project", project];
  if (!dryRun) args.push("--apply");
  const result = spawnSync(process.execPath, args, { stdio: "inherit", env: process.env });
  if (result.status !== 0) console.warn(`MCP registration failed for ${target}; run agenthost integrations ${target} add --apply manually.`);
}

async function main() {
  const { targets, project, dryRun, print, mcp } = parseArgs(process.argv.slice(2));
  const markdown = await readFile(source, "utf8");
  if (print) {
    process.stdout.write(markdown);
    return;
  }
  const { frontmatter, body } = splitFrontmatter(markdown);
  const summary = description(frontmatter);
  const requested = targets.length === 0 ? ["opencode"] : targets.flatMap((entry) => entry === "all" ? ["opencode", "claude", "codex", "copilot", "copilot-cli", "cursor"] : [entry]);
  const known = new Set(["opencode", "claude", "codex", "copilot", "copilot-cli", "cursor"]);
  for (const target of requested) {
    if (!known.has(target)) {
      console.error(`unknown target: ${target}`);
      process.exitCode = 2;
      continue;
    }
    if (target === "opencode") {
      await writeSkillFile(path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "opencode", "skills", "agenthost", "SKILL.md"), markdown, dryRun);
    } else if (target === "claude") {
      await writeSkillFile(path.join(home, ".claude", "skills", "agenthost", "SKILL.md"), markdown, dryRun);
    } else if (target === "codex") {
      await upsertMarkedFile(path.join(process.env.CODEX_HOME ?? path.join(home, ".codex"), "AGENTS.md"), body, dryRun);
    } else if (target === "copilot") {
      await upsertMarkedFile(path.join(project, ".github", "copilot-instructions.md"), body, dryRun);
    } else if (target === "copilot-cli") {
      await upsertMarkedFile(path.join(process.env.COPILOT_HOME ?? path.join(home, ".copilot"), "copilot-instructions.md"), body, dryRun);
    } else if (target === "cursor") {
      const cursor = `---\ndescription: ${summary.replace(/\n/g, " ")}\nglobs: \nalwaysApply: false\n---\n\n${body.trim()}\n`;
      await writeSkillFile(path.join(project, ".cursor", "rules", "agenthost.mdc"), cursor, dryRun);
    }
    if (mcp) registerMcp(target, project, dryRun);
  }
  if (!dryRun) {
    console.log(mcp
      ? "AgentHost skill installed. MCP server registration was applied where supported. Reload or restart the assistant so the client spawns AgentHost."
      : "AgentHost skill installed without MCP registration. Run the client's agenthost integrations command to expose the tools.");
  }
}

await main();
