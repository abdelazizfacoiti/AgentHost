#!/usr/bin/env node
import { readFile, readdir, readlink, stat } from "node:fs/promises";
import path from "node:path";
import { validateReleaseTree } from "./release-integrity.mjs";
const root = path.resolve("release");
const stage = (await readdir(root, { withFileTypes: true })).find((entry) => entry.isDirectory() && entry.name.startsWith("agenthost-v"));
if (!stage) throw new Error("release_stage_missing");
const base = path.join(root, stage.name);
const currentUser = process.env.USER ?? "";
const forbidden = [/-----BEGIN (?:RSA|OPENSSH|EC|PRIVATE) KEY-----\s+[A-Za-z0-9+/=\r\n]{40,}\s+-----END/i, /AKIA[0-9A-Z]{16}/, /bearer\s+[a-z0-9._-]{20,}/i, /AH-[A-Z0-9]{5}(?:-[A-Z0-9]{5}){2,}/, ...(currentUser ? [new RegExp(`/home/${currentUser.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(?:/|\\\\)`)] : [])];
const failures = [];
async function walk(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) { const item = path.join(directory, entry.name); if (entry.isSymbolicLink()) { const target = await readlink(item).catch(() => ""); const resolved = path.resolve(path.dirname(item), target); if (!target || path.isAbsolute(target) || (resolved !== base && !resolved.startsWith(`${base}${path.sep}`))) failures.push(`${path.relative(base, item)}:symlink_escape`); continue; } if (entry.isDirectory()) { if (["__pycache__", ".git", ".cache", ".vite", ".vite-temp"].includes(entry.name)) failures.push(`${path.relative(base, item)}:forbidden_directory`); else await walk(item); } else { const relative = path.relative(base, item); const size = (await stat(item)).size; if (/\.(png|jpe?g|webp|wav|mp3|ogg|log|pyc|map|tsbuildinfo)$/i.test(entry.name) || entry.name.startsWith(".tmp-")) failures.push(`${relative}:forbidden_artifact`); if (size > 50_000_000) failures.push(`${relative}:oversized`); if (size < 5_000_000) { const text = await readFile(item).catch(() => Buffer.alloc(0)); if (text.includes(0)) continue; const value = text.toString("utf8"); for (const pattern of forbidden) if (pattern.test(value)) failures.push(`${relative}:${pattern.source}`); } } } }
await walk(base);
const manifest = await readFile(path.join(base, "version.json"), "utf8")
  .then((value) => JSON.parse(value))
  .catch(() => undefined);
if (manifest === undefined) failures.push("version.json:invalid");
else failures.push(...await validateReleaseTree(base, manifest));
if (failures.length) { console.error(JSON.stringify({ safe: false, failures }, null, 2)); process.exit(1); }
console.log(JSON.stringify({ safe: true, stage: stage.name }, null, 2));
