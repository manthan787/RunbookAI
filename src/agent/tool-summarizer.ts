/**
 * Tool Summarizer
 *
 * Generates token-efficient compact summaries of tool results.
 * Implements per-tool summarizers for infrastructure data.
 */

import { createHash } from 'crypto';

/**
 * Compact representation of a tool result.
 */
export interface CompactToolResult {
  /** 1-2 sentence description of what the tool returned */
  summary: string;
  /** Key metrics or highlights extracted from the result */
  highlights: Record<string, unknown>;
  /** Number of items/resources in the result */
  itemCount: number;
  /** Unique ID for retrieving full result via get_full_result tool */
  resultId: string;
  /** Whether this result contains error signals */
  hasErrors: boolean;
  /** Services mentioned in the result */
  services: string[];
  /** Health status summary if applicable */
  healthStatus?: 'healthy' | 'degraded' | 'critical' | 'unknown';
}

/**
 * A summarizer function for a specific tool type.
 */
type ToolSummarizerFn = (result: unknown, args: Record<string, unknown>) => CompactToolResult;

/**
 * Generate a unique result ID for drill-down retrieval.
 */
function generateResultId(toolName: string, timestamp: number): string {
  const hash = createHash('md5')
    .update(`${toolName}-${timestamp}-${Math.random()}`)
    .digest('hex')
    .slice(0, 8);
  return `${toolName.slice(0, 3)}-${hash}`;
}

/**
 * Extract service names from various result formats.
 */
function extractServices(data: unknown): string[] {
  const services = new Set<string>();

  const extractFromValue = (value: unknown): void => {
    if (typeof value === 'string') {
      // Common service name patterns
      const patterns = [
        /service[:\s]+([a-zA-Z0-9_-]+)/gi,
        /cluster[:\s]+([a-zA-Z0-9_-]+)/gi,
        /function[:\s]+([a-zA-Z0-9_-]+)/gi,
      ];
      for (const pattern of patterns) {
        const matches = value.matchAll(pattern);
        for (const match of matches) {
          if (match[1] && match[1].length > 2) {
            services.add(match[1]);
          }
        }
      }
    } else if (Array.isArray(value)) {
      value.forEach(extractFromValue);
    } else if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      // Check for explicit service fields
      if (typeof obj.serviceName === 'string') services.add(obj.serviceName);
      if (typeof obj.service === 'string') services.add(obj.service);
      if (typeof obj.cluster === 'string') services.add(obj.cluster);
      if (typeof obj.functionName === 'string') services.add(obj.functionName);
      if (typeof obj.FunctionName === 'string') services.add(obj.FunctionName);
      if (typeof obj.name === 'string') services.add(obj.name);
      Object.values(obj).forEach(extractFromValue);
    }
  };

  extractFromValue(data);
  return Array.from(services).slice(0, 10);
}

/**
 * Check if result contains error signals.
 */
function hasErrorSignals(data: unknown): boolean {
  if (typeof data === 'string') {
    const errorKeywords = [
      'error',
      'failed',
      'exception',
      'not found',
      'unavailable',
      'timeout',
      'invalid',
      'unhealthy',
      'alarm',
      'critical',
    ];
    const lowerData = data.toLowerCase();
    return errorKeywords.some((kw) => lowerData.includes(kw));
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (obj.error || obj.errors || obj.errorMessage) return true;
    if (
      typeof obj.status === 'string' &&
      ['error', 'failed', 'critical', 'alarm'].includes(obj.status.toLowerCase())
    )
      return true;
    if (typeof obj.state === 'string' && obj.state.toLowerCase() === 'alarm') return true;
  }
  return false;
}

/**
 * Determine overall health status from result.
 */
