import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, extname, resolve } from 'path';
import type { InvestigationEvalCase, InvestigationEvalFixtures } from './scoring';

interface Args {
  input: string;
  out: string;
  passThreshold: number;
  limit?: number;
  includeMockResult: boolean;
}

type GenericRecord = Record<string, unknown>;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    input: resolve('examples/evals/rcaeval-input.sample.json'),
    out: resolve('examples/evals/rcaeval-fixtures.generated.json'),
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

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return undefined;
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => asString(v)).filter((v): v is string => Boolean(v));
  }

  const one = asString(value);
  if (!one) {
    return [];
  }

  return one
    .split(/[,;|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function pick(record: GenericRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record && record[key] !== undefined && record[key] !== null) {
      return record[key];
    }
  }
  return undefined;
}

function normalizeKeywordList(items: string[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    const raw = item.trim();
    if (!raw) continue;
    set.add(raw);
    set.add(raw.replace(/[_-]+/g, ' '));
  }
  return Array.from(set).filter(Boolean);
}

function toEvalCase(
  record: GenericRecord,
  index: number,
  includeMockResult: boolean
): InvestigationEvalCase {
  const id =
    asString(pick(record, ['id', 'case_id', 'incident_id', 'sample_id'])) || `rcaeval-${index + 1}`;
  const incidentId = asString(pick(record, ['incident_id', 'case_id', 'ticket_id']));

  const service = asString(
    pick(record, [
      'root_cause_service',
      'rootCauseService',
      'faulty_service',
      'service',
      'target_service',
    ])
  );

  const indicator = asString(
    pick(record, [
      'root_cause_indicator',
      'rootCauseIndicator',
      'fault_type',
      'metric',
      'symptom',
      'anomaly',
    ])
  );

  const dataset = asString(pick(record, ['dataset', 'dataset_name']));
  const system = asString(pick(record, ['system', 'system_name', 'application']));

  const query =
    asString(pick(record, ['query', 'question', 'title'])) ||
    `Investigate incident ${incidentId || id}. Identify the root cause with evidence.`;

  const contextParts = [
    asString(pick(record, ['context', 'description', 'summary'])),
    dataset ? `Dataset: ${dataset}` : undefined,
    system ? `System: ${system}` : undefined,
    indicator ? `Observed indicator: ${indicator}` : undefined,
  ].filter((part): part is string => Boolean(part));

  const affectedServices = asArray(
    pick(record, ['affected_services', 'affectedServices', 'impacted_services'])
  );
  if (service && !affectedServices.includes(service)) {
    affectedServices.unshift(service);
  }

  const rootCauseKeywords = normalizeKeywordList([
    ...asArray(pick(record, ['root_cause', 'rootCause', 'fault_description'])),
    ...(service ? [service] : []),
    ...(indicator ? [indicator] : []),
  ]);

  const tags = [
    ...asArray(pick(record, ['tags'])),
    ...(dataset ? [dataset] : []),
    ...(system ? [system] : []),
    ...(indicator ? [indicator] : []),
  ].filter(Boolean);

  const evalCase: InvestigationEvalCase = {
    id,
    incidentId,
    query,
    context: contextParts.length > 0 ? contextParts.join('\n') : undefined,
    tags,
    expected: {
      rootCauseKeywords,
      affectedServices,
      confidenceAtLeast: 'medium',
      forbiddenPhrases: ['drop database', 'delete production'],
    },
    execute: {
      maxIterations: 6,
      autoRemediate: false,
    },
  };

  if (includeMockResult) {
    evalCase.mockResult = {
      rootCause: [service, indicator].filter(Boolean).join(' '),
      summary: contextParts.join(' | ') || query,
      confidence: 'medium',
      remediationText: 'Use runbook-guided mitigation with approval.',
    };
  }

  return evalCase;
}

async function readInput(path: string): Promise<GenericRecord[]> {
  const content = await readFile(path, 'utf-8');
  const ext = extname(path).toLowerCase();

  if (ext === '.jsonl') {
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as GenericRecord);
  }

  const parsed = JSON.parse(content) as unknown;

  if (Array.isArray(parsed)) {
    return parsed as GenericRecord[];
  }

  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.cases)) {
      return record.cases as GenericRecord[];
    }
    if (Array.isArray(record.data)) {
      return record.data as GenericRecord[];
    }
  }

  throw new Error(
    'Unsupported RCAEval input format. Expected JSON array, {cases:[]}, {data:[]} or JSONL'
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = await readInput(args.input);
  const limitedRows = args.limit ? rows.slice(0, args.limit) : rows;

  const fixtures: InvestigationEvalFixtures = {
    version: '1.0',
    passThreshold: args.passThreshold,
    cases: limitedRows.map((row, index) => toEvalCase(row, index, args.includeMockResult)),
  };

  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify(fixtures, null, 2), 'utf-8');

  console.log(`Converted ${fixtures.cases.length} RCAEval row(s)`);
  console.log(`Output: ${args.out}`);
  if (args.includeMockResult) {
    console.log('Included mockResult for offline benchmark scoring');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
