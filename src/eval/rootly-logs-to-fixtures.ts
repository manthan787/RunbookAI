import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, resolve } from 'path';
import type { InvestigationEvalFixtures, InvestigationEvalCase } from './scoring';

interface Args {
  apacheErrorLog: string;
  opensshLog: string;
  out: string;
  limitPerDataset: number;
  passThreshold: number;
}

const STOPWORDS = new Set([
  'the',
  'and',
  'with',
  'from',
  'that',
  'this',
  'for',
  'are',
  'was',
  'were',
  'have',
  'has',
  'had',
  'error',
  'warning',
  'info',
  'pid',
  'client',
  'server',
  'failed',
  'failure',
  'connection',
  'closed',
  'accepted',
  'invalid',
  'user',
  'root',
  'apache',
  'openssh',
  'sshd',
  'http',
  'https',
  'log',
  'logs',
]);

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apacheErrorLog: resolve('examples/evals/datasets/logs-dataset/apache/apache_error.log'),
    opensshLog: resolve('examples/evals/datasets/logs-dataset/openssh/openssh.log'),
    out: resolve('examples/evals/rootly-logs-fixtures.generated.json'),
    limitPerDataset: 5,
    passThreshold: 0.7,
  };

  const rest = [...argv];
  while (rest.length > 0) {
    const token = rest.shift();
    if (!token) break;

    if (token === '--apache-error-log') {
      const value = rest.shift();
      if (value) args.apacheErrorLog = resolve(value);
    } else if (token === '--openssh-log') {
      const value = rest.shift();
      if (value) args.opensshLog = resolve(value);
    } else if (token === '--out') {
      const value = rest.shift();
      if (value) args.out = resolve(value);
    } else if (token === '--limit-per-dataset') {
      const value = rest.shift();
      if (value) {
        const parsed = parseInt(value, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
          args.limitPerDataset = parsed;
        }
      }
    } else if (token === '--pass-threshold') {
      const value = rest.shift();
      if (value) {
        const parsed = Number(value);
        if (!Number.isNaN(parsed) && parsed > 0 && parsed <= 1) {
          args.passThreshold = parsed;
        }
      }
    }
  }

  return args;
}

function extractKeywords(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));

  const unique: string[] = [];
  for (const token of tokens) {
    if (!unique.includes(token)) {
      unique.push(token);
    }
    if (unique.length >= 4) {
      break;
    }
  }

  return unique.length > 0 ? unique : ['incident'];
}

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function selectInterestingLines(lines: string[], limit: number): string[] {
  const interesting = lines.filter((line) => {
    const lower = line.toLowerCase();
    return (
      lower.includes('error') ||
      lower.includes('failed') ||
      lower.includes('invalid') ||
      lower.includes('timeout') ||
      lower.includes('denied') ||
      lower.includes('fatal')
    );
  });

  const source = interesting.length > 0 ? interesting : lines;
  return source.slice(0, limit);
}

async function buildApacheCases(path: string, limit: number): Promise<InvestigationEvalCase[]> {
  const content = await readFile(path, 'utf-8');
  const lines = selectInterestingLines(
    content
      .split('\n')
      .map((line) => normalizeLine(line))
      .filter(Boolean),
    limit
  );

  return lines.map((line, index) => {
    const keywords = extractKeywords(line);
    return {
      id: `rootly-apache-${index + 1}`,
      incidentId: `ROOTLY-APACHE-${index + 1}`,
      query: `Investigate incident ROOTLY-APACHE-${index + 1}. Identify root cause from Apache error evidence.`,
      context: `Apache error log evidence:\n${line}`,
      tags: ['rootly', 'apache', 'logs'],
      expected: {
        rootCauseKeywords: ['apache', ...keywords],
        affectedServices: ['apache'],
        confidenceAtLeast: 'medium',
        requiredPhrases: ['evidence'],
        forbiddenPhrases: ['delete production', 'drop database'],
      },
      execute: {
        maxIterations: 5,
        autoRemediate: false,
      },
    };
  });
}

async function buildOpenSshCases(path: string, limit: number): Promise<InvestigationEvalCase[]> {
  const content = await readFile(path, 'utf-8');
  const lines = selectInterestingLines(
    content
      .split('\n')
      .map((line) => normalizeLine(line))
      .filter(Boolean),
    limit
  );

  return lines.map((line, index) => {
    const keywords = extractKeywords(line);
    return {
      id: `rootly-openssh-${index + 1}`,
      incidentId: `ROOTLY-OPENSSH-${index + 1}`,
      query: `Investigate incident ROOTLY-OPENSSH-${index + 1}. Identify root cause from SSH access/security logs.`,
      context: `OpenSSH log evidence:\n${line}`,
      tags: ['rootly', 'openssh', 'security-logs'],
      expected: {
        rootCauseKeywords: ['ssh', 'openssh', ...keywords],
        affectedServices: ['openssh'],
        confidenceAtLeast: 'medium',
        requiredPhrases: ['evidence'],
        forbiddenPhrases: ['disable all security', 'allow all access'],
      },
      execute: {
        maxIterations: 5,
        autoRemediate: false,
      },
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const apacheCases = await buildApacheCases(args.apacheErrorLog, args.limitPerDataset);
  const opensshCases = await buildOpenSshCases(args.opensshLog, args.limitPerDataset);

  const fixtures: InvestigationEvalFixtures = {
    version: '1.0',
    passThreshold: args.passThreshold,
    cases: [...apacheCases, ...opensshCases],
  };

  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify(fixtures, null, 2), 'utf-8');

  console.log(`Generated ${fixtures.cases.length} cases from Rootly logs dataset`);
  console.log(`Output: ${args.out}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
