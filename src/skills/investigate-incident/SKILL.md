# Investigate Incident Skill

Perform a hypothesis-driven investigation of an incident to identify root cause.

## Arguments

- `incident_id`: PagerDuty or OpsGenie incident ID
- `service`: (optional) Primary service affected

## Workflow

### Step 1: Gather Incident Context

- [ ] Fetch incident details from PagerDuty/OpsGenie
- [ ] Identify affected service(s) from alert tags
- [ ] Pull service dependency map from knowledge base
- [ ] Check for recent deployments (last 24h)
- [ ] Query for similar historical incidents

**Tools to use:**
- `pagerduty_get_incident` or `opsgenie_get_alert`
- `search_knowledge` with type_filter: ['architecture', 'ownership']
- `aws_query`: "list recent ECS deployments" or "recent Lambda updates"

### Step 2: Form Initial Hypotheses

Based on alert type and gathered context, generate 3-5 hypotheses.

| Alert Pattern | Likely Hypotheses |
|--------------|-------------------|
| High error rate | Bad deploy, dependency failure, resource exhaustion |
| High latency | Database slow, downstream timeout, CPU saturation |
| Pod crashloop | OOM, missing config, bad image, init failure |
| Connection timeout | Network issue, DNS, service down, connection pool |

For each hypothesis, identify:
- Key signals that would confirm it
- Key signals that would refute it
- Targeted query to gather evidence

### Step 3: Test Hypotheses (Parallel)

For each hypothesis, execute targeted queries. **Do NOT gather broad data.**

For each result:
- [ ] Classify evidence strength: STRONG / WEAK / NONE
- [ ] Record reasoning
- [ ] Update hypothesis status

**Evidence Classification:**

- **STRONG**: Direct, unambiguous signal (e.g., OOM killer events, error spike at exact incident time)
- **WEAK**: Suggestive but could have other explanations (e.g., slightly elevated metrics)
- **NONE**: No supporting evidence or contradicting evidence

### Step 4: Branch on Strong Evidence

For hypotheses with STRONG evidence but unclear root cause:

- [ ] Generate 2-3 sub-hypotheses that dig deeper
- [ ] Repeat Step 3 for sub-hypotheses
- [ ] Maximum depth: 4 levels

### Step 5: Prune Weak Branches

For hypotheses with NONE evidence:

- [ ] Mark as eliminated
- [ ] Record why (e.g., "Metrics normal", "Timeline doesn't match")
- [ ] Focus resources on remaining hypotheses

### Step 6: Confirm Root Cause

When a hypothesis has:
- Strong evidence at current or child level
- No contradicting signals
- Clear causal explanation

Mark it as confirmed and calculate confidence:

- **HIGH**: Deep evidence chain + corroborating signals + temporal match
- **MEDIUM**: Evidence supports but some uncertainty
- **LOW**: Best available explanation but limited evidence

### Step 7: Search for Runbooks

- [ ] Search knowledge base for runbooks matching root cause
- [ ] If runbook exists, follow its remediation steps
- [ ] If no runbook, suggest remediation based on root cause type

**Tools to use:**
- `search_knowledge` with query matching root cause

### Step 8: Suggest Remediation

Based on root cause and any matching runbooks:

- [ ] Immediate mitigation (what to do now)
- [ ] Verification steps (how to confirm fix worked)
- [ ] Long-term fixes (prevent recurrence)

For any mutation:
- Show exact command
- Show rollback command
- Request approval before execution

### Step 9: Document Investigation

Post investigation summary to incident channel:

- [ ] Root cause with confidence level
- [ ] Evidence chain (key findings)
- [ ] Remediation steps taken/suggested
- [ ] Timeline of investigation

**Tools to use:**
- `pagerduty_add_note` or `slack_post_update`

## Output Format

```markdown
## Investigation Summary

**Incident:** {incident_id}
**Duration:** {investigation_duration}
**Confidence:** {HIGH|MEDIUM|LOW}

### Root Cause

{Clear statement of root cause}

### Evidence Chain

1. {First key finding}
2. {Second key finding}
3. {Third key finding}

### Hypotheses Explored

| Hypothesis | Evidence | Status |
|------------|----------|--------|
| {H1} | {STRONG/WEAK/NONE} | {Confirmed/Pruned} |
| {H2} | {STRONG/WEAK/NONE} | {Confirmed/Pruned} |

### Remediation

**Immediate:**
- {Action 1}
- {Action 2}

**Long-term:**
- {Action 1}
- {Action 2}

### Related Runbook

{Link to runbook if found, or "No matching runbook - consider creating one"}
```
