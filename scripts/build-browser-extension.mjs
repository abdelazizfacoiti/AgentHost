import { deflateRawSync } from "node:zlib";
import { createHash as cryptoHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const source = path.join(root, "packages", "app-browser", "extension");
const output = path.join(root, "release", "browser");
const files = ["background.js", "popup.css", "popup.html", "popup.js"];
const forbiddenPermissions = new Set(["cookies", "debugger", "webRequest", "nativeMessaging", "history"]);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const crc = crc32(entry.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const record = Buffer.concat([header, name, compressed]);
    local.push(record);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0, 8);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt16LE(0, 12);
    directory.writeUInt16LE(33, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(entry.data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([directory, name]));
    offset += record.length;
  }
  const directoryOffset = offset;
  const directoryData = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryData.length, 12);
  end.writeUInt32LE(directoryOffset, 16);
  return Buffer.concat([...local, directoryData, end]);
}

async function build(family) {
  const manifest = JSON.parse(await readFile(path.join(source, `manifest.${family}.json`), "utf8"));
  const permissions = [...(manifest.permissions ?? [])];
  if (!["tabs", "storage", "scripting", "alarms"].every((permission) => permissions.includes(permission))) throw new Error(`${family}_required_permission_missing`);
  if (permissions.some((permission) => forbiddenPermissions.has(permission))) throw new Error(`${family}_forbidden_permission`);
  if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(["http://127.0.0.1/*"])) throw new Error(`${family}_unsafe_bridge_host`);
  if (family === "firefox" && manifest.browser_specific_settings?.gecko?.id !== "browser-bridge@agenthost.local") throw new Error("firefox_stable_identity_missing");
  if (family === "chromium" && typeof manifest.key !== "string") throw new Error("chromium_stable_identity_missing");
  const entries = [{ name: "manifest.json", data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) }];
  for (const name of files) entries.push({ name, data: await readFile(path.join(source, name)) });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const artifactName = family === "firefox"
    ? `agenthost-browser-${family}-${manifest.version}-unsigned.xpi`
    : `agenthost-browser-${family}-${manifest.version}.zip`;
  const data = zip(entries);
  await writeFile(path.join(output, artifactName), data, { mode: 0o600 });
  return {
    family,
    version: manifest.version,
    artifact: artifactName,
    sha256: cryptoHash("sha256").update(data).digest("hex"),
    signed: false,
    publicInstallable: false,
    externalAction: family === "firefox" ? "Submit deterministic XPI to Mozilla Add-ons for signing." : "Publish ZIP through Chrome Web Store."
  };
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true, mode: 0o700 });
const artifacts = [await build("firefox"), await build("chromium")];
await writeFile(path.join(output, "artifacts.json"), `${JSON.stringify({ schemaVersion: 1, artifacts }, null, 2)}\n`, { mode: 0o600 });
await writeFile(path.join(output, "SHA256SUMS"), `${artifacts.map((item) => `${item.sha256}  ${item.artifact}`).join("\n")}\n`, { mode: 0o600 });
console.log(`Built ${artifacts.length} deterministic unsigned browser artifacts in ${output}.`);
