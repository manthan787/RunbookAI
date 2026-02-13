import type { Tool } from '../agent/types';
import { loadServiceConfig } from '../config/onboarding';
import { isPrometheusConfigured } from '../tools/observability/prometheus';
import type { Config } from '../utils/config';

const AWS_TOOLS = new Set([
  'aws_query',
  'aws_mutate',
  'aws_cli',
  'cloudwatch_alarms',
  'cloudwatch_logs',
]);

const CLOUDWATCH_TOOLS = new Set(['cloudwatch_alarms', 'cloudwatch_logs']);

/**
 * Filter runtime tools based on configured provider enablement.
 */
export async function getRuntimeTools(config: Config, tools: Tool[]): Promise<Tool[]> {
  const serviceConfig = await loadServiceConfig();
  const cloudwatchEnabled = serviceConfig?.observability?.cloudwatch?.enabled ?? true;
  const datadogConfig = serviceConfig?.observability?.datadog;
  const datadogEnabled =
    Boolean(datadogConfig?.enabled) &&
    Boolean(datadogConfig?.apiKey || process.env.DD_API_KEY) &&
    Boolean(datadogConfig?.appKey || process.env.DD_APP_KEY);
  const prometheusEnabled = isPrometheusConfigured();

  return tools.filter((tool) => {
    if (!config.providers.kubernetes.enabled && tool.name === 'kubernetes_query') {
      return false;
    }
    if (!config.providers.github.enabled && tool.name === 'github_query') {
      return false;
    }
    if (!config.providers.gitlab.enabled && tool.name === 'gitlab_query') {
      return false;
    }
    if (
      !config.providers.operabilityContext.enabled &&
      tool.name.startsWith('operability_context_')
    ) {
      return false;
    }
    if (!config.providers.aws.enabled && AWS_TOOLS.has(tool.name)) {
      return false;
    }
    if (!cloudwatchEnabled && CLOUDWATCH_TOOLS.has(tool.name)) {
      return false;
    }
    if (!config.incident.pagerduty.enabled && tool.name.startsWith('pagerduty_')) {
      return false;
    }
    if (!config.incident.opsgenie.enabled && tool.name.startsWith('opsgenie_')) {
      return false;
    }
    if (!config.incident.slack.enabled && tool.name.startsWith('slack_')) {
      return false;
    }
    if (tool.name === 'datadog' && !datadogEnabled) {
      return false;
    }
    if (tool.name === 'prometheus' && !prometheusEnabled) {
      return false;
    }
    return true;
  });
}
