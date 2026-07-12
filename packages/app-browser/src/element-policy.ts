import type { BrowserElementActionKind } from "@agenthost/core";
export function isSafeCss(value: string): boolean { return value.length <= 256 && !/[,:]|:has|:not|::|\[.*(?:\^=|\$=|\*=)/.test(value) && !/password|file|hidden/i.test(value); }
export function actionBlocked(kind: BrowserElementActionKind): boolean { return ["form_submit","communication_send","upload","destructive","financial","authentication","captcha","password_input","unknown"].includes(kind); }
