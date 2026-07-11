import type { CapabilityGrant, ToolForgeRuntimeCapability, ToolForgeRuntimeOperation } from "./types.js";
import { isGrantExpired } from "./grants.js";

export const PHASE20_SUPPORTED_RUNTIME_CAPABILITIES: ToolForgeRuntimeCapability[] = ["pure_compute", "read_runtime_input", "write_runtime_output", "use_manifest_metadata", "use_registration_metadata"];
export const PHASE20_HARD_LIMITS = { maxInputBytes: 64 * 1024, maxOutputBytes: 64 * 1024, maxRuntimeMs: 5_000 } as const;

export interface RuntimeGrantCoverageInput {
  generatedToolId: string;
  registrationId: string;
  toolName: string;
  capabilities: ToolForgeRuntimeCapability[];
  operations: ToolForgeRuntimeOperation[];
}

export interface RuntimeGrantCoverage {
  grantedCapabilities: ToolForgeRuntimeCapability[];
  deniedCapabilities: ToolForgeRuntimeCapability[];
  activeGrantIds: string[];
  allowedOperations: ToolForgeRuntimeOperation[];
  limits: { maxInputBytes: number; maxOutputBytes: number; maxRuntimeMs: number };
  requiresDryRun: boolean;
  requiresConfirmationToken: boolean;
  requiresApproval: boolean;
}

function matches(values: string[] | undefined, value: string): boolean { return values === undefined || values.length === 0 || values.includes(value); }

function matchesIdentity(grant: CapabilityGrant, input: RuntimeGrantCoverageInput): boolean {
  return matches(grant.match.generatedToolIds, input.generatedToolId) && matches(grant.match.registrationIds, input.registrationId) && matches(grant.match.runtimeToolNames, input.toolName);
}

export function evaluateRuntimeGrantCoverage(input: RuntimeGrantCoverageInput, grants: CapabilityGrant[]): RuntimeGrantCoverage {
  const active = grants.filter((grant) => !isGrantExpired(grant) && matchesIdentity(grant, input));
  const deniedCapabilities = input.capabilities.filter((capability) => active.some((grant) => grant.effect === "deny" && matches(grant.match.runtimeCapabilities, capability)));
  const allow = active.filter((grant) => grant.effect === "allow");
  const grantedCapabilities = input.capabilities.filter((capability) => !deniedCapabilities.includes(capability) && allow.some((grant) => matches(grant.match.runtimeCapabilities, capability)));
  const relevant = allow.filter((grant) => grant.match.runtimeCapabilities !== undefined && grant.match.runtimeCapabilities.some((capability) => input.capabilities.includes(capability)));
  const operationRules = relevant.filter((grant) => grant.requirements?.allowedOperations !== undefined).map((grant) => grant.requirements!.allowedOperations!);
  const allowedOperations = operationRules.length === 0 ? [] : input.operations.filter((operation) => operationRules.some((rule) => rule.includes(operation)));
  const limits: { maxInputBytes: number; maxOutputBytes: number; maxRuntimeMs: number } = { ...PHASE20_HARD_LIMITS };
  for (const grant of relevant) {
    if (grant.requirements?.maxInputBytes !== undefined) limits.maxInputBytes = Math.min(limits.maxInputBytes, grant.requirements.maxInputBytes);
    if (grant.requirements?.maxOutputBytes !== undefined) limits.maxOutputBytes = Math.min(limits.maxOutputBytes, grant.requirements.maxOutputBytes);
    if (grant.requirements?.maxRuntimeMs !== undefined) limits.maxRuntimeMs = Math.min(limits.maxRuntimeMs, grant.requirements.maxRuntimeMs);
  }
  return {
    grantedCapabilities,
    deniedCapabilities,
    activeGrantIds: relevant.map((grant) => grant.id),
    allowedOperations,
    limits,
    requiresDryRun: relevant.some((grant) => grant.requirements?.requiresDryRun === true),
    requiresConfirmationToken: relevant.some((grant) => grant.requirements?.requiresConfirmationToken === true),
    requiresApproval: relevant.some((grant) => grant.requirements?.requiresApproval === true)
  };
}
