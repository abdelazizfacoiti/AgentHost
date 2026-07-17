#!/usr/bin/env node
import { chmod, cp, mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
const args = process.argv.slice(2);
const input = args.find((value) => !value.startsWith("--"));
const checksumIndex = args.findIndex((value) => value === "--sha256" || value.startsWith("--sha256="));
const explicitChecksum = checksumIndex < 0 ? undefined : args[checksumIndex].startsWith("--sha256=") ? args[checksumIndex].slice("--sha256=".length) : args[checksumIndex + 1];
function normalizeChecksum(value) {
  const digest = value.trim().split(/\s+/u)[0] ?? "";
  if (!/^[a-f0-9]{64}$/iu.test(digest)) throw new Error("release_checksum_invalid");
  return digest.toLowerCase();
}
async function verifyArchiveChecksum(archive) {
  const expected = explicitChecksum === undefined
    ? await readFile(`${archive}.sha256`, "utf8").then(normalizeChecksum).catch(() => undefined)
    : normalizeChecksum(explicitChecksum);
  if (expected === undefined) throw new Error("release_checksum_required");
  const actual = createHash("sha256").update(await readFile(archive)).digest("hex");
  if (actual !== expected) throw new Error("release_checksum_mismatch");
  return actual;
}
async function verifyManifest(directory) {
  const manifest = JSON.parse(await readFile(path.join(directory, "version.json"), "utf8"));
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(String(manifest.version ?? ""))) throw new Error("release_version_invalid");
  for (const item of manifest.files ?? []) {
    if (typeof item.path !== "string" || item.path.startsWith("/") || item.path.includes("..")) throw new Error("release_manifest_path_invalid");
    const data = await readFile(path.join(directory, item.path)).catch(() => undefined);
    if (!data || createHash("sha256").update(data).digest("hex") !== item.sha256) throw new Error("release_manifest_mismatch");
  }
  return manifest;
}
let archiveRoot = path.resolve(input ?? "");
let checksumVerified = false;
if (archiveRoot.endsWith(".tar.gz")) {
  checksumVerified = Boolean(await verifyArchiveChecksum(archiveRoot));
  const listing = spawnSync("tar", ["-tzf", archiveRoot], { encoding: "utf8" });
  if (listing.status !== 0 || listing.stdout.split("\n").some((item) => item.startsWith("/") || item.includes("../"))) throw new Error("release_archive_invalid");
  const extraction = await mkdtemp(path.join(os.tmpdir(), "agenthost-release-"));
  const extracted = spawnSync("tar", ["-xzf", archiveRoot, "-C", extraction], { stdio: "ignore" });
  if (extracted.status !== 0) throw new Error("release_archive_extract_failed");
  const entries = (await (await import("node:fs/promises")).readdir(extraction, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  if (entries.length !== 1) throw new Error("release_archive_layout_invalid");
  archiveRoot = path.join(extraction, entries[0].name);
}
if (!archiveRoot || !(await readFile(path.join(archiveRoot, "version.json")).catch(() => undefined))) throw new Error("release_directory_required");
if (process.platform !== "linux" || process.arch !== "x64") throw new Error("release_target_requires_linux_x64");
const manifest = await verifyManifest(archiveRoot);
const version = manifest.version;
const installRoot = path.join(os.homedir(), ".local", "share", "agenthost", "releases", version); const current = path.join(os.homedir(), ".local", "share", "agenthost", "current"); const bin = path.join(os.homedir(), ".local", "bin");
const previous = `${current}.previous`;
await mkdir(path.dirname(installRoot), { recursive: true, mode: 0o700 });
await rm(installRoot, { recursive: true, force: true });
await cp(archiveRoot, installRoot, { recursive: true, force: true });
await rm(previous, { recursive: true, force: true });
if (await stat(current).catch(() => undefined)) await rename(current, previous);
try {
  await rename(installRoot, current);
} catch (error) {
  await rename(previous, current).catch(() => undefined);
  throw error;
}
await mkdir(bin, { recursive: true, mode: 0o700 }); const wrapper = `#!/usr/bin/env node\nprocess.env.AGENTHOST_RELEASE_ROOT=${JSON.stringify(current)};\nawait import(${JSON.stringify(path.join(current, "bin", "agenthost.mjs"))});\n`; await writeFile(path.join(bin, "agenthost"), wrapper, { mode: 0o700 }); await chmod(path.join(bin, "agenthost"), 0o700); console.log(JSON.stringify({ installed: true, version, checksumVerified, root: "[agenthost-install]", executable: "[agenthost-bin]" }, null, 2));
