---
title: Observability Tools
description: Datadog and Prometheus tool reference
---

Tools for querying metrics, logs, and traces.

## Datadog Tools

### datadog_query_metrics

Query metrics.

```
datadog_query_metrics:
  query: "avg:system.cpu.user{service:checkout-api}"
  from: 1704067200  # Unix timestamp or relative
  to: 1704153600
```

**Query Examples:**
```
avg:aws.rds.database_connections{dbinstanceidentifier:prod-db}
sum:aws.elb.request_count{name:prod-alb}.as_count()
p99:trace.servlet.request{service:api-gateway}
```

### datadog_search_logs

Search logs.

```
datadog_search_logs:
  query: "service:checkout-api status:error"
  from: "-1h"
  to: "now"
  limit: 100
```

**Query Syntax:**
```
service:checkout-api status:error
@http.status_code:>=500
env:production source:nodejs
"connection timeout"
```

### datadog_search_traces

Search distributed traces.

```
datadog_search_traces:
  query: "service:checkout-api @duration:>2s"
  from: "-1h"
  limit: 50
```

### datadog_get_monitors

Get monitor status.

```
datadog_get_monitors:
  # All monitors

datadog_get_monitors:
  tags: ["team:platform"]
  # Filtered by tag

datadog_get_monitors:
  monitor_ids: [12345, 67890]
  # Specific monitors
```

### datadog_get_events

Get events.

```
datadog_get_events:
  from: "-24h"
  tags: ["source:deployment"]
```

## Prometheus Tools

### prometheus_query

Instant query.

```
prometheus_query:
  query: "rate(http_requests_total{service='checkout'}[5m])"
  time: 1704153600  # Optional, defaults to now
```

**PromQL Examples:**
```
rate(http_requests_total[5m])
histogram_quantile(0.99, rate(request_duration_bucket[5m]))
sum(container_memory_usage_bytes) by (pod)
```

### prometheus_query_range

Range query.

```
prometheus_query_range:
  query: "rate(http_requests_total[5m])"
  start: 1704067200
  end: 1704153600
  step: 60  # Seconds between data points
```

### prometheus_get_alerts

Get firing alerts.

```
prometheus_get_alerts:
  # Returns all firing alerts
```

### prometheus_health

Check server health.

```
prometheus_health:
  # Returns health status
```

## Example Queries

### Find High Latency

**Datadog:**
```
datadog_query_metrics:
  query: "p99:trace.servlet.request{service:checkout-api}"
  from: "-1h"
```

**Prometheus:**
```
prometheus_query:
  query: "histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{service='checkout'}[5m])) by (le))"
```

### Error Rate

**Datadog:**
```
datadog_search_logs:
  query: "service:checkout-api status:error"
  from: "-1h"
```

**Prometheus:**
```
prometheus_query:
  query: "sum(rate(http_requests_total{status=~'5..'}[5m])) / sum(rate(http_requests_total[5m])) * 100"
```

### Resource Usage

**Datadog:**
```
datadog_query_metrics:
  query: "avg:container.cpu.usage{kube_deployment:checkout-api}"
```

**Prometheus:**
```
prometheus_query:
  query: "sum(container_cpu_usage_seconds_total{pod=~'checkout-api.*'}) by (pod)"
```

## Configuration

```yaml
observability:
  datadog:
    enabled: true
    apiKey: ${DATADOG_API_KEY}
    appKey: ${DATADOG_APP_KEY}
    site: datadoghq.com

  prometheus:
    enabled: true
    url: ${PROMETHEUS_URL}
```
