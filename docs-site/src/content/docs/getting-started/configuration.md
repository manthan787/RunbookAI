---
title: Configuration
description: Complete configuration reference for Runbook
---

Runbook is configured via a YAML file at `.runbook/config.yaml`. This page covers all available options.

## Configuration File

The default configuration file location is `.runbook/config.yaml` in your project root. You can also specify a custom location:

```bash
runbook --config /path/to/config.yaml ask "your query"
```

## Complete Configuration Reference

```yaml
# LLM Configuration
llm:
  provider: anthropic          # anthropic, openai, google, mistral, groq, xai
  model: claude-opus-4-5-20251101
  apiKey: ${ANTHROPIC_API_KEY} # Environment variable interpolation

# Cloud Providers
providers:
  aws:
    enabled: true
    regions:
      - us-east-1
      - us-west-2
    profile: default           # AWS CLI profile name

  kubernetes:
    enabled: false
    context: my-cluster        # kubectl context
    namespace: default         # Default namespace
    kubeconfig: ~/.kube/config # Path to kubeconfig

# Incident Management
incident:
  pagerduty:
    enabled: true
    apiKey: ${PAGERDUTY_API_KEY}

  opsgenie:
    enabled: false
    apiKey: ${OPSGENIE_API_KEY}

  slack:
    enabled: true
    botToken: ${SLACK_BOT_TOKEN}
    signingSecret: ${SLACK_SIGNING_SECRET}
    defaultChannel: "#incidents"

# Knowledge System
knowledge:
  sources:
    - type: filesystem
      path: .runbook/runbooks/
      watch: true              # Auto-reload on changes

    - type: confluence
      baseUrl: https://wiki.example.com
      spaceKey: OPS
      apiToken: ${CONFLUENCE_API_TOKEN}

    - type: github
      repo: myorg/infrastructure
      branch: main
      path: docs/runbooks
      token: ${GITHUB_TOKEN}

  store:
    type: local                # local, pinecone, weaviate, qdrant
    path: .runbook/knowledge.db
    embeddingModel: text-embedding-3-small

  retrieval:
    topK: 10                   # Number of results to retrieve
    rerank: true               # Re-rank results for relevance

# Safety Configuration
safety:
  requireApproval:
    - low_risk                 # Require approval for all risk levels
    - medium_risk
    - high_risk
    - critical
  maxMutationsPerSession: 10   # Max write operations per session
  cooldownBetweenCriticalMs: 60000  # 1 minute between critical ops

# Agent Behavior
agent:
  maxIterations: 10            # Max investigation iterations
  maxHypothesisDepth: 4        # Max depth of hypothesis tree
  contextThresholdTokens: 100000  # Token limit before compaction
```

## Configuration Sections

### LLM Configuration

Runbook supports multiple LLM providers through the unified pi-ai abstraction:

| Provider | Models |
|----------|--------|
| `anthropic` | claude-opus-4-5-20251101, claude-sonnet-4-20250514, claude-3-haiku |
| `openai` | gpt-4o, gpt-4-turbo, gpt-3.5-turbo |
| `google` | gemini-pro, gemini-ultra |
| `mistral` | mistral-large, mistral-medium |
| `groq` | llama-3.1-70b, mixtral-8x7b |
| `xai` | grok-2 |

```yaml
llm:
  provider: anthropic
  model: claude-opus-4-5-20251101
  apiKey: ${ANTHROPIC_API_KEY}

  # Optional: Advanced settings
  temperature: 0.1            # Lower = more deterministic
  maxTokens: 4096             # Max response tokens
```

### AWS Configuration

Configure AWS access and regions:

```yaml
providers:
  aws:
    enabled: true
    regions:
      - us-east-1
      - us-west-2
      - eu-west-1
    profile: production        # AWS CLI profile

    # Optional: Assume role for cross-account access
    assumeRole: arn:aws:iam::123456789012:role/RunbookRole
    externalId: your-external-id
```

### Kubernetes Configuration

Enable Kubernetes integration:

