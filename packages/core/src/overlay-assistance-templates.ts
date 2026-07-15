import {
  redactOverlayText,
  validateOverlayTargetBinding,
  type OverlayPrimitiveType,
  type OverlaySensitivity,
  type OverlayTargetBinding
} from "./overlay.js";
import type { OverlayAssistanceEventName, OverlayAssistanceSessionStatus, OverlayAssistanceStep, OverlayAssistanceStepType } from "./overlay-assistance.js";

export type OverlayAssistanceTemplateStatus = "draft" | "active" | "archived";
export type OverlayAssistanceTemplateParameterType = "string" | "number" | "boolean";

export interface OverlayAssistanceTemplateParameter {
  name: string;
  type: OverlayAssistanceTemplateParameterType;
  required: boolean;
  sensitivity: "public" | "private" | "secret";
}

export interface OverlayAssistanceTemplateTargetPlaceholder {
  placeholderId: string;
  bindingType: OverlayTargetBinding["kind"];
  required: boolean;
  sensitivity: OverlaySensitivity;
}

export interface OverlayAssistanceTemplateWidgetButton {
  label: string;
  event: Exclude<OverlayAssistanceEventName, "back">;
}

export interface OverlayAssistanceTemplateStep {
  stepId: string;
  index: number;
  type: OverlayAssistanceStepType;
  sensitivity?: OverlaySensitivity;
  primitiveType?: Exclude<OverlayPrimitiveType, "approval_card">;
  label?: string;
  description?: string;
  widgetTitle?: string;
  widgetButtons?: OverlayAssistanceTemplateWidgetButton[];
  targetPlaceholderId?: string;
  expectedEvent?: Exclude<OverlayAssistanceEventName, "back">;
  requiresEvent?: boolean;
  progressGroup?: string;
  warningCodes?: string[];
  durationMs?: number;
  animation?: { kind: "fade" | "slide" | "scale" | "pulse" | "glow" | "pointer_move" | "progress"; durationMs: number; reducedMotion?: "instant" | "fade" | "none" };
}

