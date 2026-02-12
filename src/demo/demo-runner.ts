/**
 * Demo Runner
 *
 * Runs a pre-scripted investigation demo to showcase RunbookAI
 * without requiring any API keys or cloud configuration.
 */

import chalk from 'chalk';
import { DEMO_INCIDENT, DEMO_INVESTIGATION_STEPS, type DemoStep } from './demo-data';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function printHeader() {
  console.log();
  console.log(chalk.bold.magenta('━'.repeat(60)));
  console.log(chalk.bold.magenta('  RunbookAI Demo - Hypothesis-Driven Investigation'));
  console.log(chalk.bold.magenta('━'.repeat(60)));
  console.log();
  console.log(chalk.dim('This demo shows how RunbookAI investigates incidents using'));
  console.log(chalk.dim('hypothesis-driven reasoning. No API keys required.'));
  console.log();
}

function printIncident() {
  console.log(chalk.bold.red('⚠  INCIDENT ALERT'));
  console.log(chalk.white(`   ID: ${DEMO_INCIDENT.id}`));
  console.log(chalk.white(`   ${DEMO_INCIDENT.title}`));
  console.log(chalk.dim(`   ${DEMO_INCIDENT.description}`));
  console.log(
    chalk.dim(`   Triggered: ${new Date(DEMO_INCIDENT.triggeredAt).toLocaleTimeString()}`)
  );
  console.log();
}

function printPhase(phase: string, message: string) {
  const phaseColors: Record<string, typeof chalk> = {
    context_gathering: chalk.blue,
    hypothesis_formation: chalk.magenta,
    evidence_gathering: chalk.cyan,
    root_cause_identification: chalk.yellow,
    remediation: chalk.green,
  };
  const color = phaseColors[phase] || chalk.white;
  console.log();
  console.log(color.bold(`▸ ${message}`));
}

function printTool(name: string, result: string, args?: Record<string, unknown>) {
  console.log(chalk.dim(`  ┌─ ${name}${args ? ` (${JSON.stringify(args)})` : ''}`));
  const lines = result.split('\n');
  lines.forEach((line, i) => {
    const prefix = i === lines.length - 1 ? '  └─' : '  │ ';
    console.log(chalk.dim(prefix) + chalk.white(line));
  });
}

function printHypothesis(id: string, description: string, confidence: number, reasoning: string) {
  const confidenceColor =
    confidence >= 0.7 ? chalk.green : confidence >= 0.5 ? chalk.yellow : chalk.dim;
  console.log(
    `  ${chalk.cyan.bold(id + ':')} ${chalk.white(description)} ${confidenceColor(`(${(confidence * 100).toFixed(0)}%)`)}`
  );
  console.log(chalk.dim(`      ${reasoning}`));
}

function printEvidence(hypothesis: string, strength: string, finding: string, impact: string) {
  const strengthIcon = strength === 'strong' ? chalk.green('✓') : chalk.yellow('~');
  const strengthLabel = strength === 'strong' ? chalk.green.bold('STRONG') : chalk.yellow('WEAK');
  console.log(`  ${strengthIcon} Evidence for ${chalk.cyan(hypothesis)}: ${strengthLabel}`);
  console.log(chalk.white(`    ${finding}`));
  console.log(chalk.dim(`    → ${impact}`));
}

function printMessage(text: string) {
  console.log(chalk.dim(`  ℹ ${text}`));
}

function printRootCause(data: {
  description: string;
  confidence: number;
  evidence: string[];
  affectedServices: string[];
}) {
  console.log();
  console.log(chalk.bgYellow.black.bold(' ROOT CAUSE IDENTIFIED '));
  console.log();
  console.log(chalk.white.bold(`  ${data.description}`));
  console.log(chalk.green.bold(`  Confidence: ${(data.confidence * 100).toFixed(0)}%`));
  console.log();
  console.log(chalk.dim('  Evidence:'));
  data.evidence.forEach((e) => {
    console.log(chalk.dim(`    • ${e}`));
  });
  console.log();
  console.log(chalk.dim(`  Affected services: ${data.affectedServices.join(', ')}`));
}

