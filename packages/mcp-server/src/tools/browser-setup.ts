import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { toolFailure, toolSuccess } from "@agenthost/core";
import { browserSetupRecovery, CHROMIUM_EXTENSION_PUBLIC_KEY, expectedExtensionId } from "@agenthost/app-browser";
import { z } from "zod";
import type { AgentHostMcpContext } from "../context.js";
import type { AgentHostToolDefinition, AnyAgentHostToolDefinition } from "../tool-runner.js";
import { buildPreviewResult, rejectedConfirmation } from "./preview.js";

const empty = z.object({}).strict();
const action = z.object({ dryRun: z.boolean().optional(), confirmationToken: z.string().trim().min(1).max(500).optional() }).strict();
const browser = z.object({
  browser: z.enum(["firefox", "chromium"]).optional(),
  channel: z.enum(["public", "development"]).optional(),
  setupId: z.string().trim().min(1).max(200).optional()
}).strict();
const setupBegin = z.object({
  browser: z.enum(["firefox", "chromium"]).optional(),
  dryRun: z.boolean().optional(),
  confirmationToken: z.string().trim().min(1).max(500).optional()
}).strict();
const setupAction = z.object({
  setupId: z.string().trim().min(1).max(200),
  dryRun: z.boolean().optional(),
  confirmationToken: z.string().trim().min(1).max(500).optional()
}).strict();
function bridge(context: AgentHostMcpContext) { if (context.browserBridge === undefined) throw new Error("browser_bridge_unavailable"); return context.browserBridge; }
function setup(context: AgentHostMcpContext) { if (context.browserSetup === undefined) throw new Error("browser_setup_unavailable"); return context.browserSetup; }
function failure(name: string, error: unknown) { const code = error instanceof Error ? error.message : "browser_setup_failed"; return toolFailure({ tool: name, riskLevel: "low", error: { code, message: code.replaceAll("_", " ") }, observations: ["No token or browser content was logged."] }); }
function root(family: "firefox" | "chromium") {
  const base = process.env.AGENTHOST_BROWSER_EXTENSION_DIR ?? path.join(os.homedir(), "AgentHost", "browser-extension");
  return path.join(base, family);
}
function releaseRoot() {
  return process.env.AGENTHOST_BROWSER_RELEASE_ROOT ?? path.resolve("release", "browser");
}
async function manifest(family: "firefox" | "chromium") {
  const folder = root(family), manifestPath = path.join(folder, "manifest.json");
  try {
    const data = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    const permissions = Array.isArray(data.permissions) ? data.permissions : [];
    const forbidden = new Set(["cookies", "debugger", "webRequest", "webRequestBlocking", "nativeMessaging", "history"]);
    if (data.manifest_version !== 3
      || !["tabs", "storage", "scripting", "alarms"].every((permission) => permissions.includes(permission))
      || permissions.some((permission) => typeof permission !== "string" || forbidden.has(permission))
      || JSON.stringify(data.host_permissions) !== JSON.stringify(["http://127.0.0.1/*"])
      || JSON.stringify(data.optional_host_permissions) !== JSON.stringify(["https://*/*", "http://*/*"])
      || (family === "chromium" && data.key !== CHROMIUM_EXTENSION_PUBLIC_KEY)) {
      return { folder, manifestPath, valid: false, reason: "manifest_invalid" };
    }
    if (family === "firefox" && (data.browser_specific_settings as Record<string, unknown> | undefined)?.gecko === undefined) {
      return { folder, manifestPath, valid: false, reason: "identity_mismatch" };
    }
    const gecko = (data.browser_specific_settings as Record<string, unknown> | undefined)?.gecko as Record<string, unknown> | undefined;
    if (family === "firefox" && gecko?.id !== expectedExtensionId(family)) return { folder, manifestPath, valid: false, reason: "identity_mismatch" };
    const background = data.background as Record<string, unknown> | undefined;
    const backgroundPath = typeof background?.service_worker === "string" ? background.service_worker : Array.isArray(background?.scripts) && typeof background.scripts[0] === "string" ? background.scripts[0] : undefined;
    const popup = (data.action as Record<string, unknown> | undefined)?.default_popup;
    if (backgroundPath !== "background.js" || popup !== "popup.html") return { folder, manifestPath, valid: false, reason: "manifest_invalid" };
    await access(path.join(folder, backgroundPath));
    await access(path.join(folder, popup));
    return { folder, manifestPath, valid: true, reason: "valid" };
  } catch {
    return { folder, manifestPath, valid: false, reason: "manifest_missing" };
  }
}
async function releaseArtifact(family: "firefox" | "chromium") {
  try {
    const metadata = JSON.parse(await readFile(path.join(releaseRoot(), "artifacts.json"), "utf8")) as { artifacts?: Array<Record<string, unknown>> };
    return metadata.artifacts?.find((item) => item.family === family);
  } catch {
    return undefined;
  }
}
function developmentInstructions(family: "firefox" | "chromium", folder: string) { return family === "firefox" ? [`Open about:debugging#/runtime/this-firefox.`, "Select Load Temporary Add-on…", `Select ${path.join(folder, "manifest.json")}.`, "Development-only temporary extension disappears after browser restart."] : ["Open chrome://extensions or chromium://extensions.", "Enable Developer mode.", "Choose Load unpacked.", `Select ${folder}.`, "Development-only unpacked extension is not the public install path."]; }
function publicInstructions(family: "firefox" | "chromium", artifact?: Record<string, unknown>) {
  if (artifact?.signed === true && artifact.publicInstallable === true) return family === "firefox"
    ? ["Open the signed AgentHost XPI release artifact.", "Approve Firefox installation once.", "Pair through the extension popup."]
    : ["Install AgentHost Browser Bridge from its verified Chrome Web Store listing.", "Pair through the extension popup."];
  return [
    family === "firefox" ? "Public Firefox artifact requires Mozilla signing." : "Public Chromium artifact requires Chrome Web Store publishing.",
    "Current deterministic artifact is unsigned and must not be presented as public-installable.",
    "Use development channel only for local testing."
  ];
}
function pairingSafety() {
  return {
    allowed: true,
    blocked: false,
    riskLevel: "medium" as const,
    appSensitivity: "normal" as const,
    approval: { required: false, status: "not_required" as const },
    reasons: [],
    matchedRules: [],
    grantDecision: {
      matchedGrantIds: [],
      allowedByGrantIds: [],
      deniedByGrantIds: [],
      guideOnlyByGrantIds: [],
      requiresDryRun: true,
      requiresConfirmationToken: true,
      requiresApproval: false,
      requiresExactTarget: true
    },
    guideOnly: false
  };
}

