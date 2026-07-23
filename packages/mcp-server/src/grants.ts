import { summarizeGrant, type CapabilityGrant, type GrantSummary } from "@agenthost/core";
import type { AgentHostMcpContext } from "./context.js";

function cloneGrant(grant: CapabilityGrant): CapabilityGrant {
  return {
    ...grant,
    match: {
      ...grant.match,
      ...(grant.match.tools === undefined ? {} : { tools: [...grant.match.tools] }),
      ...(grant.match.strategies === undefined ? {} : { strategies: [...grant.match.strategies] }),
      ...(grant.match.actionTypes === undefined ? {} : { actionTypes: [...grant.match.actionTypes] }),
      ...(grant.match.appNames === undefined ? {} : { appNames: [...grant.match.appNames] }),
      ...(grant.match.appIds === undefined ? {} : { appIds: [...grant.match.appIds] }),
      ...(grant.match.appSensitivities === undefined ? {} : { appSensitivities: [...grant.match.appSensitivities] }),
      ...(grant.match.dataSensitivities === undefined ? {} : { dataSensitivities: [...grant.match.dataSensitivities] }),
      ...(grant.match.fileRoots === undefined ? {} : { fileRoots: [...grant.match.fileRoots] }),
      ...(grant.match.commandAllowlist === undefined ? {} : { commandAllowlist: [...grant.match.commandAllowlist] }),
      ...(grant.match.networkDomains === undefined ? {} : { networkDomains: [...grant.match.networkDomains] }),
      ...(grant.match.oauthScopes === undefined ? {} : { oauthScopes: [...grant.match.oauthScopes] }),
      ...(grant.match.generatedToolIds === undefined
        ? {}
        : { generatedToolIds: [...grant.match.generatedToolIds] }),
      ...(grant.match.registrationIds === undefined ? {} : { registrationIds: [...grant.match.registrationIds] }),
      ...(grant.match.runtimeToolNames === undefined ? {} : { runtimeToolNames: [...grant.match.runtimeToolNames] }),
      ...(grant.match.runtimeCapabilities === undefined ? {} : { runtimeCapabilities: [...grant.match.runtimeCapabilities] }),
      ...(grant.match.operationFamilies === undefined ? {} : { operationFamilies: [...grant.match.operationFamilies] }),
      ...(grant.match.operations === undefined ? {} : { operations: [...grant.match.operations] }),
      ...(grant.match.targetFingerprints === undefined ? {} : { targetFingerprints: [...grant.match.targetFingerprints] }),
      ...(grant.match.recipientFingerprints === undefined ? {} : { recipientFingerprints: [...grant.match.recipientFingerprints] }),
      ...(grant.match.contentFingerprints === undefined ? {} : { contentFingerprints: [...grant.match.contentFingerprints] }),
      ...(grant.match.artifactFingerprints === undefined ? {} : { artifactFingerprints: [...grant.match.artifactFingerprints] }),
      ...(grant.match.channels === undefined ? {} : { channels: [...grant.match.channels] }),
      ...(grant.match.routes === undefined ? {} : { routes: [...grant.match.routes] }),
      ...(grant.match.ownerSessionIds === undefined ? {} : { ownerSessionIds: [...grant.match.ownerSessionIds] })
    },
    ...(grant.requirements === undefined
      ? {}
      : {
          requirements: {
            ...grant.requirements,
            ...(grant.requirements.allowedRoots === undefined
              ? {}
              : { allowedRoots: [...grant.requirements.allowedRoots] }),
            ...(grant.requirements.allowedOperations === undefined ? {} : { allowedOperations: [...grant.requirements.allowedOperations] }),
            ...(grant.requirements.sandboxRoots === undefined ? {} : { sandboxRoots: [...grant.requirements.sandboxRoots] }),
            ...(grant.requirements.outputRoots === undefined ? {} : { outputRoots: [...grant.requirements.outputRoots] })
          }
        })
  };
}

function isGrantActive(grant: CapabilityGrant): boolean {
  return grant.expiresAt === undefined || Date.now() <= Date.parse(grant.expiresAt);
}

export class GrantStore {
  readonly #persistentGrants: CapabilityGrant[];
  readonly #sessionGrants: CapabilityGrant[];

  constructor(input: { persistentGrants?: CapabilityGrant[]; sessionGrants?: CapabilityGrant[] } = {}) {
    this.#persistentGrants = (input.persistentGrants ?? []).map((grant) => cloneGrant(grant));
    this.#sessionGrants = (input.sessionGrants ?? []).map((grant) => cloneGrant(grant));
  }

  listPersistentGrants(): CapabilityGrant[] {
    return this.#persistentGrants.map((grant) => cloneGrant(grant));
  }

  listSessionGrants(): CapabilityGrant[] {
    return this.#sessionGrants.map((grant) => cloneGrant(grant));
  }

  listActiveGrants(): CapabilityGrant[] {
    return [...this.#persistentGrants, ...this.#sessionGrants].filter((grant) => isGrantActive(grant)).map((grant) => cloneGrant(grant));
  }

  listGrantSummaries(): GrantSummary[] {
    return [...this.#persistentGrants, ...this.#sessionGrants].map((grant) => summarizeGrant(grant));
  }

  addSessionGrants(grants: CapabilityGrant[]): void {
    const existingIds = new Set(this.#sessionGrants.map((grant) => grant.id));

    for (const grant of grants) {
      if (!existingIds.has(grant.id)) {
        this.#sessionGrants.push(cloneGrant(grant));
        existingIds.add(grant.id);
      }
    }
  }
}

export function createSafetyEvaluationContext(context: AgentHostMcpContext): {
  ownerSessionId: string;
  agentHostDir: string;
  grants: CapabilityGrant[];
} {
  return {
    ownerSessionId: context.sessionId,
    agentHostDir: context.config.agentHostDir,
    grants: context.grants.listActiveGrants()
  };
}