function determineHealthStatus(data: unknown): 'healthy' | 'degraded' | 'critical' | 'unknown' {
  if (!data || typeof data !== 'object') return 'unknown';

  const obj = data as Record<string, unknown>;

  // Check for explicit health indicators
  if (obj.stateValue === 'ALARM' || obj.state === 'ALARM') return 'critical';
  if (obj.status === 'RUNNING' || obj.status === 'ACTIVE' || obj.status === 'healthy')
    return 'healthy';
  if (obj.status === 'DRAINING' || obj.status === 'PENDING') return 'degraded';

  // Check arrays for health
  if (Array.isArray(obj.resources) || Array.isArray(obj.results)) {
    const items = (obj.resources || obj.results) as unknown[];
    const unhealthyCount = items.filter((item: unknown) => {
      if (item && typeof item === 'object') {
        const i = item as Record<string, unknown>;
        return i.status === 'ALARM' || i.health === 'unhealthy' || i.state === 'stopped';
      }
      return false;
    }).length;

    if (unhealthyCount === 0) return 'healthy';
    if (unhealthyCount < items.length / 2) return 'degraded';
    return 'critical';
  }

  return 'unknown';
}

function getNotableResourceName(
  serviceId: string,
  resource: Record<string, unknown>
): string | null {
  if (typeof resource.name === 'string' && resource.name.trim()) {
    return resource.name.trim();
  }
  if (typeof resource.functionName === 'string' && resource.functionName.trim()) {
    return resource.functionName.trim();
  }
  if (typeof resource.FunctionName === 'string' && resource.FunctionName.trim()) {
    return resource.FunctionName.trim();
  }

  const id = resource.id;
  if (typeof id === 'string' && id.trim()) {
    const trimmed = id.trim();
    if (serviceId === 'lambda') {
      const marker = 'function:';
      const idx = trimmed.indexOf(marker);
      if (idx !== -1) {
        return trimmed.slice(idx + marker.length);
      }
    }
    return trimmed;
  }

  return null;
}

// ============================================================================
// Per-Tool Summarizers
// ============================================================================

/**
 * Summarizer for aws_query results.
 */
function summarizeAwsQuery(result: unknown, args: Record<string, unknown>): CompactToolResult {
  const query = (args.query as string) || 'AWS resources';
  const resultId = generateResultId('aws_query', Date.now());
  const services = extractServices(result);
  const hasErrors = hasErrorSignals(result);
  const healthStatus = determineHealthStatus(result);

  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    const totalResources = (obj.totalResources as number) || 0;
    const servicesQueried = (obj.servicesQueried as number) || 0;
    const results = (obj.results as Record<string, unknown>) || {};
    const errors = (obj.errors as string[]) || [];
    const notableResources: string[] = [];
    const lambdaFunctionNames: string[] = [];

    // Build highlights per service
    const highlights: Record<string, unknown> = {};
    for (const [serviceId, data] of Object.entries(results)) {
      if (data && typeof data === 'object') {
        const sData = data as Record<string, unknown>;
        const resources = Array.isArray(sData.resources)
          ? (sData.resources as Array<Record<string, unknown>>)
          : [];
        const names = resources
          .map((resource) => getNotableResourceName(serviceId, resource))
          .filter((name): name is string => Boolean(name))
          .slice(0, 3);

        if (serviceId === 'lambda') {
          lambdaFunctionNames.push(...names);
        }
        notableResources.push(...names.map((name) => `${serviceId}/${name}`));

        highlights[serviceId] = {
          count: sData.count,
          sample: resources.slice(0, 2),
          notable: names,
        };
      }
    }

    const uniqueNotableResources = Array.from(new Set(notableResources)).slice(0, 3);
    const summary =
      uniqueNotableResources.length > 0
        ? `Queried ${servicesQueried} AWS service(s), found ${totalResources} resource(s). Notable: ${uniqueNotableResources.join(', ')}. ${errors.length > 0 ? `${errors.length} error(s).` : ''}`
        : `Queried ${servicesQueried} AWS service(s), found ${totalResources} resource(s). ${errors.length > 0 ? `${errors.length} error(s).` : ''}`;
    const mergedServices = Array.from(new Set([...services, ...lambdaFunctionNames])).slice(0, 10);

    return {
      summary,
      highlights,
      itemCount: totalResources,
      resultId,
      hasErrors: hasErrors || errors.length > 0,
      services: mergedServices,
      healthStatus,
    };
  }

  return {
    summary: `AWS query for "${query}": ${String(result).slice(0, 150)}...`,
    highlights: {},
    itemCount: 1,
    resultId,
    hasErrors,
    services,
    healthStatus,
  };
}

