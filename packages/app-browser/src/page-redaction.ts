import { redactSensitiveText } from "@agenthost/core";

const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phone = /\+?[0-9][0-9 ()-]{7,}[0-9]/g;
export function redactBrowserText(input: string): { text: string; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  let text = redactSensitiveText(input);
  text = text.replace(email, () => { counts.email = (counts.email ?? 0) + 1; return "[redacted-email]"; });
  text = text.replace(phone, () => { counts.phone = (counts.phone ?? 0) + 1; return "[redacted-phone]"; });
  return { text: text.replace(/\s+/g, " ").trim(), counts };
}
