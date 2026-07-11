export const FORGE_HANDLER_SCHEMA_VERSION = "agenthost.forge.handler.v1";
export const FORGE_HANDLER_BYTES_MAX = 64 * 1024;
export const FORGE_JSON_BYTES_MAX = 64 * 1024;
const MAX_DEPTH = 32;
const MAX_NODES = 256;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface Program {
  schemaVersion: typeof FORGE_HANDLER_SCHEMA_VERSION;
  tools: Record<string, Expression>;
}

type Expression =
  | { op: "const"; value: JsonValue }
  | { op: "input"; pointer?: string }
  | { op: "object"; entries: Record<string, Expression> }
  | { op: "array"; items: Expression[] }
  | { op: "concat"; values: Expression[] }
  | { op: "length"; value: Expression };

export class ForgeProgramError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export function parseJsonValue(raw: string, maxBytes = FORGE_JSON_BYTES_MAX): JsonValue {
  if (Buffer.byteLength(raw, "utf8") > maxBytes) throw new ForgeProgramError("json_too_large", "JSON payload exceeds sandbox size limit.");
  try {
    return assertJson(JSON.parse(raw) as unknown);
  } catch (error) {
    if (error instanceof ForgeProgramError) throw error;
    throw new ForgeProgramError("invalid_json", "JSON payload is invalid.");
  }
}

export function parseProgram(raw: string): Program {
  if (Buffer.byteLength(raw, "utf8") > FORGE_HANDLER_BYTES_MAX) throw new ForgeProgramError("handler_too_large", "Handler exceeds sandbox size limit.");
  const value = parseJsonValue(raw, FORGE_HANDLER_BYTES_MAX);
  if (!isObject(value) || value.schemaVersion !== FORGE_HANDLER_SCHEMA_VERSION || !isObject(value.tools)) {
    throw new ForgeProgramError("handler_invalid", "Handler must contain approved schemaVersion and tools object.");
  }
  const tools: Record<string, Expression> = {};
  for (const [name, expression] of Object.entries(value.tools)) tools[name] = parseExpression(expression, 0, { count: 0 });
  return { schemaVersion: FORGE_HANDLER_SCHEMA_VERSION, tools };
}

export function evaluateProgram(program: Program, toolName: string, input: JsonValue): JsonValue {
  const expression = program.tools[toolName];
  if (expression === undefined) throw new ForgeProgramError("tool_not_found", "Handler does not declare requested tool.");
  return evaluate(expression, input);
}

export function validateSchema(schema: unknown, value: JsonValue): void {
  validateSchemaNode(schema, value, "$");
}

function assertJson(value: unknown): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ForgeProgramError("invalid_json_value", "JSON number must be finite.");
    return value;
  }
  if (Array.isArray(value)) return value.map(assertJson);
  if (isObject(value)) {
    const result: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value)) result[key] = assertJson(child);
    return result;
  }
  throw new ForgeProgramError("invalid_json_value", "Value is not JSON serializable.");
}

function parseExpression(value: JsonValue, depth: number, state: { count: number }): Expression {
  if (++state.count > MAX_NODES || depth > MAX_DEPTH || !isObject(value) || typeof value.op !== "string") {
    throw new ForgeProgramError("handler_invalid", "Handler expression exceeds limits or has invalid shape.");
  }
  switch (value.op) {
    case "const": { const literal = value["value"]; if (literal === undefined) throw new ForgeProgramError("handler_invalid", "const must contain value."); return { op: "const", value: assertJson(literal) }; }
    case "input":
      if (value.pointer !== undefined && typeof value.pointer !== "string") throw new ForgeProgramError("handler_invalid", "Input pointer must be string.");
      return { op: "input", ...(typeof value.pointer === "string" ? { pointer: value.pointer } : {}) };
    case "object": {
      if (!isObject(value.entries) || Object.keys(value.entries).length > 128) throw new ForgeProgramError("handler_invalid", "Object expression entries invalid.");
      const entries: Record<string, Expression> = {};
      for (const [key, child] of Object.entries(value.entries)) entries[key] = parseExpression(child, depth + 1, state);
      return { op: "object", entries };
    }
    case "array":
    case "concat": {
      if (!Array.isArray(value.items ?? value.values)) throw new ForgeProgramError("handler_invalid", "Array expression values invalid.");
      const source = (value.items ?? value.values) as JsonValue[];
      if (source.length > 128) throw new ForgeProgramError("handler_invalid", "Array expression too large.");
      const values = source.map((child) => parseExpression(child, depth + 1, state));
      return value.op === "array" ? { op: "array", items: values } : { op: "concat", values };
    }
    case "length": { const child = value["value"]; if (child === undefined) throw new ForgeProgramError("handler_invalid", "length must contain value."); return { op: "length", value: parseExpression(child, depth + 1, state) }; }
    default: throw new ForgeProgramError("handler_invalid", "Handler contains unsupported operation.");
  }
}