/**
 * Summarizer for cloudwatch_alarms results.
 */
function summarizeCloudwatchAlarms(
  result: unknown,
  args: Record<string, unknown>
): CompactToolResult {
  const resultId = generateResultId('cw_alarms', Date.now());
  const services = extractServices(result);

  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    const alarms = (obj.alarms as unknown[]) || [];
    const count = (obj.count as number) || alarms.length;

    const alarmingCount = alarms.filter((a: unknown) => {
      if (a && typeof a === 'object') {
        return (a as Record<string, unknown>).stateValue === 'ALARM';
      }
      return false;
    }).length;

    const alarmNames = alarms.slice(0, 3).map((a: unknown) => {
      if (a && typeof a === 'object') {
        return (a as Record<string, unknown>).alarmName;
      }
      return 'unknown';
    });

    const healthStatus: 'healthy' | 'degraded' | 'critical' =
      alarmingCount === 0 ? 'healthy' : alarmingCount > 2 ? 'critical' : 'degraded';

    return {
      summary: `${count} alarm(s). ${alarmingCount} in ALARM state. ${alarmNames.length > 0 ? `Top: ${alarmNames.join(', ')}` : ''}`,
      highlights: {
        total: count,
        alarming: alarmingCount,
        alarmNames: alarmNames.slice(0, 5),
      },
      itemCount: count,
      resultId,
      hasErrors: alarmingCount > 0,
      services,
      healthStatus,
    };
  }

  return {
    summary: 'CloudWatch alarms query completed',
    highlights: {},
    itemCount: 0,
    resultId,
    hasErrors: false,
    services,
    healthStatus: 'unknown',
  };
}

/**
 * Summarizer for cloudwatch_logs results.
 */
function summarizeCloudwatchLogs(
  result: unknown,
  args: Record<string, unknown>
): CompactToolResult {
  const logGroup = (args.log_group as string) || 'logs';
  const pattern = (args.filter_pattern as string) || '';
  const resultId = generateResultId('cw_logs', Date.now());
  const services = extractServices(result);

  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    const events = (obj.events as unknown[]) || [];
    const count = (obj.count as number) || events.length;

    // Check for error patterns in log messages
    const errorCount = events.filter((e: unknown) => {
      if (e && typeof e === 'object') {
        const msg = ((e as Record<string, unknown>).message as string) || '';
        return /error|exception|failed|timeout/i.test(msg);
      }
      return false;
    }).length;

    const sampleMessages = events.slice(0, 2).map((e: unknown) => {
      if (e && typeof e === 'object') {
        const msg = ((e as Record<string, unknown>).message as string) || '';
        return msg.slice(0, 100);
      }
      return '';
    });

    return {
      summary: `Found ${count} log event(s) in ${logGroup} matching "${pattern}". ${errorCount} error(s).`,
      highlights: {
        count,
        errorCount,
        samples: sampleMessages,
      },
      itemCount: count,
      resultId,
      hasErrors: errorCount > 0,
      services,
      healthStatus: errorCount > 0 ? 'degraded' : 'healthy',
    };
  }

  return {
    summary: `Log search in ${logGroup} completed`,
    highlights: {},
    itemCount: 0,
    resultId,
    hasErrors: false,
    services,
    healthStatus: 'unknown',
  };
}

/**
 * Summarizer for pagerduty_get_incident results.
 */
