---
title: Datadog Integration
description: Query metrics, logs, and traces from Datadog
---

Runbook integrates with Datadog for metrics, logs, traces, and monitor status.

## Configuration

```yaml
# .runbook/config.yaml
observability:
  datadog:
    enabled: true
    apiKey: ${DATADOG_API_KEY}
    appKey: ${DATADOG_APP_KEY}
    site: datadoghq.com  # or datadoghq.eu, etc.
```

## API Keys Setup

1. Go to Datadog → Organization Settings → API Keys
2. Create an API key
3. Go to Organization Settings → Application Keys
4. Create an Application key
5. Set environment variables:

```bash
export DATADOG_API_KEY="your-api-key"
export DATADOG_APP_KEY="your-app-key"
```

## Available Tools

### datadog_query_metrics

Query metrics using Datadog's query language:

```bash
runbook ask "Show CPU usage for checkout-api over the last hour"
```

Example queries:
```
avg:system.cpu.user{service:checkout-api}
sum:aws.elb.request_count{name:prod-alb}.as_count()
p99:trace.servlet.request{service:api-gateway}
```

### datadog_search_logs

Search logs across your infrastructure:

```bash
runbook ask "Find error logs from checkout-api in the last 30 minutes"
```

Supports full Datadog log query syntax:
```
service:checkout-api status:error
@http.status_code:>=500
env:production source:nodejs
```

### datadog_search_traces

Search distributed traces:

```bash
runbook ask "Find slow traces for the payment endpoint"
```

### datadog_get_monitors

Get monitor status and triggered alerts:

```bash
runbook ask "Which Datadog monitors are currently alerting?"
```

### datadog_get_events

Retrieve Datadog events:

```bash
runbook ask "Show Datadog events from the last hour"
```

## Usage Examples

### Metrics Analysis

```bash
# Service metrics
runbook ask "What's the request rate for checkout-api?"

# Comparison
runbook ask "Compare error rates between production and staging"

# Resource usage
runbook ask "Show memory usage trend for the API cluster"
```

### Log Investigation

```bash
# Error logs
runbook ask "Find all 500 errors in production logs"

# Pattern search
runbook ask "Search logs for 'connection timeout'"

# Correlated logs
runbook ask "Show logs from checkout-api during the incident window"
```

### Trace Analysis

```bash
# Slow requests
runbook ask "Find traces with latency over 2 seconds"

# Error traces
runbook ask "Show traces with errors for the payment service"

# Specific endpoint
runbook ask "Analyze traces for POST /api/checkout"
```

### Monitor Status

```bash
# Active alerts
runbook ask "Are any monitors currently alerting?"

# Specific monitors
runbook ask "What's the status of database monitors?"

# Alert history
runbook ask "Which monitors triggered in the last 24 hours?"
```

## Datadog Sites

Configure the correct site for your region:

| Site | URL |
|------|-----|
| US1 | datadoghq.com |
| US3 | us3.datadoghq.com |
| US5 | us5.datadoghq.com |
| EU | datadoghq.eu |
| AP1 | ap1.datadoghq.com |

```yaml
observability:
  datadog:
    site: datadoghq.eu  # For EU region
```

## Required Permissions

API key needs:
- Read access to metrics, logs, traces
- Read access to monitors

Application key should have:
- `metrics_read`
- `logs_read`
- `traces_read`
- `monitors_read`

## Next Steps

- [Prometheus Integration](/RunbookAI/integrations/prometheus/) - Alternative metrics source
- [Observability Tools](/RunbookAI/tools/observability/) - Tool reference
