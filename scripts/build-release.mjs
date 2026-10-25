#!/usr/bin/env node
import { chmod, cp, mkdir, readdir, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectReleaseFiles,
  LEGAL_FILES,
  productionDependencyInventory,
  PROJECT_LICENSE,
  pruneNonProductionPackages,
  renderThirdPartyNotices,
  validateReleaseTree
} from "./release-integrity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootPackage = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
const version = rootPackage.version;
if (process.platform !== "linux" || process.arch !== "x64") throw new Error("release_target_requires_linux_x64");
if (rootPackage.license !== PROJECT_LICENSE) throw new Error("release_project_license_invalid");
for (const legalFile of LEGAL_FILES) {
  if (!(await stat(path.join(root, legalFile)).then((value) => value.isFile()).catch(() => false))) {
    throw new Error(`release_legal_file_missing:${legalFile}`);
  }
}
const expectedNotices = renderThirdPartyNotices(productionDependencyInventory(lock));
if (await readFile(path.join(root, "THIRD_PARTY_NOTICES"), "utf8") !== expectedNotices) {
  throw new Error("release_third_party_notices_stale");
}
const releaseRoot = path.join(root, "release");
const stage = path.join(releaseRoot, `agenthost-v${version}-linux-x64`);
// Release staging can contain large dependency trees; tolerate transient
// directory-entry races while pruning a prior stage, but never reuse it.
await rm(stage, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
await mkdir(stage, { recursive: true, mode: 0o755 });
async function copy(source, destination, options = {}) { await mkdir(path.dirname(destination), { recursive: true }); await cp(source, destination, { recursive: true, force: true, verbatimSymlinks: true, ...options }); }
for (const packageName of ["core", "mcp-server", "os-linux", "app-overlay", "app-blender", "app-ssh", "agenthost-cli"]) {
  await copy(path.join(root, "packages", packageName, "dist"), path.join(stage, "packages", packageName, "dist"));
  await copy(path.join(root, "packages", packageName, "package.json"), path.join(stage, "packages", packageName, "package.json"));
}
await copy(path.join(root, "packages", "app-overlay", "runtime"), path.join(stage, "packages", "app-overlay", "runtime"));
await copy(path.join(root, "README.md"), path.join(stage, "README.md"));
await copy(path.join(root, "CHANGELOG.md"), path.join(stage, "CHANGELOG.md"));
await copy(path.join(root, "CONTRIBUTING.md"), path.join(stage, "CONTRIBUTING.md"));
for (const communityFile of ["CODE_OF_CONDUCT.md", "SECURITY.md", "SUPPORT.md"]) {
  await copy(path.join(root, communityFile), path.join(stage, communityFile));
}
await copy(path.join(root, "docs"), path.join(stage, "docs"));
for (const legalFile of LEGAL_FILES) {
  await copy(path.join(root, legalFile), path.join(stage, legalFile));
}
if (await stat(path.join(root, "node_modules")).then(() => true).catch(() => false)) await copy(path.join(root, "node_modules"), path.join(stage, "node_modules"));
await mkdir(path.join(stage, "node_modules", "@agenthost"), { recursive: true });
for (const packageName of ["core", "os-linux", "app-overlay", "app-blender", "app-ssh", "mcp-server"]) {
  const link = path.join(stage, "node_modules", "@agenthost", packageName);
  await rm(link, { recursive: true, force: true }).catch(() => undefined);
  await symlink(path.join("..", "..", "packages", packageName), link, "junction");
}
await pruneNonProductionPackages(stage, lock);
async function prune(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.name === "__tests__" || entry.name === "__pycache__" || entry.name === ".cache" || entry.name === ".vite" || entry.name === ".vite-temp" || entry.name.endsWith(".map") || entry.name.endsWith(".tsbuildinfo") || entry.name.endsWith(".pyc") || /\.(png|jpe?g|webp|gif|wav|mp3|ogg)$/i.test(entry.name) || ["typescript", "vitest", "vite", "vite-node", "esbuild", "rollup", "postcss", "@types", "@vitest", "@esbuild"].includes(entry.name)) { await rm(item, { recursive: true, force: true }); continue; }
    if (entry.isDirectory()) await prune(item);
  }
}
await prune(stage);
async function removeDanglingSymlinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) { const target = await readlink(item).catch(() => ""); const resolved = path.resolve(path.dirname(item), target); if (path.isAbsolute(target) || (resolved !== stage && !resolved.startsWith(`${stage}${path.sep}`)) || !(await stat(item).catch(() => undefined))) await rm(item, { force: true }); continue; }
    if (entry.isDirectory()) await removeDanglingSymlinks(item);
  }
}
await removeDanglingSymlinks(stage);
const wrapper = `#!/usr/bin/env node\nimport { fileURLToPath } from "node:url";\nprocess.env.AGENTHOST_RELEASE_ROOT = fileURLToPath(new URL("..", import.meta.url));\nawait import(new URL("../packages/agenthost-cli/dist/index.js", import.meta.url));\n`;
await mkdir(path.join(stage, "bin"), { recursive: true });
await writeFile(path.join(stage, "bin", "agenthost.mjs"), wrapper, { mode: 0o755 }); await chmod(path.join(stage, "bin", "agenthost.mjs"), 0o755);
for (const packageName of ["core", "mcp-server", "os-linux", "app-overlay", "app-blender", "app-ssh", "agenthost-cli"]) {
  const packageManifest = JSON.parse(await readFile(path.join(stage, "packages", packageName, "package.json"), "utf8"));
  if (packageManifest.license !== PROJECT_LICENSE) {
    throw new Error(`release_package_license_invalid:${packageName}`);
  }
}
const inventory = await collectReleaseFiles(stage);
if (inventory.symlinkFailures.length > 0) {
  throw new Error(`release_symlink_invalid:${inventory.symlinkFailures.join(",")}`);
}
const manifest = {
  product: "AgentHost",
  version,
  schemaVersion: 2,
  platform: "linux",
  architecture: "x64",
  createdAt: "1970-01-01T00:00:00.000Z",
  requires: { node: ">=20", python: "3" },
  limitations: [
    "X11 visible overlay is verified; Wayland reports limited support."
  ],
  legal: {
    projectLicense: PROJECT_LICENSE,
    licenseFile: "LICENSE",
    noticeFile: "NOTICE",
    thirdPartyNoticesFile: "THIRD_PARTY_NOTICES",
    licenseIncluded: true,
    noticeIncluded: true,
    thirdPartyNoticesIncluded: true
  },
  files: inventory.files
};
await writeFile(path.join(stage, "version.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o644 });
const treeFailures = await validateReleaseTree(stage, manifest);
if (treeFailures.length > 0) {
  throw new Error(`release_tree_invalid:${treeFailures.join(",")}`);
}
await mkdir(releaseRoot, { recursive: true });
const archive = path.join(releaseRoot, `agenthost-v${version}-linux-x64.tar.gz`);
// Normalize both tar metadata and the gzip header timestamp so identical
// source trees produce byte-identical release archives.
const tar = spawnSync("tar", ["--use-compress-program=gzip -n", "-cf", archive, "--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "-C", releaseRoot, path.basename(stage)], { stdio: "pipe" });
if (tar.status !== 0) throw new Error("release_archive_failed");
const archiveHash = createHash("sha256").update(await readFile(archive)).digest("hex");
await writeFile(`${archive}.sha256`, `${archiveHash}  ${path.basename(archive)}\n`, { mode: 0o644 });
await writeFile(path.join(releaseRoot, "SHA256SUMS"), `${archiveHash}  ${path.basename(archive)}\n`, { mode: 0o644 });
console.log(JSON.stringify({ stage, archive, version, fileCount: inventory.files.length }, null, 2));
