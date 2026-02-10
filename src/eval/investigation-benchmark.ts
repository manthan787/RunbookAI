import { readFile, mkdir, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { loadConfig, validateConfig } from '../utils/config';
import { createLLMClient } from '../model/llm';
import { toolRegistry } from '../tools/registry';
import { skillRegistry } from '../skills/registry';
import { getRuntimeTools } from '../cli/runtime-tools';
import { createRetriever } from '../knowledge/retriever';
import {
  createOrchestrator,
  type InvestigationEvent,
  type RemediationContext,
  type InvestigationResult,
} from '../agent/investigation-orchestrator';
import {
  scoreInvestigationResult,
  type InvestigationEvalCase,
  type InvestigationEvalFixtures,
} from './scoring';

interface RunnerArgs {
  fixturesPath: string;
  outPath: string;
  limit?: number;
  offline: boolean;
}

interface CaseRunResult {
  id: string;
  incidentId?: string;
  query: string;
  tags: string[];
  durationMs: number;
  score: ReturnType<typeof scoreInvestigationResult>;
  pass: boolean;
  result?: InvestigationResult;
  error?: string;
  eventCounts: {
    phaseChanges: number;
    hypothesesCreated: number;
    queriesExecuted: number;
    evaluations: number;
    remediationSteps: number;
  };
}

interface BenchmarkReport {
  timestamp: string;
  fixturesPath: string;
  passThreshold: number;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  averageOverallScore: number;
  results: CaseRunResult[];
}

function parseArgs(argv: string[]): RunnerArgs {
  const defaults: RunnerArgs = {
    fixturesPath: 'examples/evals/investigation-fixtures.sample.json',
    outPath: `.runbook/evals/investigation-report-${Date.now()}.json`,
    offline: false,
  };

  const args = [...argv];

  while (args.length > 0) {
    const token = args.shift();
    if (!token) break;

    if (token === '--fixtures') {
      defaults.fixturesPath = args.shift() || defaults.fixturesPath;
    } else if (token === '--out') {
      defaults.outPath = args.shift() || defaults.outPath;
    } else if (token === '--limit') {
      const raw = args.shift();
      if (raw) {
        const parsed = parseInt(raw, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
          defaults.limit = parsed;
        }
      }
    } else if (token === '--offline') {
      defaults.offline = true;
    }
  }

  return {
    fixturesPath: resolve(defaults.fixturesPath),
    outPath: resolve(defaults.outPath),
    limit: defaults.limit,
    offline: defaults.offline,
  };
}

async function loadFixtures(fixturesPath: string): Promise<InvestigationEvalFixtures> {
  const content = await readFile(fixturesPath, 'utf-8');
  const parsed = JSON.parse(content) as InvestigationEvalFixtures;

  if (!parsed.version || !Array.isArray(parsed.cases)) {
    throw new Error('Invalid fixtures format: expected { version, cases[] }');
  }

  return parsed;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function normalizeJsonResponse(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return raw;
  }

  const direct = (() => {
    try {
      const parsed = JSON.parse(trimmed);
      return JSON.stringify(parsed);
    } catch {
      return null;
    }
  })();
  if (direct) {
    return direct;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    try {
      const parsed = JSON.parse(fencedMatch[1].trim());
      return JSON.stringify(parsed);
    } catch {
      // fall through to brace extraction
    }
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(candidate);
      return JSON.stringify(parsed);
    } catch {
      // Keep original raw text if we still cannot parse
    }
  }

  return raw;
}

