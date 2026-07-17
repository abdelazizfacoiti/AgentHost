import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeSha256, readSha256Sidecar, sha256File } from "../release.js";

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
  });
});
