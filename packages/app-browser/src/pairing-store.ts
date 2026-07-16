import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface PairedBrowserDevice {
  deviceId: string;
  browserFamily: "firefox" | "chromium";
  extensionId: string;
  exactOrigin: string;
  extensionVersion: string;
  protocolVersion: number;
  refreshSecretHash: string;
  createdAt: string;
  lastSeenAt: string;
  rotatedAt?: string;
  revokedAt?: string;
}

interface PairingState {
  schemaVersion: 1;
  devices: PairedBrowserDevice[];
}

const EMPTY: PairingState = { schemaVersion: 1, devices: [] };
const MAX_DEVICES = 20;

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function equalHash(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function validDevice(value: unknown): value is PairedBrowserDevice {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.deviceId === "string"
    && (item.browserFamily === "firefox" || item.browserFamily === "chromium")
    && typeof item.extensionId === "string"
    && typeof item.exactOrigin === "string"
    && typeof item.extensionVersion === "string"
    && Number.isInteger(item.protocolVersion)
    && typeof item.refreshSecretHash === "string"
    && typeof item.createdAt === "string"
    && typeof item.lastSeenAt === "string"
    && (item.rotatedAt === undefined || typeof item.rotatedAt === "string")
    && (item.revokedAt === undefined || typeof item.revokedAt === "string");
}

export class BrowserPairingStore {
  constructor(readonly file: string) {}

  async list(): Promise<PairedBrowserDevice[]> {
    return (await this.#read()).devices.map((item) => ({ ...item }));
  }

  async enroll(input: Omit<PairedBrowserDevice, "deviceId" | "refreshSecretHash" | "createdAt" | "lastSeenAt">): Promise<{ device: PairedBrowserDevice; refreshSecret: string }> {
    const state = await this.#read();
    const now = new Date().toISOString();
    const refreshSecret = randomBytes(32).toString("base64url");
    const device: PairedBrowserDevice = {
      ...input,
      deviceId: `browser_${randomBytes(16).toString("hex")}`,
      refreshSecretHash: hash(refreshSecret),
      createdAt: now,
      lastSeenAt: now
    };
    state.devices = [...state.devices, device].slice(-MAX_DEVICES);
    await this.#write(state);
    return { device, refreshSecret };
  }

  async authenticate(input: {
    deviceId: string;
    refreshSecret: string;
    browserFamily: "firefox" | "chromium";
    extensionId: string;
    exactOrigin: string;
    extensionVersion: string;
    protocolVersion: number;
  }): Promise<PairedBrowserDevice | undefined> {
    const state = await this.#read();
    const device = state.devices.find((item) => item.deviceId === input.deviceId);
    if (device === undefined || device.revokedAt !== undefined) return undefined;
    if (device.browserFamily !== input.browserFamily
      || device.extensionId !== input.extensionId
      || device.exactOrigin !== input.exactOrigin
      || device.protocolVersion !== input.protocolVersion
      || !equalHash(device.refreshSecretHash, hash(input.refreshSecret))) return undefined;
    device.lastSeenAt = new Date().toISOString();
    device.extensionVersion = input.extensionVersion;
    await this.#write(state);
    return { ...device };
  }

  async revokeAll(): Promise<number> {
    let state: PairingState;
    try {
      state = await this.#read();
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "browser_pairing_state_corrupt") throw error;
      await this.#write({ ...EMPTY, devices: [] });
      return 0;
    }
    const now = new Date().toISOString();
    let count = 0;
    for (const device of state.devices) {
      if (device.revokedAt === undefined) {
        device.revokedAt = now;
        count += 1;
      }
    }
    await this.#write(state);
    return count;
  }

  async #read(): Promise<PairingState> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as Record<string, unknown>;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.devices) || !parsed.devices.every(validDevice) || parsed.devices.length > MAX_DEVICES) {
        throw new Error("browser_pairing_state_corrupt");
      }
      return { schemaVersion: 1, devices: parsed.devices.map((item) => ({ ...item })) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY, devices: [] };
      if (error instanceof SyntaxError || (error instanceof Error && error.message === "browser_pairing_state_corrupt")) throw new Error("browser_pairing_state_corrupt");
      throw error;
    }
  }

  async #write(state: PairingState): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, this.file);
  }
}
