import { createHash } from "node:crypto";
import type {
  ActionBindingFingerprints,
  ActionEffectDecision,
  ActionEffectDecisionSummary,
  ActionRecoveryAction,
  AppSensitivity,
  GovernedActionEffect,
  GrantDecision,
  RuntimePolicy,
  RiskLevel,
  SafetyInput,
  ToolExecutionClass
} from "./types.js";

const stable = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
};

export function fingerprintActionEffect(input: {
  ownerSessionId: string;
  operationFamily: string;
  operation: string;
  bindings?: ActionBindingFingerprints;
  application?: string;
  route?: string;
  sensitivity?: AppSensitivity;
  externalEffect?: boolean;
  destructive?: boolean;
  executionClass?: ToolExecutionClass;
  reversibility?: GovernedActionEffect["reversibility"];
  confirmationLevel?: GovernedActionEffect["confirmationLevel"];
  verificationKind?: string;
  cleanupKind?: string;
  requiredGrantIds?: string[];
}): string {
  return createHash("sha256").update(stable({
    ownerSessionId: input.ownerSessionId,
    operationFamily: input.operationFamily,
    operation: input.operation,
    bindings: input.bindings ?? {},
    application: input.application ?? "",
    route: input.route ?? "",
    sensitivity: input.sensitivity ?? "normal",
    externalEffect: input.externalEffect === true,
    destructive: input.destructive === true,
    executionClass: input.executionClass ?? "state_changing",
    reversibility: input.reversibility ?? "reversible",
    confirmationLevel: input.confirmationLevel ?? "none",
    verificationKind: input.verificationKind ?? "none",
    cleanupKind: input.cleanupKind ?? "none",
    requiredGrantIds: [...(input.requiredGrantIds ?? [])].sort()
  })).digest("hex");
}

