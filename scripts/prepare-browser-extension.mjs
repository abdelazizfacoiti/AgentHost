import { access, chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const source = path.join(root, "packages", "app-browser", "extension");
const requested = process.argv.includes("--browser") ? process.argv[process.argv.indexOf("--browser") + 1] : "all";
const outputFlag = process.argv.indexOf("--output");
const output = outputFlag >= 0 ? path.resolve(process.argv[outputFlag + 1]) : (process.env.AGENTHOST_BROWSER_EXTENSION_DIR ?? path.join(os.homedir(), ".local", "share", "agenthost", "browser-extension"));
const setup = process.argv.includes("--setup");
const families = requested === "all" ? ["firefox", "chromium"] : [requested];
if (!families.every((item) => item === "firefox" || item === "chromium")) throw new Error("Use --browser firefox, chromium, or all.");
for (const required of ["background.js", "popup.html", "popup.js"]) await access(path.join(source, required));
for (const family of families) {
  const manifestSource = path.join(source, `manifest.${family}.json`);
  const manifest = JSON.parse(await readFile(manifestSource, "utf8"));
  const background = manifest.background ?? {};
  const backgroundFile = background.service_worker ?? background.scripts?.[0];
  const popupFile = manifest.action?.default_popup;
  const forbiddenPermissions = new Set(["cookies", "debugger", "webRequest", "webRequestBlocking", "nativeMessaging", "history"]);
  if (manifest.manifest_version !== 3
    || backgroundFile !== "background.js"
    || popupFile !== "popup.html"
    || !["tabs", "storage", "scripting", "alarms"].every((permission) => manifest.permissions?.includes(permission))
    || manifest.permissions?.some((permission) => forbiddenPermissions.has(permission))
    || JSON.stringify(manifest.host_permissions) !== JSON.stringify(["http://127.0.0.1/*"])
    || JSON.stringify(manifest.optional_host_permissions) !== JSON.stringify(["https://*/*", "http://*/*"])
    || (family === "firefox" && manifest.browser_specific_settings?.gecko?.id !== "browser-bridge@agenthost.local")
    || (family === "chromium" && typeof manifest.key !== "string")) throw new Error(`Invalid ${family} manifest.`);
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
if (!setup) {
  const pairCommands = families.length === 1
    ? [`agenthost browser setup --browser ${families[0]} --apply --approve`]
    : [
        "agenthost browser setup --browser firefox --apply --approve",
        "agenthost browser setup --browser chromium --apply --approve"
      ];
  console.log("\nBrowser-side enrollment (no pairing token):");
  for (const command of pairCommands) console.log(`  ${command}`);
  console.log("That command starts a bounded local enrollment session and prints the exact path again. Leave it running while you load the extension and click Pair with AgentHost.");
}
if (setup) {
  const home = os.homedir();
  const agentHost = process.env.AGENTHOST_HOME ?? path.join(home, ".agenthost");
  const publicConfig = path.join(home, ".config", "agenthost", "config.json");
  const legacyConfig = path.join(agentHost, "config.json");
  const configPath = process.env.AGENTHOST_CONFIG ?? (existsSync(publicConfig) ? publicConfig : existsSync(legacyConfig) ? legacyConfig : publicConfig);
  let config = {};
  try { config = JSON.parse(await readFile(configPath, "utf8")); } catch { /* first local setup */ }
  const currentBridge = typeof config.browserBridge === "object" && config.browserBridge !== null ? config.browserBridge : {};
  config.browserBridge = { ...currentBridge, enabled: true, port: Number.isInteger(currentBridge.port) ? currentBridge.port : 43117 };
  await mkdir(agentHost, { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(configPath, 0o600);
  console.log(`\nBrowser bridge configured at ${configPath} (loopback port ${config.browserBridge.port}).`);
  console.log("No pairing token is required for a fresh setup; enrollment is started by the pairing command below.");
  console.log("\nSource checkout pairing flow:");
  console.log("  1. Build once if needed: npm run build");
  if (families.length === 1) {
    console.log(`  2. Terminal 1: npm run browser:pair -- --browser ${families[0]} --apply --approve`);
  } else {
    console.log("  2. Terminal 1: npm run browser:pair -- --browser firefox --apply --approve");
    console.log("     (use --browser chromium instead for Chromium)");
  }
  console.log("  3. Leave Terminal 1 running; load the printed extension path in your browser.");
  console.log("  4. Open the extension popup and click Pair with AgentHost.");
  console.log("  5. Wait for 'Browser Bridge is ready', then start normal MCP in Terminal 2: npm run start:mcp");
  console.log("\nDo not start npm run start:mcp as the pairing command; it does not create an enrollment session.");
}
