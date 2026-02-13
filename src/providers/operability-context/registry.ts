import {
  providerSupportsCapability,
  type AgentChangeClaim,
  type ClaimFactDelta,
  type OperabilityContextCapability,
  type OperabilityContextProvider,
  type ProviderAck,
  type ProviderHealth,
  type ProviderResult,
  type ReconciledChangeSummary,
  type VerifiedChangeFact,
  type ServiceContextQuery,
  type ServiceContextRecord,
  type IncidentContextQuery,
  type IncidentContextRecord,
  type DiffBlastRadiusQuery,
  type DiffBlastRadiusResult,
  type OperabilityGapsQuery,
  type OperabilityGapsResult,
  type PROperabilityValidationQuery,
  type PROperabilityValidationResult,
  type PullRequestIngestEvent,
} from './types';
import { reconcileClaimWithFact } from './reconcile';

export interface ProviderExecutionFailure {
  providerId: string;
  error: string;
}

export interface ProviderExecutionResult<T> {
  providerId: string;
  result: ProviderResult<T>;
}

export interface IngestExecutionResult {
  acknowledgements: Array<{ providerId: string; ack: ProviderAck }>;
  failures: ProviderExecutionFailure[];
}

export interface QueryExecutionResult<T> {
  best: ProviderExecutionResult<T> | null;
  all: ProviderExecutionResult<T>[];
  failures: ProviderExecutionFailure[];
}

export interface ReconciliationExecutionResult {
  best: ProviderExecutionResult<ReconciledChangeSummary>;
  all: ProviderExecutionResult<ReconciledChangeSummary>[];
  failures: ProviderExecutionFailure[];
  fallbackDelta: ClaimFactDelta;
}

async function settleProviderCalls<T>(
  providers: OperabilityContextProvider[],
  execute: (provider: OperabilityContextProvider) => Promise<ProviderResult<T>>
): Promise<QueryExecutionResult<T>> {
  const settled = await Promise.allSettled(
    providers.map(async (provider) => ({
      providerId: provider.id,
      result: await execute(provider),
    }))
  );

  const all: ProviderExecutionResult<T>[] = [];
  const failures: ProviderExecutionFailure[] = [];

  for (const item of settled) {
    if (item.status === 'fulfilled') {
      all.push(item.value);
      continue;
    }

    const reason = item.reason as { providerId?: string; message?: string };
    failures.push({
      providerId: reason.providerId || 'unknown',
      error: reason.message || String(item.reason),
    });
  }

  all.sort((a, b) => b.result.confidence.value - a.result.confidence.value);
  return { best: all[0] || null, all, failures };
}

/**
 * Registry + fusion layer for operability context providers.
 */
export class OperabilityContextProviderRegistry {
  private readonly providers = new Map<string, OperabilityContextProvider>();

  register(provider: OperabilityContextProvider): void {
    this.providers.set(provider.id, provider);
  }

  unregister(providerId: string): void {
    this.providers.delete(providerId);
  }

  get(providerId: string): OperabilityContextProvider | undefined {
    return this.providers.get(providerId);
  }

  list(): OperabilityContextProvider[] {
    return Array.from(this.providers.values());
  }

  listByCapability(capability: OperabilityContextCapability): OperabilityContextProvider[] {
    return this.list().filter((provider) => providerSupportsCapability(provider, capability));
  }

  async healthcheck(): Promise<Array<{ providerId: string; health: ProviderHealth }>> {
    const checks = await Promise.all(
      this.list().map(async (provider) => ({
        providerId: provider.id,
        health: await provider.healthcheck(),
      }))
    );
    return checks;
  }

  async ingestSessionStart(claim: AgentChangeClaim): Promise<IngestExecutionResult> {
    return this.ingestClaim('start', claim);
  }

  async ingestCheckpoint(claim: AgentChangeClaim): Promise<IngestExecutionResult> {
    return this.ingestClaim('checkpoint', claim);
  }

  async ingestSessionEnd(claim: AgentChangeClaim): Promise<IngestExecutionResult> {
    return this.ingestClaim('end', claim);
  }