function printRemediation(data: {
  steps: Array<{
    priority: number;
    action: string;
    command: string | null;
    requiresApproval: boolean;
    rollback?: string;
    note?: string;
  }>;
  estimatedRecovery: string;
  preventionNotes: string[];
}) {
  console.log();
  console.log(chalk.bold.green('  Suggested Remediation:'));
  console.log();

  data.steps.forEach((step) => {
    const approvalTag = step.requiresApproval ? chalk.yellow(' (requires approval)') : '';
    console.log(chalk.white(`  ${step.priority}. ${step.action}`) + approvalTag);
    if (step.command) {
      console.log(chalk.cyan(`     $ ${step.command}`));
    }
    if (step.note) {
      console.log(chalk.dim(`     Note: ${step.note}`));
    }
  });

  console.log();
  console.log(chalk.dim(`  Estimated recovery: ${data.estimatedRecovery}`));
  console.log();
  console.log(chalk.dim('  Prevention recommendations:'));
  data.preventionNotes.forEach((note) => {
    console.log(chalk.dim(`    • ${note}`));
  });
}

function printFooter() {
  console.log();
  console.log(chalk.bold.magenta('━'.repeat(60)));
  console.log(chalk.bold.magenta('  Demo Complete'));
  console.log(chalk.bold.magenta('━'.repeat(60)));
  console.log();
  console.log(chalk.white('Ready to try with your own infrastructure?'));
  console.log();
  console.log(chalk.dim('  1. Set your API key:'));
  console.log(chalk.cyan('     export ANTHROPIC_API_KEY=your-key'));
  console.log();
  console.log(chalk.dim('  2. Initialize configuration:'));
  console.log(chalk.cyan('     runbook init'));
  console.log();
  console.log(chalk.dim('  3. Run your first investigation:'));
  console.log(chalk.cyan('     runbook investigate <incident-id>'));
  console.log();
  console.log(chalk.dim('Documentation: https://github.com/Runbook-Agent/RunbookAI'));
  console.log();
}

async function processStep(step: DemoStep) {
  await sleep(step.delay);

  switch (step.type) {
    case 'phase':
      printPhase(step.data.phase as string, step.data.message as string);
      break;

    case 'tool':
      printTool(
        step.data.name as string,
        step.data.result as string,
        step.data.args as Record<string, unknown> | undefined
      );
      break;

    case 'hypothesis':
      printHypothesis(
        step.data.id as string,
        step.data.description as string,
        step.data.confidence as number,
        step.data.reasoning as string
      );
      break;

    case 'evidence':
      printEvidence(
        step.data.hypothesis as string,
        step.data.strength as string,
        step.data.finding as string,
        step.data.impact as string
      );
      break;

    case 'message':
      printMessage(step.data.text as string);
      break;

    case 'root_cause':
      printRootCause(
        step.data as {
          description: string;
          confidence: number;
          evidence: string[];
          affectedServices: string[];
        }
      );
      break;

    case 'remediation':
      printRemediation(
        step.data as {
          steps: Array<{
            priority: number;
            action: string;
            command: string | null;
            requiresApproval: boolean;
            rollback?: string;
            note?: string;
          }>;
          estimatedRecovery: string;
          preventionNotes: string[];
        }
      );
      break;
  }
}

export async function runDemo(options: { fast?: boolean } = {}) {
  const speedMultiplier = options.fast ? 0.3 : 1;

  printHeader();
  await sleep(500 * speedMultiplier);

  printIncident();
  await sleep(1000 * speedMultiplier);

  console.log(chalk.bold.white('Starting investigation...'));

  for (const step of DEMO_INVESTIGATION_STEPS) {
    const adjustedStep = {
      ...step,
      delay: Math.floor(step.delay * speedMultiplier),
    };
    await processStep(adjustedStep);
  }

  await sleep(500 * speedMultiplier);
  printFooter();
}
