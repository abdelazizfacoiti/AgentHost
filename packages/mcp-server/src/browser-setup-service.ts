import { access, readFile } from "node:fs/promises";
import path from "node:path";
import {
  BrowserSetupStore,
  browserSetupRecovery,
  CHROMIUM_EXTENSION_PUBLIC_KEY,
  expectedExtensionId,
  selectBrowserFromInventory,
  type BrowserInventory,
  type BrowserInventoryEntry,
  type BrowserSetupFailureCode,
  type BrowserSetupRecord,
  type BrowserBridgeServer,
  type SupportedBrowserFamily
} from "@agenthost/app-browser";
import type { LinuxBrowserProbe } from "@agenthost/os-linux";
import type { VisualSurfaceCoordinator } from "@agenthost/app-overlay";
import type { OverlayWidgetComponent, VisualSurfaceProtocolEnvelope } from "@agenthost/core";

export interface BrowserSetupServiceOptions {
  ownerSessionId: string;
  agentHostDir: string;
  extensionRoot: string;
  releaseRoot: string;
  detectBrowsers(): Promise<LinuxBrowserProbe[]>;
  visual?: Pick<VisualSurfaceCoordinator, "showSurface" | "updateSurface" | "dismissSurface" | "surfaceSnapshot">;
}

type ManifestStatus = {
  valid: boolean;
  version?: string;
  reason: "valid" | "manifest_missing" | "background_missing" | "identity_mismatch" | "manifest_invalid";
};

const REQUIRED_PERMISSIONS = ["tabs", "storage", "scripting", "alarms"] as const;
const FORBIDDEN_PERMISSIONS = new Set(["cookies", "debugger", "webRequest", "webRequestBlocking", "nativeMessaging", "history"]);

function safeAssetPath(root: string, family: SupportedBrowserFamily, asset: string): string | undefined {
  if (asset.length === 0 || asset.length > 200 || path.isAbsolute(asset)) return undefined;
  const normalized = path.posix.normalize(asset.replaceAll("\\", "/"));
  if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../") || normalized.includes("\0")) return undefined;
  const familyRoot = path.resolve(root, family);
  const candidate = path.resolve(familyRoot, normalized);
  return candidate === familyRoot || candidate.startsWith(`${familyRoot}${path.sep}`) ? candidate : undefined;
}

async function manifestStatus(
  root: string,
  family: SupportedBrowserFamily
): Promise<ManifestStatus> {
  try {
    const manifest = JSON.parse(
      await readFile(path.join(root, family, "manifest.json"), "utf8")
    ) as Record<string, unknown>;
    const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : undefined;
    if (manifest.manifest_version !== 3
      || permissions === undefined
      || !REQUIRED_PERMISSIONS.every((permission) => permissions.includes(permission))
      || permissions.some((permission) => typeof permission !== "string" || FORBIDDEN_PERMISSIONS.has(permission))
      || JSON.stringify(manifest.host_permissions) !== JSON.stringify(["http://127.0.0.1/*"])) {
      return { valid: false, reason: "manifest_invalid" };
    }
    if (JSON.stringify(manifest.optional_host_permissions) !== JSON.stringify(["https://*/*", "http://*/*"])) {
      return { valid: false, reason: "manifest_invalid" };
    }
    if (family === "chromium" && manifest.key !== CHROMIUM_EXTENSION_PUBLIC_KEY) {
      return { valid: false, reason: "identity_mismatch" };
    }
    const background = manifest.background as Record<string, unknown> | undefined;
    const backgroundFile = typeof background?.service_worker === "string"
      ? background.service_worker
      : Array.isArray(background?.scripts) && typeof background.scripts[0] === "string"
        ? background.scripts[0]
        : undefined;
    if (backgroundFile === undefined) return { valid: false, reason: "background_missing" };
    const backgroundPath = safeAssetPath(root, family, backgroundFile);
    if (backgroundPath === undefined) return { valid: false, reason: "manifest_invalid" };
    await access(backgroundPath);
    const popup = (manifest.action as Record<string, unknown> | undefined)?.default_popup;
    if (typeof popup !== "string") return { valid: false, reason: "manifest_invalid" };
    const popupPath = safeAssetPath(root, family, popup);
    if (popupPath === undefined) return { valid: false, reason: "manifest_invalid" };
    await access(popupPath);
    if (family === "firefox") {
      const gecko = (
        manifest.browser_specific_settings as Record<string, unknown> | undefined
      )?.gecko as Record<string, unknown> | undefined;
      if (gecko?.id !== expectedExtensionId(family)) {
        return { valid: false, reason: "identity_mismatch" };
      }
    }
    return {
      valid: true,
      ...(typeof manifest.version === "string" ? { version: manifest.version } : {}),
      reason: "valid"
    };
  } catch {
    return { valid: false, reason: "manifest_missing" };
  }
}

