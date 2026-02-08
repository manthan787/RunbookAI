---
title: Prometheus Integration
description: Query metrics and alerts from Prometheus
---

Runbook integrates with Prometheus for metrics queries and alert status.

## Configuration

```yaml
# .runbook/config.yaml
observability:
  prometheus:
    enabled: true
    url: ${PROMETHEUS_URL}  # e.g., http://prometheus:9090
    # Optional authentication
    username: ${PROMETHEUS_USER}
    password: ${PROMETHEUS_PASSWORD}
```

## Available Tools

### prometheus_query

Execute instant queries:

```bash
runbook ask "What's the current request rate?"
```

Uses PromQL:
```promql
rate(http_requests_total{service="checkout"}[5m])
sum(container_memory_usage_bytes{namespace="prod"}) by (pod)
histogram_quantile(0.99, rate(request_duration_seconds_bucket[5m]))
```

### prometheus_query_range

Execute range queries over time:

```bash
runbook ask "Show CPU usage over the last hour"
```

### prometheus_get_alerts

Get currently firing alerts:

```bash
runbook ask "Are there any Prometheus alerts firing?"
```

### prometheus_health

Check Prometheus server health:

```bash
runbook ask "Is Prometheus healthy?"
```

## Usage Examples

### Metrics Queries

```bash
# Request rate
runbook ask "What's the request rate for checkout-api over the last 5 minutes?"

# Error rate
runbook ask "Calculate the error percentage for production services"

# Latency
runbook ask "Show p99 latency for API endpoints"

# Resource usage
runbook ask "Which pods are using the most memory?"
```

### Range Queries

```bash
# Historical data
runbook ask "Show request rate trend for the last 6 hours"

# Comparison
runbook ask "Compare today's error rate to yesterday"
```

### Alert Status

```bash
# All firing alerts
runbook ask "What Prometheus alerts are currently firing?"

# Specific alerts
runbook ask "Is the high-CPU alert firing?"

# Alert history
runbook ask "Show alerts that fired in the last hour"
```

## PromQL Reference

Runbook translates natural language to PromQL:

| Natural Language | PromQL |
|-----------------|--------|
| "request rate for checkout" | `rate(http_requests_total{service="checkout"}[5m])` |
| "error percentage" | `sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) * 100` |
| "p99 latency" | `histogram_quantile(0.99, sum(rate(request_duration_bucket[5m])) by (le))` |
| "memory usage by pod" | `sum(container_memory_usage_bytes) by (pod)` |

## Authentication

### Basic Auth

```yaml
observability:
  prometheus:
    url: https://prometheus.example.com
    username: ${PROMETHEUS_USER}
    password: ${PROMETHEUS_PASSWORD}
```

### Bearer Token

```yaml
observability:
  prometheus:
    url: https://prometheus.example.com
    bearerToken: ${PROMETHEUS_TOKEN}
```

## Multiple Prometheus Instances

```yaml
observability:
  prometheus:
    instances:
      - name: production
        url: http://prometheus-prod:9090
        default: true
      - name: staging
        url: http://prometheus-staging:9090
```

Query specific instance:
```bash
runbook ask "Show metrics from staging Prometheus"
```

## Troubleshooting

### Connection Errors

```
Error: Cannot connect to Prometheus at http://prometheus:9090

1. Verify Prometheus URL is correct
2. Check network connectivity
3. Ensure Prometheus is running
```

### Query Errors

```
Error: PromQL parse error

The query syntax was invalid. Check:
1. Metric names are correct
2. Label selectors use proper syntax
3. Functions are applied correctly
```

## Next Steps

- [Datadog Integration](/RunbookAI/integrations/datadog/) - Alternative observability
- [Observability Tools](/RunbookAI/tools/observability/) - Tool reference
