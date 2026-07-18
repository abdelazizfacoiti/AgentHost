#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateReleaseTree } from "./release-integrity.mjs";

const root = path.resolve("release");
const stage = (await readdir(root, { withFileTypes: true }))
  .find((entry) => entry.isDirectory() && entry.name.startsWith("agenthost-v"));
if (!stage) throw new Error("release_stage_missing");
const base = path.join(root, stage.name);
const failures = [];
const manifest = await readFile(path.join(base, "version.json"), "utf8")
  .then((value) => JSON.parse(value))
  .catch(() => undefined);
if (manifest === undefined) failures.push("version.json:invalid");
else failures.push(...await validateReleaseTree(base, manifest));

const archive = path.join(root, `${stage.name}.tar.gz`);
const sidecar = `${archive}.sha256`;
const expected = await readFile(sidecar, "utf8")
  .then((value) => value.trim().split(/\s+/u)[0])
  .catch(() => undefined);
const actual = await readFile(archive)
  .then((value) => createHash("sha256").update(value).digest("hex"))
  .catch(() => undefined);
if (!expected || !/^[a-f0-9]{64}$/iu.test(expected) || actual !== expected.toLowerCase()) {
  failures.push("archive:checksum");
}
const sums = await readFile(path.join(root, "SHA256SUMS"), "utf8").catch(() => "");
if (sums.trim() !== `${expected ?? ""}  ${path.basename(archive)}`) {
  failures.push("archive:checksum_manifest");
}

const listing = spawnSync("tar", ["-tzf", archive], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
if (listing.status !== 0) {
  failures.push("archive:list_failed");
} else {
  const entries = listing.stdout.split("\n").filter(Boolean);
  for (const entry of entries) {
    const normalized = path.posix.normalize(entry.replace(/\/$/u, ""));
    if (path.posix.isAbsolute(entry)
      || normalized === ".."
      || normalized.startsWith("../")
      || (normalized !== stage.name && !normalized.startsWith(`${stage.name}/`))) {
      failures.push(`archive:unsafe_path:${entry}`);
    }
  }
}

const temporary = await mkdtemp(path.join(os.tmpdir(), "agenthost-release-verify-"));
try {
  if (!failures.some((failure) => failure.startsWith("archive:"))) {
    const extraction = spawnSync("tar", ["-xzf", archive, "-C", temporary], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (extraction.status !== 0) {
      failures.push("archive:extract_failed");
    } else {
      const extractedEntries = await readdir(temporary);
      if (extractedEntries.length !== 1 || extractedEntries[0] !== stage.name) {
        failures.push("archive:root_layout");
      } else {
        const extractedRoot = path.join(temporary, stage.name);
        const extractedManifest = await readFile(path.join(extractedRoot, "version.json"), "utf8")
          .then((value) => JSON.parse(value))
          .catch(() => undefined);
        if (extractedManifest === undefined) failures.push("archive:manifest_invalid");
        else {
          failures.push(...(await validateReleaseTree(extractedRoot, extractedManifest))
            .map((failure) => `archive:${failure}`));
          if (JSON.stringify(extractedManifest) !== JSON.stringify(manifest)) {
            failures.push("archive:manifest_mismatch");
          }
        }
      }
    }
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}

const uniqueFailures = [...new Set(failures)].sort();
if (uniqueFailures.length) {
  console.error(JSON.stringify({ verified: false, failures: uniqueFailures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({
  verified: true,
  version: manifest.version,
  files: manifest.files.length,
  legal: manifest.legal,
  archiveChecksumVerified: true,
  archiveTreeVerified: true
}, null, 2));
