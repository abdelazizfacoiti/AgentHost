#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
const root = path.resolve("release");
const stage = (await readdir(root, { withFileTypes: true })).find((entry) => entry.isDirectory() && entry.name.startsWith("agenthost-v"));
if (!stage) throw new Error("release_stage_missing");
const base = path.join(root, stage.name); const manifest = JSON.parse(await readFile(path.join(base, "version.json"), "utf8"));
const failures = [];
for (const item of manifest.files ?? []) { const data = await readFile(path.join(base, item.path)).catch(() => undefined); if (!data || createHash("sha256").update(data).digest("hex") !== item.sha256) failures.push(item.path); }
if (failures.length) { console.error(JSON.stringify({ verified: false, failures }, null, 2)); process.exit(1); }
console.log(JSON.stringify({ verified: true, version: manifest.version, files: manifest.files.length }, null, 2));
