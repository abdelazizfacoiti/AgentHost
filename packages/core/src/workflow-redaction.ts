import { redactSensitiveText } from "./safety/redaction.js";

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<!\w)(?:\+?\d[\d(). -]{7,}\d)(?!\w)/g;
const URL_CREDENTIALS_OR_QUERY = /\bhttps?:\/\/([^\s/@]+(?::[^\s/@]+)?@)?([^\s/?#]+)(?:\/[^\s?#]*)?(?:\?[^\s#]*)?(?:#[^\s]*)?/gi;
const ABSOLUTE_PATH = /(?:^|\s)(?:~\/|\/[A-Za-z0-9._-]+\/)[^\s,;]*/g;
const MAX = 500;

/** Redaction stricter than audit logging: traces never keep content or user paths. */
export function redactWorkflowSummary(value: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  const redacted = redactSensitiveText(normalized)
    .replace(URL_CREDENTIALS_OR_QUERY, (_match, _credentials: string | undefined, host: string) => `https://${host}/[redacted-path]`)
    .replace(EMAIL, "[redacted-email]")
    .replace(PHONE, "[redacted-phone]")
    .replace(ABSOLUTE_PATH, " [redacted-path]");
  return redacted.length <= MAX ? redacted : `${redacted.slice(0, MAX)}…`;
}

export function workflowValueSummary(value: unknown): string {
  if (typeof value === "string") return `[redacted-value length=${value.length}]`;
  return "[redacted-value]";
}
