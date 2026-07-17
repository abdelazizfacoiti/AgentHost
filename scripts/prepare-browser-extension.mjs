import { access, chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const source = path.join(root, "packages", "app-browser", "extension");
const requested = process.argv.includes("--browser") ? process.argv[process.argv.indexOf("--browser") + 1] : "all";
const outputFlag = process.argv.indexOf("--output");
const output = outputFlag >= 0 ? path.resolve(process.argv[outputFlag + 1]) : (process.env.AGENTHOST_BROWSER_EXTENSION_DIR ?? path.join(os.homedir(), "AgentHost", "browser-extension"));
const setup = process.argv.includes("--setup");
const families = requested === "all" ? ["firefox", "chromium"] : [requested];
if (!families.every((item) => item === "firefox" || item === "chromium")) throw new Error("Use --browser firefox, chromium, or all.");
for (const required of ["background.js", "popup.html", "popup.js"]) await access(path.join(source, required));
for (const family of families) {
  const manifestSource = path.join(source, `manifest.${family}.json`);
  const manifest = JSON.parse(await readFile(manifestSource, "utf8"));
  const background = manifest.background ?? {};
  const backgroundFile = background.service_worker ?? background.scripts?.[0];
  if (typeof backgroundFile !== "string"
    || !["tabs", "storage", "scripting", "alarms"].every((permission) => manifest.permissions?.includes(permission))
    || JSON.stringify(manifest.host_permissions) !== JSON.stringify(["http://127.0.0.1/*"])) throw new Error(`Invalid ${family} manifest.`);
  const destination = path.join(output, family);
  await rm(destination, { recursive: true, force: true }); await mkdir(destination, { recursive: true, mode: 0o700 });
  await cp(path.join(source, "background.js"), path.join(destination, "background.js"));
  await cp(path.join(source, "popup.html"), path.join(destination, "popup.html"));
  await cp(path.join(source, "popup.js"), path.join(destination, "popup.js"));
  try { await cp(path.join(source, "popup.css"), path.join(destination, "popup.css")); } catch { /* optional during source-only setup */ }
  await writeFile(path.join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  console.log(`${family}: ${path.join(destination, "manifest.json")}`);
  if (family === "firefox") console.log("Firefox development only: open about:debugging#/runtime/this-firefox, Load Temporary Add-on…, select manifest.json. Public users must install Mozilla-signed XPI.");
  else console.log("Chromium development only: open chrome://extensions, enable Developer mode, Load unpacked, select folder. Public users should install store release.");
}
if (!setup) console.log("Start AgentHost with browserBridge.enabled=true, then use browser.generate_pairing_token dry-run + confirmation. Paste returned token in extension popup.");
if (setup) {
  const home = os.homedir(), agentHost = process.env.AGENTHOST_HOME ?? path.join(home, ".agenthost"), configPath = process.env.AGENTHOST_CONFIG ?? path.join(agentHost, "config.json");
  let config = {};
  try { config = JSON.parse(await readFile(configPath, "utf8")); } catch { /* first local setup */ }
  const currentBridge = typeof config.browserBridge === "object" && config.browserBridge !== null ? config.browserBridge : {};
  config.browserBridge = { ...currentBridge, enabled: true, port: Number.isInteger(currentBridge.port) ? currentBridge.port : 43117 };
  await mkdir(agentHost, { recursive: true, mode: 0o700 }); await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 }); await chmod(configPath, 0o600);
  console.log("\nBrowser bridge enabled. Restart AgentHost MCP server.");
  console.log("Then use browser.generate_pairing_token dry-run + confirmation and paste returned one-time token into extension popup.");
  console.log("Setup script does not create, print, or preserve pairing credentials.");
}