```yaml
providers:
  kubernetes:
    enabled: true
    context: production-cluster
    namespace: default
    kubeconfig: ~/.kube/config

    # Optional: Multiple contexts
    contexts:
      - name: production
        context: prod-east
        namespace: prod
      - name: staging
        context: staging
        namespace: staging
```

### Incident Management

Configure PagerDuty, OpsGenie, and Slack:

```yaml
incident:
  pagerduty:
    enabled: true
    apiKey: ${PAGERDUTY_API_KEY}
    serviceIds:               # Optional: Filter to specific services
      - PXXXXXX
      - PYYYYYY

  opsgenie:
    enabled: false
    apiKey: ${OPSGENIE_API_KEY}
    region: us                 # us or eu

  slack:
    enabled: true
    botToken: ${SLACK_BOT_TOKEN}
    signingSecret: ${SLACK_SIGNING_SECRET}
    defaultChannel: "#incidents"
    approvalChannel: "#approvals"
```

### Knowledge Sources

Configure where Runbook finds organizational knowledge:

```yaml
knowledge:
  sources:
    # Local filesystem
    - type: filesystem
      path: .runbook/runbooks/
      patterns:
        - "**/*.md"
        - "**/*.yaml"
      watch: true

    # Confluence wiki
    - type: confluence
      baseUrl: https://wiki.company.com
      spaceKey: SRE
      apiToken: ${CONFLUENCE_TOKEN}

    # Notion database
    - type: notion
      databaseId: abc123
      token: ${NOTION_TOKEN}

    # GitHub repository
    - type: github
      repo: company/runbooks
      branch: main
      path: docs/
      token: ${GITHUB_TOKEN}

    # Generic API endpoint
    - type: api
      url: https://api.company.com/runbooks
      headers:
        Authorization: "Bearer ${API_TOKEN}"
```

### Safety Controls

Configure approval requirements and limits:

```yaml
safety:
  # Risk levels that require approval
  requireApproval:
    - high_risk
    - critical

  # Skip approval for these operations (use carefully)
  skipApproval:
    - describe
    - list
    - get

  # Rate limits
  maxMutationsPerSession: 10
  cooldownBetweenCriticalMs: 60000

  # Blocked operations (never allowed)
  blockedOperations:
    - terminate-instances
    - delete-db-cluster
```

## Environment Variables

Runbook supports environment variable interpolation using `${VAR_NAME}` syntax:

```yaml
llm:
  apiKey: ${ANTHROPIC_API_KEY}

providers:
  aws:
    profile: ${AWS_PROFILE:-default}  # With default value
```

### Required Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key (if using) |
| `OPENAI_API_KEY` | OpenAI API key (if using) |
| `AWS_*` | AWS credentials (or use IAM roles) |

### Optional Variables

| Variable | Purpose |
|----------|---------|
| `PAGERDUTY_API_KEY` | PagerDuty integration |
| `OPSGENIE_API_KEY` | OpsGenie integration |
| `SLACK_BOT_TOKEN` | Slack bot integration |
| `SLACK_SIGNING_SECRET` | Slack webhook verification |
| `DATADOG_API_KEY` | Datadog metrics/logs |
| `PROMETHEUS_URL` | Prometheus server URL |

## Viewing Configuration

Check your current configuration:

```bash
# Show full configuration
runbook config

# Show specific section
runbook config --services
runbook config --providers

# Validate configuration
runbook config --validate
```

## Modifying Configuration

Update configuration via CLI:

```bash
# Set a value
runbook config --set llm.model=gpt-4o

# Enable a provider
runbook config --set providers.kubernetes.enabled=true

# Add a region
runbook config --set providers.aws.regions+=eu-central-1
```

## Configuration Precedence

Configuration values are resolved in this order (highest priority first):

1. Command-line arguments
2. Environment variables
3. `.runbook/config.yaml`
4. Default values

## Next Steps

- [Architecture](/RunbookAI/concepts/architecture/) - Understand how Runbook works
- [CLI Reference](/RunbookAI/cli/overview/) - Explore all commands
