const SENSITIVE_KEY_PATTERN =
  /^(api[_-]?key|authorization|auth|cookie|password|passwd|private[_-]?key|refresh[_-]?token|confirmation[_-]?token|secret|token)$/i;

const SENSITIVE_ASSIGNMENT_PATTERN =
  /\b(api[_-]?key|auth|cookie|password|passwd|private[_-]?key|refresh[_-]?token|confirmation[_-]?token|secret|token)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}\]]+)/gi;

const AUTH_HEADER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const PRIVATE_KEY_PATTERN = /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi;
const MAX_REDACTION_DEPTH = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

export function redactSensitiveText(input: string): string {
  return input
    .replace(PRIVATE_KEY_PATTERN, "[redacted-private-key]")
    .replace(AUTH_HEADER_PATTERN, "$1 [redacted]")
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, (_match, key: string, separator: string) => `${key}${separator}[redacted]`);
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return "[redacted-circular]";
  }

  if (depth >= MAX_REDACTION_DEPTH) {
    return "[redacted-depth-limit]";
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1, seen));
  }

  if (!isRecord(value)) {
    return "[redacted-object]";
  }

  const output: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    output[key] = isSensitiveKey(key) ? "[redacted]" : redactValue(nestedValue, depth + 1, seen);
  }

  return output;
}

export function redactForLog(value: unknown): unknown {
  return redactValue(value, 0, new WeakSet<object>());
}
