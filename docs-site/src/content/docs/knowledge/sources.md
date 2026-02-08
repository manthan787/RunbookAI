---
title: Knowledge Sources
description: Configure where Runbook finds knowledge
---

Runbook can sync knowledge from multiple sources. Configure sources in your config file.

## Filesystem

The simplest source—markdown files on disk.

```yaml
knowledge:
  sources:
    - type: filesystem
      path: .runbook/runbooks/
      patterns:
        - "**/*.md"
        - "**/*.yaml"
      watch: true  # Auto-reload on changes
```

### Directory Structure

```
.runbook/
├── runbooks/
│   ├── database/
│   │   ├── connection-exhaustion.md
│   │   └── replication-lag.md
│   ├── services/
│   │   ├── checkout-api.md
│   │   └── payment-service.md
│   └── infrastructure/
│       ├── scaling.md
│       └── failover.md
├── postmortems/
│   └── 2024/
│       ├── 01-15-checkout-outage.md
│       └── 01-22-database-failure.md
└── architecture/
    ├── service-topology.md
    └── data-flow.md
```

### Watch Mode

With `watch: true`, changes are automatically synced:

```bash
# Edit a runbook
vim .runbook/runbooks/database/connection-exhaustion.md

# Changes are automatically indexed
# No need to run 'runbook knowledge sync'
```

## GitHub

Sync from a GitHub repository.

```yaml
knowledge:
  sources:
    - type: github
      repo: myorg/runbooks
      branch: main
      path: docs/  # Optional: specific directory
      token: ${GITHUB_TOKEN}
```

### Private Repositories

For private repos, set a personal access token:

```bash
export GITHUB_TOKEN="ghp_xxxxxxxxxxxx"
```

Required permissions:
- `repo` (for private repos)
- `public_repo` (for public repos)

### Multiple Repos

```yaml
knowledge:
  sources:
    - type: github
      repo: myorg/sre-runbooks
      branch: main
      token: ${GITHUB_TOKEN}

    - type: github
      repo: myorg/architecture-docs
      branch: main
      path: docs/services/
      token: ${GITHUB_TOKEN}
```

## Confluence

Sync from Atlassian Confluence.

```yaml
knowledge:
  sources:
    - type: confluence
      baseUrl: https://mycompany.atlassian.net/wiki
      spaceKey: SRE
      apiToken: ${CONFLUENCE_API_TOKEN}
      email: ${CONFLUENCE_EMAIL}
```

### API Token

1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Create an API token
3. Set environment variables:

```bash
export CONFLUENCE_EMAIL="your@email.com"
export CONFLUENCE_API_TOKEN="your-token"
```

### Filtering Pages

```yaml
knowledge:
  sources:
    - type: confluence
      baseUrl: https://mycompany.atlassian.net/wiki
      spaceKey: SRE
      labels:  # Only sync pages with these labels
        - runbook
        - postmortem
      excludeLabels:
        - draft
        - archived
```

## Notion

Sync from Notion databases.

```yaml
knowledge:
  sources:
    - type: notion
      databaseId: abc123def456
      token: ${NOTION_TOKEN}
```

### Integration Setup

1. Go to https://www.notion.so/my-integrations
2. Create a new integration
3. Copy the Internal Integration Token
4. Share your database with the integration

```bash
export NOTION_TOKEN="secret_xxxxxxxxxxxx"
```

### Property Mapping

Map Notion properties to knowledge fields:

```yaml
knowledge:
  sources:
    - type: notion
      databaseId: abc123def456
      token: ${NOTION_TOKEN}
      propertyMapping:
        title: Name           # Notion property → title
        type: Type            # Notion property → type
        services: Services    # Multi-select → services array
        tags: Tags           # Multi-select → tags array
```

## API

Generic HTTP endpoint for custom sources.

```yaml
knowledge:
  sources:
    - type: api
      url: https://api.internal.com/knowledge
      method: GET
      headers:
        Authorization: "Bearer ${API_TOKEN}"
        Content-Type: application/json
      responseMapping:
        documents: data.documents  # JSONPath to documents array
        title: title
        content: body
        type: docType
```

### Pagination

```yaml
knowledge:
  sources:
    - type: api
      url: https://api.internal.com/knowledge
      pagination:
        type: offset  # or 'cursor'
        pageParam: page
        limitParam: limit
        limit: 100
```

## Source Priority

When documents exist in multiple sources, priority determines which wins:

```yaml
knowledge:
  sources:
    - type: filesystem
      path: .runbook/runbooks/
      priority: 1  # Highest priority (local overrides)

    - type: github
      repo: myorg/runbooks
      priority: 2

    - type: confluence
      spaceKey: SRE
      priority: 3  # Lowest priority
```

## Sync Configuration

```yaml
knowledge:
  sync:
    schedule: "0 */6 * * *"  # Every 6 hours (cron)
    onStartup: true           # Sync when Runbook starts
    retryAttempts: 3
    retryDelayMs: 5000
```

### Manual Sync

```bash
# Sync all sources
runbook knowledge sync

# Sync specific source
runbook knowledge sync --source github

# Force full re-sync
runbook knowledge sync --force
```

## Troubleshooting

### "Source unreachable"

```
Error: Cannot reach Confluence at https://mycompany.atlassian.net

1. Check URL is correct
2. Verify network connectivity
3. Check API credentials
```

### "No documents found"

```
Warning: No documents found in GitHub repo

1. Check path is correct
2. Verify branch exists
3. Check patterns match files
```

### "Parse error"

```
Error: Failed to parse document.md

1. Check frontmatter is valid YAML
2. Ensure required fields are present
3. Validate markdown syntax
```

## Next Steps

- [Search & Retrieval](/RunbookAI/knowledge/search/) - Using the knowledge base
- [Writing Runbooks](/RunbookAI/knowledge/writing-runbooks/) - Best practices
