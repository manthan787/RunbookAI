import type {
  AgentChangeClaim,
  DiffBlastRadiusQuery,
  DiffBlastRadiusResult,
  IncidentContextQuery,
  IncidentContextRecord,
  OperabilityContextCapability,
  OperabilityContextProvider,
  OperabilityGapsQuery,
  OperabilityGapsResult,
  PROperabilityValidationQuery,
  PROperabilityValidationResult,
  ProviderAck,
  ProviderHealth,
  ProviderResult,
  PullRequestIngestEvent,
  ReconciledChangeSummary,
  RolloutRollbackQuery,
  RolloutRollbackSuggestion,
  ServiceContextQuery,
  ServiceContextRecord,
  SimilarIncidentsQuery,
  SimilarIncidentsResult,
  VerifiedChangeFact,
} from '../types';

export interface HttpOperabilityContextProviderOptions {
  id: string;
  displayName: string;
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  requestHeaders?: Record<string, string>;
  capabilities: OperabilityContextCapability[];
}

interface JsonRequestResult {
  response: Response;
  payload: unknown;
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function defaultConfidence() {
  return {
    value: 0.5,
    rationale: 'Provider response did not include confidence; applied default.',
  };
}

function parseProviderResult<T>(
  providerId: string,
  payload: unknown,
  fallback: T
): ProviderResult<T> {
  const body = asObject(payload);
  if (!body) {
    return {
      data: fallback,
      confidence: defaultConfidence(),
      provenance: [],
    };
  }

  const confidenceRaw = asObject(body.confidence);
  const confidenceValue = confidenceRaw ? asNumber(confidenceRaw.value) : undefined;
  const confidence = {
    value: typeof confidenceValue === 'number' ? Math.min(1, Math.max(0, confidenceValue)) : 0.5,
    rationale: asString(confidenceRaw?.rationale),
  };

  const provenanceRaw = Array.isArray(body.provenance) ? body.provenance : [];
  const provenance = provenanceRaw
    .map((item) => {
      const parsed = asObject(item);
      if (!parsed) return null;
      const recordId = asString(parsed.recordId);
      const source = asString(parsed.source);
      const observedAt = asString(parsed.observedAt);
      if (!recordId || !source || !observedAt) return null;
      return {
        providerId: asString(parsed.providerId) || providerId,
        source: source as
          | 'agent_session'
          | 'git_diff'
          | 'ast'
          | 'ci'
          | 'webhook'
          | 'runtime'
          | 'incident_system'
          | 'manual',
        recordId,
        observedAt,
        url: asString(parsed.url),
        metadata: asObject(parsed.metadata) || undefined,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return {
    data: (body.data as T) || fallback,
    confidence,
    provenance,
  };
}

function parseAck(providerId: string, payload: unknown): ProviderAck {
  const body = asObject(payload);
  const accepted = body ? asBoolean(body.accepted) : undefined;
  const receiptId = body ? asString(body.receiptId) : undefined;
  const observedAt = body ? asString(body.observedAt) : undefined;
  const warnings = body && Array.isArray(body.warnings) ? body.warnings.map(String) : undefined;

  return {
    accepted: accepted ?? true,
    receiptId: receiptId || `${providerId}-${Date.now()}`,
    observedAt: observedAt || new Date().toISOString(),
    warnings,
  };
}

export class HttpOperabilityContextProvider implements OperabilityContextProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: OperabilityContextCapability[];

  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly requestHeaders: Record<string, string>;

  constructor(options: HttpOperabilityContextProviderOptions) {
    this.id = options.id;
    this.displayName = options.displayName;
    this.baseUrl = normalizeUrl(options.baseUrl);
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs || 5000;
    this.requestHeaders = options.requestHeaders || {};
    this.capabilities = options.capabilities;
  }

  async healthcheck(): Promise<ProviderHealth> {
    try {
      const { response, payload } = await this.requestJson('GET', '/v1/health');
      const body = asObject(payload) || {};
      const status = asString(body.status);
      if (status === 'healthy' || status === 'degraded' || status === 'unavailable') {
        return {
          status,
          checkedAt: new Date().toISOString(),
          message: asString(body.message),
          details: asObject(body.details) || undefined,
        };
      }
      return {
        status: response.ok ? 'healthy' : 'degraded',
        checkedAt: new Date().toISOString(),
        message: response.ok
          ? 'Health endpoint responded.'
          : `Health endpoint returned ${response.status}`,
      };
    } catch (error) {
      return {
        status: 'unavailable',
        checkedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async ingestChangeSessionStart(input: AgentChangeClaim): Promise<ProviderAck> {
    return this.ingestStage('start', input);
  }

  async ingestChangeCheckpoint(input: AgentChangeClaim): Promise<ProviderAck> {
    return this.ingestStage('checkpoint', input);
  }

  async ingestChangeSessionEnd(input: AgentChangeClaim): Promise<ProviderAck> {
    return this.ingestStage('end', input);
  }

  async ingestPullRequestEvent(input: PullRequestIngestEvent): Promise<ProviderAck> {
    const { payload } = await this.requestJson('POST', '/v1/ingest/pull-request', {
      pullRequest: input,
    });
    return parseAck(this.id, payload);
  }

  async getServiceContext(
    query: ServiceContextQuery
  ): Promise<ProviderResult<ServiceContextRecord>> {
    const { payload } = await this.requestJson('POST', '/v1/context/service', query);
    return parseProviderResult(this.id, payload, {
      service: query.service,
      environment: query.environment,
      owners: [],
      repos: [],
      runbooks: [],
      alerts: [],
      dependencies: [],
      recentChanges: [],
      provenance: [],
    });
  }

  async getIncidentContext(
    query: IncidentContextQuery
  ): Promise<ProviderResult<IncidentContextRecord>> {
    const { payload } = await this.requestJson('POST', '/v1/context/incident', query);
    return parseProviderResult(this.id, payload, {
      incidentId: query.incidentId,
      services: query.relatedServices || [],
      relatedChanges: [],
      similarIncidents: [],
      likelyRunbooks: [],
      provenance: [],
    });
  }

  async getDiffBlastRadius(
    query: DiffBlastRadiusQuery
  ): Promise<ProviderResult<DiffBlastRadiusResult>> {
    const { payload } = await this.requestJson('POST', '/v1/analysis/diff-blast-radius', query);
    return parseProviderResult(this.id, payload, {
      changeId: `${query.baseSha}..${query.headSha}`,
      impactedFiles: query.files || [],
      impactedServices: [],
      blastRadius: {
        directlyImpactedServices: [],
        downstreamServices: [],
        externalDependencies: [],
        severity: 'low',
        rationale: [],
      },
      provenance: [],
    });
  }

  async getOperabilityGaps(
    query: OperabilityGapsQuery
  ): Promise<ProviderResult<OperabilityGapsResult>> {
    const { payload } = await this.requestJson('POST', '/v1/analysis/operability-gaps', query);
    return parseProviderResult(this.id, payload, {
      changeId: `${query.baseSha}..${query.headSha}`,
      score: 1,
      gaps: [],
      provenance: [],
    });
  }

  async findSimilarIncidents(
    query: SimilarIncidentsQuery
  ): Promise<ProviderResult<SimilarIncidentsResult>> {
    const { payload } = await this.requestJson('POST', '/v1/incidents/similar', query);
    return parseProviderResult(this.id, payload, {
      incidents: [],
      provenance: [],
    });
  }

  async suggestRolloutRollback(
    query: RolloutRollbackQuery
  ): Promise<ProviderResult<RolloutRollbackSuggestion>> {
    const { payload } = await this.requestJson('POST', '/v1/changes/rollout-rollback', query);
    return parseProviderResult(this.id, payload, {
      rolloutPlan: [],
      rollbackPlan: [],
      guardrails: [],
      provenance: [],
    });
  }

  async validatePROperability(
    query: PROperabilityValidationQuery
  ): Promise<ProviderResult<PROperabilityValidationResult>> {
    const { payload } = await this.requestJson('POST', '/v1/pr/validate', query);
    return parseProviderResult(this.id, payload, {
      changeId: `${query.baseSha}..${query.headSha}`,
      score: 1,
      status: 'pass',
      summary: 'No provider result returned.',
      gaps: [],
      requiredActions: [],
      provenance: [],
    });
  }

  async reconcileClaimWithFact(
    claim: AgentChangeClaim,
    fact: VerifiedChangeFact
  ): Promise<ProviderResult<ReconciledChangeSummary>> {
    const { payload } = await this.requestJson('POST', '/v1/reconcile/claim-fact', {
      claim,
      fact,
    });
    return parseProviderResult(this.id, payload, {
      sessionId: claim.session.sessionId,
      claim,
      fact,
      delta: {
        filesMissingInClaim: [],
        filesMissingInFact: [],
        servicesMissingInClaim: [],
        servicesMissingInFact: [],
        testsMissingInClaim: [],
        testsMissingInFact: [],
        unknownsNotCovered: [],
        rolloutMismatch: false,
        rollbackMismatch: false,
      },
      trustScore: 0.5,
      confidence: {
        value: 0.5,
      },
      generatedAt: new Date().toISOString(),
    });
  }

  private async ingestStage(
    stage: 'start' | 'checkpoint' | 'end',
    input: AgentChangeClaim
  ): Promise<ProviderAck> {
    const { payload } = await this.requestJson('POST', `/v1/ingest/change-session/${stage}`, {
      stage,
      claim: input,
    });
    return parseAck(this.id, payload);
  }

  private async requestJson(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
  ): Promise<JsonRequestResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers = new Headers({
      Accept: 'application/json',
      ...this.requestHeaders,
    });

    if (this.apiKey) {
      headers.set('Authorization', `Bearer ${this.apiKey}`);
    }

    if (method === 'POST') {
      headers.set('Content-Type', 'application/json');
    }

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
        signal: controller.signal,
      });

      let payload: unknown = null;
      const text = await response.text().catch(() => '');
      if (text.trim()) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = { message: text };
        }
      }

      if (!response.ok) {
        const message = asString(asObject(payload)?.message);
        throw new Error(
          `${this.displayName} request failed (${response.status} ${response.statusText})${message ? `: ${message}` : ''}`
        );
      }

      return { response, payload };
    } finally {
      clearTimeout(timeout);
    }
  }
}
