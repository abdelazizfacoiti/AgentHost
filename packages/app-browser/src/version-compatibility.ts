export const BROWSER_BRIDGE_PROTOCOL_VERSION = 1;
export const MIN_EXTENSION_VERSION = "0.1.0";
export const MAX_EXTENSION_VERSION_EXCLUSIVE = "1.0.0";

function parse(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compare(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index]! !== right[index]!) return left[index]! - right[index]!;
  }
  return 0;
}

export function extensionVersionCompatible(version: string): boolean {
  const value = parse(version);
  const minimum = parse(MIN_EXTENSION_VERSION)!;
  const maximum = parse(MAX_EXTENSION_VERSION_EXCLUSIVE)!;
  return value !== undefined && compare(value, minimum) >= 0 && compare(value, maximum) < 0;
}

export function browserCompatibilitySummary(agentHostVersion: string) {
  return {
    agentHostVersion,
    protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
    extensionRange: `>=${MIN_EXTENSION_VERSION} <${MAX_EXTENSION_VERSION_EXCLUSIVE}`
  };
}