async function runCase(
  testCase: InvestigationEvalCase,
  passThreshold: number,
  executeInvestigation:
    | ((
        query: string,
        incidentId: string | undefined,
        maxIterations: number | undefined,
        autoRemediate: boolean | undefined,
        onEvent: (event: InvestigationEvent) => void,
        context?: string
      ) => Promise<InvestigationResult>)
    | null,
  offline: boolean
): Promise<CaseRunResult> {
  const query =
    testCase.query ||
    `Investigate incident ${testCase.incidentId || testCase.id}. Identify root cause with evidence.`;

  const eventCounts = {
    phaseChanges: 0,
    hypothesesCreated: 0,
    queriesExecuted: 0,
    evaluations: 0,
    remediationSteps: 0,
  };

  const start = Date.now();

  try {
    if (offline) {
      if (!testCase.mockResult) {
        throw new Error('Offline mode requires case.mockResult in fixtures');
      }

      const score = scoreInvestigationResult({
        expected: testCase.expected,
        rootCauseText: testCase.mockResult.rootCause,
        summaryText: testCase.mockResult.summary,
        remediationText: testCase.mockResult.remediationText,
        confidence: testCase.mockResult.confidence,
      });

      return {
        id: testCase.id,
        incidentId: testCase.incidentId,
        query,
        tags: testCase.tags || [],
        durationMs: Date.now() - start,
        score,
        pass: score.overall >= passThreshold,
        eventCounts,
      };
    }

    if (!executeInvestigation) {
      throw new Error('Investigation executor is not configured');
    }

    const result = await executeInvestigation(
      query,
      testCase.incidentId,
      testCase.execute?.maxIterations,
      testCase.execute?.autoRemediate,
      (event) => {
        switch (event.type) {
          case 'phase_change':
            eventCounts.phaseChanges += 1;
            break;
          case 'hypothesis_created':
            eventCounts.hypothesesCreated += 1;
            break;
          case 'query_executing':
            eventCounts.queriesExecuted += 1;
            break;
          case 'evidence_evaluated':
            eventCounts.evaluations += 1;
            break;
          case 'remediation_step':
            eventCounts.remediationSteps += 1;
            break;
        }
      },
      testCase.context
    );

    const remediationText = (result.remediationPlan?.steps || [])
      .map((step) => `${step.action}. ${step.description || ''}`)
      .join('\n');

    const score = scoreInvestigationResult({
      expected: testCase.expected,
      rootCauseText: result.rootCause,
      summaryText: result.summary,
      remediationText,
      confidence: result.confidence,
      affectedServicesDetected: result.affectedServices,
    });

    return {
      id: testCase.id,
      incidentId: testCase.incidentId,
      query,
      tags: testCase.tags || [],
      durationMs: Date.now() - start,
      score,
      pass: score.overall >= passThreshold,
      result,
      eventCounts,
    };
  } catch (error) {
    return {
      id: testCase.id,
      incidentId: testCase.incidentId,
      query,
      tags: testCase.tags || [],
      durationMs: Date.now() - start,
      score: {
        rootCause: null,
        services: null,
        confidence: null,
        phraseCompliance: null,
        overall: 0,
      },
      pass: false,
      error: error instanceof Error ? error.message : String(error),
      eventCounts,
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixtures = await loadFixtures(args.fixturesPath);
  const passThreshold = fixtures.passThreshold ?? 0.7;
  const cases = args.limit ? fixtures.cases.slice(0, args.limit) : fixtures.cases;

  let executeInvestigation:
    | ((
        query: string,
        incidentId: string | undefined,
        maxIterations: number | undefined,
        autoRemediate: boolean | undefined,
        onEvent: (event: InvestigationEvent) => void,
        context?: string
      ) => Promise<InvestigationResult>)
    | null = null;

  if (!args.offline) {
    const config = await loadConfig();
    const configErrors = validateConfig(config);
    if (configErrors.length > 0) {
      throw new Error(`Configuration errors:\n- ${configErrors.join('\n- ')}`);
    }

    const llm = createLLMClient({
      provider: config.llm.provider,
      model: config.llm.model,
      apiKey: config.llm.apiKey,
    });

    await skillRegistry.loadUserSkills();
    const runtimeSkills = skillRegistry.getAll().map((skill) => skill.id);
    const runtimeTools = await getRuntimeTools(config, toolRegistry.getAll());
    const toolsByName = new Map(runtimeTools.map((tool) => [tool.name, tool]));

    executeInvestigation = async (
      query: string,
      incidentId: string | undefined,
      maxIterations: number | undefined,
      autoRemediate: boolean | undefined,
      onEvent: (event: InvestigationEvent) => void,
      context?: string
    ): Promise<InvestigationResult> => {
      const orchestrator = createOrchestrator(
        {
          complete: async (prompt: string) => {
            const response = await llm.chat(
              'You are an SRE investigator. Return only valid JSON matching the requested schema.',
              prompt
            );
            return normalizeJsonResponse(response.content);
          },
        },
        {
          execute: async (toolName: string, parameters: Record<string, unknown>) => {
            const tool = toolsByName.get(toolName);
            if (!tool) {
              throw new Error(`Tool not available in runtime: ${toolName}`);
            }
            return tool.execute(parameters);
          },
        },
        {
          incidentId,
          maxIterations: maxIterations ?? config.agent.maxIterations,
          autoApproveRemediation: autoRemediate ?? false,
          availableTools: runtimeTools.map((tool) => tool.name),
          availableSkills: runtimeSkills,
          fetchRelevantRunbooks: async (ctx: RemediationContext) => {
            const retriever = createRetriever();
            try {
              const searchQuery = [ctx.rootCause, ...ctx.affectedServices].join(' ').trim();
              const results = await retriever.search(searchQuery || 'incident remediation', {
                typeFilter: ['runbook'],
                serviceFilter: ctx.affectedServices.length > 0 ? ctx.affectedServices : undefined,
                limit: 12,
              });

              return Array.from(
                new Set(results.runbooks.map((runbook) => runbook.title).filter(Boolean))
              ).slice(0, 8);
            } finally {
              retriever.close();
            }
          },
        }
      );

      const unsubscribe = orchestrator.on(onEvent);
      try {
        return await orchestrator.investigate(query, context);
      } finally {
        unsubscribe();
      }
    };
  }

  const results: CaseRunResult[] = [];

  console.log(`Running investigation benchmark with ${cases.length} case(s)`);
  for (let i = 0; i < cases.length; i += 1) {
    const testCase = cases[i];
    console.log(`[${i + 1}/${cases.length}] ${testCase.id}`);
    const result = await runCase(testCase, passThreshold, executeInvestigation, args.offline);
    results.push(result);
    const status = result.pass ? 'PASS' : 'FAIL';
    console.log(
      `  ${status} score=${formatPercent(result.score.overall)} duration=${result.durationMs}ms`
    );
    if (result.error) {
      console.log(`  error=${result.error}`);
    }
  }

  const passedCases = results.filter((result) => result.pass).length;
  const failedCases = results.length - passedCases;
  const averageOverallScore =
    results.length > 0
      ? Number(
          (results.reduce((sum, result) => sum + result.score.overall, 0) / results.length).toFixed(
            4
          )
        )
      : 0;

  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    fixturesPath: args.fixturesPath,
    passThreshold,
    totalCases: results.length,
    passedCases,
    failedCases,
    averageOverallScore,
    results,
  };

  await mkdir(dirname(args.outPath), { recursive: true });
  await writeFile(args.outPath, JSON.stringify(report, null, 2), 'utf-8');

  console.log('\nBenchmark summary');
  console.log(
    `  pass rate: ${passedCases}/${results.length} (${formatPercent(results.length > 0 ? passedCases / results.length : 0)})`
  );
  console.log(`  average score: ${formatPercent(averageOverallScore)}`);
  console.log(`  report: ${args.outPath}`);

  if (failedCases > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