function summarizePagerdutyIncident(
  result: unknown,
  args: Record<string, unknown>
): CompactToolResult {
  const resultId = generateResultId('pd_inc', Date.now());
  const services = extractServices(result);

  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    const incident = (obj.incident as Record<string, unknown>) || {};
    const alerts = (obj.alerts as unknown[]) || [];

    const status = (incident.status as string) || 'unknown';
    const urgency = (incident.urgency as string) || 'unknown';
    const title = (incident.title as string) || 'Unknown incident';
    const service = (incident.service as string) || '';

    if (service) services.push(service);

    const healthStatus: 'healthy' | 'degraded' | 'critical' =
      status === 'resolved' ? 'healthy' : urgency === 'high' ? 'critical' : 'degraded';

    return {
      summary: `Incident "${title.slice(0, 50)}": ${status} (${urgency}). ${alerts.length} alert(s).`,
      highlights: {
        id: incident.id,
        number: incident.number,
        status,
        urgency,
        service,
        alertCount: alerts.length,
      },
      itemCount: 1,
      resultId,
      hasErrors: status !== 'resolved',
      services,
      healthStatus,
    };
  }

  return {
    summary: 'PagerDuty incident retrieved',
    highlights: {},
    itemCount: 1,
    resultId,
    hasErrors: false,
    services,
    healthStatus: 'unknown',
  };
}

/**
 * Summarizer for pagerduty_list_incidents results.
 */
function summarizePagerdutyList(
  result: unknown,
  _args: Record<string, unknown>
): CompactToolResult {
  const resultId = generateResultId('pd_list', Date.now());
  const services = extractServices(result);

  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    const incidents = (obj.incidents as unknown[]) || [];
    const count = (obj.count as number) || incidents.length;

    const triggered = incidents.filter((i: unknown) => {
      if (i && typeof i === 'object') {
        return (i as Record<string, unknown>).status === 'triggered';
      }
      return false;
    }).length;

    const acknowledged = incidents.filter((i: unknown) => {
      if (i && typeof i === 'object') {
        return (i as Record<string, unknown>).status === 'acknowledged';
      }
      return false;
    }).length;

    const healthStatus: 'healthy' | 'degraded' | 'critical' =
      triggered === 0 ? 'healthy' : triggered > 2 ? 'critical' : 'degraded';

    return {
      summary: `${count} incident(s): ${triggered} triggered, ${acknowledged} acknowledged.`,
      highlights: {
        total: count,
        triggered,
        acknowledged,
        resolved: count - triggered - acknowledged,
      },
      itemCount: count,
      resultId,
      hasErrors: triggered > 0,
      services,
      healthStatus,
    };
  }

  return {
    summary: 'PagerDuty incidents listed',
    highlights: {},
    itemCount: 0,
    resultId,
    hasErrors: false,
    services,
    healthStatus: 'unknown',
  };
}

/**
 * Summarizer for datadog tool results.
 */
function summarizeDatadog(result: unknown, args: Record<string, unknown>): CompactToolResult {
  const action = (args.action as string) || 'query';
  const resultId = generateResultId('dd', Date.now());
  const services = extractServices(result);

  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;

    if (action === 'monitors') {
      const monitors = (obj.triggeredMonitors as unknown[]) || [];
      const count = (obj.count as number) || monitors.length;

      return {
        summary: `${count} triggered Datadog monitor(s).`,
        highlights: {
          count,
          monitors: monitors
            .slice(0, 3)
            .map((m: unknown) => {
              if (m && typeof m === 'object') {
                const mon = m as Record<string, unknown>;
                return { name: mon.name, state: mon.state };
              }
              return null;
            })
            .filter(Boolean),
        },
        itemCount: count,
        resultId,
        hasErrors: count > 0,
        services,
        healthStatus: count === 0 ? 'healthy' : count > 2 ? 'critical' : 'degraded',
      };
    }

    if (action === 'logs') {
      const logs = (obj.logs as unknown[]) || [];
      return {
        summary: `Found ${logs.length} log entries in Datadog.`,
        highlights: { count: logs.length },
        itemCount: logs.length,
        resultId,
        hasErrors: hasErrorSignals(result),
        services,
        healthStatus: determineHealthStatus(result),
      };
    }
  }

  return {
    summary: `Datadog ${action} completed`,
    highlights: {},
    itemCount: 1,
    resultId,
    hasErrors: hasErrorSignals(result),
    services,
    healthStatus: 'unknown',
  };
}

