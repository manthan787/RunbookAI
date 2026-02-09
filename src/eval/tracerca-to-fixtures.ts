import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, extname, resolve } from 'path';
import type { InvestigationEvalCase, InvestigationEvalFixtures } from './scoring';

type RecordRow = Record<string, string>;

interface Args {
  input: string;
  out: string;
  passThreshold: number;
  limit?: number;
  includeMockResult: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    input: resolve('examples/evals/tracerca-input.sample.json'),
    out: resolve('examples/evals/tracerca-fixtures.generated.json'),
    passThreshold: 0.7,
    includeMockResult: false,
  };

  const rest = [...argv];
  while (rest.length > 0) {
    const token = rest.shift();
    if (!token) break;

    if (token === '--input') {
      const value = rest.shift();
      if (value) args.input = resolve(value);
    } else if (token === '--out') {
      const value = rest.shift();
      if (value) args.out = resolve(value);
    } else if (token === '--pass-threshold') {
      const value = rest.shift();
      if (value) {
        const parsed = Number(value);
        if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) {
          args.passThreshold = parsed;
        }
      }
    } else if (token === '--limit') {
      const value = rest.shift();
      if (value) {
        const parsed = parseInt(value, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
          args.limit = parsed;
        }
      }
    } else if (token === '--include-mock-result') {
      args.includeMockResult = true;
    }
  }

  return args;
}

function safe(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const str = String(value).trim();
  return str.length > 0 ? str : undefined;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,;|]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseDelimited(content: string, delimiter: ',' | '\t'): RecordRow[] {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map((v) => v.trim());
  };

  const header = parseLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = parseLine(line);
    const row: RecordRow = {};
    for (let i = 0; i < header.length; i += 1) {
      row[header[i]] = cols[i] || '';
    }
    return row;
  });
}

async function loadRows(inputPath: string): Promise<RecordRow[]> {
  const content = await readFile(inputPath, 'utf-8');
  const ext = extname(inputPath).toLowerCase();

  if (ext === '.jsonl') {
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RecordRow);
  }

  if (ext === '.json') {
    const parsed = JSON.parse(content) as unknown;
    if (Array.isArray(parsed)) return parsed as RecordRow[];
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.data)) return record.data as RecordRow[];
      if (Array.isArray(record.cases)) return record.cases as RecordRow[];
    }
    throw new Error('Unsupported JSON structure; expected array or {data:[]}/{cases:[]}');
  }

  if (ext === '.csv') {
    return parseDelimited(content, ',');
  }

  if (ext === '.tsv') {
    return parseDelimited(content, '\t');
  }

  throw new Error('Unsupported TraceRCA input format. Use .json, .jsonl, .csv, or .tsv');
}

function pick(row: RecordRow, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = safe(row[key]);
    if (v) return v;
  }
  return undefined;
}

function toCase(row: RecordRow, idx: number, includeMockResult: boolean): InvestigationEvalCase {
  const id = pick(row, ['id', 'case_id', 'trace_id', 'incident_id']) || `tracerca-${idx + 1}`;
  const incidentId = pick(row, ['incident_id', 'case_id', 'trace_id']);
  const service = pick(row, ['root_cause_service', 'service', 'faulty_service', 'target_service']);
  const operation = pick(row, ['operation', 'span', 'endpoint', 'interface']);
  const anomaly = pick(row, ['anomaly_type', 'fault_type', 'symptom', 'indicator']);
  const system = pick(row, ['system', 'system_name', 'application']);
  const description = pick(row, ['description', 'context', 'summary']);

  const keywords = [service, operation, anomaly]
    .filter((v): v is string => Boolean(v))
    .flatMap((v) => [v, v.replace(/[_-]+/g, ' ')])
    .filter(Boolean);

  const affectedServices = splitList(pick(row, ['affected_services', 'impacted_services']));
  if (service && !affectedServices.includes(service)) {
    affectedServices.unshift(service);
  }

  const contextParts = [
    description,
    system ? `System: ${system}` : undefined,
    service ? `Likely service: ${service}` : undefined,
    operation ? `Operation/span: ${operation}` : undefined,
    anomaly ? `Anomaly/fault: ${anomaly}` : undefined,
  ].filter((v): v is string => Boolean(v));

  const out: InvestigationEvalCase = {
    id,
    incidentId,
    query: `Investigate incident ${incidentId || id}. Identify the root cause from trace RCA context with supporting evidence.`,
    context: contextParts.join('\n'),
    tags: ['tracerca', ...(system ? [system] : []), ...(anomaly ? [anomaly] : [])],
    expected: {
      rootCauseKeywords: keywords.length > 0 ? keywords : ['trace', 'latency'],
      affectedServices,
      confidenceAtLeast: 'medium',
      requiredPhrases: ['evidence'],
      forbiddenPhrases: ['delete production', 'drop database'],
    },
    execute: {
      maxIterations: 6,
      autoRemediate: false,
    },
  };

  if (includeMockResult) {
    out.mockResult = {
      rootCause: [service, anomaly, operation].filter(Boolean).join(' '),
      summary: contextParts.join(' | '),
      confidence: 'medium',
      remediationText: 'Use runbook-guided remediation with approval.',
    };
  }

  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = await loadRows(args.input);
  const selected = args.limit ? rows.slice(0, args.limit) : rows;

  const fixtures: InvestigationEvalFixtures = {
    version: '1.0',
    passThreshold: args.passThreshold,
    cases: selected.map((row, idx) => toCase(row, idx, args.includeMockResult)),
  };

  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify(fixtures, null, 2), 'utf-8');

  console.log(`Converted ${fixtures.cases.length} TraceRCA row(s)`);
  console.log(`Output: ${args.out}`);
  if (args.includeMockResult) {
    console.log('Included mockResult for offline benchmark scoring');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