function evaluate(expression: Expression, input: JsonValue): JsonValue {
  switch (expression.op) {
    case "const": return expression.value;
    case "input": return expression.pointer === undefined ? input : pointer(input, expression.pointer);
    case "object": return Object.fromEntries(Object.entries(expression.entries).map(([key, value]) => [key, evaluate(value, input)]));
    case "array": return expression.items.map((value) => evaluate(value, input));
    case "concat": return expression.values.map((value) => evaluate(value, input)).map((value) => typeof value === "string" ? value : (() => { throw new ForgeProgramError("handler_type_error", "concat accepts strings only."); })()).join("");
    case "length": { const value = evaluate(expression.value, input); if (typeof value !== "string" && !Array.isArray(value)) throw new ForgeProgramError("handler_type_error", "length accepts string or array only."); return value.length; }
  }
}

function pointer(value: JsonValue, raw: string): JsonValue {
  if (raw === "") return value;
  if (!raw.startsWith("/")) throw new ForgeProgramError("handler_invalid", "Input pointer must be RFC 6901 pointer.");
  let current: JsonValue = value;
  for (const segment of raw.slice(1).split("/").map((entry) => entry.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    if (Array.isArray(current) && /^0$|^[1-9]\d*$/.test(segment) && Number(segment) < current.length) current = current[Number(segment)]!;
    else if (isObject(current) && Object.prototype.hasOwnProperty.call(current, segment)) current = current[segment]!;
    else throw new ForgeProgramError("input_pointer_missing", "Input pointer does not exist.");
  }
  return current;
}

function validateSchemaNode(schema: unknown, value: JsonValue, at: string): void {
  if (schema === undefined || schema === true) return;
  if (schema === false || !isObject(schema)) throw new ForgeProgramError("schema_unsupported", "Schema must be supported JSON Schema object.");
  const allowed = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "const", "minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems"]);
  if (Object.keys(schema).some((key) => !allowed.has(key))) throw new ForgeProgramError("schema_unsupported", "Schema contains unsupported keyword.");
  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) throw new ForgeProgramError("schema_invalid", `${at} must match const.`);
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => JSON.stringify(entry) === JSON.stringify(value))) throw new ForgeProgramError("schema_invalid", `${at} must match enum.`);
  if (typeof schema.type === "string" && !matchesType(schema.type, value)) throw new ForgeProgramError("schema_invalid", `${at} has wrong type.`);
  if (typeof value === "string") { if (typeof schema.minLength === "number" && value.length < schema.minLength) throw new ForgeProgramError("schema_invalid", `${at} too short.`); if (typeof schema.maxLength === "number" && value.length > schema.maxLength) throw new ForgeProgramError("schema_invalid", `${at} too long.`); }
  if (typeof value === "number") { if (typeof schema.minimum === "number" && value < schema.minimum) throw new ForgeProgramError("schema_invalid", `${at} below minimum.`); if (typeof schema.maximum === "number" && value > schema.maximum) throw new ForgeProgramError("schema_invalid", `${at} above maximum.`); }
  if (Array.isArray(value)) { if (typeof schema.minItems === "number" && value.length < schema.minItems) throw new ForgeProgramError("schema_invalid", `${at} too short.`); if (typeof schema.maxItems === "number" && value.length > schema.maxItems) throw new ForgeProgramError("schema_invalid", `${at} too long.`); if (schema.items !== undefined) value.forEach((entry, index) => validateSchemaNode(schema.items, entry, `${at}[${index}]`)); }
  if (isObject(value)) { const props = isObject(schema.properties) ? schema.properties : {}; const required = Array.isArray(schema.required) ? schema.required : []; for (const key of required) if (typeof key !== "string" || !(key in value)) throw new ForgeProgramError("schema_invalid", `${at}.${String(key)} required.`); for (const [key, entry] of Object.entries(value)) { if (key in props) validateSchemaNode(props[key], entry, `${at}.${key}`); else if (schema.additionalProperties === false) throw new ForgeProgramError("schema_invalid", `${at}.${key} not allowed.`); } }
}

function matchesType(type: string, value: JsonValue): boolean { return type === "null" ? value === null : type === "array" ? Array.isArray(value) : type === "object" ? isObject(value) : type === "integer" ? typeof value === "number" && Number.isInteger(value) : typeof value === type; }
function isObject(value: unknown): value is Record<string, JsonValue> { return typeof value === "object" && value !== null && !Array.isArray(value); }
