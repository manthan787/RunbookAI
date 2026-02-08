import type { Tool } from '../agent/types';
import type { Config } from '../utils/config';

/**
 * Filter runtime tools based on configured provider enablement.
 */
export function getRuntimeTools(config: Config, tools: Tool[]): Tool[] {
  if (!config.providers.kubernetes.enabled) {
    return tools.filter((tool) => tool.name !== 'kubernetes_query');
  }

  return tools;
}
