import type { OperabilityContextCapability } from '../types';
import { HttpOperabilityContextProvider, type HttpOperabilityContextProviderOptions } from './http';

const ENTIREIO_CAPABILITIES: OperabilityContextCapability[] = [
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

export type EntireIoOperabilityAdapterOptions = Omit<
  HttpOperabilityContextProviderOptions,
  'id' | 'displayName' | 'capabilities'
>;

export function createEntireIoOperabilityAdapter(
  options: EntireIoOperabilityAdapterOptions
): HttpOperabilityContextProvider {
  return new HttpOperabilityContextProvider({
    ...options,
    id: 'entireio',
    displayName: 'Entire.io Operability Context',
    capabilities: ENTIREIO_CAPABILITIES,
    requestHeaders: {
      'x-runbook-adapter': 'entireio',
      ...(options.requestHeaders || {}),
    },
  });
}
