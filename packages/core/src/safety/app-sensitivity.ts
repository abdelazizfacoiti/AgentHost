import type { AppSensitivity, SafetyInput } from "../types.js";

const COMMUNICATION_PATTERNS = [
  /\bgmail\b/i,
  /\boutlook\b/i,
  /\bslack\b/i,
  /\bdiscord\b/i,
  /\bwhatsapp\b/i,
  /\btelegram\b/i,
  /\bsignal\b/i,
  /\bteams\b/i,
  /\bemail\b/i,
  /\bmail\b/i
];

const FINANCIAL_PATTERNS = [
  /\bbank/i,
  /\bcheckout\b/i,
  /\bpayment\b/i,
  /\bpaypal\b/i,
  /\bstripe\b/i,
  /\bcrypto\b/i,
  /\bwallet\b/i,
  /\bcoinbase\b/i,
  /\bbinance\b/i,
  /\bkraken\b/i,
  /\bmetamask\b/i,
  /\bledger\b/i,
  /\btrezor\b/i
];

const CREDENTIAL_OR_SECURITY_PATTERNS = [
  /\b1password\b/i,
  /\bbitwarden\b/i,
  /\bkeepass\b/i,
  /\blastpass\b/i,
  /\bpassword\b/i,
  /\bsecret\b/i,
  /\bcredential\b/i,
  /\bkeyring\b/i,
  /\bseahorse\b/i,
  /\bssh\b/i,
  /\bgnupg\b/i,
  /\bgpg\b/i,
  /\bsecurity\b/i,
  /\bauthenticator\b/i
];

const SYSTEM_SETTINGS_PATTERNS = [
  /\bsettings\b/i,
  /\bcontrol panel\b/i,
  /\bgnome-control-center\b/i,
  /\bsystem preferences\b/i,
  /\bdconf\b/i,
  /\bgsettings\b/i,
  /\bnetworkmanager\b/i,
  /\bpackage manager\b/i,
  /\bsoftware updater\b/i
];

const URL_SECURITY_PATTERNS = [/\/login\b/i, /\/signin\b/i, /\/mfa\b/i, /\/2fa\b/i, /\/security\b/i, /\/admin\b/i, /\/console\b/i];

const NORMAL_APP_PATTERNS = [
  /\bblender\b/i,
  /\bgimp\b/i,
  /\blibreoffice\b/i,
  /\bwriter\b/i,
  /\bcalc\b/i,
  /\bcode\b/i,
  /\bvscode\b/i,
  /\bvisual studio code\b/i,
  /\bterminal\b/i
];

function combinedInput(input: Pick<SafetyInput, "appId" | "appName" | "url">): string {
  return [input.appId, input.appName, input.url].filter((value): value is string => typeof value === "string").join(" ");
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

export function classifyAppSensitivity(input: Pick<SafetyInput, "appId" | "appName" | "url">): AppSensitivity {
  const value = combinedInput(input);

  if (value.trim().length === 0) {
    return "unknown";
  }

  if (matchesAny(value, CREDENTIAL_OR_SECURITY_PATTERNS)) {
    return "credential_or_security";
  }

  if (matchesAny(value, URL_SECURITY_PATTERNS)) return "credential_or_security";

  if (matchesAny(value, FINANCIAL_PATTERNS)) {
    return "financial";
  }

  if (matchesAny(value, COMMUNICATION_PATTERNS)) {
    return "communication";
  }

  if (matchesAny(value, SYSTEM_SETTINGS_PATTERNS)) {
    return "system_settings";
  }

  if (matchesAny(value, NORMAL_APP_PATTERNS)) {
    return "normal";
  }

  return "unknown";
}