function bridgeFailureCode(state: Record<string, unknown>): BrowserSetupFailureCode | undefined {
  const value = String(state.state ?? state.lastError ?? "");
  const map: Record<string, BrowserSetupFailureCode> = {
    bridge_disabled: "bridge_unavailable",
    bridge_unavailable: "bridge_unavailable",
    extension_not_seen: "extension_not_installed",
    unpaired: "extension_disconnected",
    token_expired: "enrollment_expired",
    token_invalid: "extension_pairing_state_missing",
    pairing_revoked: "device_revoked",
    protocol_mismatch: "protocol_mismatch",
    version_mismatch: "extension_version_mismatch",
    extension_identity_mismatch: "extension_identity_mismatch",
    origin_rejected: "origin_rejected",
    device_state_corrupt: "pairing_ledger_corrupted",
    browser_busy: "pairing_state_mismatch",
    port_mismatch: "bridge_port_conflict",
    manifest_missing: "extension_artifact_missing"
  };
  return map[value];
}

export class BrowserSetupService {
  readonly #bridge: BrowserBridgeServer;
  readonly #store: BrowserSetupStore;
  readonly #options: BrowserSetupServiceOptions;

  constructor(bridge: BrowserBridgeServer, options: BrowserSetupServiceOptions) {
    this.#bridge = bridge;
    this.#options = options;
    this.#store = new BrowserSetupStore(options.agentHostDir, options.ownerSessionId);
  }

  async ensureStructure(): Promise<void> {
    await this.#store.ensureStructure();
  }

  store(): BrowserSetupStore {
    return this.#store;
  }