  async ingestPullRequest(event: PullRequestIngestEvent): Promise<IngestExecutionResult> {
    const providers = this.listByCapability('session_ingest').filter((provider) =>
      Boolean(provider.ingestPullRequestEvent)
    );

    const acknowledgements: Array<{ providerId: string; ack: ProviderAck }> = [];
    const failures: ProviderExecutionFailure[] = [];

    await Promise.all(
      providers.map(async (provider) => {
        try {
          const ack = await provider.ingestPullRequestEvent!(event);
          acknowledgements.push({ providerId: provider.id, ack });
        } catch (error) {
          failures.push({
            providerId: provider.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })
    );

    return { acknowledgements, failures };
  }

  private async ingestClaim(
    stage: 'start' | 'checkpoint' | 'end',
    claim: AgentChangeClaim
  ): Promise<IngestExecutionResult> {
    const providers = this.listByCapability('session_ingest');
    const acknowledgements: Array<{ providerId: string; ack: ProviderAck }> = [];
    const failures: ProviderExecutionFailure[] = [];

    await Promise.all(
      providers.map(async (provider) => {
        try {
          const ack =
            stage === 'start'
              ? await provider.ingestChangeSessionStart(claim)
              : stage === 'checkpoint'
                ? await provider.ingestChangeCheckpoint(claim)
                : await provider.ingestChangeSessionEnd(claim);
          acknowledgements.push({ providerId: provider.id, ack });
        } catch (error) {
          failures.push({
            providerId: provider.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })
    );

    return { acknowledgements, failures };
  }

  async getServiceContext(
    query: ServiceContextQuery
  ): Promise<QueryExecutionResult<ServiceContextRecord>> {
    const providers = this.listByCapability('service_context').filter((provider) =>
      Boolean(provider.getServiceContext)
    );
    return settleProviderCalls(providers, (provider) => provider.getServiceContext!(query));
  }

  async getIncidentContext(
    query: IncidentContextQuery
  ): Promise<QueryExecutionResult<IncidentContextRecord>> {
    const providers = this.listByCapability('incident_context').filter((provider) =>
      Boolean(provider.getIncidentContext)
    );
    return settleProviderCalls(providers, (provider) => provider.getIncidentContext!(query));
  }

  async getDiffBlastRadius(
    query: DiffBlastRadiusQuery
  ): Promise<QueryExecutionResult<DiffBlastRadiusResult>> {
    const providers = this.listByCapability('diff_blast_radius').filter((provider) =>
      Boolean(provider.getDiffBlastRadius)
    );
    return settleProviderCalls(providers, (provider) => provider.getDiffBlastRadius!(query));
  }

  async getOperabilityGaps(
    query: OperabilityGapsQuery
  ): Promise<QueryExecutionResult<OperabilityGapsResult>> {
    const providers = this.listByCapability('operability_gaps').filter((provider) =>
      Boolean(provider.getOperabilityGaps)
    );
    return settleProviderCalls(providers, (provider) => provider.getOperabilityGaps!(query));
  }

  async validatePROperability(
    query: PROperabilityValidationQuery
  ): Promise<QueryExecutionResult<PROperabilityValidationResult>> {
    const providers = this.listByCapability('pr_validation').filter((provider) =>
      Boolean(provider.validatePROperability)
    );
    return settleProviderCalls(providers, (provider) => provider.validatePROperability!(query));
  }

  /**
   * Reconcile claim vs verified fact. If no provider implements reconciliation,
   * this falls back to the built-in deterministic reconciler.
   */
  async reconcileClaimWithFact(
    claim: AgentChangeClaim,
    fact: VerifiedChangeFact
  ): Promise<ReconciliationExecutionResult> {
    const providers = this.listByCapability('claim_fact_reconciliation').filter((provider) =>
      Boolean(provider.reconcileClaimWithFact)
    );

    const providerResults = await settleProviderCalls(providers, (provider) =>
      provider.reconcileClaimWithFact!(claim, fact)
    );

    const fallback = reconcileClaimWithFact(claim, fact);
    const fallbackResult: ProviderExecutionResult<ReconciledChangeSummary> = {
      providerId: 'runbook-deterministic-fallback',
      result: {
        data: fallback,
        confidence: fallback.confidence,
        provenance: fact.provenance,
      },
    };

    const all = [...providerResults.all, fallbackResult].sort(
      (left, right) => right.result.confidence.value - left.result.confidence.value
    );

    return {
      best: all[0],
      all,
      failures: providerResults.failures,
      fallbackDelta: fallback.delta,
    };
  }
}
