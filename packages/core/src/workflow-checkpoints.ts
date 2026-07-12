import { checkpointStrategy } from "./checkpoint.js";
import type { Checkpoint, WorkflowCheckpointTemplate, WorkflowSkillParameter } from "./types.js";

const PARAMETER_NAME = /^[A-Za-z][A-Za-z0-9_]{0,99}$/;
const INTERPOLATION = /{{([^{}]+)}}/g;
const MAX_DEPTH = 12;
const MAX_ITEMS = 200;
const MAX_SERIALIZED_BYTES = 32_000;

export interface ResolvedSkillCheckpoint {
  template: WorkflowCheckpointTemplate;
  checkpoint: Checkpoint;
}

function fail(code: string): never { throw new Error(code); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

function validateValue(value: unknown, declarations: Map<string, WorkflowSkillParameter>, depth = 0, count = { value: 0 }): void {
  if (depth > MAX_DEPTH) fail("checkpoint_template_too_deep");
  count.value += 1;
  if (count.value > MAX_ITEMS) fail("checkpoint_template_too_large");
  if (typeof value === "string") {
    for (const match of value.matchAll(INTERPOLATION)) {
      const name = (match[1] ?? "").trim();
      if (!PARAMETER_NAME.test(name) || !declarations.has(name)) fail("checkpoint_template_invalid_interpolation");
    }
    if (value.includes("{{") || value.includes("}}")) {
      const stripped = value.replace(INTERPOLATION, "");
      if (stripped.includes("{{") || stripped.includes("}}")) fail("checkpoint_template_invalid_interpolation");
    }
    return;
  }
  if (Array.isArray(value)) { for (const item of value) validateValue(item, declarations, depth + 1, count); return; }
  if (isRecord(value)) { for (const item of Object.values(value)) validateValue(item, declarations, depth + 1, count); }
}

function hasPrivateLiteral(value: unknown): boolean {
  if (typeof value === "string") return value.replace(INTERPOLATION, "").trim().length > 0;
  if (Array.isArray(value)) return value.some(hasPrivateLiteral);
  return isRecord(value) && Object.values(value).some(hasPrivateLiteral);
}

export function validateWorkflowCheckpointTemplate(template: WorkflowCheckpointTemplate, parameters: WorkflowSkillParameter[]): void {
  const declarations = new Map(parameters.map((parameter) => [parameter.name, parameter]));
  if (!PARAMETER_NAME.test(template.templateId) || !template.name.trim() || !template.description.trim()) fail("checkpoint_template_invalid");
  if (checkpointStrategy(template.kind) !== template.strategy) fail("checkpoint_template_strategy_mismatch");
  if (new Set(template.parameters).size !== template.parameters.length || template.parameters.some((name) => !declarations.has(name))) fail("checkpoint_template_unknown_parameter");
  if (new Set(template.requiredGrants).size !== template.requiredGrants.length) fail("checkpoint_template_duplicate_grant");
  validateValue(template.expectedTemplate, declarations);
  if (template.sensitivity !== "public" && hasPrivateLiteral(template.expectedTemplate)) fail("checkpoint_template_private_literal_blocked");
  const referenced = new Set<string>();
  JSON.stringify(template.expectedTemplate).replace(INTERPOLATION, (_match, rawName: string) => { referenced.add(rawName.trim()); return ""; });
  if ([...referenced].some((name) => !template.parameters.includes(name))) fail("checkpoint_template_parameter_not_declared");
  if (Buffer.byteLength(JSON.stringify(template.expectedTemplate), "utf8") > MAX_SERIALIZED_BYTES) fail("checkpoint_template_too_large");
}

function typeMatches(value: unknown, type: WorkflowSkillParameter["type"]): boolean {
  return type === "json" || (type === "string" && typeof value === "string") || (type === "number" && typeof value === "number" && Number.isFinite(value)) || (type === "boolean" && typeof value === "boolean");
}

function interpolate(value: unknown, declarations: Map<string, WorkflowSkillParameter>, bindings: Record<string, unknown>, depth = 0): unknown {
  if (depth > MAX_DEPTH) fail("checkpoint_template_too_deep");
  if (typeof value === "string") return value.replace(INTERPOLATION, (_all, rawName: string) => {
    const name = rawName.trim(); const parameter = declarations.get(name);
    if (parameter === undefined || !(name in bindings)) fail("checkpoint_parameter_missing");
    const bound = bindings[name];
    if (!typeMatches(bound, parameter.type)) fail("checkpoint_parameter_type_invalid");
    return typeof bound === "string" ? bound : JSON.stringify(bound);
  });
  if (Array.isArray(value)) return value.map((item) => interpolate(item, declarations, bindings, depth + 1));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item, declarations, bindings, depth + 1)]));
  return value;
}

export function resolveWorkflowCheckpointTemplates(input: { templates: WorkflowCheckpointTemplate[]; parameters: WorkflowSkillParameter[]; bindings: Record<string, unknown> }): ResolvedSkillCheckpoint[] {
  const declarations = new Map(input.parameters.map((parameter) => [parameter.name, parameter]));
  for (const name of Object.keys(input.bindings)) if (!declarations.has(name)) fail("checkpoint_parameter_unknown");
  for (const parameter of input.parameters) if (parameter.required && !(parameter.name in input.bindings)) fail("checkpoint_parameter_missing");
  return input.templates.map((template) => {
    validateWorkflowCheckpointTemplate(template, input.parameters);
    for (const name of template.parameters) if (!(name in input.bindings)) fail("checkpoint_parameter_missing");
    return { template, checkpoint: { checkpointId: template.templateId, kind: template.kind, description: template.description, sensitivity: template.sensitivity, expected: interpolate(template.expectedTemplate, declarations, input.bindings) as Record<string, unknown>, ...(template.timeoutMs === undefined ? {} : { timeoutMs: template.timeoutMs }), ...(template.pollIntervalMs === undefined ? {} : { pollIntervalMs: template.pollIntervalMs }) } };
  });
}

export function checkpointTemplateSummary(template: WorkflowCheckpointTemplate, blockedReasons: string[] = []): { templateId: string; kind: WorkflowCheckpointTemplate["kind"]; strategy: WorkflowCheckpointTemplate["strategy"]; sensitivity: WorkflowCheckpointTemplate["sensitivity"]; requiredGrants: string[]; parameterNames: string[]; expectedFields: string[]; blocked: boolean; blockedReasons: string[]; redacted: true } {
  return { templateId: template.templateId, kind: template.kind, strategy: template.strategy, sensitivity: template.sensitivity, requiredGrants: [...template.requiredGrants], parameterNames: [...template.parameters], expectedFields: Object.keys(template.expectedTemplate), blocked: blockedReasons.length > 0, blockedReasons, redacted: true };
}
