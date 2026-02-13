import type { Config } from '../../utils/config';
import {
  createCustomOperabilityAdapter,
  createEntireIoOperabilityAdapter,
  createRunbookContextOperabilityAdapter,
  createSourcegraphOperabilityAdapter,
} from './adapters';
import { OperabilityContextProviderRegistry } from './registry';
import type { OperabilityContextProvider } from './types';

export interface OperabilityProviderFactoryOptions {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  requestHeaders?: Record<string, string>;
}

function resolveFactoryOptions(
  config: Config,
  overrides: OperabilityProviderFactoryOptions = {}
): {
  enabled: boolean;
  adapter: Config['providers']['operabilityContext']['adapter'];
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  requestHeaders: Record<string, string>;
} {
  const provider = config.providers.operabilityContext;
  return {
    enabled: provider.enabled,
    adapter: provider.adapter,
    baseUrl: (
      overrides.baseUrl ||
      provider.baseUrl ||
      process.env.RUNBOOK_OPERABILITY_CONTEXT_URL ||
      ''
    ).trim(),
    apiKey: (
      overrides.apiKey ||
      provider.apiKey ||
      process.env.RUNBOOK_OPERABILITY_CONTEXT_API_KEY ||
      ''
    ).trim(),
    timeoutMs: overrides.timeoutMs || provider.timeoutMs,
    requestHeaders: {
      ...(provider.requestHeaders || {}),
      ...(overrides.requestHeaders || {}),
    },
  };
}

export function createOperabilityContextProviderFromConfig(
  config: Config,
  overrides: OperabilityProviderFactoryOptions = {}
): OperabilityContextProvider | null {
  const resolved = resolveFactoryOptions(config, overrides);

  if (!resolved.enabled || !resolved.baseUrl) {
    return null;
  }

  const options = {
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey || undefined,
    timeoutMs: resolved.timeoutMs,
    requestHeaders: resolved.requestHeaders,
  };

  switch (resolved.adapter) {
    case 'sourcegraph':
      return createSourcegraphOperabilityAdapter(options);
    case 'entireio':
      return createEntireIoOperabilityAdapter(options);
    case 'runbook_context':
      return createRunbookContextOperabilityAdapter(options);
    case 'custom':
      return createCustomOperabilityAdapter(options);
    case 'none':
    default:
      return null;
  }
}

export function createOperabilityContextRegistryFromConfig(
  config: Config,
  overrides: OperabilityProviderFactoryOptions = {}
): OperabilityContextProviderRegistry {
  const registry = new OperabilityContextProviderRegistry();
  const provider = createOperabilityContextProviderFromConfig(config, overrides);
  if (provider) {
    registry.register(provider);
  }
  return registry;
}
