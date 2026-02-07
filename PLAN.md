# Runbook: Agentic Cloud Operator & Incident Investigator

An AI-powered SRE assistant that investigates incidents, executes runbooks, and manages cloud infrastructure using a research-first, hypothesis-driven methodology.

---

## Core Methodology

| Source | Contribution |
|--------|--------------|
| **Dexter** | Research-first architecture, scratchpad audit trail, skills, graceful limits |
| **Bits AI (Datadog)** | Hypothesis branching, causal focus, evidence-based pruning |
| **Organizational Knowledge** | Runbooks, post-mortems, architecture docs, service ownership |

### Investigation Flow

```
Incident Alert (PagerDuty/OpsGenie)
    ↓
Initial Context Gathering
    ├─ Alert metadata
    ├─ Recent deployments
    ├─ Service dependencies
    └─ Retrieved organizational knowledge
    ↓
Hypothesis Formation (3-5 initial hypotheses)
    ↓
Parallel Hypothesis Testing (targeted queries only)
    ↓
Branch (strong evidence) / Prune (no evidence)
    ↓
Recursive Investigation (max depth: 4)
    ↓
Root Cause Identification + Confidence Score
    ↓
Remediation (with approval for mutations)
    ↓
Scratchpad: Full Audit Trail
```

---

## Implementation Plan

### Phase 1: Project Foundation
- [x] Initialize project structure
- [x] Create PLAN.md
- [x] Set up TypeScript + Bun configuration
- [x] Set up ESLint + Prettier
- [x] Create base directory structure
- [x] Add core dependencies (Anthropic SDK, AWS SDK, etc.)

### Phase 2: Core Agent Loop
- [x] Implement base Agent class (`src/agent/agent.ts`)
  - [x] Async generator pattern for event streaming
  - [x] Iteration loop with max iterations
  - [x] Tool execution pipeline
