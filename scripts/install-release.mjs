#!/usr/bin/env node
import { chmod, cp, mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
let archiveRoot = path.resolve(process.argv[2] ?? "");
if (archiveRoot.endsWith(".tar.gz")) {
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
const version = JSON.parse(await readFile(path.join(archiveRoot, "version.json"), "utf8")).version;
const installRoot = path.join(os.homedir(), ".local", "share", "agenthost", "releases", version); const current = path.join(os.homedir(), ".local", "share", "agenthost", "current"); const bin = path.join(os.homedir(), ".local", "bin");
await mkdir(path.dirname(installRoot), { recursive: true, mode: 0o700 }); await cp(archiveRoot, installRoot, { recursive: true, force: true }); await rename(current, `${current}.previous`).catch(() => undefined); await rename(installRoot, current).catch(async () => { await rm(current, { recursive: true, force: true }); await rename(installRoot, current); }); await mkdir(bin, { recursive: true, mode: 0o700 }); const wrapper = `#!/usr/bin/env node\nprocess.env.AGENTHOST_RELEASE_ROOT=${JSON.stringify(current)};\nawait import(${JSON.stringify(path.join(current, "bin", "agenthost.mjs"))});\n`; await writeFile(path.join(bin, "agenthost"), wrapper, { mode: 0o700 }); await chmod(path.join(bin, "agenthost"), 0o700); console.log(JSON.stringify({ installed: true, version, root: "[agenthost-install]", executable: "[agenthost-bin]" }, null, 2));