export function createBrowserSetupTools(): AnyAgentHostToolDefinition<AgentHostMcpContext>[] {
  const status: AgentHostToolDefinition<z.infer<typeof browser>, unknown, AgentHostMcpContext> = {
    name: "browser.setup_status",
    description: "Reports normalized browser inventory, bridge health, and resumable setup state without secrets.",
    riskLevel: "observe",
    inputSchema: browser,
    mcpInputSchema: {
      type: "object",
      properties: {
        browser: { type: "string", enum: ["firefox", "chromium"] },
        channel: { type: "string", enum: ["public", "development"] },
        setupId: { type: "string" }
      },
      additionalProperties: false
    },
    inputSummary: "Get browser setup status",
    auditOutputSummary: () => "Reported normalized browser setup status without credentials.",
    safety: { actionType: "observe" },
    async handler(input, context) {
      try {
        const family = input.browser ?? "firefox";
        const channel = input.channel ?? "public";
        const state = bridge(context).status();
        const packageStatus = await manifest(family);
        const artifact = await releaseArtifact(family);
        const inventory = context.browserSetup === undefined
          ? undefined
          : await context.browserSetup.inventory(input.browser);
        const setupRecord = input.setupId === undefined || context.browserSetup === undefined
          ? undefined
          : await context.browserSetup.refresh(input.setupId);
        return toolSuccess({
          tool: "browser.setup_status",
          riskLevel: "observe",
          data: {
            ...state,
            ...(inventory === undefined ? {} : { inventory }),
            ...(setupRecord === undefined ? {} : { setup: setupRecord }),
            channel,
            developmentManifest: {
              exists: packageStatus.valid,
              reason: packageStatus.reason
            },
            releaseArtifact: artifact === undefined
              ? { exists: false, publicInstallable: false }
              : {
                  exists: true,
                  version: artifact.version,
                  signed: artifact.signed === true,
                  publicInstallable: artifact.publicInstallable === true,
                  externalAction: artifact.externalAction
                },
            tokenExists: state.tokenExists,
            instructions: channel === "public"
              ? publicInstructions(family, artifact)
              : packageStatus.valid
                ? developmentInstructions(family, packageStatus.folder)
                : [`Run npm run browser:extension:${family}.`]
          },
          observations: [state.reason]
        });
      } catch (error) {
        return failure("browser.setup_status", error);
      }
    }
  };
  const diagnose: AgentHostToolDefinition<z.infer<typeof empty>, unknown, AgentHostMcpContext> = { name: "browser.diagnose_bridge", description: "Returns actionable local browser bridge diagnostics without tokens or page data.", riskLevel: "observe", inputSchema: empty, mcpInputSchema: { type: "object", properties: {}, additionalProperties: false }, inputSummary: "Diagnose browser bridge", auditOutputSummary: () => "Returned browser bridge diagnostic codes only.", safety: { actionType: "observe" }, async handler(_input, context) { try { const state = bridge(context).status(); const fixes: Record<string, string[]> = { bridge_disabled: ["Enable browserBridge.enabled in ~/.agenthost/config.json.", "Restart AgentHost MCP server."], bridge_unavailable: ["Restart AgentHost MCP server and confirm port is free."], extension_not_seen: ["Install signed public extension, or prepare explicit development extension.", "Check popup port matches AgentHost port."], unpaired: state.enrolledDeviceCount > 0 ? ["Open extension popup and choose Retry.", "If pairing was revoked, generate a new one-time pairing token."] : ["Use browser.generate_pairing_token, paste token in popup, and pair once."], token_invalid: ["Generate a new one-time pairing token; old token is invalid."], token_expired: ["Generate a fresh one-time pairing token."], pairing_revoked: ["Generate and explicitly enroll a new browser device."], version_mismatch: ["Update AgentHost or browser extension to a compatible version."], device_state_corrupt: ["Use browser.reset_pairing, then create a fresh pairing."], browser_busy: ["Close or disconnect the other paired browser session, then retry."], paired: ["Bridge is connected and ready."], unknown_error: ["Use browser.setup_status and retry extension connection."] }; return toolSuccess({ tool: "browser.diagnose_bridge", riskLevel: "observe", data: { state: state.state, likelyCause: state.reason, nextSteps: fixes[state.state] ?? fixes.unknown_error, extensionSeen: state.extensionSeen, tokenExists: state.tokenExists, enrolledDeviceCount: state.enrolledDeviceCount, compatibility: state.compatibility }, observations: ["Diagnostics omit credentials, URLs, and page content."] }); } catch (error) { return failure("browser.diagnose_bridge", error); } } };
  const generate: AgentHostToolDefinition<z.infer<typeof action>, unknown, AgentHostMcpContext> = { name: "browser.generate_pairing_token", description: "Revokes prior browser devices and creates one short-lived enrollment token after exact confirmation.", riskLevel: "medium", inputSchema: action, mcpInputSchema: { type: "object", properties: { dryRun: { type: "boolean" }, confirmationToken: { type: "string" } }, additionalProperties: false }, inputSummary: "Generate browser pairing token", auditInputSummary: () => "Generate browser pairing token; token omitted.", auditOutputSummary: () => "Browser pairing rotated; token omitted.", preview: { isDryRun: (input) => input.dryRun === true }, async handler(input, context, runtime) { try { const target = { operation: "generate_pairing_token", port: bridge(context).config.port }; if (runtime?.isDryRun) return buildPreviewResult({ tool: "browser.generate_pairing_token", riskLevel: "medium", safety: pairingSafety(), targetSummary: "Rotate browser pairing", target: { kind: "browser", summary: "Rotate browser pairing" }, wouldExecute: true, confirmation: { manager: context.confirmations, sessionId: context.sessionId, input, target, explanation: "Revoke prior browser devices and create one short-lived enrollment token.", riskLevel: "medium" } }); const verified = context.confirmations.verifyAndConsume(input.confirmationToken ?? "", { sessionId: context.sessionId, tool: "browser.generate_pairing_token", input, target, riskLevel: "medium" }); if (!verified.ok) return toolFailure({ tool: "browser.generate_pairing_token", riskLevel: "medium", confirmation: rejectedConfirmation(verified.tokenId, verified.reason), error: { code: "confirmation_rejected", message: verified.reason } }); const generated = await bridge(context).generatePairingToken(); return toolSuccess({ tool: "browser.generate_pairing_token", riskLevel: "medium", data: { pairingToken: generated.token, tokenReturnedOnce: true, expiresInMs: 600_000, priorDevicesRevoked: true, port: bridge(context).config.port }, observations: ["Paste token into extension popup. It is consumed after enrollment and excluded from audit logs."] }); } catch (error) { return failure("browser.generate_pairing_token", error); } } };
  const reset: AgentHostToolDefinition<z.infer<typeof action>, unknown, AgentHostMcpContext> = { name: "browser.reset_pairing", description: "Revokes all browser devices and removes pending enrollment after exact confirmation.", riskLevel: "medium", inputSchema: action, mcpInputSchema: generate.mcpInputSchema, inputSummary: "Reset browser pairing", auditInputSummary: () => "Reset browser pairing; credentials omitted.", auditOutputSummary: () => "Browser pairing reset; credentials omitted.", preview: { isDryRun: (input) => input.dryRun === true }, async handler(input, context, runtime) { try { const target = { operation: "reset_pairing", port: bridge(context).config.port }; if (runtime?.isDryRun) return buildPreviewResult({ tool: "browser.reset_pairing", riskLevel: "medium", safety: pairingSafety(), targetSummary: "Reset browser pairing", target: { kind: "browser", summary: "Reset browser pairing" }, wouldExecute: true, confirmation: { manager: context.confirmations, sessionId: context.sessionId, input, target, explanation: "Revoke all enrolled browser devices and pending enrollment token.", riskLevel: "medium" } }); const verified = context.confirmations.verifyAndConsume(input.confirmationToken ?? "", { sessionId: context.sessionId, tool: "browser.reset_pairing", input, target, riskLevel: "medium" }); if (!verified.ok) return toolFailure({ tool: "browser.reset_pairing", riskLevel: "medium", confirmation: rejectedConfirmation(verified.tokenId, verified.reason), error: { code: "confirmation_rejected", message: verified.reason } }); await bridge(context).resetPairing(); return toolSuccess({ tool: "browser.reset_pairing", riskLevel: "medium", data: { reset: true, devicesRevoked: true, tokenReturned: false }, observations: ["Pairing reset. Generate a fresh one-time token to enroll again."] }); } catch (error) { return failure("browser.reset_pairing", error); } } };
  const install: AgentHostToolDefinition<z.infer<typeof browser>, unknown, AgentHostMcpContext> = { name: "browser.get_extension_install_instructions", description: "Returns explicit public or development browser-extension installation instructions.", riskLevel: "observe", inputSchema: browser, mcpInputSchema: status.mcpInputSchema, inputSummary: "Get browser extension install instructions", safety: { actionType: "observe" }, async handler(input) { const family = input.browser ?? "firefox", channel = input.channel ?? "public"; const packageStatus = await manifest(family), artifact = await releaseArtifact(family); return toolSuccess({ tool: "browser.get_extension_install_instructions", riskLevel: "observe", data: { browser: family, channel, ...(channel === "development" ? { extensionPath: packageStatus.folder, manifestPath: packageStatus.manifestPath, manifestValid: packageStatus.valid } : {}), artifact: artifact === undefined ? { exists: false, publicInstallable: false } : { exists: true, version: artifact.version, signed: artifact.signed === true, publicInstallable: artifact.publicInstallable === true, externalAction: artifact.externalAction }, instructions: channel === "public" ? publicInstructions(family, artifact) : packageStatus.valid ? developmentInstructions(family, packageStatus.folder) : [`Run npm run browser:extension:${family}.`], neverAutoInstalled: true }, observations: ["Public and development installation paths are separate. Browser security prompts remain manual."] }); } };
  const verify: AgentHostToolDefinition<z.infer<typeof empty>, unknown, AgentHostMcpContext> = { name: "browser.verify_pairing", description: "Verifies fresh authenticated extension connection without page access.", riskLevel: "observe", inputSchema: empty, mcpInputSchema: { type: "object", properties: {}, additionalProperties: false }, inputSummary: "Verify browser pairing", safety: { actionType: "observe" }, async handler(_input, context) { try { const state = bridge(context).status(); return state.connected ? toolSuccess({ tool: "browser.verify_pairing", riskLevel: "observe", data: { verified: true, browser: state.browser, lastSeenAt: state.lastSeenAt }, observations: ["Paired extension connection is active."] }) : toolFailure({ tool: "browser.verify_pairing", riskLevel: "low", error: { code: state.state, message: state.reason }, observations: ["No browser page was accessed."] }); } catch (error) { return failure("browser.verify_pairing", error); } } };
  const inventory: AgentHostToolDefinition<z.infer<typeof browser>, unknown, AgentHostMcpContext> = {
    name: "browser.inventory",
    description: "Returns normalized supported-browser installation, artifact, connection, and compatibility status.",
    riskLevel: "observe",
    inputSchema: browser,
    mcpInputSchema: status.mcpInputSchema,
    inputSummary: "Inspect supported browser inventory",
    auditOutputSummary: () => "Reported browser family health without profiles, paths, or credentials.",
    safety: { actionType: "observe" },
    async handler(input, context) {
      try {
        return toolSuccess({
          tool: "browser.inventory",
          riskLevel: "observe",
          data: await setup(context).inventory(input.browser),
          observations: ["Executable names and safe structural health only."]
        });
      } catch (error) {
        return failure("browser.inventory", error);
      }
    }
  };
  const stateChangingExecution = {
    executionClass: "state_changing",
    externalEffect: true,
    requiresDryRun: true,
    requiresConfirmationToken: true,
    requiresExactTarget: true,
    source: "base",
    availability: "available"
  } as const;
  const begin: AgentHostToolDefinition<z.infer<typeof setupBegin>, unknown, AgentHostMcpContext> = {
    name: "browser.setup_begin",
    description: "Starts one bounded browser-side enrollment session without returning enrollment credentials.",
    riskLevel: "medium",
    inputSchema: setupBegin,
    mcpInputSchema: {
      type: "object",
      properties: {
        browser: { type: "string", enum: ["firefox", "chromium"] },
        dryRun: { type: "boolean" },
        confirmationToken: { type: "string" }
      },
      additionalProperties: false
    },
    inputSummary: "Start browser setup enrollment",
    auditInputSummary: (input) => `Start browser setup for ${input.browser ?? "auto-select"}`,
    auditOutputSummary: () => "Browser enrollment state updated; credentials omitted.",
    preview: { isDryRun: (input) => input.dryRun === true },
    execution: stateChangingExecution,
    safety: { actionType: "inspect" },
    async handler(input, context, runtime) {
      try {
        const target = { operation: "browser_setup_begin", browser: input.browser ?? "auto" };
        if (runtime?.isDryRun) {
          return buildPreviewResult({
            tool: "browser.setup_begin",
            riskLevel: "medium",
            safety: pairingSafety(),
            targetSummary: `Start browser setup for ${input.browser ?? "auto-select"}`,
            target: { kind: "browser", summary: "Create bounded local browser enrollment" },
            wouldExecute: true,
            confirmation: {
              manager: context.confirmations,
              sessionId: context.sessionId,
              input,
              target,
              explanation: "Create one local enrollment session; extension approval remains manual.",
              riskLevel: "medium"
            }
          });
        }
        const verified = context.confirmations.verifyAndConsume(input.confirmationToken ?? "", {
          sessionId: context.sessionId,
          tool: "browser.setup_begin",
          input,
          target,
          riskLevel: "medium"
        });
        if (!verified.ok) {
          return toolFailure({
            tool: "browser.setup_begin",
            riskLevel: "medium",
            confirmation: rejectedConfirmation(verified.tokenId, verified.reason),
            error: { code: "confirmation_rejected", message: verified.reason }
          });
        }
        return toolSuccess({
          tool: "browser.setup_begin",
          riskLevel: "medium",
          data: await setup(context).start(input.browser),
          observations: ["Open approved extension popup and request pairing. No enrollment credential was returned."]
        });
      } catch (error) {
        return failure("browser.setup_begin", error);
      }
    }
  };
  const approve: AgentHostToolDefinition<z.infer<typeof setupAction>, unknown, AgentHostMcpContext> = {
    name: "browser.setup_approve",
    description: "Approves exact pending extension identity for one bounded setup session.",
    riskLevel: "medium",
    inputSchema: setupAction,
    mcpInputSchema: {
      type: "object",
      properties: {
        setupId: { type: "string" },
        dryRun: { type: "boolean" },
        confirmationToken: { type: "string" }
      },
      required: ["setupId"],
      additionalProperties: false
    },
    inputSummary: "Approve pending browser extension identity",
    auditInputSummary: (input) => `Approve browser setup ${input.setupId}`,
    auditOutputSummary: () => "Browser setup approval recorded; identity and credentials omitted.",
    preview: { isDryRun: (input) => input.dryRun === true },
    execution: stateChangingExecution,
    safety: { actionType: "inspect" },
    async handler(input, context, runtime) {
      try {
        const target = { operation: "browser_setup_approve", setupId: input.setupId };
        if (runtime?.isDryRun) {
          return buildPreviewResult({
            tool: "browser.setup_approve",
            riskLevel: "medium",
            safety: pairingSafety(),
            targetSummary: `Approve setup ${input.setupId}`,
            target: { kind: "browser", summary: "Approve exact pending extension identity" },
            wouldExecute: true,
            confirmation: {
              manager: context.confirmations,
              sessionId: context.sessionId,
              input,
              target,
              explanation: "Approve one exact extension request; no browser security prompt is bypassed.",
              riskLevel: "medium"
            }
          });
        }
        const verified = context.confirmations.verifyAndConsume(input.confirmationToken ?? "", {
          sessionId: context.sessionId,
          tool: "browser.setup_approve",
          input,
          target,
          riskLevel: "medium"
        });
        if (!verified.ok) {
          return toolFailure({
            tool: "browser.setup_approve",
            riskLevel: "medium",
            confirmation: rejectedConfirmation(verified.tokenId, verified.reason),
            error: { code: "confirmation_rejected", message: verified.reason }
          });
        }
        return toolSuccess({
          tool: "browser.setup_approve",
          riskLevel: "medium",
          data: await setup(context).approve(input.setupId),
          observations: ["Extension must collect approved pairing through local bridge."]
        });
      } catch (error) {
        return failure("browser.setup_approve", error);
      }
    }
  };
  const cancel: AgentHostToolDefinition<z.infer<typeof setupAction>, unknown, AgentHostMcpContext> = {
    name: "browser.setup_cancel",
    description: "Cancels one bounded browser setup session without revoking existing devices.",
    riskLevel: "medium",
    inputSchema: setupAction,
    mcpInputSchema: approve.mcpInputSchema,
    inputSummary: "Cancel browser setup",
    auditInputSummary: (input) => `Cancel browser setup ${input.setupId}`,
    auditOutputSummary: () => "Browser setup cancelled; credentials omitted.",
    preview: { isDryRun: (input) => input.dryRun === true },
    execution: stateChangingExecution,
    safety: { actionType: "inspect" },
    async handler(input, context, runtime) {
      try {
        const target = { operation: "browser_setup_cancel", setupId: input.setupId };
        if (runtime?.isDryRun) {
          return buildPreviewResult({
            tool: "browser.setup_cancel",
            riskLevel: "medium",
            safety: pairingSafety(),
            targetSummary: `Cancel setup ${input.setupId}`,
            target: { kind: "browser", summary: "Cancel bounded browser setup" },
            wouldExecute: true,
            confirmation: {
              manager: context.confirmations,
              sessionId: context.sessionId,
              input,
              target,
              explanation: "Cancel pending enrollment without revoking existing devices.",
              riskLevel: "medium"
            }
          });
        }
        const verified = context.confirmations.verifyAndConsume(input.confirmationToken ?? "", {
          sessionId: context.sessionId,
          tool: "browser.setup_cancel",
          input,
          target,
          riskLevel: "medium"
        });
        if (!verified.ok) {
          return toolFailure({
            tool: "browser.setup_cancel",
            riskLevel: "medium",
            confirmation: rejectedConfirmation(verified.tokenId, verified.reason),
            error: { code: "confirmation_rejected", message: verified.reason }
          });
        }
        return toolSuccess({
          tool: "browser.setup_cancel",
          riskLevel: "medium",
          data: await setup(context).cancel(input.setupId),
          observations: ["Existing paired devices were not revoked."]
        });
      } catch (error) {
        return failure("browser.setup_cancel", error);
      }
    }
  };
  const verifySetup: AgentHostToolDefinition<z.infer<typeof setupAction>, unknown, AgentHostMcpContext> = {
    name: "browser.setup_verify",
    description: "Verifies current paired setup and reconnect readiness without page access.",
    riskLevel: "observe",
    inputSchema: setupAction,
    mcpInputSchema: approve.mcpInputSchema,
    inputSummary: "Verify browser setup",
    auditInputSummary: (input) => `Verify browser setup ${input.setupId}`,
    auditOutputSummary: () => "Browser setup verification reported without credentials.",
    safety: { actionType: "observe" },
    async handler(input, context) {
      try {
        return toolSuccess({
          tool: "browser.setup_verify",
          riskLevel: "observe",
          data: await setup(context).verify(input.setupId),
          observations: ["No browser page was accessed."]
        });
      } catch (error) {
        const code = error instanceof Error ? error.message : "browser_setup_failed";
        const recovery = browserSetupRecovery(
          code === "browser_setup_not_paired" ? "extension_disconnected" : "reconnect_timeout"
        );
        return toolFailure({
          tool: "browser.setup_verify",
          riskLevel: "low",
          error: { code, message: recovery.explanation },
          observations: [recovery.action]
        });
      }
    }
  };
  // Pairing mutations participate in the central dry-run/confirmation
  // baseline; the handler retains the exact token and token-file checks.
  generate.safety = { actionType: "inspect" };
  reset.safety = { actionType: "inspect" };
  return [status, diagnose, generate, reset, install, verify, inventory, begin, approve, cancel, verifySetup];
}