/** Hash opaque target/content bindings before grants, effects, or logs. */
export function fingerprintActionBinding(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Hash a bounded structured binding without retaining its raw value. */
export function fingerprintActionBindingValue(value: unknown): string {
  return fingerprintActionBinding(stable(value));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstBinding(source: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

/**
 * Derive opaque bindings for legacy state-changing handlers. This is a
 * bounded compatibility resolver: only known input fields are considered,
 * and values are hashed before entering effects, grants, or logs.
 */
export function deriveActionEffectBindings(input: unknown, existing: ActionBindingFingerprints = {}): ActionBindingFingerprints {
  const source = asRecord(input);
  const target = firstBinding(source, [
    "targetFingerprint", "elementId", "path", "filePath", "url", "windowId",
    "activeWindow", "registrationId", "manifestId", "preparationId", "artifactId",
    "appName", "browser", "purpose", "query", "actionName", "command", "keys", "script", "demo", "value", "target"
  ]) ?? (source.x !== undefined || source.y !== undefined ? { x: source.x, y: source.y, activeWindow: source.activeWindow } : undefined);
  const recipient = firstBinding(source, ["recipientFingerprint", "recipient", "recipientId"]);
  const content = firstBinding(source, ["contentFingerprint", "content", "text", "value", "script"]);
  const artifact = firstBinding(source, ["artifactFingerprint", "artifactId", "artifact", "outputPath", "outputDir"]);
  const channel = firstBinding(source, ["channel", "channelId", "application"]);
  const route = firstBinding(source, ["routeFingerprint", "routeId", "route", "providerId"]);
  const bind = (current: string | undefined, value: unknown): string | undefined => current ?? (value === undefined ? undefined : fingerprintActionBindingValue(value));
  const result: ActionBindingFingerprints = {};
  const set = (key: keyof ActionBindingFingerprints, current: string | undefined, value: unknown): void => {
    const resolved = bind(current, value);
    if (resolved !== undefined) result[key] = resolved;
  };
  set("target", existing.target, target);
  set("recipient", existing.recipient, recipient);
  set("content", existing.content, content);
  set("artifact", existing.artifact, artifact);
  set("channel", existing.channel, channel);
  set("route", existing.route, route);
  return result;
}

export function createGovernedActionEffect(input: {
  ownerSessionId: string;
  operationFamily: string;
  operation: string;
  executionClass: ToolExecutionClass;
  reversibility?: GovernedActionEffect["reversibility"];
  externalEffect?: boolean;
  destructive?: boolean;
  sensitivity?: AppSensitivity;
  requiredGrantIds?: string[];
  confirmationLevel?: GovernedActionEffect["confirmationLevel"];
  verificationKind?: string;
  cleanupKind?: string;
  bindings?: ActionBindingFingerprints;
  application?: string;
  expiresAt?: string;
  effectId?: string;
}): GovernedActionEffect {
  const bindings = { ...(input.bindings ?? {}) };
  const reversibility = input.reversibility ?? (input.destructive === true ? "destructive" : input.externalEffect === true ? "external" : "reversible");
  const confirmationLevel = input.confirmationLevel ?? (input.destructive === true ? "strong" : input.externalEffect === true ? "standard" : "none");
  const verificationKind = input.verificationKind ?? "none";
  const cleanupKind = input.cleanupKind ?? "none";
  const requiredGrantIds = [...new Set(input.requiredGrantIds ?? [])];
  const fingerprint = fingerprintActionEffect({ ...input, bindings, reversibility, confirmationLevel, verificationKind, cleanupKind, requiredGrantIds });
  return {
    effectId: input.effectId ?? `effect_${fingerprint.slice(0, 24)}`,
    ownerSessionId: input.ownerSessionId,
    operationFamily: input.operationFamily,
    operation: input.operation,
    bindings,
    ...(input.application === undefined ? {} : { application: input.application }),
    executionClass: input.executionClass,
    reversibility,
    externalEffect: input.externalEffect === true,
    destructive: input.destructive === true,
    sensitivity: input.sensitivity ?? "normal",
    requiredGrantIds,
    confirmationLevel,
    verificationKind,
    cleanupKind,
    expiresAt: input.expiresAt ?? new Date(Date.now() + 180_000).toISOString(),
    status: "prepared",
    fingerprint
  };
}

/** Validate resolver output before any policy or handler path can use it. */
export function validateGovernedActionEffect(
  effect: GovernedActionEffect,
  requiredBindings: readonly string[] = [],
  expectedOwnerSessionId?: string
): { ok: true } | { ok: false; code: string; reason: string } {
  if (effect === null || typeof effect !== "object") {
    return { ok: false, code: "action_effect_unresolved", reason: "Governed effect resolver returned no effect." };
  }
  if (typeof effect.ownerSessionId !== "string" || effect.ownerSessionId.length === 0) {
    return { ok: false, code: "action_effect_unresolved", reason: "Governed effect is not bound to the current owner session." };
  }
  if (expectedOwnerSessionId !== undefined && effect.ownerSessionId !== expectedOwnerSessionId) {
    return { ok: false, code: "action_binding_changed", reason: "Governed effect is bound to a different owner session." };
  }
  if (effect.executionClass !== "state_changing") {
    return { ok: false, code: "action_effect_unresolved", reason: "State-changing effect has an incompatible execution class." };
  }
  if (typeof effect.expiresAt !== "string" || !Number.isFinite(Date.parse(effect.expiresAt)) || Date.parse(effect.expiresAt) <= Date.now()) {
    return { ok: false, code: "action_effect_expired", reason: "Governed effect authorization window has expired." };
  }
  if (typeof effect.operationFamily !== "string" || effect.operationFamily.length === 0 || typeof effect.operation !== "string" || effect.operation.length === 0) {
    return { ok: false, code: "action_effect_unresolved", reason: "Exact operation is unresolved." };
  }
  for (const binding of requiredBindings) {
    const value = effect.bindings?.[binding as keyof ActionBindingFingerprints];
    if (typeof value !== "string" || value.length === 0) {
      return { ok: false, code: "action_target_missing", reason: `Required ${binding} binding is unresolved.` };
    }
  }
  if (typeof effect.fingerprint !== "string" || !/^[a-f0-9]{64}$/i.test(effect.fingerprint)) {
    return { ok: false, code: "action_effect_unresolved", reason: "Governed effect fingerprint is invalid." };
  }
  const expectedFingerprint = fingerprintActionEffect({
    ownerSessionId: effect.ownerSessionId,
    operationFamily: effect.operationFamily,
    operation: effect.operation,
    bindings: effect.bindings,
    ...(effect.application === undefined ? {} : { application: effect.application }),
    sensitivity: effect.sensitivity,
    externalEffect: effect.externalEffect,
    destructive: effect.destructive,
    executionClass: effect.executionClass,
    reversibility: effect.reversibility,
    confirmationLevel: effect.confirmationLevel,
    verificationKind: effect.verificationKind,
    cleanupKind: effect.cleanupKind,
    requiredGrantIds: effect.requiredGrantIds
  });
  if (expectedFingerprint !== effect.fingerprint) {
    return { ok: false, code: "action_binding_changed", reason: "Governed effect fingerprint does not match its bound operation." };
  }
  return { ok: true };
}

function failure(decision: ActionEffectDecision, recovery: ActionRecoveryAction, code: string, reason: string, effect?: GovernedActionEffect): ActionEffectDecisionSummary {
  return {
    decision,
    recovery,
    code,
    reason,
    ...(effect === undefined ? {} : { effectFingerprint: effect.fingerprint }),
    requiresGrant: effect !== undefined && (effect.externalEffect || effect.destructive || effect.sensitivity !== "normal"),
    requiresConfirmation: effect?.confirmationLevel !== "none",
    requiresStrongConfirmation: effect?.confirmationLevel === "strong",
    verificationRequired: effect !== undefined && (effect.externalEffect || effect.destructive)
  };
}

export function decideGovernedAction(input: {
  effect?: GovernedActionEffect;
  safety?: { allowed: boolean; blocked: boolean; guideOnly: boolean; riskLevel: RiskLevel; appSensitivity: AppSensitivity };
  grantDecision?: GrantDecision;
  policy: RuntimePolicy;
}): ActionEffectDecisionSummary {
  const effect = input.effect;
  if (effect === undefined) return failure("require_clarification", "prepare", "action_effect_unresolved", "Exact operation and bindings are not resolved.");
  const sensitivity = input.safety?.appSensitivity !== undefined && input.safety.appSensitivity !== "unknown"
    ? input.safety.appSensitivity
    : effect.sensitivity;
  if (sensitivity === "credential_or_security" || sensitivity === "unknown" && effect.externalEffect) {
    return failure("blocked_by_policy", "block", "protected_context_blocked", "Credential, secret, or unknown protected context cannot be automated.", effect);
  }
  if (sensitivity === "financial" && effect.executionClass === "state_changing" && effect.bindings.route === undefined) {
    return failure("unsupported", "select_route", "action_route_unavailable", "Financial effect has no explicitly governed route and independent verification contract.", effect);
  }
  if (effect.reversibility === "prohibited") return failure("blocked_by_policy", "block", "action_policy_blocked", "Effect is prohibited by safety policy.", effect);
  if (input.grantDecision !== undefined && input.grantDecision.deniedByGrantIds.length > 0) return failure("blocked_by_policy", "block", "action_policy_blocked", "An explicit deny grant blocks this exact effect.", effect);
  const needsGrant = effect.externalEffect || effect.destructive || sensitivity !== "normal";
  // Preserve precise recovery for default-denied external effects. Callers
  // can request a narrowly scoped grant instead of receiving a category-only
  // refusal.
  if (needsGrant && (input.grantDecision?.allowedByGrantIds.length ?? 0) === 0 && input.policy.defaults.externalSendsUploads === "deny") {
    return failure("require_confirmation", "confirm", "action_grant_missing", "A matching scoped grant is required for this exact effect.", effect);
  }
  if (input.safety?.blocked === true) return failure("blocked_by_policy", "block", "action_policy_blocked", "Safety policy blocked this exact effect.", effect);
  if (input.safety?.guideOnly === true) return failure("guide_only", "guide", "action_policy_blocked", "Current grant or policy permits guide mode only.", effect);
  if (effect.verificationKind === "none" && (effect.externalEffect || effect.destructive)) {
    return failure("verification_unavailable", "guide", "action_verification_unavailable", "No independent verification contract is available.", effect);
  }
  if (effect.confirmationLevel === "strong") return failure("require_strong_confirmation", "confirm", "action_confirmation_missing", "Fresh strong confirmation is required for this exact effect.", effect);
  if (effect.confirmationLevel === "standard") return failure("require_confirmation", "confirm", "action_confirmation_missing", "Fresh confirmation is required for this exact effect.", effect);
  return {
    decision: effect.executionClass === "read_only" ? "allow_read_only" : "allow_from_explicit_intent",
    recovery: "retry",
    ...(effect.fingerprint === undefined ? {} : { effectFingerprint: effect.fingerprint }),
    requiresGrant: needsGrant,
    requiresConfirmation: false,
    requiresStrongConfirmation: false,
    verificationRequired: false,
    reason: "Exact effect is governed and eligible."
  };
}

export function actionEffectFromSafetyInput(
  input: SafetyInput,
  ownerSessionId: string,
  executionClass: ToolExecutionClass,
  metadata?: {
    externalEffect?: boolean;
    reversibility?: GovernedActionEffect["reversibility"];
    sensitivity?: AppSensitivity;
    confirmationLevel?: GovernedActionEffect["confirmationLevel"];
    verificationKind?: string;
    cleanupKind?: string;
  },
  rawInput?: unknown
): GovernedActionEffect {
  const effect = input.effect ?? {};
  const bindings = deriveActionEffectBindings(rawInput, effect.bindings);
  return createGovernedActionEffect({
    ownerSessionId,
    operationFamily: effect.operationFamily ?? input.actionType,
    operation: effect.operation ?? input.tool,
    executionClass,
    ...(input.externalEffect ?? effect.externalEffect ?? metadata?.externalEffect) === undefined ? {} : { externalEffect: (input.externalEffect ?? effect.externalEffect ?? metadata?.externalEffect) === true },
    ...(input.destructive ?? effect.destructive) === undefined ? {} : { destructive: (input.destructive ?? effect.destructive) === true },
    sensitivity: effect.sensitivity ?? metadata?.sensitivity ?? (input.communicative === true ? "communication" : "normal"),
    ...((input.destructive ?? effect.destructive) === true
      ? { reversibility: "destructive" as const, confirmationLevel: "strong" as const }
      : metadata?.reversibility === undefined ? {} : { reversibility: metadata.reversibility }),
    ...((input.destructive ?? effect.destructive) === true || metadata?.confirmationLevel === undefined
      ? {}
      : { confirmationLevel: metadata.confirmationLevel }),
    ...(metadata?.verificationKind === undefined ? {} : { verificationKind: metadata.verificationKind }),
    ...(metadata?.cleanupKind === undefined ? {} : { cleanupKind: metadata.cleanupKind }),
    ...(Object.keys(bindings).length === 0 ? {} : { bindings }),
    ...(input.appName === undefined ? {} : { application: input.appName }),
    verificationKind: metadata?.verificationKind ?? "tool_result"
  });
}
