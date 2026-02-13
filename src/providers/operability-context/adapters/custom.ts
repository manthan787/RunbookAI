import type { OperabilityContextCapability } from '../types';
import { HttpOperabilityContextProvider, type HttpOperabilityContextProviderOptions } from './http';

const DEFAULT_CUSTOM_CAPABILITIES: OperabilityContextCapability[] = [
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

export interface CustomOperabilityAdapterOptions extends Omit<
  HttpOperabilityContextProviderOptions,
  'id' | 'displayName' | 'capabilities'
> {
  id?: string;
  displayName?: string;
  capabilities?: OperabilityContextCapability[];
}

export function createCustomOperabilityAdapter(
  options: CustomOperabilityAdapterOptions
): HttpOperabilityContextProvider {
  return new HttpOperabilityContextProvider({
    ...options,
    id: options.id || 'custom-operability-context',
    displayName: options.displayName || 'Custom Operability Context',
    capabilities: options.capabilities || DEFAULT_CUSTOM_CAPABILITIES,
    requestHeaders: {
      'x-runbook-adapter': 'custom',
      ...(options.requestHeaders || {}),
    },
  });
}
