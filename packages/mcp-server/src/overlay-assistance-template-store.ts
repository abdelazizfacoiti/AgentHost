import { chmod, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  bindOverlayAssistanceTemplate,
  OVERLAY_ASSISTANCE_TEMPLATE_MAX_PREVIEW_BYTES,
  redactOverlayText,
  validateOverlayAssistanceTemplate,
  type OverlayAssistanceTemplate,
  type OverlayAssistanceTemplateParameter,
  type OverlayAssistanceTemplateStep,
  type OverlayAssistanceTemplateTargetPlaceholder,
  type OverlayTargetBinding
} from "@agenthost/core";
import type { OverlayAssistanceStore } from "./overlay-assistance-store.js";

const now = () => new Date().toISOString();
const safeId = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 200);
const MAX_TEMPLATES = 100;

function boundedText(value: unknown, max: number, fallback = "[redacted]"): string | undefined {
  if (typeof value !== "string") return value === undefined ? undefined : fallback;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function safeTemplateSummary(template: OverlayAssistanceTemplate): Record<string, unknown> {
  return {
    templateId: template.templateId,
    name: boundedText(template.name, 200) ?? "[redacted]",
    ...(template.description === undefined ? {} : { description: boundedText(template.description, 500) }),
    version: template.version,
    status: template.status,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    ...(template.archivedAt === undefined ? {} : { archivedAt: template.archivedAt }),
    parameterNames: template.parameters.map((parameter) => parameter.name),
    parameterCount: template.parameters.length,
    targetPlaceholderCount: template.targetPlaceholders?.length ?? 0,
    stepCount: template.steps.length,
    stepTypes: template.steps.map((step) => step.type),
    progressGroups: (template.progressGroups ?? []).slice(0, 20),
    warningCount: template.warnings?.length ?? 0,
    hasTerminalInstruction: template.terminalInstruction !== undefined
  };
}

function safeStepSummary(step: OverlayAssistanceTemplateStep): Record<string, unknown> {
  return {
    stepId: step.stepId,
    index: step.index,
    type: step.type,
    ...(step.primitiveType === undefined ? {} : { primitiveType: step.primitiveType }),
    ...(step.label === undefined ? {} : { label: boundedText(step.label, 200) }),
    ...(step.targetPlaceholderId === undefined ? {} : { targetPlaceholderId: step.targetPlaceholderId }),
    ...(step.requiresTarget === undefined ? {} : { requiresTarget: step.requiresTarget }),
    ...(step.expectedEvent === undefined ? {} : { expectedEvent: step.expectedEvent }),
    ...(step.requiresEvent === undefined ? {} : { requiresEvent: step.requiresEvent }),
    ...(step.progressGroup === undefined ? {} : { progressGroup: boundedText(step.progressGroup, 100) }),
    warningCodes: (step.warningCodes ?? []).slice(0, 10)
  };
}

function safeBoundStepSummary(step: import("@agenthost/core").OverlayAssistanceStep): Record<string, unknown> {
  const rawLabel = step.primitive?.label ?? step.primitive?.text ?? step.widget?.title;
  const label = rawLabel === undefined ? undefined : (step.primitive?.sensitivity ?? step.widget?.sensitivity) === "private" ? "[redacted-private]" : redactOverlayText(rawLabel, "public").redactedText ?? "[redacted]";
  return {
    stepId: step.stepId,
    index: step.index,
    type: step.type,
    ...(step.primitive?.type === undefined ? {} : { primitiveType: step.primitive.type }),
    ...(label === undefined ? {} : { label: boundedText(label, 200) }),
    ...(step.requiresTarget === undefined ? {} : { requiresTarget: step.requiresTarget }),
    ...(step.expectedEvent === undefined ? {} : { expectedEvent: step.expectedEvent }),
    ...(step.requiresEvent === undefined ? {} : { requiresEvent: step.requiresEvent }),
    ...(step.progressGroup === undefined ? {} : { progressGroup: boundedText(step.progressGroup, 100) }),
    warningCodes: (step.warningCodes ?? []).slice(0, 10)
  };
}

export class OverlayAssistanceTemplateStore {
  readonly #dir: string;
  readonly #ownerSessionId: string;
  readonly #assistance: OverlayAssistanceStore;
  readonly #templates = new Map<string, OverlayAssistanceTemplate>();

  constructor(agentHostDir: string, ownerSessionId: string, assistance: OverlayAssistanceStore) {
    this.#dir = path.join(agentHostDir, "overlays", "assistance-templates");
    this.#ownerSessionId = ownerSessionId;
    this.#assistance = assistance;
  }

  async ensureStructure(): Promise<void> { await mkdir(this.#dir, { recursive: true, mode: 0o700 }); }

  validate(raw: unknown): Record<string, unknown> {
    this.#assertNoOwnerField(raw);
    const template = this.#normalize(raw);
    const errors = [...this.#shapeErrors(raw), ...validateOverlayAssistanceTemplate(template)];
    return { valid: errors.length === 0, errors: [...new Set(errors)], template: this.#previewTemplateMetadata(template) };
  }

  preview(raw: unknown, parameters: Record<string, unknown> = {}, targetBindings: Record<string, OverlayTargetBinding> = {}): Record<string, unknown> {
    this.#assertNoOwnerField(raw);
    const template = this.#normalize(raw);
    const bound = bindOverlayAssistanceTemplate(template, parameters, targetBindings);
    bound.errors.push(...this.#shapeErrors(raw));
    const steps = bound.steps.map(safeBoundStepSummary);
    const payload = { valid: bound.errors.length === 0, template: this.#previewTemplateMetadata(template), steps, blockers: [...new Set(bound.errors)].slice(0, 30), execution: { actionsExecuted: false, rendered: false, confirmationTokensCreated: false, grantsCreated: false } };
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > OVERLAY_ASSISTANCE_TEMPLATE_MAX_PREVIEW_BYTES) throw new Error("overlay_template_preview_too_large");
    return payload;
  }

  async save(raw: unknown): Promise<Record<string, unknown>> {
    await this.ensureStructure();
    this.#assertNoOwnerField(raw);
    const incoming = this.#normalize(raw);
    const existing = this.#templates.get(incoming.templateId) ?? await this.#load(incoming.templateId);
    if (existing !== undefined && existing.ownerSessionId !== this.#ownerSessionId) throw new Error("overlay_template_not_found");
    if (existing?.status === "archived") throw new Error("overlay_template_archived");
    const timestamp = now();
    const template: OverlayAssistanceTemplate = this.#sanitize({ ...incoming, ownerSessionId: this.#ownerSessionId, status: "draft", version: existing === undefined ? 1 : existing.version + 1, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp });
    const errors = [...this.#shapeErrors(raw), ...validateOverlayAssistanceTemplate(template)];
    if (errors.length > 0) throw new Error(errors[0]);
    if (!existing && (await this.#count()) >= MAX_TEMPLATES) throw new Error("overlay_template_limit_reached");
    this.#templates.set(template.templateId, template); await this.#persist(template);
    return safeTemplateSummary(template);
  }

  async get(templateId: string): Promise<Record<string, unknown>> {
    const template = await this.#owned(templateId);
    return { ...safeTemplateSummary(template), steps: template.steps.map(safeStepSummary), parameters: template.parameters.map((parameter) => ({ name: parameter.name, type: parameter.type, required: parameter.required, sensitivity: parameter.sensitivity })), targetPlaceholders: (template.targetPlaceholders ?? []).map((placeholder) => ({ placeholderId: placeholder.placeholderId, bindingType: placeholder.bindingType, required: placeholder.required, sensitivity: placeholder.sensitivity })) };
  }

  async list(limit = 50): Promise<Record<string, unknown>[]> {
    await this.#loadAll();
    return [...this.#templates.values()].filter((template) => template.ownerSessionId === this.#ownerSessionId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, Math.min(50, Math.max(1, limit))).map(safeTemplateSummary);
  }

  async archive(templateId: string): Promise<Record<string, unknown>> {
    const template = await this.#owned(templateId);
    if (template.status === "archived") return safeTemplateSummary(template);
    template.status = "archived"; template.archivedAt = now(); template.updatedAt = template.archivedAt;
    await this.#persist(template); return safeTemplateSummary(template);
  }

  async instantiate(templateId: string, parameters: Record<string, unknown> = {}, targetBindings: Record<string, OverlayTargetBinding> = {}, allowPrivate = false): Promise<Record<string, unknown>> {
    const template = await this.#owned(templateId);
    if (template.status === "archived") throw new Error("overlay_template_archived");
    const bound = bindOverlayAssistanceTemplate(template, parameters, targetBindings);
    if (bound.errors.length > 0) throw new Error(bound.errors[0]);
    const privateRequested = template.parameters.some((parameter) => parameter.sensitivity === "private" && parameters[parameter.name] !== undefined) || template.steps.some((step) => step.sensitivity === "private");
    if (privateRequested && !allowPrivate) throw new Error("overlay_template_private_grant_required");
    const session = await this.#assistance.create({ name: template.name, steps: bound.steps, allowPrivate });
    return { templateId: template.templateId, templateVersion: template.version, session, execution: { draftOnly: true, started: false, rendered: false, confirmationTokensCreated: false, grantsCreated: false } };
  }

  #normalize(raw: unknown): OverlayAssistanceTemplate {
    const value = raw !== null && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const timestamp = now();
    return {
      templateId: typeof value.templateId === "string" && value.templateId.length > 0 ? value.templateId : `template_${randomUUID()}`,
      ownerSessionId: this.#ownerSessionId,
      name: typeof value.name === "string" ? value.name : "",
      ...(typeof value.description === "string" ? { description: value.description } : {}),
      version: Number.isInteger(value.version) && Number(value.version) > 0 ? Number(value.version) : 1,
      parameters: (Array.isArray(value.parameters) ? value.parameters : []) as OverlayAssistanceTemplateParameter[],
      targetPlaceholders: (Array.isArray(value.targetPlaceholders) ? value.targetPlaceholders : []) as OverlayAssistanceTemplateTargetPlaceholder[],
      steps: (Array.isArray(value.steps) ? value.steps : []) as OverlayAssistanceTemplateStep[],
      progressGroups: (Array.isArray(value.progressGroups) ? value.progressGroups : []) as string[],
      warnings: (Array.isArray(value.warnings) ? value.warnings : []) as string[],
      ...(typeof value.terminalInstruction === "string" ? { terminalInstruction: value.terminalInstruction } : {}),
      status: value.status === "active" || value.status === "archived" ? value.status : "draft",
      createdAt: typeof value.createdAt === "string" ? value.createdAt : timestamp,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : timestamp,
      ...(typeof value.archivedAt === "string" ? { archivedAt: value.archivedAt } : {})
    };
  }

  #assertNoOwnerField(raw: unknown): void {
    if (raw !== null && typeof raw === "object" && Object.prototype.hasOwnProperty.call(raw, "ownerSessionId")) throw new Error("overlay_template_owner_input_forbidden");
  }

  #shapeErrors(raw: unknown): string[] {
    if (raw === null || typeof raw !== "object") return ["overlay_template_invalid"];
    const value = raw as Record<string, unknown>;
    const errors: string[] = [];
    const allowed = new Set(["templateId", "name", "description", "version", "parameters", "targetPlaceholders", "steps", "progressGroups", "warnings", "terminalInstruction", "status", "createdAt", "updatedAt", "archivedAt"]);
    for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push("overlay_template_unknown_field");
    for (const key of ["parameters", "targetPlaceholders", "steps", "progressGroups", "warnings"]) if (value[key] !== undefined && !Array.isArray(value[key])) errors.push(`overlay_template_${key}_invalid`);
    for (const key of ["templateId", "name", "description", "terminalInstruction", "status", "createdAt", "updatedAt", "archivedAt"]) if (value[key] !== undefined && typeof value[key] !== "string") errors.push(`overlay_template_${key}_invalid`);
    if (value.version !== undefined && (!Number.isInteger(value.version) || Number(value.version) < 1)) errors.push("overlay_template_version_invalid");
    return errors;
  }

  #previewTemplateMetadata(template: OverlayAssistanceTemplate): Record<string, unknown> { return { templateId: template.templateId, version: template.version, status: template.status, stepCount: template.steps.length, parameterNames: template.parameters.map((parameter) => parameter.name), targetPlaceholderCount: template.targetPlaceholders?.length ?? 0 }; }

  #sanitize(template: OverlayAssistanceTemplate): OverlayAssistanceTemplate {
    const sanitize = (value: string | undefined, sensitivity: "public" | "private" | "secret" = "public"): string | undefined => {
      if (value === undefined) return undefined;
      if (sensitivity === "secret") return "[redacted]";
      if (sensitivity === "private" && !value.includes("{{")) return "[redacted-private]";
      const bounded = boundedText(value, 1_000, "[redacted]") ?? "[redacted]";
      const checked = redactOverlayText(bounded, sensitivity === "private" ? "private" : "public");
      return checked.ok ? checked.redactedText ?? "[redacted]" : "[redacted]";
    };
    const result: OverlayAssistanceTemplate = {
      ...template,
      name: (() => { const value = sanitize(template.name) ?? "[redacted]"; const checked = redactOverlayText(value, "public"); return checked.ok ? checked.redactedText ?? "[redacted]" : "[redacted]"; })(),
      steps: template.steps.map((step) => {
        const sanitized: OverlayAssistanceTemplateStep = { ...step };
        const label = sanitize(step.label, step.sensitivity); if (label !== undefined) sanitized.label = label;
        const description = sanitize(step.description, step.sensitivity); if (description !== undefined) sanitized.description = description;
        const widgetTitle = sanitize(step.widgetTitle, step.sensitivity); if (widgetTitle !== undefined) sanitized.widgetTitle = widgetTitle;
        if (step.widgetButtons !== undefined) sanitized.widgetButtons = step.widgetButtons.map((button) => ({ ...button, label: sanitize(button.label, step.sensitivity) ?? "[redacted]" }));
        return sanitized;
      }),
    };
    const description = sanitize(template.description); if (description !== undefined) result.description = description;
    if (template.warnings !== undefined) result.warnings = template.warnings.map((warning) => sanitize(warning) ?? "[redacted]");
    const terminalInstruction = sanitize(template.terminalInstruction); if (terminalInstruction !== undefined) result.terminalInstruction = terminalInstruction;
    return result;
  }

  async #owned(templateId: string): Promise<OverlayAssistanceTemplate> {
    const template = this.#templates.get(templateId) ?? await this.#load(templateId);
    if (template === undefined || template.ownerSessionId !== this.#ownerSessionId) throw new Error("overlay_template_not_found");
    this.#templates.set(template.templateId, template); return template;
  }
  async #load(templateId: string): Promise<OverlayAssistanceTemplate | undefined> { try { const value = JSON.parse(await readFile(this.#file(templateId), "utf8")) as OverlayAssistanceTemplate; return validateOverlayAssistanceTemplate(value).length > 0 ? undefined : value; } catch { return undefined; } }
  async #loadAll(): Promise<void> { const entries = await readdir(this.#dir, { withFileTypes: true }).catch(() => []); for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json"))) { try { const value = JSON.parse(await readFile(path.join(this.#dir, entry.name), "utf8")) as OverlayAssistanceTemplate; if (value.ownerSessionId === this.#ownerSessionId && validateOverlayAssistanceTemplate(value).length === 0) this.#templates.set(value.templateId, value); } catch { /* ignore malformed local records */ } } }
  async #count(): Promise<number> { await this.#loadAll(); return [...this.#templates.values()].filter((template) => template.ownerSessionId === this.#ownerSessionId && template.status !== "archived").length; }
  async #persist(template: OverlayAssistanceTemplate): Promise<void> { await mkdir(this.#dir, { recursive: true, mode: 0o700 }); const file = this.#file(template.templateId); const temporary = `${file}.${randomUUID()}.tmp`; await writeFile(temporary, `${JSON.stringify(template, null, 2)}\n`, { mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, file); }
  #file(templateId: string): string { return path.join(this.#dir, `${safeId(templateId)}.json`); }
}
