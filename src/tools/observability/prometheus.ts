/**
 * Prometheus Tools
 *
 * Query Prometheus for metrics, alerts, and targets.
 * Supports standard Prometheus HTTP API.
 */

interface PrometheusConfig {
  baseUrl: string;
  username?: string;
  password?: string;
}

let config: PrometheusConfig | null = null;

export function configure(baseUrl: string, username?: string, password?: string): void {
  config = { baseUrl, username, password };
}

function getBaseUrl(): string {
  if (config?.baseUrl) return config.baseUrl;
  if (process.env.PROMETHEUS_URL) return process.env.PROMETHEUS_URL;
  throw new Error('Prometheus URL not configured. Set PROMETHEUS_URL environment variable.');
}

export function isPrometheusConfigured(): boolean {
  return !!(config?.baseUrl || process.env.PROMETHEUS_URL);
}

async function promFetch<T>(path: string): Promise<T> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {};

  // Add basic auth if configured
  const username = config?.username || process.env.PROMETHEUS_USERNAME;
  const password = config?.password || process.env.PROMETHEUS_PASSWORD;
  if (username && password) {
    headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Prometheus API error: ${response.status} ${error}`);
  }

  const data = await response.json() as {
    status: 'success' | 'error';
    data?: T;
    error?: string;
    errorType?: string;
  };

  if (data.status === 'error') {
    throw new Error(`Prometheus query error: ${data.errorType} - ${data.error}`);
  }

  return data.data as T;
}

export interface PrometheusInstantResult {
  resultType: 'vector' | 'matrix' | 'scalar' | 'string';
  result: Array<{
    metric: Record<string, string>;
    value?: [number, string]; // [timestamp, value] for vector
    values?: Array<[number, string]>; // [[timestamp, value], ...] for matrix
  }>;
}

export interface PrometheusAlert {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: 'firing' | 'pending' | 'inactive';
  activeAt: string;
  value: string;
}

export interface PrometheusAlertGroup {
  name: string;
  file: string;
  rules: Array<{
    name: string;
    query: string;
    duration: number;
    labels: Record<string, string>;
    annotations: Record<string, string>;
    alerts: PrometheusAlert[];
    health: string;
    type: string;
  }>;
}

export interface PrometheusTarget {
  discoveredLabels: Record<string, string>;
  labels: Record<string, string>;
  scrapePool: string;
  scrapeUrl: string;
  globalUrl: string;
  lastError: string;
  lastScrape: string;
  lastScrapeDuration: number;
  health: 'up' | 'down' | 'unknown';
}

export interface PrometheusTargetsResult {
  activeTargets: PrometheusTarget[];
  droppedTargets: Array<{ discoveredLabels: Record<string, string> }>;
}

/**
 * Query Prometheus for instant data (single point in time)
 */
export async function instantQuery(
  query: string,
  time?: Date
): Promise<PrometheusInstantResult> {
  const params = new URLSearchParams({ query });
  if (time) {
    params.set('time', (time.getTime() / 1000).toString());
  }

  return promFetch<PrometheusInstantResult>(`/api/v1/query?${params.toString()}`);
}

/**
 * Query Prometheus for range data (time series)
 */
export async function rangeQuery(
  query: string,
  start: Date,
  end: Date,
  step: string = '15s'
): Promise<PrometheusInstantResult> {
  const params = new URLSearchParams({
    query,
    start: (start.getTime() / 1000).toString(),
    end: (end.getTime() / 1000).toString(),
    step,
  });

  return promFetch<PrometheusInstantResult>(`/api/v1/query_range?${params.toString()}`);
}

/**
 * Get all active alerts from Prometheus Alertmanager
 */
export async function getAlerts(): Promise<PrometheusAlertGroup[]> {
  return promFetch<PrometheusAlertGroup[]>('/api/v1/rules?type=alert');
}

/**
 * Get firing alerts only
 */
export async function getFiringAlerts(): Promise<Array<{
  alertname: string;
  instance?: string;
  job?: string;
  severity?: string;
  summary?: string;
  description?: string;
  state: 'firing' | 'pending';
  activeAt: string;
}>> {
  const groups = await getAlerts();
  const firingAlerts: Array<{
    alertname: string;
    instance?: string;
    job?: string;
    severity?: string;
    summary?: string;
    description?: string;
    state: 'firing' | 'pending';
    activeAt: string;
  }> = [];

  for (const group of groups) {
    for (const rule of group.rules) {
      for (const alert of rule.alerts) {
        if (alert.state === 'firing' || alert.state === 'pending') {
          firingAlerts.push({
            alertname: rule.name,
            instance: alert.labels.instance,
            job: alert.labels.job,
            severity: alert.labels.severity,
            summary: alert.annotations.summary,
            description: alert.annotations.description,
            state: alert.state,
            activeAt: alert.activeAt,
          });
        }
      }
    }
  }

  return firingAlerts;
}

/**
 * Get scrape targets and their health
 */
export async function getTargets(): Promise<PrometheusTargetsResult> {
  return promFetch<PrometheusTargetsResult>('/api/v1/targets');
}

/**
 * Get target health summary
 */
export async function getTargetHealth(): Promise<{
  healthy: number;
  unhealthy: number;
  targets: Array<{
    job: string;
    instance: string;
    health: 'up' | 'down' | 'unknown';
    lastError: string;
    lastScrape: string;
  }>;
}> {
  const { activeTargets } = await getTargets();

  const healthy = activeTargets.filter((t) => t.health === 'up').length;
  const unhealthy = activeTargets.filter((t) => t.health !== 'up').length;

  return {
    healthy,
    unhealthy,
    targets: activeTargets.map((t) => ({
      job: t.labels.job || t.discoveredLabels.__address__ || 'unknown',
      instance: t.labels.instance || t.discoveredLabels.__address__ || 'unknown',
      health: t.health,
      lastError: t.lastError,
      lastScrape: t.lastScrape,
    })),
  };
}

/**
 * Get series metadata
 */
export async function getSeries(
  match: string[],
  start?: Date,
  end?: Date
): Promise<Array<Record<string, string>>> {
  const params = new URLSearchParams();
  match.forEach((m) => params.append('match[]', m));
  if (start) params.set('start', (start.getTime() / 1000).toString());
  if (end) params.set('end', (end.getTime() / 1000).toString());

  return promFetch<Array<Record<string, string>>>(`/api/v1/series?${params.toString()}`);
}

/**
 * Get label values for a label name
 */
export async function getLabelValues(labelName: string): Promise<string[]> {
  return promFetch<string[]>(`/api/v1/label/${labelName}/values`);
}

/**
 * Get all label names
 */
export async function getLabels(): Promise<string[]> {
  return promFetch<string[]>('/api/v1/labels');
}

/**
 * Common metric queries for infrastructure monitoring
 */
export const COMMON_QUERIES = {
  // CPU
  cpuUsage: 'avg(rate(node_cpu_seconds_total{mode!="idle"}[5m])) by (instance) * 100',
  cpuUsageByNode: '100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)',

  // Memory
  memoryUsage: '(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100',
  memoryUsageByNode: '100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)',

  // Disk
  diskUsage: '(1 - node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes{fstype!~"tmpfs|overlay"}) * 100',
  diskIO: 'rate(node_disk_io_time_seconds_total[5m]) * 100',

  // Network
  networkReceive: 'rate(node_network_receive_bytes_total{device!="lo"}[5m])',
  networkTransmit: 'rate(node_network_transmit_bytes_total{device!="lo"}[5m])',

  // HTTP (if instrumented)
  requestRate: 'sum(rate(http_requests_total[5m])) by (service)',
  errorRate: 'sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) * 100',
  latencyP99: 'histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service))',
  latencyP95: 'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service))',
  latencyP50: 'histogram_quantile(0.50, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service))',

  // Container
  containerCpu: 'sum(rate(container_cpu_usage_seconds_total{name!=""}[5m])) by (name) * 100',
  containerMemory: 'sum(container_memory_working_set_bytes{name!=""}) by (name)',

  // Kubernetes
  podReady: 'sum(kube_pod_status_ready{condition="true"}) by (namespace)',
  podNotReady: 'sum(kube_pod_status_ready{condition="false"}) by (namespace)',
  deploymentReplicas: 'kube_deployment_status_replicas_available',
  nodeCpuK8s: 'sum(rate(container_cpu_usage_seconds_total{pod!=""}[5m])) by (node) * 100',
};

/**
 * Quick health check - returns key metrics for investigation
 */
export async function getQuickHealthCheck(): Promise<{
  alertCount: number;
  targetHealth: { healthy: number; unhealthy: number };
  topCpu?: Array<{ instance: string; value: number }>;
  topMemory?: Array<{ instance: string; value: number }>;
}> {
  const [alerts, targetHealth] = await Promise.all([
    getFiringAlerts().catch(() => []),
    getTargetHealth().catch(() => ({ healthy: 0, unhealthy: 0, targets: [] })),
  ]);

  // Try to get CPU and memory metrics
  let topCpu: Array<{ instance: string; value: number }> = [];
  let topMemory: Array<{ instance: string; value: number }> = [];

  try {
    const cpuResult = await instantQuery(COMMON_QUERIES.cpuUsageByNode);
    topCpu = cpuResult.result
      .map((r) => ({
        instance: r.metric.instance || 'unknown',
        value: r.value ? parseFloat(r.value[1]) : 0,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  } catch {
    // Metrics may not be available
  }

  try {
    const memResult = await instantQuery(COMMON_QUERIES.memoryUsageByNode);
    topMemory = memResult.result
      .map((r) => ({
        instance: r.metric.instance || 'unknown',
        value: r.value ? parseFloat(r.value[1]) : 0,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  } catch {
    // Metrics may not be available
  }

  return {
    alertCount: alerts.length,
    targetHealth: { healthy: targetHealth.healthy, unhealthy: targetHealth.unhealthy },
    topCpu: topCpu.length > 0 ? topCpu : undefined,
    topMemory: topMemory.length > 0 ? topMemory : undefined,
  };
}