/**
 * Summarizer for prometheus tool results.
 */
function summarizePrometheus(result: unknown, args: Record<string, unknown>): CompactToolResult {
  const action = (args.action as string) || 'query';
  const resultId = generateResultId('prom', Date.now());
  const services = extractServices(result);

  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;

    if (action === 'alerts') {
      const alerts = (obj.firingAlerts as unknown[]) || [];
      const count = (obj.count as number) || alerts.length;

      return {
        summary: `${count} firing Prometheus alert(s).`,
        highlights: {
          count,
          alerts: alerts
            .slice(0, 3)
            .map((a: unknown) => {
              if (a && typeof a === 'object') {
                const alert = a as Record<string, unknown>;
                return { name: alert.name, severity: alert.severity };
              }
              return null;
            })
            .filter(Boolean),
        },
        itemCount: count,
        resultId,
        hasErrors: count > 0,
        services,
        healthStatus: count === 0 ? 'healthy' : count > 2 ? 'critical' : 'degraded',
      };
    }

    if (action === 'targets') {
      const summary = (obj.summary as Record<string, unknown>) || {};
      const healthy = (summary.healthy as number) || 0;
      const unhealthy = (summary.unhealthy as number) || 0;

      return {
        summary: `Prometheus targets: ${healthy} healthy, ${unhealthy} unhealthy.`,
        highlights: { healthy, unhealthy },
        itemCount: healthy + unhealthy,
        resultId,
        hasErrors: unhealthy > 0,
        services,
        healthStatus: unhealthy === 0 ? 'healthy' : unhealthy > healthy ? 'critical' : 'degraded',
      };
    }
  }

  return {
    summary: `Prometheus ${action} completed`,
    highlights: {},
    itemCount: 1,
    resultId,
    hasErrors: hasErrorSignals(result),
    services,
    healthStatus: 'unknown',
  };
}

/**
 * Summarizer for search_knowledge results.
 */
function summarizeKnowledgeSearch(
  result: unknown,
  args: Record<string, unknown>
): CompactToolResult {
  const query = (args.query as string) || 'knowledge';
  const resultId = generateResultId('kb', Date.now());
  const services = extractServices(result);

  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    const documentCount = (obj.documentCount as number) || 0;
    const runbooks = (obj.runbooks as unknown[]) || [];
    const postmortems = (obj.postmortems as unknown[]) || [];
    const knownIssues = (obj.knownIssues as unknown[]) || [];

    const runbookTitles = runbooks
      .slice(0, 2)
      .map((r: unknown) => {
        if (r && typeof r === 'object') {
          return (r as Record<string, unknown>).title;
        }
        return null;
      })
      .filter(Boolean);

    return {
      summary: `Found ${documentCount} doc(s): ${runbooks.length} runbook(s), ${postmortems.length} postmortem(s), ${knownIssues.length} known issue(s).`,
      highlights: {
        runbooks: runbookTitles,
        postmortemCount: postmortems.length,
        knownIssueCount: knownIssues.length,
      },
      itemCount: documentCount,
      resultId,
      hasErrors: false,
      services,
      healthStatus: 'unknown',
    };
  }

  return {
    summary: `Knowledge search for "${query}"`,
    highlights: {},
    itemCount: 0,
    resultId,
    hasErrors: false,
    services,
    healthStatus: 'unknown',
  };
}

/**
 * Default summarizer for unknown tools.
 */
