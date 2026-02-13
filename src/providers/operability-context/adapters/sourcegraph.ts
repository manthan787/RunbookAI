import type { OperabilityContextCapability } from '../types';
import { HttpOperabilityContextProvider, type HttpOperabilityContextProviderOptions } from './http';

const SOURCEGRAPH_CAPABILITIES: OperabilityContextCapability[] = [
  'session_ingest',
  'service_context',
  'incident_context',
  'diff_blast_radius',
  'operability_gaps',
  'similar_incidents',
  'rollout_rollback',
  'pr_validation',
  'claim_fact_reconciliation',
];

export type SourcegraphOperabilityAdapterOptions = Omit<
  HttpOperabilityContextProviderOptions,
  'id' | 'displayName' | 'capabilities'
>;

export function createSourcegraphOperabilityAdapter(
  options: SourcegraphOperabilityAdapterOptions
): HttpOperabilityContextProvider {
  return new HttpOperabilityContextProvider({
    ...options,
    id: 'sourcegraph',
    displayName: 'Sourcegraph Operability Context',
    capabilities: SOURCEGRAPH_CAPABILITIES,
    requestHeaders: {
      'x-runbook-adapter': 'sourcegraph',
      ...(options.requestHeaders || {}),
    },
  });
}