export interface OverlayAssistanceTemplate {
  templateId: string;
  ownerSessionId: string;
  name: string;
  description?: string;
  version: number;
  parameters: OverlayAssistanceTemplateParameter[];
  targetPlaceholders?: OverlayAssistanceTemplateTargetPlaceholder[];
  steps: OverlayAssistanceTemplateStep[];
  progressGroups?: string[];
  warnings?: string[];
  terminalInstruction?: string;
  status: OverlayAssistanceTemplateStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface OverlayAssistanceStepPreview {
  sessionId: string;
  status: OverlayAssistanceSessionStatus;
  currentStepIndex: number;
  stepId?: string;
  stepType?: OverlayAssistanceStepType;
  safeLabel?: string;
  progressGroup?: string;
  warningCodes: string[];
  progress: { completed: number; total: number; percent: number };
  canRender: boolean;
  targetRequired: boolean;
  targetFreshness: "fresh" | "stale" | "missing" | "not_required" | "unknown";
  expectedEvent?: OverlayAssistanceEventName;
  blockers: string[];
  warnings: string[];
  recommendedAction: string;
  terminal: boolean;
}

export interface OverlayAssistanceSessionExplanation {
  sessionId: string;
  status: OverlayAssistanceSessionStatus;
  currentStepIndex: number;
  remainingSteps: number;
  progress: { completed: number; total: number; percent: number };
  currentStep?: { stepId: string; type: OverlayAssistanceStepType; label?: string };
  waitingReason?: string;
  lastEvent?: { event: string; stepId: string; createdAt: string };
  renderer: { status: string; backend: string; sessionType: string; healthy: boolean; reason?: string };
  targetFreshness: OverlayAssistanceStepPreview["targetFreshness"];
  blockers: string[];
  warnings: string[];
  requiredGrantIds: string[];
  recommendedAction: string;
  terminalExplanation?: string;
}

export const OVERLAY_ASSISTANCE_TEMPLATE_MAX_PARAMETERS = 20;
export const OVERLAY_ASSISTANCE_TEMPLATE_MAX_PLACEHOLDERS = 20;
export const OVERLAY_ASSISTANCE_TEMPLATE_MAX_WARNINGS = 20;
export const OVERLAY_ASSISTANCE_TEMPLATE_MAX_WIDGET_BUTTONS = 8;
export const OVERLAY_ASSISTANCE_TEMPLATE_MAX_SERIALIZED_BYTES = 32_000;
export const OVERLAY_ASSISTANCE_TEMPLATE_MAX_PREVIEW_BYTES = 64_000;

const parameterName = /^[A-Za-z][A-Za-z0-9_]{0,99}$/;
const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
const eventNames = new Set<OverlayAssistanceEventName>(["accepted", "rejected", "dismissed", "cancelled", "next", "acknowledgement_checked", "emergency_stop_requested"]);
const stepTypes = new Set<OverlayAssistanceStepType>(["pointer", "highlight", "tooltip", "widget", "instruction", "warning", "progress", "checkpoint_result", "wait_for_event", "clear", "finish"]);
const primitiveTypes = new Set<Exclude<OverlayPrimitiveType, "approval_card">>(["pointer", "arrow", "highlight", "spotlight", "tooltip", "instruction_card", "warning", "progress", "checkpoint_result", "status_toast", "comparison", "cancel_control", "emergency_stop_control"]);
const targetKinds = new Set<OverlayTargetBinding["kind"]>(["browser_element", "accessibility_element", "vision_target", "window_region", "screenshot_region", "screen_point"]);

function unknownKeys(value: object, allowed: string[]): string[] {
  const allowedSet = new Set(allowed);
  return Object.keys(value).filter((key) => !allowedSet.has(key));
}

function validateLiteralText(value: unknown, field: string, parameters: Set<string>, errors: string[]): void {
  if (value === undefined) return;
  if (typeof value !== "string" || value.length > 1_000) { errors.push(`${field}_invalid`); return; }
  const matches = [...value.matchAll(/\{\{([^{}]+)\}\}/g)];
  for (const match of matches) {
    const name = match[1] ?? "";
    if (!parameterName.test(name) || !parameters.has(name)) errors.push("overlay_template_interpolation_invalid");
  }
  if (value.includes("${") || /(?:\beval\s*\(|\bfunction\b|process\.env|\brequire\s*\(|\bshell\.|\bglob\s*\(|\bexec\s*\(|=>|;)/i.test(value)) errors.push("overlay_template_executable_text_blocked");
  const redaction = redactOverlayText(value, "public");
  errors.push(...redaction.errors.map((error) => `overlay_template_${error}`));
}

export function validateOverlayAssistanceTemplate(template: unknown, now = Date.now()): string[] {
  const errors: string[] = [];
  if (template === null || typeof template !== "object") return ["overlay_template_invalid"];
  const value = template as Record<string, unknown>;
  const allowed = ["templateId", "ownerSessionId", "name", "description", "version", "parameters", "targetPlaceholders", "steps", "progressGroups", "warnings", "terminalInstruction", "status", "createdAt", "updatedAt", "archivedAt"];
  errors.push(...unknownKeys(value, allowed).map(() => "overlay_template_unknown_field"));
  if (typeof value.templateId !== "string" || !identifier.test(value.templateId)) errors.push("overlay_template_id_invalid");
  if (typeof value.ownerSessionId !== "string" || !identifier.test(value.ownerSessionId)) errors.push("overlay_template_owner_invalid");
  if (typeof value.name !== "string" || value.name.trim().length === 0 || value.name.length > 200) errors.push("overlay_template_name_invalid");
  if (value.description !== undefined && (typeof value.description !== "string" || value.description.length > 1_000)) errors.push("overlay_template_description_invalid");
  if (!Number.isInteger(value.version) || Number(value.version) < 1) errors.push("overlay_template_version_invalid");
  if (!(["draft", "active", "archived"] as string[]).includes(String(value.status))) errors.push("overlay_template_status_invalid");
  const parameters = Array.isArray(value.parameters) ? value.parameters : [];
  if (!Array.isArray(value.parameters) || parameters.length > OVERLAY_ASSISTANCE_TEMPLATE_MAX_PARAMETERS) errors.push("overlay_template_parameters_invalid");
  const parameterNames = new Set<string>();
  for (const parameter of parameters) {
    if (parameter === null || typeof parameter !== "object") { errors.push("overlay_template_parameter_invalid"); continue; }
    const item = parameter as Record<string, unknown>;
    errors.push(...unknownKeys(item, ["name", "type", "required", "sensitivity"]).map(() => "overlay_template_unknown_field"));
    if (typeof item.name !== "string" || !parameterName.test(item.name) || parameterNames.has(item.name)) errors.push("overlay_template_parameter_name_invalid");
    if (typeof item.name === "string") parameterNames.add(item.name);
    if (!["string", "number", "boolean"].includes(String(item.type))) errors.push("overlay_template_parameter_type_invalid");
    if (typeof item.required !== "boolean") errors.push("overlay_template_parameter_required_invalid");
    if (!["public", "private", "secret"].includes(String(item.sensitivity))) errors.push("overlay_template_parameter_sensitivity_invalid");
    if (item.sensitivity === "secret") errors.push("overlay_template_secret_parameter_blocked");
  }
  validateLiteralText(value.name, "overlay_template_name", parameterNames, errors);
  validateLiteralText(value.description, "overlay_template_description", parameterNames, errors);
  const placeholders = Array.isArray(value.targetPlaceholders) ? value.targetPlaceholders : [];
  if (value.targetPlaceholders !== undefined && (!Array.isArray(value.targetPlaceholders) || placeholders.length > OVERLAY_ASSISTANCE_TEMPLATE_MAX_PLACEHOLDERS)) errors.push("overlay_template_placeholders_invalid");
  const placeholderIds = new Set<string>();
  for (const placeholder of placeholders) {
    if (placeholder === null || typeof placeholder !== "object") { errors.push("overlay_template_placeholder_invalid"); continue; }
    const item = placeholder as Record<string, unknown>;
    errors.push(...unknownKeys(item, ["placeholderId", "bindingType", "required", "sensitivity"]).map(() => "overlay_template_unknown_field"));
    if (typeof item.placeholderId !== "string" || !identifier.test(item.placeholderId) || placeholderIds.has(item.placeholderId)) errors.push("overlay_template_placeholder_id_invalid");
    if (typeof item.placeholderId === "string") placeholderIds.add(item.placeholderId);
    if (!targetKinds.has(item.bindingType as OverlayTargetBinding["kind"])) errors.push("overlay_template_placeholder_kind_invalid");
    if (typeof item.required !== "boolean") errors.push("overlay_template_placeholder_required_invalid");
    if (!["public", "private", "secret"].includes(String(item.sensitivity))) errors.push("overlay_template_placeholder_sensitivity_invalid");
    if (item.sensitivity === "secret") errors.push("overlay_template_secret_placeholder_blocked");
  }
  const steps = Array.isArray(value.steps) ? value.steps : [];
  if (!Array.isArray(value.steps) || steps.length === 0 || steps.length > 50) errors.push("overlay_template_step_count_invalid");
  const stepIds = new Set<string>();
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (step === null || typeof step !== "object") { errors.push("overlay_template_step_invalid"); continue; }
    const item = step as Record<string, unknown>;
    errors.push(...unknownKeys(item, ["stepId", "index", "type", "sensitivity", "primitiveType", "label", "description", "widgetTitle", "widgetButtons", "targetPlaceholderId", "expectedEvent", "requiresEvent", "progressGroup", "warningCodes", "durationMs", "animation"]).map(() => "overlay_template_unknown_field"));
    if (typeof item.stepId !== "string" || !identifier.test(item.stepId) || stepIds.has(item.stepId)) errors.push("overlay_template_step_id_invalid");
    if (typeof item.stepId === "string") stepIds.add(item.stepId);
    if (item.index !== index || !stepTypes.has(item.type as OverlayAssistanceStepType)) errors.push("overlay_template_step_type_invalid");
    if (item.sensitivity !== undefined && !["public", "private", "secret"].includes(String(item.sensitivity))) errors.push("overlay_template_step_sensitivity_invalid");
    if (item.sensitivity === "secret") errors.push("overlay_template_secret_step_blocked");
    if (item.primitiveType !== undefined && !primitiveTypes.has(item.primitiveType as never)) errors.push("overlay_template_primitive_invalid");
    if (!["clear", "wait_for_event", "finish"].includes(String(item.type)) && item.type !== "widget" && item.primitiveType === undefined) errors.push("overlay_template_primitive_required");
    if (item.type === "widget") {
      if (typeof item.widgetTitle !== "string" || item.widgetTitle.length > 200) errors.push("overlay_template_widget_title_invalid");
      if (item.widgetButtons !== undefined && (!Array.isArray(item.widgetButtons) || item.widgetButtons.length > OVERLAY_ASSISTANCE_TEMPLATE_MAX_WIDGET_BUTTONS)) errors.push("overlay_template_widget_buttons_invalid");
      for (const button of (Array.isArray(item.widgetButtons) ? item.widgetButtons : [])) {
        if (button === null || typeof button !== "object") { errors.push("overlay_template_widget_button_invalid"); continue; }
        const b = button as Record<string, unknown>;
        errors.push(...unknownKeys(b, ["label", "event"]).map(() => "overlay_template_unknown_field"));
        if (typeof b.label !== "string" || b.label.length > 200 || !eventNames.has(b.event as OverlayAssistanceEventName)) errors.push("overlay_template_widget_button_invalid");
      }
    }
    if (item.targetPlaceholderId !== undefined && (typeof item.targetPlaceholderId !== "string" || !placeholderIds.has(item.targetPlaceholderId))) errors.push("overlay_template_target_placeholder_invalid");
    if (item.expectedEvent !== undefined && !eventNames.has(item.expectedEvent as OverlayAssistanceEventName)) errors.push("overlay_template_expected_event_invalid");
    if (item.requiresEvent !== undefined && typeof item.requiresEvent !== "boolean") errors.push("overlay_template_requires_event_invalid");
    if (item.progressGroup !== undefined && (typeof item.progressGroup !== "string" || item.progressGroup.length > 100)) errors.push("overlay_template_progress_group_invalid");
    if (item.warningCodes !== undefined && (!Array.isArray(item.warningCodes) || item.warningCodes.length > 10 || item.warningCodes.some((code) => typeof code !== "string" || code.length > 100))) errors.push("overlay_template_warning_codes_invalid");
    if (item.durationMs !== undefined && (!Number.isInteger(item.durationMs) || Number(item.durationMs) < 0 || Number(item.durationMs) > 1_800_000)) errors.push("overlay_template_duration_invalid");
    if (item.animation !== undefined) {
      const animation = item.animation as Record<string, unknown>;
      if (animation === null || typeof animation !== "object" || unknownKeys(animation, ["kind", "durationMs", "reducedMotion"]).length > 0 || !["fade", "slide", "scale", "pulse", "glow", "pointer_move", "progress"].includes(String(animation.kind)) || !Number.isInteger(animation.durationMs) || Number(animation.durationMs) < 0 || Number(animation.durationMs) > 5_000 || (animation.reducedMotion !== undefined && !["instant", "fade", "none"].includes(String(animation.reducedMotion)))) errors.push("overlay_template_animation_invalid");
    }
    validateLiteralText(item.label, "overlay_template_label", parameterNames, errors);
    validateLiteralText(item.description, "overlay_template_description", parameterNames, errors);
    validateLiteralText(item.widgetTitle, "overlay_template_widget_title", parameterNames, errors);
    for (const button of (Array.isArray(item.widgetButtons) ? item.widgetButtons : [])) validateLiteralText((button as Record<string, unknown>).label, "overlay_template_button_label", parameterNames, errors);
  }
  if (value.progressGroups !== undefined && (!Array.isArray(value.progressGroups) || value.progressGroups.length > 20 || value.progressGroups.some((group) => typeof group !== "string" || group.length > 100))) errors.push("overlay_template_progress_groups_invalid");
  if (value.warnings !== undefined && (!Array.isArray(value.warnings) || value.warnings.length > OVERLAY_ASSISTANCE_TEMPLATE_MAX_WARNINGS || value.warnings.some((warning) => typeof warning !== "string" || warning.length > 1_000))) errors.push("overlay_template_warnings_invalid");
  for (const text of [...(Array.isArray(value.warnings) ? value.warnings : []), value.terminalInstruction]) validateLiteralText(text, "overlay_template_text", parameterNames, errors);
  if (value.terminalInstruction !== undefined && (typeof value.terminalInstruction !== "string" || value.terminalInstruction.length > 1_000)) errors.push("overlay_template_terminal_instruction_invalid");
  if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) errors.push("overlay_template_created_at_invalid");
  if (typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) errors.push("overlay_template_updated_at_invalid");
  if (value.archivedAt !== undefined && (!(["archived"].includes(String(value.status))) || typeof value.archivedAt !== "string" || !Number.isFinite(Date.parse(value.archivedAt)))) errors.push("overlay_template_archive_invalid");
  if (String(value.status) === "archived" && value.archivedAt === undefined) errors.push("overlay_template_archive_invalid");
  if (String(value.updatedAt) && Date.parse(String(value.updatedAt)) > now + 300_000) errors.push("overlay_template_future_timestamp");
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > OVERLAY_ASSISTANCE_TEMPLATE_MAX_SERIALIZED_BYTES) errors.push("overlay_template_too_large");
  return [...new Set(errors)];
}

function interpolate(value: string | undefined, parameters: Map<string, { value: string; sensitivity: "public" | "private" }>): string | undefined {
  if (value === undefined) return undefined;
  return value.replace(/\{\{([A-Za-z][A-Za-z0-9_]{0,99})\}\}/g, (_match, name: string) => parameters.get(name)?.sensitivity === "private" ? "[redacted]" : parameters.get(name)?.value ?? "[redacted]");
}

export function bindOverlayAssistanceTemplate(template: OverlayAssistanceTemplate, rawParameters: Record<string, unknown> = {}, targetBindings: Record<string, OverlayTargetBinding> = {}, now = Date.now()): { errors: string[]; steps: OverlayAssistanceStep[]; redactionCounts: Record<string, number> } {
  const errors = validateOverlayAssistanceTemplate(template, now);
  const declared = new Map(template.parameters.map((parameter) => [parameter.name, parameter]));
  for (const name of Object.keys(rawParameters)) if (!declared.has(name)) errors.push("overlay_template_unknown_parameter");
  const bound = new Map<string, { value: string; sensitivity: "public" | "private" }>();
  for (const parameter of template.parameters) {
    const raw = rawParameters[parameter.name];
    if (raw === undefined) { if (parameter.required) errors.push("overlay_template_missing_parameter"); continue; }
    if ((parameter.type === "string" && typeof raw !== "string") || (parameter.type === "number" && (typeof raw !== "number" || !Number.isFinite(raw))) || (parameter.type === "boolean" && typeof raw !== "boolean")) errors.push("overlay_template_parameter_type_mismatch");
    if (parameter.sensitivity === "secret") errors.push("overlay_template_secret_parameter_blocked");
    bound.set(parameter.name, { value: String(raw), sensitivity: parameter.sensitivity === "private" ? "private" : "public" });
  }
  const placeholders = new Map((template.targetPlaceholders ?? []).map((placeholder) => [placeholder.placeholderId, placeholder]));
  for (const name of Object.keys(targetBindings)) if (!placeholders.has(name)) errors.push("overlay_template_unknown_target_placeholder");
  for (const placeholder of template.targetPlaceholders ?? []) {
    const binding = targetBindings[placeholder.placeholderId];
    if (binding === undefined) { if (placeholder.required) errors.push("overlay_template_missing_target_binding"); continue; }
    if (binding.kind !== placeholder.bindingType) errors.push("overlay_template_target_binding_kind_mismatch");
    errors.push(...validateOverlayTargetBinding(binding, now));
  }
  const redactionCounts: Record<string, number> = {};
  const steps: OverlayAssistanceStep[] = template.steps.map((step) => {
    const sensitivity = step.sensitivity ?? "public";
    const label = interpolate(step.label, bound);
    const target = step.targetPlaceholderId === undefined ? undefined : targetBindings[step.targetPlaceholderId];
    const primitive = step.primitiveType === undefined ? undefined : { type: step.primitiveType, sensitivity, ...(label === undefined ? {} : { label, text: interpolate(step.description, bound) }), ...(target === undefined ? {} : { target }), ...(step.durationMs === undefined ? {} : { ttlMs: step.durationMs }), ...(step.animation === undefined ? {} : { animation: step.animation }) };
    const widget = step.type === "widget" ? { title: interpolate(step.widgetTitle, bound) ?? label ?? "Visual assistance", sensitivity, components: (step.widgetButtons ?? []).map((button) => ({ type: "button" as const, label: interpolate(button.label, bound) ?? "Continue", event: button.event })), ...(target === undefined ? {} : { target }), ...(step.durationMs === undefined ? {} : { ttlMs: step.durationMs }), ...(step.animation === undefined ? {} : { animation: step.animation }) } : undefined;
    return { stepId: step.stepId, index: step.index, type: step.type, ...(primitive === undefined ? {} : { primitive }), ...(widget === undefined ? {} : { widget }), ...(target === undefined ? {} : { target }), ...(step.requiresEvent === undefined ? {} : { requiresEvent: step.requiresEvent }), ...(step.expectedEvent === undefined ? {} : { expectedEvent: step.expectedEvent }), ...(step.progressGroup === undefined ? {} : { progressGroup: step.progressGroup }), ...(step.warningCodes === undefined ? {} : { warningCodes: step.warningCodes.slice(0, 10) }), ...(step.durationMs === undefined ? {} : { durationMs: step.durationMs }), ...(step.animation === undefined ? {} : { animation: step.animation }) } as OverlayAssistanceStep;
  });
  return { errors: [...new Set(errors)], steps, redactionCounts };
}
