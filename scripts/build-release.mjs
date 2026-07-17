#!/usr/bin/env node
import { chmod, cp, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
if (process.platform !== "linux" || process.arch !== "x64") throw new Error("release_target_requires_linux_x64");
const releaseRoot = path.join(root, "release");
const stage = path.join(releaseRoot, `agenthost-v${version}-linux-x64`);
const browserBuild = spawnSync(process.execPath, [path.join(root, "scripts", "build-browser-extension.mjs")], { cwd: root, stdio: "pipe" });
if (browserBuild.status !== 0) throw new Error("browser_release_artifact_build_failed");
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true, mode: 0o755 });
async function copy(source, destination, options = {}) { await mkdir(path.dirname(destination), { recursive: true }); await cp(source, destination, { recursive: true, force: true, ...options }); }
for (const packageName of ["core", "mcp-server", "os-linux", "app-browser", "app-overlay", "app-control-room", "app-blender", "agenthost-cli"]) {
  await copy(path.join(root, "packages", packageName, "dist"), path.join(stage, "packages", packageName, "dist"));
  await copy(path.join(root, "packages", packageName, "package.json"), path.join(stage, "packages", packageName, "package.json"));
}
await copy(path.join(root, "packages", "app-overlay", "runtime"), path.join(stage, "packages", "app-overlay", "runtime"));
await copy(path.join(root, "packages", "app-browser", "extension"), path.join(stage, "browser-extension", "source"));
await copy(path.join(releaseRoot, "browser"), path.join(stage, "browser-extension", "artifacts"));
await copy(path.join(root, "README.md"), path.join(stage, "README.md"));
await copy(path.join(root, "docs"), path.join(stage, "docs"));
await copy(path.join(root, "LICENSE"), path.join(stage, "LICENSE")).catch(() => undefined);
if (await stat(path.join(root, "node_modules")).then(() => true).catch(() => false)) await copy(path.join(root, "node_modules"), path.join(stage, "node_modules"));
await mkdir(path.join(stage, "node_modules", "@agenthost"), { recursive: true });
for (const packageName of ["core", "os-linux", "app-browser", "app-overlay", "app-control-room", "app-blender", "mcp-server"]) {
  const link = path.join(stage, "node_modules", "@agenthost", packageName);
  await rm(link, { recursive: true, force: true }).catch(() => undefined);
  await symlink(path.join("..", "..", "packages", packageName), link, "junction");
}
async function prune(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.name === "__tests__" || entry.name === "__pycache__" || entry.name === ".cache" || entry.name.endsWith(".map") || entry.name.endsWith(".tsbuildinfo") || entry.name.endsWith(".pyc") || /\.(png|jpe?g|webp|gif|wav|mp3|ogg)$/i.test(entry.name) || ["typescript", "vitest", "vite", "vite-node", "esbuild", "rollup", "postcss", "@types", "@vitest", "@esbuild"].includes(entry.name)) { await rm(item, { recursive: true, force: true }); continue; }
    if (entry.isDirectory()) await prune(item);
  }
}
await prune(stage);
const wrapper = `#!/usr/bin/env node\nprocess.env.AGENTHOST_RELEASE_ROOT = new URL("..", import.meta.url).pathname.replace(/\\/$/, "");\nawait import(new URL("../packages/agenthost-cli/dist/index.js", import.meta.url));\n`;
await mkdir(path.join(stage, "bin"), { recursive: true });
await writeFile(path.join(stage, "bin", "agenthost.mjs"), wrapper, { mode: 0o755 }); await chmod(path.join(stage, "bin", "agenthost.mjs"), 0o755);
const files = [];
async function walk(directory) { for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) { const item = path.join(directory, entry.name); if (entry.isSymbolicLink()) continue; if (entry.name === "__pycache__" || entry.name === ".cache") continue; if (entry.isDirectory()) await walk(item); else { const data = await readFile(item); files.push({ path: path.relative(stage, item), sha256: createHash("sha256").update(data).digest("hex"), bytes: data.byteLength }); } } }
await walk(stage);
const manifest = { product: "AgentHost", version, schemaVersion: 1, platform: "linux", architecture: "x64", createdAt: "1970-01-01T00:00:00.000Z", requires: { node: ">=20", python: "3" }, limitations: ["X11 visible overlay is verified; Wayland reports limited support.", "Browser extensions are unsigned/manual unless externally published."], files };
await writeFile(path.join(stage, "version.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o644 });
await mkdir(releaseRoot, { recursive: true });
const archive = path.join(releaseRoot, `agenthost-v${version}-linux-x64.tar.gz`);
const tar = spawnSync("tar", ["-czf", archive, "--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "-C", releaseRoot, path.basename(stage)], { stdio: "pipe" });
if (tar.status !== 0) throw new Error("release_archive_failed");
console.log(JSON.stringify({ stage, archive, version, fileCount: files.length }, null, 2));