  async inventory(requested?: SupportedBrowserFamily): Promise<BrowserInventory> {
    const [probes, firefoxManifest, chromiumManifest] = await Promise.all([
      this.#options.detectBrowsers(),
      manifestStatus(this.#options.extensionRoot, "firefox"),
      manifestStatus(this.#options.extensionRoot, "chromium")
    ]);
    const bridge = this.#bridge.status() as Record<string, unknown>;
    const connectedBrowser = (bridge.browser as { family?: unknown } | undefined)?.family;
    const entries: BrowserInventoryEntry[] = probes.map((probe) => {
      const artifact = probe.family === "firefox" ? firefoxManifest : chromiumManifest;
      const connected = bridge.connected === true && connectedBrowser === probe.family;
      const incompatible = (bridge.state === "version_mismatch" || bridge.state === "protocol_mismatch")
        && (connectedBrowser === undefined || connectedBrowser === probe.family);
      const protocolCompatible = bridge.state !== "protocol_mismatch" && bridge.state !== "version_mismatch";
      const runtimeCompatible = bridge.state !== "version_mismatch" && bridge.state !== "protocol_mismatch";
      const extensionConnectionState = connected
        ? "connected" as const
        : incompatible
          ? "incompatible" as const
          : bridge.extensionSeen === true
            ? "disconnected" as const
            : "missing" as const;
    const enrolledCounts = bridge.enrolledDeviceCounts as Record<string, unknown> | undefined;
    const paired = Number(enrolledCounts?.[probe.family] ?? 0) > 0;
      const artifactFailure = artifact.reason === "identity_mismatch"
        ? "extension_identity_mismatch" as const
        : "extension_artifact_missing" as const;
      const safeFailureCode = !probe.installed
        ? "browser_not_detected" as const
        : !artifact.valid
          ? artifactFailure
          : connected
            ? undefined
            : bridgeFailureCode(bridge) ?? "extension_disconnected";
      return {
        family: probe.family,
        supported: true,
        installed: probe.installed,
        executableAvailable: probe.executableAvailable,
        ...(probe.executableName === undefined ? {} : { executableName: probe.executableName }),
        running: probe.running,
        expectedExtensionId: expectedExtensionId(probe.family),
        extensionArtifactAvailable: artifact.valid,
        extensionConnectionState,
        pairedDeviceState: bridge.state === "pairing_revoked"
          ? "revoked"
          : paired
            ? "paired"
            : "none",
        protocolCompatible,
        runtimeCompatible,
        reconnectReady: paired && artifact.valid && protocolCompatible && runtimeCompatible,
        lastHealthStatus: connected
          ? "healthy"
          : probe.installed && artifact.valid
            ? "degraded"
            : "unavailable",
        ...(safeFailureCode === undefined ? {} : { safeFailureCode }),
        recommendedNextAction: safeFailureCode === undefined
          ? "Browser Bridge is ready."
          : browserSetupRecovery(safeFailureCode).action
      };
    });
    const selection = selectBrowserFromInventory(entries, requested);
    return {
      schemaVersion: 1,
      browsers: entries,
      ...(selection.selected === undefined ? {} : { selectedBrowser: selection.selected }),
      selectionRequired: selection.failureCode === "browser_selection_required",
      evaluatedAt: new Date().toISOString(),
      redacted: true
    };
  }

  async start(browser?: SupportedBrowserFamily): Promise<{
    setup: BrowserSetupRecord;
    inventory: BrowserInventory;
  }> {
    if (!this.#bridge.status().listening) {
      throw new Error("bridge_unavailable");
    }
    const inventory = await this.inventory(browser);
    const selection = selectBrowserFromInventory(inventory.browsers, browser);
    if (selection.selected === undefined) {
      throw new Error(selection.failureCode ?? "browser_not_detected");
    }
    let setup = await this.#store.create(selection.selected);
    setup = await this.#store.transition(setup.setupId, "browser_selected", {
      recommendedNextAction: "Validate selected browser extension artifact."
    });
    setup = await this.#store.transition(setup.setupId, "checking_extension");
    const entry = inventory.browsers.find((item) => item.family === selection.selected)!;
    if (!entry.extensionArtifactAvailable) {
      setup = await this.#store.transition(setup.setupId, "extension_missing", {
        failureCode: "extension_artifact_missing"
      });
      await this.#project(setup);
      return { setup, inventory };
    }
    const enrollment = this.#bridge.beginEnrollment(selection.selected);
    setup = await this.#store.transition(setup.setupId, "enrollment_created", {
      enrollmentId: enrollment.enrollmentId,
      recommendedNextAction: "Open approved extension popup and request local enrollment."
    });
    setup = await this.#store.transition(setup.setupId, "waiting_for_extension", {
      recommendedNextAction: `Waiting for ${enrollment.browserFamily} extension request.`
    });
    await this.#project(setup);
    return { setup, inventory };
  }

  async refresh(setupId: string): Promise<BrowserSetupRecord> {
    let setup = await this.#store.get(setupId);
    if (Date.parse(setup.expiresAt) <= Date.now()) {
      if (!["ready", "failed", "cancelled", "blocked"].includes(setup.state)) {
        setup = await this.#store.transition(setupId, "failed", {
          failureCode: "enrollment_expired"
        });
      }
      await this.#project(setup);
      return setup;
    }
    const bridge = this.#bridge.status() as Record<string, unknown>;
    const globalEnrollment = bridge.enrollment as Record<string, unknown> | undefined;
    const enrollment = setup.enrollmentId === undefined
      ? globalEnrollment
      : (() => { try { return this.#bridge.enrollmentStatus(setup.enrollmentId) as Record<string, unknown>; } catch { return undefined; } })();
    if (enrollment?.state === "waiting_for_approval"
      && setup.state === "waiting_for_extension") {
      setup = await this.#store.transition(setupId, "waiting_for_approval", {
        ...(typeof enrollment.enrollmentId === "string" ? { enrollmentId: enrollment.enrollmentId } : {}),
        ...(typeof enrollment.approvalFingerprint === "string" ? { approvalFingerprint: enrollment.approvalFingerprint } : {}),
        extensionIdentitySuffix: String(
          this.#bridge.enrollmentStatus(String(enrollment.enrollmentId)).extensionIdentitySuffix ?? ""
        ),
        recommendedNextAction: "Review extension identity, then explicitly approve enrollment."
      });
    }
    if (enrollment?.state === "approved" && setup.state === "waiting_for_approval") {
      setup = await this.#store.transition(setupId, "pairing", {
        recommendedNextAction: "Waiting for extension to receive approved pairing."
      });
    }
    if (bridge.connected === true && ["pairing", "waiting_for_approval", "waiting_for_extension"].includes(setup.state)) {
      if (setup.state === "waiting_for_approval") {
        setup = await this.#store.transition(setupId, "pairing");
      }
      if (setup.state === "waiting_for_extension") {
        setup = await this.#store.transition(setupId, "extension_connected");
        setup = await this.#store.transition(setupId, "pairing");
      }
      setup = await this.#store.transition(setupId, "paired", {
        recommendedNextAction: "Restart or reconnect once, then verify readiness."
      });
    }
    await this.#project(setup);
    return setup;
  }

  async approve(setupId: string): Promise<BrowserSetupRecord> {
    const setup = await this.refresh(setupId);
    if (setup.state !== "waiting_for_approval") {
      throw new Error("browser_setup_not_waiting_for_approval");
    }
    if (typeof setup.enrollmentId !== "string" || typeof setup.approvalFingerprint !== "string") {
      throw new Error("enrollment_expired");
    }
    await this.#bridge.approveEnrollment(setup.enrollmentId, setup.approvalFingerprint);
    const result = await this.#store.transition(setupId, "pairing", {
      recommendedNextAction: "Waiting for extension to receive approved pairing."
    });
    await this.#project(result);
    return result;
  }

  async verify(setupId: string): Promise<BrowserSetupRecord> {
    let setup = await this.refresh(setupId);
    if (setup.state !== "paired" && setup.state !== "verifying_reconnect") {
      throw new Error("browser_setup_not_paired");
    }
    if (setup.state === "paired") {
      setup = await this.#store.transition(setupId, "verifying_reconnect");
    }
    const bridge = this.#bridge.status();
    if (!bridge.connected) {
      const result = await this.#store.transition(setupId, "needs_repair", {
        failureCode: "reconnect_timeout"
      });
      await this.#project(result);
      return result;
    }
    const result = await this.#store.transition(setupId, "ready", {
      reconnectVerified: true,
      recommendedNextAction: "Browser Bridge is ready."
    });
    await this.#project(result);
    return result;
  }

  async cancel(setupId: string): Promise<BrowserSetupRecord> {
    const bridge = this.#bridge.status() as Record<string, unknown>;
    const enrollmentId = (await this.#store.get(setupId).catch(() => undefined))?.enrollmentId;
    if (typeof enrollmentId === "string") {
      try {
        this.#bridge.cancelEnrollment(enrollmentId);
      } catch {
        // Expired enrollment is already inert.
      }
    }
    const result = await this.#store.cancel(setupId);
    await this.#options.visual?.dismissSurface(this.#surfaceId(setupId)).catch(() => undefined);
    return result;
  }

  async summary(): Promise<Record<string, unknown>> {
    const records = await this.#store.list();
    const latest = records[0];
    return {
      status: latest?.state ?? "not_started",
      activeSetupCount: records.filter((item) => !["ready", "failed", "blocked", "cancelled"].includes(item.state)).length,
      ...(latest === undefined ? {} : {
        latest: {
          setupId: latest.setupId,
          browserFamily: latest.browserFamily,
          state: latest.state,
          reconnectVerified: latest.reconnectVerified,
          ...(latest.safeFailureCode === undefined ? {} : { safeFailureCode: latest.safeFailureCode }),
          recommendedNextAction: latest.recommendedNextAction,
          updatedAt: latest.updatedAt,
          redacted: true
        }
      }),
      redacted: true
    };
  }

  #surfaceId(setupId: string): string {
    return `browser_setup:${setupId}`;
  }

  async #project(record: BrowserSetupRecord): Promise<void> {
    const visual = this.#options.visual;
    if (visual === undefined) return;
    const order = [
      "detecting_browser", "browser_selected", "checking_extension", "enrollment_created",
      "waiting_for_extension", "waiting_for_approval", "pairing", "paired", "verifying_reconnect", "ready"
    ];
    const completed = Math.max(0, order.indexOf(record.state));
    const total = order.length - 1;
    const terminalFailure = ["extension_missing", "needs_repair", "blocked", "failed"].includes(record.state);
    const components: OverlayWidgetComponent[] = [
      {
        type: "status_badge",
        status: record.state === "ready" ? "success" : terminalFailure ? "warning" : "info",
        text: record.state.replaceAll("_", " ")
      },
      {
        type: "checklist",
        items: [
          { label: "Supported browser selected", checked: completed >= 1 },
          { label: "Approved extension artifact found", checked: completed >= 3 },
          { label: "Extension request received", checked: completed >= 5 },
          { label: "Local pairing complete", checked: completed >= 7 },
          { label: "Reconnect verified", checked: record.reconnectVerified }
        ]
      },
      ...(terminalFailure ? [{ type: "warning" as const, text: record.recommendedNextAction }] : [
        { type: "text" as const, text: record.recommendedNextAction }
      ])
    ];
    const now = new Date().toISOString();
    const expiry = Math.max(Date.now() + 1_000, Math.min(Date.parse(record.expiresAt), Date.now() + 300_000));
    const surface: VisualSurfaceProtocolEnvelope = {
      schemaVersion: 1,
      surfaceId: this.#surfaceId(record.setupId),
      ownerSessionId: this.#options.ownerSessionId,
      source: "browser_setup",
      taskId: record.setupId,
      type: record.state === "ready" ? "result_summary" : terminalFailure ? "recovery_card" : "browser_connection",
      content: {
        title: `${record.browserFamily === "firefox" ? "Firefox" : "Chromium"} Browser Bridge`,
        components,
        progress: { completed: Math.min(total, completed), total, percent: Math.round(Math.min(total, completed) / total * 100) }
      },
      state: record.state === "ready" ? "completed" : terminalFailure ? "blocked" : "waiting",
      placement: "top_right",
      priority: terminalFailure ? "high" : "normal",
      interactionMode: "click_through",
      approvedIntents: [],
      ttlMs: Math.max(1_000, expiry - Date.now()),
      sensitivity: "public",
      screenshotBehavior: "hide",
      createdAt: record.createdAt,
      updatedAt: now,
      expiresAt: new Date(expiry).toISOString()
    };
    const exists = visual.surfaceSnapshot().some((item) => item.surfaceId === surface.surfaceId);
    if (exists) await visual.updateSurface(surface.surfaceId, surface).catch(() => undefined);
    else await visual.showSurface(surface).catch(() => undefined);
  }
}