- [x] Implement Scratchpad (`src/agent/scratchpad.ts`)
  - [x] JSONL persistence
  - [x] Tool call tracking
  - [x] Graceful limits (warn, don't block)
  - [x] Similar query detection
- [x] Implement prompt builder (`src/agent/prompts.ts`)
  - [x] System prompt with tool descriptions
  - [x] Iteration prompt with accumulated results
  - [x] Final answer prompt
- [x] Implement event types (`src/agent/types.ts`)
  - [x] ThinkingEvent, ToolStartEvent, ToolEndEvent, etc.
  - [x] Investigation-specific events

### Phase 3: Hypothesis Engine
- [x] Implement Hypothesis tree (`src/agent/hypothesis.ts`)
  - [x] Hypothesis interface (id, statement, evidence, children)
  - [x] InvestigationTree class
  - [x] Branch and prune operations
  - [x] Tree serialization for scratchpad
- [x] Implement confidence scoring (`src/agent/confidence.ts`)
  - [x] Evidence strength classification (strong/weak/none)
  - [x] Multi-factor confidence calculation
  - [x] Temporal correlation detection
- [x] Implement causal query builder (`src/agent/causal-query.ts`)
  - [x] Hypothesis-targeted query generation
  - [x] Anti-pattern detection (prevent broad data gathering)
  - [x] Query prioritization by hypothesis confidence
  - [x] Query refinement suggestions

### Phase 4: Cloud Provider Tools (AWS First)
- [x] Implement AWS client wrapper (`src/providers/aws/client.ts`)
  - [x] Credential management (assume-role, profiles)
  - [x] Region handling (multi-region support)
  - [x] Multi-account support
- [x] **Dynamic AWS Service System** (`src/providers/aws/services.ts`, `executor.ts`)
  - [x] Declarative service definitions for 40+ AWS services
  - [x] Dynamic SDK client loading (lazy imports)
  - [x] Automatic pagination handling
  - [x] Unified resource formatting
  - [x] Services by category: compute, database, storage, networking, security, analytics, integration, devtools, ml, management
- [x] Implement AWS query meta-router (`src/tools/registry.ts - aws_query`)
  - [x] Natural language to AWS API routing
  - [x] Query by service ID or category
  - [x] Parallel multi-service queries
  - [x] Result aggregation
- [x] Supported AWS Services (40+):
  - **Compute**: EC2, ECS, EKS, Lambda, Lightsail, App Runner, Amplify, Batch, ECR
  - **Database**: RDS, DynamoDB, ElastiCache, DocumentDB, Neptune, Redshift, MemoryDB
  - **Storage**: S3, EFS, FSx, Backup
  - **Networking**: VPC, ELB, CloudFront, Route 53, API Gateway, API Gateway V2
  - **Security**: IAM, Secrets Manager, KMS, ACM, WAF
  - **Integration**: SQS, SNS, EventBridge, Step Functions, Kinesis
  - **Management**: CloudWatch, CloudWatch Logs, SSM, CloudFormation
  - **DevTools**: CodePipeline, CodeBuild, CodeCommit
  - **Analytics**: Athena, Glue, OpenSearch
  - **ML**: SageMaker, Bedrock, Comprehend
- [x] Implement AWS mutation tool (`src/tools/registry.ts - aws_mutate`)
  - [x] Approval flow integration
  - [x] Rollback command display
  - [x] Risk classification
  - [x] Supported: ECS UpdateService, EC2 Reboot/Start/Stop, Lambda UpdateConfig

### Phase 5: Safety & Approval System
- [x] Implement safety layer (`src/agent/safety.ts`)
  - [x] Operation risk classification (read/low/high/critical)
  - [x] Mutation limits per session
  - [x] Cooldown between high-risk operations
- [x] Implement approval flow (`src/agent/approval.ts`)
  - [x] CLI confirmation prompts with risk display
  - [x] Risk-based approval (critical ops require typing 'yes')
  - [x] Cooldown enforcement for critical mutations
  - [x] Audit logging to `.runbook/audit/approvals.jsonl`
  - [ ] Slack approval integration (future)

### Phase 6: Observability Tools
- [x] Implement CloudWatch tools (`src/tools/aws/cloudwatch.ts`)
  - [x] Log filtering and search
  - [x] Alarm status
  - [x] Log group listing
- [x] Implement Datadog tools (`src/tools/observability/datadog.ts`)
  - [x] Metric queries
  - [x] Log search
  - [x] APM trace search
  - [x] Monitor/alert status
  - [x] Events timeline
  - [x] Service catalog
- [x] Implement generic metrics interface
  - [x] Prometheus support
    - [x] Instant and range queries
    - [x] Firing alerts
    - [x] Target health monitoring
    - [x] Common metric shortcuts
  - [ ] Custom metrics endpoints

### Phase 7: Incident Management Integration
- [x] Implement PagerDuty tools (`src/tools/incident/pagerduty.ts`)
  - [x] Get incident details
  - [x] List incidents with filters
  - [x] Get alerts for incident
  - [x] Get service configuration
  - [x] Add investigation notes
  - [x] Acknowledge/resolve incidents
- [x] Implement OpsGenie tools (`src/tools/incident/opsgenie.ts`)
  - [x] Get alert details
  - [x] List alerts with filters
  - [x] Get incident details
  - [x] List incidents
  - [x] Add notes to alerts
  - [x] Acknowledge/close alerts
- [x] Implement Slack integration (`src/tools/incident/slack.ts`)
  - [x] Post investigation updates with rich formatting
  - [x] Post root cause identification
  - [x] Read channel/thread messages
  - [x] Send simple messages
  - [x] Request mutation approval via Slack
  - [ ] Handle approval button interactions (requires webhook server)

### Phase 8: Knowledge System
- [x] Implement knowledge types (`src/knowledge/types.ts`)
  - [x] KnowledgeDocument, KnowledgeChunk interfaces
  - [x] Source configurations
- [ ] Implement filesystem source (`src/knowledge/sources/filesystem.ts`)
  - [ ] Markdown parsing with frontmatter
  - [ ] YAML support
  - [ ] File watching for hot reload
- [ ] Implement chunker (`src/knowledge/indexer/chunker.ts`)
  - [ ] Markdown-aware chunking
  - [ ] Section preservation
  - [ ] Metadata extraction
- [ ] Implement embedder (`src/knowledge/indexer/embedder.ts`)
  - [ ] OpenAI embeddings integration
  - [ ] Batch processing
- [ ] Implement vector store (`src/knowledge/store/vector-store.ts`)
  - [ ] SQLite + sqlite-vss for local storage
  - [ ] CRUD operations
  - [ ] Similarity search
- [ ] Implement service graph (`src/knowledge/store/graph-store.ts`)
  - [ ] Service nodes and edges
  - [ ] Dependency traversal
  - [ ] Ownership lookup
- [ ] Implement hybrid retriever (`src/knowledge/retriever/hybrid-search.ts`)
  - [ ] Vector + keyword search
  - [ ] Service filtering
  - [ ] Type boosting
- [ ] Implement reranker (`src/knowledge/retriever/reranker.ts`)
  - [ ] LLM-based relevance scoring
  - [ ] Hypothesis-aware ranking
- [ ] Implement context builder (`src/knowledge/retriever/context-builder.ts`)
  - [ ] Assemble retrieved knowledge for prompts
  - [ ] Token budget management

### Phase 9: Skills System
- [x] Implement skill types (`src/skills/types.ts`)
  - [x] SkillDefinition, SkillStep, SkillParameter interfaces
  - [x] Execution context and result types
- [x] Implement skill registry (`src/skills/registry.ts`)
  - [x] Built-in skill registration
  - [x] User skill loading from .runbook/skills/
  - [x] Skill lookup by ID, tag, or service
- [x] Implement skill executor (`src/skills/executor.ts`)
  - [x] Step-by-step execution
  - [x] Parameter substitution with templates
  - [x] Conditional step execution
  - [x] Error handling (continue/abort/retry)
  - [x] Approval flow integration
- [x] Create core skills (`src/skills/builtin/`)
  - [x] `investigate-incident` - Hypothesis-driven investigation
  - [x] `deploy-service` - Safe deployment with pre/post checks
  - [x] `scale-service` - Capacity planning and scaling
  - [x] `troubleshoot-service` - Diagnose and fix issues
  - [x] `rollback-deployment` - Quick and safe rollback
  - [x] `cost-analysis` - Spending analysis and optimization
  - [x] `security-audit` - IAM and security review

### Phase 10: CLI Interface
- [x] Implement CLI entry point (`src/cli.tsx`)
  - [x] Ink-based React CLI
  - [x] Command parsing
  - [x] Configuration loading
- [x] Implement core commands
  - [x] `runbook investigate <incident-id>` - Investigate incident
  - [x] `runbook ask <query>` - Natural language cloud queries
  - [x] `runbook chat` - Interactive conversation mode
  - [ ] `runbook deploy <service>` - Deploy workflow
  - [x] `runbook status` - Current infrastructure status
- [ ] Implement knowledge commands
  - [ ] `runbook knowledge sync` - Sync from sources
  - [ ] `runbook knowledge search <query>` - Search knowledge base
  - [ ] `runbook knowledge add <file>` - Add local knowledge
  - [ ] `runbook knowledge validate` - Check for stale content
- [x] Implement config commands
  - [x] `runbook init` - Interactive setup wizard with step-by-step configuration
  - [ ] `runbook config set <key> <value>` - Set config values

### Phase 11: Learning & Suggestions
- [ ] Implement learning module (`src/knowledge/learning/`)
  - [ ] Post-investigation analysis
  - [ ] Runbook suggestion generation
  - [ ] Known issue detection (recurring patterns)
- [ ] Implement knowledge update suggestions
  - [ ] New runbook drafts
  - [ ] Runbook update patches
  - [ ] Post-mortem drafts

### Phase 12: Multi-Cloud Expansion (Future)
- [ ] GCP provider (`src/providers/gcp/`)
- [ ] Azure provider (`src/providers/azure/`)
- [ ] Kubernetes provider (`src/providers/kubernetes/`)
- [ ] Terraform integration (`src/providers/terraform/`)

---

## Project Structure

```
runbook/
├── src/
│   ├── agent/
│   │   ├── agent.ts              # Main agent loop
│   │   ├── hypothesis.ts         # Hypothesis tree management
│   │   ├── confidence.ts         # Evidence scoring
│   │   ├── prompts.ts            # Prompt templates
│   │   ├── scratchpad.ts         # Audit trail
│   │   ├── safety.ts             # Mutation controls
│   │   └── types.ts              # Event types
│   ├── providers/
│   │   ├── aws/
│   │   │   ├── client.ts         # AWS SDK wrapper
│   │   │   └── tools/            # EC2, ECS, Lambda, etc.
│   │   ├── gcp/                  # Future
│   │   └── kubernetes/           # Future
│   ├── tools/
│   │   ├── registry.ts           # Tool registration
│   │   ├── skill.ts              # Skill invocation
│   │   ├── aws/
│   │   │   ├── aws-query.ts      # Read-only meta-router
│   │   │   └── aws-mutate.ts     # State changes
│   │   ├── observability/
│   │   │   ├── causal-query.ts   # Hypothesis-targeted queries
│   │   │   ├── cloudwatch.ts
│   │   │   └── datadog.ts
│   │   └── incident/
│   │       ├── pagerduty.ts
│   │       ├── opsgenie.ts
│   │       └── slack.ts
│   ├── knowledge/
│   │   ├── types.ts
│   │   ├── sources/
│   │   │   ├── filesystem.ts
│   │   │   ├── confluence.ts     # Future
│   │   │   └── github.ts         # Future
│   │   ├── indexer/
│   │   │   ├── chunker.ts
│   │   │   ├── embedder.ts
│   │   │   └── metadata.ts
│   │   ├── store/
│   │   │   ├── vector-store.ts
│   │   │   ├── graph-store.ts
│   │   │   └── sqlite.ts
│   │   ├── retriever/
│   │   │   ├── hybrid-search.ts
│   │   │   ├── reranker.ts
│   │   │   └── context-builder.ts
│   │   └── learning/
│   │       ├── suggest-updates.ts
│   │       └── auto-enrich.ts
│   ├── skills/
│   │   ├── registry.ts
│   │   ├── investigate-incident/
│   │   │   └── SKILL.md
│   │   ├── deploy-service/
│   │   │   └── SKILL.md
│   │   ├── scale-service/
│   │   │   └── SKILL.md
│   │   ├── troubleshoot-service/
│   │   │   └── SKILL.md
│   │   └── cost-analysis/
│   │       └── SKILL.md
│   ├── model/
│   │   └── llm.ts                # LLM client with caching
│   ├── hooks/
│   │   └── useAgentRunner.ts     # React hook for CLI
│   ├── utils/
│   │   ├── tokens.ts             # Token counting
│   │   └── config.ts             # Configuration loading
│   └── cli.tsx                   # CLI entry point
├── .runbook/                     # User configuration (gitignored)
│   ├── config.yaml
│   ├── runbooks/                 # Local runbooks
│   ├── knowledge.db              # SQLite + vectors
│   ├── service-graph.json
│   ├── scratchpad/               # Investigation logs
│   └── investigations/           # Investigation trees
├── examples/
│   └── runbooks/                 # Example runbooks
├── package.json
├── tsconfig.json
├── bunfig.toml
├── PLAN.md                       # This file
└── README.md
```

---

## Configuration Schema

**`.runbook/config.yaml`**

```yaml
# LLM Configuration
llm:
  provider: anthropic  # anthropic | openai
  model: claude-sonnet-4-20250514
  api_key: ${ANTHROPIC_API_KEY}

# Cloud Providers
providers:
  aws:
    enabled: true
    regions: [us-east-1, us-west-2]
    profile: default  # AWS profile or use env vars

# Incident Management
incident:
  pagerduty:
    enabled: true
    api_key: ${PAGERDUTY_API_KEY}
  opsgenie:
    enabled: false
  slack:
    enabled: true
    bot_token: ${SLACK_BOT_TOKEN}

# Knowledge Sources
knowledge:
  sources:
    - type: filesystem
      path: .runbook/runbooks/
      watch: true
    - type: filesystem
      path: ~/.runbook/knowledge/

  store:
    type: local
    path: .runbook/knowledge.db
    embedding_model: text-embedding-3-small

  retrieval:
    top_k: 10
    rerank: true

# Safety
safety:
  require_approval:
    - high_risk
    - critical
  max_mutations_per_session: 5
  cooldown_between_critical_ms: 60000

# Agent
agent:
  max_iterations: 10
  max_hypothesis_depth: 4
  context_threshold_tokens: 100000
```

---

## Key Design Decisions

### 1. Hypothesis-Driven Investigation
Rather than gathering all available data, we form hypotheses and test them with targeted queries. This reduces noise and focuses on causal relationships.

### 2. Graceful Limits
Tool limits warn but never block. The agent can always proceed, but gets warnings to prevent retry loops.

### 3. Research-First for Mutations
All state-changing operations require prior research to understand current state and impact.

### 4. Full Audit Trail
Every tool call, hypothesis, and decision is logged to JSONL for compliance and debugging.

### 5. Knowledge as First-Class Citizen
Organizational runbooks and post-mortems are indexed and retrieved during investigations, not just appended as context.

### 6. Multi-Cloud Ready
Provider abstraction allows adding GCP, Azure, K8s without changing core agent logic.

---

## Dependencies

### Core
- `bun` - Runtime
- `typescript` - Type safety
- `@langchain/anthropic` - LLM integration
- `@langchain/core` - Agent primitives
- `zod` - Schema validation

### AWS
- `@aws-sdk/client-ec2`
- `@aws-sdk/client-ecs`
- `@aws-sdk/client-lambda`
- `@aws-sdk/client-rds`
- `@aws-sdk/client-elasticache`
- `@aws-sdk/client-cloudwatch`
- `@aws-sdk/client-cloudwatch-logs`
- `@aws-sdk/client-iam`

### Incident Management
- `node-pagerduty` or raw API
- `@slack/web-api`

### Knowledge
- `better-sqlite3` - Local storage
- `sqlite-vss` - Vector search
- `openai` - Embeddings
- `gray-matter` - Frontmatter parsing
- `marked` - Markdown parsing

### CLI
- `ink` - React for CLI
- `ink-spinner` - Loading states
- `commander` - Command parsing
- `chalk` - Colors

---

## Success Metrics

1. **Investigation Accuracy**: Root cause correctly identified in >80% of incidents
2. **Time to Resolution**: Reduce MTTR by providing faster diagnosis
3. **Runbook Coverage**: Track which incidents had matching runbooks
4. **Knowledge Freshness**: Alert on stale runbooks (>90 days without validation)
5. **Safety**: Zero unauthorized mutations, full audit trail

---

## Progress Summary

**Completed:**
- Phase 1: Project Foundation (100%)
- Phase 2: Core Agent Loop (100%)
- Phase 3: Hypothesis Engine (100% - causal query builder with anti-pattern detection)
- Phase 4: AWS Tools (100% - 40+ services with dynamic loading)
- Phase 5: Safety Layer (90% - approval flow complete, missing Slack integration)
- Phase 6: Observability (100% - CloudWatch, Datadog, Prometheus integration)
- Phase 7: Incident Management (100% - PagerDuty, OpsGenie, Slack complete)
- Phase 8: Knowledge System (80% - filesystem source, SQLite store, FTS search)
- Phase 9: Skills (100% - 7 core skills with executor and registry)
- Phase 10: CLI Interface (90% - ask, chat, investigate, status, init wizard, config, knowledge commands)

**New Features:**
- Multi-AWS account support with assume-role and profiles
- Service configuration system for targeted infrastructure scanning
- Quick setup templates (ecs-rds, serverless, enterprise)
- Interactive setup wizard (`runbook init`) with step-by-step configuration
- **Dynamic AWS Service System (40+ services)**:
  - Declarative service definitions with automatic SDK loading
  - Query by service ID, category, or all services
  - Parallel execution with unified result formatting
  - Automatic pagination handling
  - Categories: compute, database, storage, networking, security, analytics, integration, devtools, ml, management
- Mutation approval flow with risk classification (low/medium/high/critical)
- AWS mutations: ECS scaling, EC2 start/stop/reboot, Lambda config updates
- Audit trail for all approved/rejected mutations
- Interactive chat interface (`runbook chat`) with conversation history
- Datadog integration (metrics, logs, traces, monitors, events)
- Skill system with 7 built-in workflows:
  - investigate-incident, deploy-service, scale-service
  - troubleshoot-service, rollback-deployment
  - cost-analysis, security-audit
- Skill executor with templating, conditions, and error handling
- User-defined skills via YAML in .runbook/skills/
- Causal query builder with pattern-based investigation queries
  - Detects failure patterns (latency, errors, memory, CPU, etc.)
  - Generates targeted queries per hypothesis
  - Prevents broad data gathering with anti-pattern detection
- Slack integration for incident communication:
  - Post investigation updates with rich Block Kit formatting
  - Post root cause identification with evidence
  - Read channel/thread context for investigation
  - Request approval for mutations via Slack buttons
- OpsGenie integration:
  - Get/list alerts and incidents
  - Add investigation notes
  - Acknowledge and close alerts
- Prometheus integration:
  - Instant and range PromQL queries
  - Firing alerts monitoring
  - Target health checks
  - Common metric shortcuts (CPU, memory, disk, network, K8s)

**GitHub:** https://github.com/manthan787/RunbookAI

**Next Steps:**

1. Implement Slack webhook server for approval button interactions
2. Add describe operations for AWS services (detailed resource info)
3. Implement vector embeddings for semantic knowledge search
4. Add service graph for dependency visualization
5. Add custom metrics endpoint support

**Usage:**
```bash
# Quick setup
runbook init --template ecs-rds --regions us-east-1

# Interactive chat mode
runbook chat

# One-shot queries
runbook ask "what's running in prod?"
runbook ask "show me all S3 buckets and Lambda functions"

# Investigate incident
runbook investigate PD-12345

# Check status
runbook status

# Search knowledge
runbook knowledge search "redis timeout"
```
