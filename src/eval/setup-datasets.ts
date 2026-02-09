import { access, mkdir, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { spawn } from 'child_process';

interface Args {
  datasets: Array<'rcaeval' | 'rootly' | 'tracerca'>;
  out: string;
}

interface DatasetStatus {
  name: 'rcaeval' | 'rootly' | 'tracerca';
  status: 'ready' | 'failed';
  path?: string;
  reason?: string;
}

interface SetupReport {
  timestamp: string;
  statuses: DatasetStatus[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    datasets: ['rcaeval', 'rootly', 'tracerca'],
    out: resolve('.runbook/evals/dataset-setup.json'),
  };

  const rest = [...argv];
  while (rest.length > 0) {
    const token = rest.shift();
    if (!token) break;

    if (token === '--datasets') {
      const value = rest.shift();
      if (!value) continue;
      const selected = value
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(
          (item): item is 'rcaeval' | 'rootly' | 'tracerca' =>
            item === 'rcaeval' || item === 'rootly' || item === 'tracerca'
        );
      if (selected.length > 0) {
        args.datasets = selected;
      }
    } else if (token === '--out') {
      const value = rest.shift();
      if (value) args.out = resolve(value);
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
      resolvePromise({ code: code ?? 1, output: output.trim() });
    });
  });
}

async function ensureGitRepo(opts: {
  cwd: string;
  path: string;
  url: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const { cwd, path, url } = opts;
  const gitDir = resolve(path, '.git');
  if (await exists(gitDir)) {
    return { ok: true };
  }

  const targetParent = dirname(path);
  await mkdir(targetParent, { recursive: true });

  const clone = await runCommand(['git', 'clone', '--depth', '1', url, path], cwd);
  if (clone.code !== 0) {
    return { ok: false, reason: clone.output || `git clone failed (${url})` };
  }
  return { ok: true };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = resolve('.');
  const datasetsRoot = resolve(cwd, 'examples/evals/datasets');
  await mkdir(datasetsRoot, { recursive: true });

  const statuses: DatasetStatus[] = [];

  for (const dataset of args.datasets) {
    if (dataset === 'rootly') {
      const target = resolve(datasetsRoot, 'logs-dataset');
      const result = await ensureGitRepo({
        cwd,
        path: target,
        url: 'https://github.com/Rootly-AI-Labs/logs-dataset.git',
      });
      statuses.push(
        result.ok
          ? { name: 'rootly', status: 'ready', path: target }
          : { name: 'rootly', status: 'failed', path: target, reason: result.reason }
      );
      continue;
    }

    if (dataset === 'tracerca') {
      const target = resolve(datasetsRoot, 'TraceRCA');
      const result = await ensureGitRepo({
        cwd,
        path: target,
        url: 'https://github.com/NetManAIOps/TraceRCA.git',
      });
      statuses.push(
        result.ok
          ? { name: 'tracerca', status: 'ready', path: target }
          : { name: 'tracerca', status: 'failed', path: target, reason: result.reason }
      );
      continue;
    }

    if (dataset === 'rcaeval') {
      const target = resolve(datasetsRoot, 'RCAEval');
      const result = await ensureGitRepo({
        cwd,
        path: target,
        url: 'https://github.com/phamquiluan/RCAEval.git',
      });
      statuses.push(
        result.ok
          ? { name: 'rcaeval', status: 'ready', path: target }
          : { name: 'rcaeval', status: 'failed', path: target, reason: result.reason }
      );
    }
  }

  const report: SetupReport = {
    timestamp: new Date().toISOString(),
    statuses,
  };
  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify(report, null, 2), 'utf-8');

  const failed = statuses.filter((status) => status.status === 'failed');
  if (failed.length > 0) {
    console.warn('Dataset bootstrap completed with warnings:');
    for (const failure of failed) {
      console.warn(`- ${failure.name}: ${failure.reason || 'unknown error'}`);
    }
    process.exitCode = 1;
  } else {
    console.log('Dataset bootstrap complete');
  }
  console.log(`Report: ${args.out}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
