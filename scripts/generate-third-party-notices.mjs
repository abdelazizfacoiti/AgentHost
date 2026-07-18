#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  productionDependencyInventory,
  renderThirdPartyNotices
} from "./release-integrity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
const notices = renderThirdPartyNotices(productionDependencyInventory(lock));

if (process.argv.includes("--check")) {
  const current = await readFile(path.join(root, "THIRD_PARTY_NOTICES"), "utf8")
    .catch(() => "");
  if (current !== notices) {
    throw new Error("third_party_notices_out_of_date");
  }
  console.log("THIRD_PARTY_NOTICES is current.");
} else if (process.argv.includes("--stdout")) {
  process.stdout.write(notices);
} else {
  await writeFile(path.join(root, "THIRD_PARTY_NOTICES"), notices, {
    encoding: "utf8",
    mode: 0o644
  });
  console.log("Generated THIRD_PARTY_NOTICES.");
}
