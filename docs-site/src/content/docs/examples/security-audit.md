---
title: Security Audit
description: Example of running a security audit
---

This example demonstrates using Runbook to perform infrastructure security audits.

## Scenario

Run a security audit on production S3 buckets to identify misconfigurations.

## Audit

### Start Security Audit

```bash
runbook ask "Run a security audit on production S3 buckets"
```

### Execution

```
→ Running security audit on S3 buckets...
✓ aws_query (list-buckets) (0.3s)

Found 23 S3 buckets in production account

→ Checking public access settings...
✓ aws_query (public-access-blocks) (1.2s)

→ Checking bucket policies...
✓ aws_query (bucket-policies) (1.5s)

→ Checking encryption...
✓ aws_query (encryption-configs) (0.8s)

→ Checking logging...
✓ aws_query (logging-configs) (0.7s)

═══════════════════════════════════════════════════════════════
                    S3 SECURITY AUDIT RESULTS
═══════════════════════════════════════════════════════════════

Buckets Audited: 23
Issues Found: 7

CRITICAL Issues (2)
───────────────────

[C1] Public bucket detected
     Bucket: marketing-assets-public
     Issue: Block Public Access disabled
     Risk: Data exposure to internet

     Recommendation:
       Enable Block Public Access unless intentionally public

       aws s3api put-public-access-block \
         --bucket marketing-assets-public \
         --public-access-block-configuration \
         "BlockPublicAcls=true,IgnorePublicAcls=true,..."

[C2] Overly permissive bucket policy
     Bucket: data-exports
     Issue: Policy allows s3:* to Principal: "*"
     Risk: Any AWS account can read/write/delete

     Current Policy:
       {
         "Effect": "Allow",
         "Principal": "*",
         "Action": "s3:*",
         "Resource": "arn:aws:s3:::data-exports/*"
       }

     Recommendation:
       Restrict to specific AWS accounts or IAM roles

HIGH Issues (3)
───────────────

[H1] No server-side encryption
     Buckets: legacy-logs, temp-data
     Issue: Default encryption not enabled
     Risk: Data at rest not encrypted

     Recommendation:
       aws s3api put-bucket-encryption \
         --bucket legacy-logs \
         --server-side-encryption-configuration \
         '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

[H2] No access logging
     Buckets: user-uploads, api-cache, session-data
     Issue: Access logging disabled
     Risk: No audit trail for data access

     Recommendation:
       Enable access logging to a dedicated logging bucket

[H3] No versioning
     Buckets: config-backups
     Issue: Versioning disabled on backup bucket
     Risk: Accidental deletions are permanent

     Recommendation:
       aws s3api put-bucket-versioning \
         --bucket config-backups \
         --versioning-configuration Status=Enabled

MEDIUM Issues (2)
─────────────────

[M1] No lifecycle policy
     Buckets: logs-archive, temp-processing
     Issue: No automatic cleanup or tiering
     Risk: Unbounded storage growth, higher costs

[M2] Cross-account access without external ID
     Bucket: shared-data
     Issue: Trust policy lacks external ID
     Risk: Confused deputy attack vector

COMPLIANT Buckets (16)
──────────────────────
✓ production-assets
✓ application-logs
✓ database-backups
... and 13 more

═══════════════════════════════════════════════════════════════
                    SUMMARY & RECOMMENDATIONS
═══════════════════════════════════════════════════════════════

Security Score: 72/100 (Needs Improvement)

Priority Actions:
1. [CRITICAL] Review marketing-assets-public - is public access intended?
2. [CRITICAL] Fix data-exports bucket policy immediately
3. [HIGH] Enable encryption on legacy-logs, temp-data
4. [HIGH] Enable access logging on sensitive buckets

Compliance Status:
  • SOC2: 3 findings
  • HIPAA: Not applicable (no PHI detected)
  • PCI-DSS: 2 findings (if processing card data)

Would you like to:
  [1] Fix critical issues now (requires approval)
  [2] Generate detailed report
  [3] Schedule recurring audit
```

### Fix Critical Issues

```bash
runbook ask "Fix the critical S3 security issues"
```

```
→ Preparing fixes for critical issues...

Issue C1: marketing-assets-public
─────────────────────────────────
Before fixing, please confirm:
Is this bucket intentionally public? (e.g., static website hosting)

[User: No, it should be private]

╔════════════════════════════════════════════════════════════╗
║                    APPROVAL REQUIRED                        ║
╠════════════════════════════════════════════════════════════╣
║  Operation: Enable Block Public Access                      ║
║  Bucket: marketing-assets-public                            ║
║  Risk Level: MEDIUM                                         ║
║                                                             ║
║  Impact:                                                    ║
║    • All public access will be blocked                      ║
║    • Existing public URLs will stop working                 ║
║                                                             ║
║  Rollback:                                                  ║
║    aws s3api delete-public-access-block \                  ║
║      --bucket marketing-assets-public                       ║
╚════════════════════════════════════════════════════════════╝

[Approved]

→ Enabling Block Public Access...
✓ Public access blocked

Issue C2: data-exports overly permissive policy
───────────────────────────────────────────────
Current policy allows anyone to access this bucket.

Recommended policy restricts to:
  • Partner account: 123456789012
  • Internal role: arn:aws:iam::*:role/ExportProcessor

╔════════════════════════════════════════════════════════════╗
║                    APPROVAL REQUIRED                        ║
╠════════════════════════════════════════════════════════════╣
║  Operation: Replace bucket policy                           ║
║  Bucket: data-exports                                       ║
║  Risk Level: HIGH                                           ║
║                                                             ║
║  Impact:                                                    ║
║    • Only specified accounts/roles can access               ║
║    • May break existing integrations                        ║
║                                                             ║
║  Review the new policy carefully before approving           ║
╚════════════════════════════════════════════════════════════╝

[Approved by @security-team]

→ Updating bucket policy...
✓ Bucket policy updated

═══════════════════════════════════════════════════════════════
                    CRITICAL ISSUES RESOLVED
═══════════════════════════════════════════════════════════════

Fixed:
  ✓ C1: marketing-assets-public - Block Public Access enabled
  ✓ C2: data-exports - Restrictive policy applied

Remaining issues:
  • 3 HIGH
  • 2 MEDIUM

New Security Score: 82/100 (+10 points)

Changes logged to scratchpad.
Notification sent to #security-alerts.
```

## Recurring Audits

Set up automated security checks:

```yaml
# In config
security:
  audits:
    s3:
      schedule: "0 0 * * 1"  # Weekly on Monday
      alertChannel: "#security-alerts"
      autoFix:
        enabled: false  # Report only, don't auto-fix
```

Or via CLI:

```bash
runbook schedule audit s3 --weekly --channel "#security-alerts"
```
