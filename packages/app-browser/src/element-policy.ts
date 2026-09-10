import type { BrowserElementActionKind } from "@agenthost/core";
export function isSafeCss(value: string): boolean { return value.length <= 256 && !/:has|::|\[.*(?:\^=|\$=|\*=)/.test(value) && !/password|file|hidden/i.test(value); }
/** Compatibility name: only genuinely protected actions are hard-blocked. */
export function isProtectedAction(kind: BrowserElementActionKind): boolean { return ["authentication", "captcha", "password_input", "unknown"].includes(kind); }
export function actionBlocked(kind: BrowserElementActionKind): boolean { return isProtectedAction(kind); }
