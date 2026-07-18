import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeSha256, readSha256Sidecar, sha256File } from "../release.js";
// @ts-ignore Release scripts are JavaScript entry points tested from the workspace.
import * as releaseIntegrity from "../../../../scripts/release-integrity.mjs";

const {
  collectReleaseFiles,
  pruneNonProductionPackages,
  productionDependencyInventory,
  renderThirdPartyNotices,
  validateReleaseTree
} = releaseIntegrity;

describe("release integrity helpers", () => {
  it("normalizes valid checksum files and rejects malformed values", () => {
    expect(normalizeSha256(`${"A".repeat(64)}  archive.tar.gz`)).toBe("a".repeat(64));
    expect(() => normalizeSha256("not-a-checksum")).toThrow("release_checksum_invalid");
  });

  it("computes files and reads adjacent checksum sidecars", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-release-integrity-"));
    const file = path.join(root, "archive.tar.gz");
    await writeFile(file, "release");
    const digest = await sha256File(file);
    await writeFile(`${file}.sha256`, `${digest}  archive.tar.gz\n`);
    expect(await readSha256Sidecar(file)).toBe(digest);
    await writeFile(`${file}.sha256`, `${"0".repeat(64)}  archive.tar.gz\n`);
    expect(await readSha256Sidecar(file)).toBe("0".repeat(64));
    await writeFile(`${file}.sha256`, "bad\n");
    await expect(readSha256Sidecar(file)).rejects.toThrow("release_checksum_invalid");
    await rm(root, { recursive: true, force: true });
  });

  it("keeps the generated third-party notice synchronized with production dependencies", async () => {
    const lock = JSON.parse(await readFile(path.resolve("package-lock.json"), "utf8"));
    const inventory = productionDependencyInventory(lock);
    expect(inventory.length).toBeGreaterThan(0);
    expect(inventory.every((item: { lockPath: string; license: string }) =>
      item.lockPath.startsWith("node_modules/")
      && !item.lockPath.startsWith("node_modules/@agenthost/")
      && item.license.length > 0)).toBe(true);
    expect(await readFile(path.resolve("THIRD_PARTY_NOTICES"), "utf8"))
      .toBe(renderThirdPartyNotices(inventory));
  });

  it("requires legal files and an exact release manifest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-release-tree-"));
    await writeFile(path.join(root, "LICENSE"), "Apache License\n");
    await writeFile(path.join(root, "NOTICE"), "AgentHost\n");
    await writeFile(
      path.join(root, "THIRD_PARTY_NOTICES"),
      "Bundled npm production dependencies:\n"
    );
    await writeFile(path.join(root, "payload.txt"), "bounded release payload");
    const { files } = await collectReleaseFiles(root);
    const manifest = {
      product: "AgentHost",
      version: "0.1.0",
      schemaVersion: 2,
      platform: "linux",
      architecture: "x64",
      legal: {
        projectLicense: "Apache-2.0",
        licenseFile: "LICENSE",
        noticeFile: "NOTICE",
        thirdPartyNoticesFile: "THIRD_PARTY_NOTICES",
        licenseIncluded: true,
        noticeIncluded: true,
        thirdPartyNoticesIncluded: true
      },
      files
    };
    expect(await validateReleaseTree(root, manifest)).toEqual([]);
    await writeFile(path.join(root, "payload.txt"), "tampered");
    expect(await validateReleaseTree(root, manifest)).toContain("payload.txt:fingerprint");
    await writeFile(path.join(root, "unexpected.txt"), "not declared");
    expect(await validateReleaseTree(root, manifest)).toContain("unexpected.txt:undeclared");
    await rm(path.join(root, "NOTICE"));
    expect(await validateReleaseTree(root, manifest)).toContain("NOTICE:missing");
    await rm(root, { recursive: true, force: true });
  });

  it("prunes package roots without deleting package-internal build metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-release-prune-"));
    const kept = path.join(root, "node_modules", "kept");
    const removed = path.join(root, "node_modules", "removed");
    await mkdir(path.join(kept, "dist", "esm"), { recursive: true });
    await mkdir(removed, { recursive: true });
    await writeFile(path.join(kept, "package.json"), JSON.stringify({ name: "kept", version: "1.0.0" }));
    await writeFile(path.join(kept, "dist", "esm", "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(path.join(kept, "dist", "esm", "index.js"), "export const ok = true;\n");
    await writeFile(path.join(removed, "package.json"), JSON.stringify({ name: "removed", version: "1.0.0" }));
    await pruneNonProductionPackages(root, {
      packages: {
        "node_modules/kept": { version: "1.0.0", license: "MIT" }
      }
    });
    await expect(access(path.join(kept, "dist", "esm", "index.js"))).resolves.toBeUndefined();
    await expect(access(removed)).rejects.toThrow();
    await rm(root, { recursive: true, force: true });
  });

  it("generates a release launcher that decodes file URLs in paths with spaces", async () => {
    const source = await readFile(path.resolve("scripts/build-release.mjs"), "utf8");
    expect(source).toContain('import { fileURLToPath } from "node:url";');
    expect(source).toContain('fileURLToPath(new URL("..", import.meta.url))');
  });
});
