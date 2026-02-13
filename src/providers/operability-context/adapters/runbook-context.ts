import type { OperabilityContextCapability } from '../types';
import { HttpOperabilityContextProvider, type HttpOperabilityContextProviderOptions } from './http';

const RUNBOOK_CONTEXT_CAPABILITIES: OperabilityContextCapability[] = [
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

export type RunbookContextOperabilityAdapterOptions = Omit<
  HttpOperabilityContextProviderOptions,
  'id' | 'displayName' | 'capabilities'
>;

export function createRunbookContextOperabilityAdapter(
  options: RunbookContextOperabilityAdapterOptions
): HttpOperabilityContextProvider {
  return new HttpOperabilityContextProvider({
    ...options,
    id: 'runbook_context',
    displayName: 'Runbook Context',
    capabilities: RUNBOOK_CONTEXT_CAPABILITIES,
    requestHeaders: {
      'x-runbook-adapter': 'runbook_context',
      ...(options.requestHeaders || {}),
    },
  });
}
