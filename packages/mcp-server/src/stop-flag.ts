import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

function runDir(agentHostDir: string): string {
  return path.join(agentHostDir, "run");
}

export function stopFlagPath(agentHostDir: string): string {
  return path.join(runDir(agentHostDir), "stop.requested");
}

export function takeoverFlagPath(agentHostDir: string): string {
  return path.join(runDir(agentHostDir), "takeover.active");
}

/** Hard stop independent of the model. Checked by the central runner before state-changing execution. */
export async function requestStop(agentHostDir: string, reason = "operator_stop"): Promise<void> {
  await mkdir(runDir(agentHostDir), { recursive: true, mode: 0o700 });
  await writeFile(stopFlagPath(agentHostDir), JSON.stringify({ stopped: true, reason, at: new Date().toISOString() }), { mode: 0o600 });
}

export async function clearStop(agentHostDir: string): Promise<void> {
  await rm(stopFlagPath(agentHostDir), { force: true });
  await rm(takeoverFlagPath(agentHostDir), { force: true });
}

export async function isStopRequested(agentHostDir: string): Promise<boolean> {
  try {
    const raw = await readFile(stopFlagPath(agentHostDir), "utf8");
    return (JSON.parse(raw) as { stopped?: boolean }).stopped === true;
  } catch {
    return false;
  }
}

export async function beginTakeover(agentHostDir: string): Promise<void> {
  await mkdir(runDir(agentHostDir), { recursive: true, mode: 0o700 });
  await writeFile(takeoverFlagPath(agentHostDir), JSON.stringify({ takeover: true, at: new Date().toISOString() }), { mode: 0o600 });
}

export async function endTakeover(agentHostDir: string): Promise<void> {
  await rm(takeoverFlagPath(agentHostDir), { force: true });
}

export async function isTakeoverActive(agentHostDir: string): Promise<boolean> {
  try {
    const raw = await readFile(takeoverFlagPath(agentHostDir), "utf8");
    return (JSON.parse(raw) as { takeover?: boolean }).takeover === true;
  } catch {
    return false;
  }
}
