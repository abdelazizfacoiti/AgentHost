import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink, rm, stat } from "node:fs/promises";
import path from "node:path";

export const LEGAL_FILES = ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES"];
export const PROJECT_LICENSE = "Apache-2.0";

function posixRelative(root, item) {
  return path.relative(root, item).split(path.sep).join("/");
}

function packageNameFromLockPath(lockPath) {
  const marker = "node_modules/";
  const index = lockPath.lastIndexOf(marker);
  return index < 0 ? undefined : lockPath.slice(index + marker.length);
}

export function productionDependencyInventory(lock) {
  const records = [];
  for (const [lockPath, value] of Object.entries(lock?.packages ?? {})) {
    if (!lockPath.startsWith("node_modules/")
      || value?.dev === true
      || lockPath.startsWith("node_modules/@agenthost/")) continue;
    const name = typeof value?.name === "string" ? value.name : packageNameFromLockPath(lockPath);
    if (typeof name !== "string"
      || typeof value?.version !== "string"
      || typeof value?.license !== "string") {
      throw new Error(`release_dependency_metadata_invalid:${lockPath}`);
    }
    records.push({ name, version: value.version, license: value.license, lockPath });
  }
  return records.sort((left, right) =>
    left.name.localeCompare(right.name)
    || left.version.localeCompare(right.version)
    || left.lockPath.localeCompare(right.lockPath));
}

export function renderThirdPartyNotices(records) {
  const grouped = new Map();
  for (const record of records) {
    const names = grouped.get(record.license) ?? [];
    names.push(record.name);
    grouped.set(record.license, names);
  }
  const lines = [
    "AgentHost Third-Party Notices",
    "",
    "This file is generated from package-lock.json production dependency entries.",
    "AgentHost does not modify third-party license terms. Complete license texts",
    "remain alongside bundled packages under node_modules.",
    "",
    "Bundled npm production dependencies:",
    ""
  ];
  for (const [license, names] of [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`${license}:`);
    lines.push(`  ${[...new Set(names)].sort().join(", ")}`);
    lines.push("");
  }
  lines.push(
    "Optional system programs such as GTK3/PyGObject, xdotool, Tesseract,",
    "Bubblewrap, eSpeak NG, Piper, and Speech Dispatcher are not bundled by",
    "AgentHost. Their licenses and installation remain the operator's responsibility.",
    ""
  );
  return lines.join("\n");
}

export function isSafeManifestPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) return false;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || value.includes("\\")) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value
    && normalized !== "."
    && !normalized.startsWith("../")
    && !normalized.includes("/../");
}

export async function collectReleaseFiles(root, options = {}) {
  const excluded = new Set(options.exclude ?? []);
  const files = [];
  const symlinkFailures = [];
  async function walk(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const item = path.join(directory, entry.name);
      const relative = posixRelative(root, item);
      if (entry.isSymbolicLink()) {
        const target = await readlink(item).catch(() => "");
        const resolved = path.resolve(path.dirname(item), target);
        if (!target
          || path.isAbsolute(target)
          || (resolved !== root && !resolved.startsWith(`${root}${path.sep}`))
          || !(await stat(item).catch(() => undefined))) {
          symlinkFailures.push(`${relative}:symlink_escape`);
        }
        continue;
      }
      if (entry.isDirectory()) {
        await walk(item);
        continue;
      }
      if (!entry.isFile() || excluded.has(relative)) continue;
      const data = await readFile(item);
      files.push({
        path: relative,
        sha256: createHash("sha256").update(data).digest("hex"),
        bytes: data.byteLength
      });
    }
  }
  await walk(root);
  return { files, symlinkFailures };
}

async function validateLegalFiles(root, manifest, failures) {
  const legal = manifest?.legal;
  if (legal?.projectLicense !== PROJECT_LICENSE) failures.push("manifest:project_license");
  if (legal?.licenseIncluded !== true) failures.push("manifest:license_flag");
  if (legal?.noticeIncluded !== true) failures.push("manifest:notice_flag");
  if (legal?.thirdPartyNoticesIncluded !== true) failures.push("manifest:third_party_flag");
  const expectedPaths = {
    LICENSE: legal?.licenseFile,
    NOTICE: legal?.noticeFile,
    THIRD_PARTY_NOTICES: legal?.thirdPartyNoticesFile
  };
  for (const name of LEGAL_FILES) {
    if (expectedPaths[name] !== name) failures.push(`${name}:manifest_path`);
    const content = await readFile(path.join(root, name), "utf8").catch(() => undefined);
    if (content === undefined) {
      failures.push(`${name}:missing`);
      continue;
    }
    if ((name === "LICENSE" && !content.includes("Apache License"))
      || (name === "NOTICE" && !content.includes("AgentHost"))
      || (name === "THIRD_PARTY_NOTICES"
        && !content.includes("Bundled npm production dependencies:"))) {
      failures.push(`${name}:invalid`);
    }
  }
}

export async function validateReleaseTree(root, manifest) {
  const failures = [];
  if (manifest?.product !== "AgentHost") failures.push("manifest:product");
  if (manifest?.schemaVersion !== 2) failures.push("manifest:schema_version");
  if (manifest?.platform !== "linux") failures.push("manifest:platform");
  if (manifest?.architecture !== "x64") failures.push("manifest:architecture");
  await validateLegalFiles(root, manifest, failures);

  if (!Array.isArray(manifest?.files) || manifest.files.length === 0) {
    failures.push("manifest:files");
    return [...new Set(failures)].sort();
  }
  const declared = new Map();
  for (const item of manifest.files) {
    if (!isSafeManifestPath(item?.path)) {
      failures.push(`${String(item?.path)}:invalid_path`);
      continue;
    }
    if (declared.has(item.path)) failures.push(`${item.path}:duplicate`);
    if (typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(item.sha256)) {
      failures.push(`${item.path}:invalid_sha256`);
    }
    if (!Number.isSafeInteger(item.bytes) || item.bytes < 0) {
      failures.push(`${item.path}:invalid_bytes`);
    }
    declared.set(item.path, item);
  }

  const actual = await collectReleaseFiles(root, { exclude: ["version.json"] });
  failures.push(...actual.symlinkFailures);
  const actualByPath = new Map(actual.files.map((item) => [item.path, item]));
  for (const [filePath, item] of declared) {
    const record = actualByPath.get(filePath);
    if (record === undefined) failures.push(`${filePath}:missing`);
    else if (record.sha256 !== item.sha256 || record.bytes !== item.bytes) {
      failures.push(`${filePath}:fingerprint`);
    }
  }
  for (const filePath of actualByPath.keys()) {
    if (!declared.has(filePath)) failures.push(`${filePath}:undeclared`);
  }
  return [...new Set(failures)].sort();
}

export async function pruneNonProductionPackages(stageRoot, lock) {
  const allowed = new Set(productionDependencyInventory(lock).map((record) => record.lockPath));
  const nodeModules = path.join(stageRoot, "node_modules");
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory()) continue;
      const item = path.join(directory, entry.name);
      const relative = posixRelative(stageRoot, item);
      if (await lstat(path.join(item, "package.json")).then(() => true).catch(() => false)) {
        if (!allowed.has(relative)) {
          await rm(item, { recursive: true, force: true });
        }
        // A production package may contain package.json files for its own
        // build artifacts (for example dist/esm/package.json). Once the
        // package root is accepted, preserve its contents and inspect only
        // its nested node_modules for further package pruning.
        else await walk(path.join(item, "node_modules"));
        continue;
      }
      await walk(item);
    }
  }
  await walk(nodeModules);
}
