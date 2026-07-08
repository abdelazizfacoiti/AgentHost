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
        : { generatedToolIds: [...grant.match.generatedToolIds] })
    },
    ...(grant.requirements === undefined
      ? {}
      : {
          requirements: {
            ...grant.requirements,
            ...(grant.requirements.allowedRoots === undefined
              ? {}
              : { allowedRoots: [...grant.requirements.allowedRoots] })
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
}

export function createSafetyEvaluationContext(context: AgentHostMcpContext): {
  agentHostDir: string;
  grants: CapabilityGrant[];
} {
  return {
    agentHostDir: context.config.agentHostDir,
    grants: context.grants.listActiveGrants()
  };
}
