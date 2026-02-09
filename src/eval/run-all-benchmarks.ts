import { access, mkdir, readFile, writeFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { spawn } from 'child_process';

interface Args {
  outDir: string;
  limit?: number;
  offline: boolean;
  benchmarks?: string[];
  rcaevalInput?: string;
  tracercaInput?: string;
  rootlyLimitPerDataset: number;
}

interface RunResult {
  benchmark: string;
  status: 'passed' | 'failed' | 'skipped';
  fixturesPath?: string;
  reportPath?: string;
  totalCases?: number;
  passedCases?: number;
  failedCases?: number;
  averageOverallScore?: number;
  passRate?: number;
  reason?: string;
  commandLog?: string;
}

interface InvestigationBenchmarkReport {
  totalCases: number;
  passedCases: number;
  failedCases: number;
  averageOverallScore: number;
}

interface AggregateReport {
  timestamp: string;
  outDir: string;
  offline: boolean;
  limit?: number;
  results: RunResult[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    outDir: resolve('.runbook/evals/all-benchmarks'),
    offline: false,
    rootlyLimitPerDataset: 5,
  };

  const rest = [...argv];
  while (rest.length > 0) {
    const token = rest.shift();
    if (!token) break;

    if (token === '--out-dir') {
      const value = rest.shift();
      if (value) args.outDir = resolve(value);
    } else if (token === '--limit') {
      const value = rest.shift();
      if (value) {
        const parsed = parseInt(value, 10);
        if (!Number.isNaN(parsed) && parsed > 0) args.limit = parsed;
      }
    } else if (token === '--offline') {
      args.offline = true;
    } else if (token === '--benchmarks') {
      const value = rest.shift();
      if (value) {
        args.benchmarks = value
          .split(',')
          .map((v) => v.trim().toLowerCase())
          .filter(Boolean);
      }
    } else if (token === '--rcaeval-input') {
      const value = rest.shift();
      if (value) args.rcaevalInput = resolve(value);
    } else if (token === '--tracerca-input') {
      const value = rest.shift();
      if (value) args.tracercaInput = resolve(value);
    } else if (token === '--rootly-limit-per-dataset') {
      const value = rest.shift();
      if (value) {
        const parsed = parseInt(value, 10);
        if (!Number.isNaN(parsed) && parsed > 0) args.rootlyLimitPerDataset = parsed;
      }
    }
  }

  return args;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(
  command: string[],
  cwd: string
): Promise<{ code: number; output: string }> {
  return new Promise((resolvePromise) => {
    const [cmd, ...args] = command;
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.on('close', (code) => {
      resolvePromise({ code: code ?? 1, output });
    });
  });
}

async function loadBenchmarkReport(path: string): Promise<InvestigationBenchmarkReport> {
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content) as InvestigationBenchmarkReport;
}

async function runSingleBenchmark(opts: {
  name: 'rcaeval' | 'rootly' | 'tracerca';
  cwd: string;
  outDir: string;
  offline: boolean;
  limit?: number;
  rcaevalInput?: string;
  tracercaInput?: string;
  rootlyLimitPerDataset: number;
}): Promise<RunResult> {
  const { name, cwd, outDir, offline, limit } = opts;
  const fixturesPath = resolve(outDir, `${name}-fixtures.json`);
  const reportPath = resolve(outDir, `${name}-report.json`);
  const logs: string[] = [];

  const run = async (cmd: string[]): Promise<number> => {
    logs.push(`$ ${cmd.join(' ')}`);
    const { code, output } = await runCommand(cmd, cwd);
    logs.push(output.trim());
    return code;
  };

  if (name === 'rcaeval') {
    const input = opts.rcaevalInput || resolve(cwd, 'examples/evals/rcaeval-input.sample.json');
    if (!(await exists(input))) {
      return { benchmark: name, status: 'skipped', reason: `Input not found: ${input}` };
    }

    const convertCmd = [
      'node',
      '--import',
      'tsx',
      'src/eval/rcaeval-to-fixtures.ts',
      '--input',
      input,
      '--out',
      fixturesPath,
      ...(offline ? ['--include-mock-result'] : []),
      ...(limit ? ['--limit', String(limit)] : []),
    ];
    if ((await run(convertCmd)) !== 0) {
      return {
        benchmark: name,
        status: 'failed',
        fixturesPath,
        reason: 'Converter failed',
        commandLog: logs.join('\n'),
      };
    }
  }

  if (name === 'rootly') {
    const apacheLog = resolve(cwd, 'examples/evals/datasets/logs-dataset/apache/apache_error.log');
    const opensshLog = resolve(cwd, 'examples/evals/datasets/logs-dataset/openssh/openssh.log');

    if (!(await exists(apacheLog)) || !(await exists(opensshLog))) {
      return {
        benchmark: name,
        status: 'skipped',
        reason:
          'Rootly dataset logs not found. Clone Rootly logs dataset into examples/evals/datasets/logs-dataset.',
      };
    }

    const convertCmd = [
      'node',
      '--import',
      'tsx',
      'src/eval/rootly-logs-to-fixtures.ts',
      '--apache-error-log',
      apacheLog,
      '--openssh-log',
      opensshLog,
      '--out',
      fixturesPath,
      '--limit-per-dataset',
      String(opts.rootlyLimitPerDataset),
    ];
    if ((await run(convertCmd)) !== 0) {
      return {
        benchmark: name,
        status: 'failed',
        fixturesPath,
        reason: 'Converter failed',
        commandLog: logs.join('\n'),
      };
    }
  }

  if (name === 'tracerca') {
    const input = opts.tracercaInput;
    if (!input || !(await exists(input))) {
      return {
        benchmark: name,
        status: 'skipped',
        reason: 'TraceRCA input not provided/found. Use --tracerca-input <json|jsonl|csv|tsv>.',
      };
    }

    const convertCmd = [
      'node',
      '--import',
      'tsx',
      'src/eval/tracerca-to-fixtures.ts',
      '--input',
      input,
      '--out',
      fixturesPath,
      ...(offline ? ['--include-mock-result'] : []),
      ...(limit ? ['--limit', String(limit)] : []),
    ];

    if ((await run(convertCmd)) !== 0) {
      return {
        benchmark: name,
        status: 'failed',
        fixturesPath,
        reason: 'Converter failed',
        commandLog: logs.join('\n'),
      };
    }
  }

  const benchCmd = [
    'node',
    '--import',
    'tsx',
    'src/eval/investigation-benchmark.ts',
    '--fixtures',
    fixturesPath,
    '--out',
    reportPath,
    ...(offline ? ['--offline'] : []),
    ...(limit ? ['--limit', String(limit)] : []),
  ];

  const benchCode = await run(benchCmd);
  if (!(await exists(reportPath))) {
    return {
      benchmark: name,
      status: 'failed',
      fixturesPath,
      reportPath,
      reason: 'Benchmark did not produce report file',
      commandLog: logs.join('\n'),
    };
  }

  const report = await loadBenchmarkReport(reportPath);
  const passRate = report.totalCases > 0 ? report.passedCases / report.totalCases : 0;

  return {
    benchmark: name,
    status: benchCode === 0 ? 'passed' : 'failed',
    fixturesPath,
    reportPath,
    totalCases: report.totalCases,
    passedCases: report.passedCases,
    failedCases: report.failedCases,
    averageOverallScore: report.averageOverallScore,
    passRate,
    commandLog: logs.join('\n'),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = resolve('.');

  const benchmarkOrder: Array<'rcaeval' | 'rootly' | 'tracerca'> = [
    'rcaeval',
    'rootly',
    'tracerca',
  ];
  const selected =
    args.benchmarks && args.benchmarks.length > 0
      ? benchmarkOrder.filter((name) => args.benchmarks!.includes(name))
      : benchmarkOrder;

  await mkdir(args.outDir, { recursive: true });

  const results: RunResult[] = [];
  for (const benchmark of selected) {
    console.log(`\n=== ${benchmark.toUpperCase()} ===`);
    const result = await runSingleBenchmark({
      name: benchmark,
      cwd,
      outDir: args.outDir,
      offline: args.offline,
      limit: args.limit,
      rcaevalInput: args.rcaevalInput,
      tracercaInput: args.tracercaInput,
      rootlyLimitPerDataset: args.rootlyLimitPerDataset,
    });

    results.push(result);

    if (result.status === 'skipped') {
      console.log(`SKIPPED: ${result.reason}`);
      continue;
    }

    if (result.status === 'failed' && !result.reportPath) {
      console.log(`FAILED: ${result.reason}`);
      continue;
    }

    console.log(`status: ${result.status}`);
    console.log(`cases: ${result.passedCases}/${result.totalCases} passed`);
    if (typeof result.averageOverallScore === 'number') {
      console.log(`avg score: ${(result.averageOverallScore * 100).toFixed(1)}%`);
    }
    if (result.reportPath) {
      console.log(`report: ${result.reportPath}`);
    }
  }

  const aggregate: AggregateReport = {
    timestamp: new Date().toISOString(),
    outDir: args.outDir,
    offline: args.offline,
    limit: args.limit,
    results,
  };

  const aggregatePath = resolve(args.outDir, 'summary.json');
  await mkdir(dirname(aggregatePath), { recursive: true });
  await writeFile(aggregatePath, JSON.stringify(aggregate, null, 2), 'utf-8');

  console.log(`\nSummary: ${aggregatePath}`);

  const failed = results.some((result) => result.status === 'failed');
  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
