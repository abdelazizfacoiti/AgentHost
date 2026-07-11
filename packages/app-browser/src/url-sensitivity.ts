import { classifyAppSensitivity, type AppSensitivity } from "@agenthost/core";

export function sanitizeBrowserUrl(value: string): { url: string; origin: string; redacted: boolean } {
  try { const parsed = new URL(value); const redacted = parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== ""; parsed.username = ""; parsed.password = ""; parsed.search = ""; parsed.hash = ""; return { url: parsed.toString(), origin: parsed.origin, redacted }; } catch { return { url: "about:blank", origin: "null", redacted: true }; }
}
export function browserSensitivity(url: string): AppSensitivity { return classifyAppSensitivity({ url }); }
export function isProtectedBrowserSensitivity(value: AppSensitivity): boolean { return value === "financial" || value === "credential_or_security" || value === "system_settings"; }
