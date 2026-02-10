import { describe, it, expect } from 'vitest';
import { ToolSummarizer } from '../tool-summarizer';

describe('ToolSummarizer aws_query', () => {
  it('includes Lambda function names in compact summaries', () => {
    const summarizer = new ToolSummarizer();

    const compact = summarizer.summarize(
      'aws_query',
      { query: 'Show lambda functions' },
      {
        totalResources: 1,
        servicesQueried: 1,
        results: {
          lambda: {
            count: 1,
            resources: [
              {
                id: 'arn:aws:lambda:ap-south-1:123456789012:function:runbook-yc-demo-failing-worker',
                name: 'runbook-yc-demo-failing-worker',
                status: 'Active',
              },
            ],
          },
        },
      }
    );

    expect(compact.summary).toContain('lambda/runbook-yc-demo-failing-worker');
    expect(compact.services).toContain('runbook-yc-demo-failing-worker');

    const lambdaHighlights = compact.highlights.lambda as { notable?: string[] };
    expect(lambdaHighlights.notable).toContain('runbook-yc-demo-failing-worker');
  });

  it('extracts Lambda function names from ARN when name field is missing', () => {
    const summarizer = new ToolSummarizer();

    const compact = summarizer.summarize(
      'aws_query',
      { query: 'Show lambda functions' },
      {
        totalResources: 1,
        servicesQueried: 1,
        results: {
          lambda: {
            count: 1,
            resources: [
              {
                id: 'arn:aws:lambda:ap-south-1:123456789012:function:worker-from-arn-only',
                status: 'Active',
              },
            ],
          },
        },
      }
    );

    expect(compact.summary).toContain('lambda/worker-from-arn-only');
    expect(compact.services).toContain('worker-from-arn-only');
  });
});