function summarizeDefault(
  result: unknown,
  args: Record<string, unknown>,
  toolName: string
): CompactToolResult {
  const resultId = generateResultId(toolName, Date.now());
  const services = extractServices(result);
  const hasErrors = hasErrorSignals(result);
  const healthStatus = determineHealthStatus(result);

  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    const keys = Object.keys(obj);
    const itemCount = Array.isArray(result) ? result.length : 1;

    return {
      summary: `${toolName}: returned ${itemCount} item(s). Keys: ${keys.slice(0, 5).join(', ')}`,
      highlights: {},
      itemCount,
      resultId,
      hasErrors,
      services,
      healthStatus,
    };
  }

  const strResult = String(result);
  return {
    summary:
      strResult.length > 200
        ? `${toolName}: ${strResult.slice(0, 200)}...`
        : `${toolName}: ${strResult}`,
    highlights: {},
    itemCount: 1,
    resultId,
    hasErrors,
    services,
    healthStatus,
  };
}

// ============================================================================
// Registry of Summarizers
// ============================================================================

const SUMMARIZERS: Record<string, ToolSummarizerFn> = {
  aws_query: summarizeAwsQuery,
  cloudwatch_alarms: summarizeCloudwatchAlarms,
  cloudwatch_logs: summarizeCloudwatchLogs,
  pagerduty_get_incident: summarizePagerdutyIncident,
  pagerduty_list_incidents: summarizePagerdutyList,
  datadog: summarizeDatadog,
  prometheus: summarizePrometheus,
  search_knowledge: summarizeKnowledgeSearch,
};

// ============================================================================
// Main ToolSummarizer Class
// ============================================================================

/**
 * ToolSummarizer generates compact summaries of tool results.
 * Stores full results in tiered storage for later retrieval.
 */
export class ToolSummarizer {
  /** Map of result IDs to full results */
  private fullResults: Map<
    string,
    {
      toolName: string;
      args: Record<string, unknown>;
      result: unknown;
      timestamp: number;
    }
  > = new Map();

  /**
   * Summarize a tool result into a compact representation.
   * Also stores the full result for later retrieval.
   */
  summarize(toolName: string, args: Record<string, unknown>, result: unknown): CompactToolResult {
    // Get appropriate summarizer or use default
    const summarizer =
      SUMMARIZERS[toolName] ||
      ((r: unknown, a: Record<string, unknown>) => summarizeDefault(r, a, toolName));
    const compact = summarizer(result, args);

    // Store full result for later retrieval
    this.fullResults.set(compact.resultId, {
      toolName,
      args,
      result,
      timestamp: Date.now(),
    });

    return compact;
  }

  /**
   * Get full result by ID for drill-down.
   */
  getFullResult(
    resultId: string
  ): { toolName: string; args: Record<string, unknown>; result: unknown } | null {
    const entry = this.fullResults.get(resultId);
    if (!entry) return null;
    return { toolName: entry.toolName, args: entry.args, result: entry.result };
  }

  /**
   * Check if a result ID exists.
   */
  hasResult(resultId: string): boolean {
    return this.fullResults.has(resultId);
  }

  /**
   * Get all stored result IDs.
   */
  getResultIds(): string[] {
    return Array.from(this.fullResults.keys());
  }

  /**
   * Clear old results to manage memory.
   */
  clearOldResults(maxAge: number = 30 * 60 * 1000): number {
    const cutoff = Date.now() - maxAge;
    let cleared = 0;

    for (const [id, entry] of this.fullResults) {
      if (entry.timestamp < cutoff) {
        this.fullResults.delete(id);
        cleared++;
      }
    }

    return cleared;
  }

  /**
   * Format a compact result for display in prompts.
   */
  static formatForPrompt(compact: CompactToolResult): string {
    let formatted = `[${compact.resultId}] ${compact.summary}`;

    if (compact.healthStatus && compact.healthStatus !== 'unknown') {
      const statusEmoji =
        compact.healthStatus === 'healthy' ? '✓' : compact.healthStatus === 'degraded' ? '!' : '✗';
      formatted += ` (${statusEmoji} ${compact.healthStatus})`;
    }

    if (compact.services.length > 0) {
      formatted += `\n  Services: ${compact.services.slice(0, 5).join(', ')}`;
    }

    return formatted;
  }
}
