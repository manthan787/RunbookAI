#!/usr/bin/env bun
/**
 * Runbook CLI
 *
 * Command-line interface for the Runbook agent.
 */

import { program } from 'commander';
import React, { useState, useEffect } from 'react';
import { render, Text, Box, Static } from 'ink';
import Spinner from 'ink-spinner';
import chalk from 'chalk';

import { Agent } from './agent/agent';
import { createLLMClient } from './model/llm';
import { toolRegistry } from './tools/registry';
import { loadConfig, validateConfig } from './utils/config';
import { quickSetup, loadServiceConfig, ONBOARDING_PROMPTS } from './config/onboarding';
import { SetupWizard } from './cli/setup-wizard';
import { ChatInterface } from './cli/chat';
import { MarkdownText } from './cli/components/markdown';
import { createRetriever } from './knowledge/retriever';
import type { AgentEvent } from './agent/types';
import { skillRegistry } from './skills/registry';
import { getRuntimeTools } from './cli/runtime-tools';
import { startSlackGateway, executeSlackRequestWithRuntime } from './slack/gateway';
import { runLearningLoop, type LearningEvent } from './learning/loop';
import {
  createOrchestrator,
  type InvestigationEvent,
  type RemediationContext,
} from './agent/investigation-orchestrator';
import type { RemediationStep } from './agent/state-machine';

// Version from package.json
const VERSION = '0.1.0';

/**
 * Knowledge retriever adapter for Agent runtime.
 */
function createAgentKnowledgeRetriever() {
  const retriever = createRetriever();

  return {
    retrieve: async (context: {
      query?: string;
      incidentId?: string;
      services: string[];
      symptoms: string[];
      errorMessages: string[];
    }) => {
      const queryParts = [
        context.query,
        context.incidentId,
        ...context.services,
        ...context.symptoms,
        ...context.errorMessages,
      ].filter(Boolean) as string[];

      const query = queryParts.join(' ').trim() || 'production incident investigation runbook';
      return retriever.search(query, {
        limit: 20,
        serviceFilter: context.services.length > 0 ? context.services : undefined,
      });
    },
  };
}

async function createRuntimeAgent(config: Awaited<ReturnType<typeof loadConfig>>): Promise<Agent> {
  const llm = createLLMClient({
    provider: config.llm.provider,
    model: config.llm.model,
    apiKey: config.llm.apiKey,
  });

  await skillRegistry.loadUserSkills();
  const runtimeSkills = skillRegistry.getAll().map((skill) => skill.id);
  const runtimeTools = await getRuntimeTools(config, toolRegistry.getAll());

  return new Agent({
    llm,
    tools: runtimeTools,
    skills: runtimeSkills,
    knowledgeRetriever: createAgentKnowledgeRetriever(),
    config: {
      maxIterations: config.agent.maxIterations,
      maxHypothesisDepth: config.agent.maxHypothesisDepth,
      contextThresholdTokens: config.agent.contextThresholdTokens,
    },
  });
}

/**
 * CLI Component for agent interaction
 */
interface AgentUIProps {
  query: string;
  incidentId?: string;
  verbose: boolean;
}

function AgentUI({ query, incidentId, verbose }: AgentUIProps) {
  const [status, setStatus] = useState<'loading' | 'thinking' | 'tool' | 'done'>('loading');
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    runAgent();
  }, []);

  async function runAgent() {
    try {
      // Load config
      const config = await loadConfig();
      const configErrors = validateConfig(config);
      if (configErrors.length > 0) {
        setError(configErrors.join('\n'));
        setStatus('done');
        return;
      }

      // Create agent
      const agent = await createRuntimeAgent(config);

      // Run agent and process events
      for await (const event of agent.run(query, incidentId)) {
        setEvents((prev) => [...prev, event]);

        switch (event.type) {
          case 'thinking':
            setStatus('thinking');
            break;
          case 'tool_start':
            setStatus('tool');
            setCurrentTool(event.tool);
            break;
          case 'tool_end':
            setCurrentTool(null);
            setStatus('thinking');
            break;
          case 'tool_error':
            setCurrentTool(null);
            setStatus('thinking');
            break;
          case 'done':
            setAnswer(event.answer);
            setStatus('done');
            break;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('done');
    }
  }

  // Render past events (static, won't re-render)
  const pastEvents = verbose
    ? events.filter((e) => e.type !== 'done').slice(0, -1)
    : events.filter((e) => e.type === 'tool_end');

  return (
    <Box flexDirection="column">
      {/* Static past events */}
      <Static items={pastEvents}>
        {(event, index) => (
          <Box key={index}>
            {event.type === 'tool_end' && (
              <Text color="green">
                ✓ {event.tool} ({event.durationMs}ms)
              </Text>
            )}
            {verbose && event.type === 'thinking' && (
              <Text color="gray" dimColor>
                💭 {event.content.slice(0, 100)}...
              </Text>
            )}
            {verbose && event.type === 'tool_start' && <Text color="blue">→ {event.tool}</Text>}
            {verbose && event.type === 'tool_limit' && (
              <Text color="yellow">
                ! {event.tool}: {event.warning}
              </Text>
            )}
            {verbose && event.type === 'tool_error' && (
              <Text color="red">
                ✗ {event.tool}: {event.error}
              </Text>
            )}
          </Box>
        )}
      </Static>

      {/* Current status */}
      {status !== 'done' && (
        <Box>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text>
            {' '}
            {status === 'loading' && 'Initializing...'}
            {status === 'thinking' && 'Thinking...'}
            {status === 'tool' && `Executing ${currentTool}...`}
          </Text>
        </Box>
      )}

      {/* Error */}
      {error && (
        <Box marginTop={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

      {/* Final answer */}
      {answer && (
        <Box marginTop={1} flexDirection="column">
          <Text color="green" bold>
            ─────────────────────────────────────────
          </Text>
          <MarkdownText content={answer} />
        </Box>
      )}
    </Box>
  );
}

/**
 * Simple text-only mode for non-TTY environments
 */
async function runSimple(query: string, incidentId?: string) {
  console.log(chalk.cyan('Runbook Agent'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`Query: ${query}`);
  if (incidentId) {
    console.log(`Incident: ${incidentId}`);
  }
  console.log();

  try {
    const config = await loadConfig();
    const configErrors = validateConfig(config);
    if (configErrors.length > 0) {
      console.error(chalk.red('Configuration errors:'));
      configErrors.forEach((e) => console.error(chalk.red(`  - ${e}`)));
      process.exit(1);
    }

    const agent = await createRuntimeAgent(config);

    for await (const event of agent.run(query, incidentId)) {
      switch (event.type) {
        case 'tool_start':
          console.log(chalk.blue(`→ ${event.tool}`));
          break;
        case 'tool_end':
          console.log(chalk.green(`✓ ${event.tool} (${event.durationMs}ms)`));
          break;
        case 'tool_error':
          console.log(chalk.red(`✗ ${event.tool}: ${event.error}`));
          break;
        case 'done':
          console.log();
          console.log(chalk.green('─'.repeat(40)));
          printMarkdownToConsole(event.answer);
          break;
      }
    }
  } catch (err) {
    console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
    process.exit(1);
  }
}

function formatInlineMarkdownForConsole(text: string): string {
  return text
    .replace(/`([^`]+)`/g, (_match, value) => chalk.yellow(String(value)))
    .replace(/\*\*([^*]+)\*\*/g, (_match, value) => chalk.bold(String(value)))
    .replace(/\*([^*]+)\*/g, (_match, value) => chalk.italic(String(value)));
}

function printMarkdownToConsole(content: string): void {
  const lines = content.split('\n');
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      console.log(chalk.gray(line));
      continue;
    }

    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const headerText = formatInlineMarkdownForConsole(headerMatch[2]);
      if (level === 1) {
        console.log(chalk.cyan.bold.underline(headerText));
      } else if (level === 2) {
        console.log(chalk.cyan.bold(headerText));
      } else {
        console.log(chalk.blue.bold(headerText));
      }
      continue;
    }

    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      console.log(chalk.gray('─'.repeat(40)));
      continue;
    }

    const orderedItem = line.match(/^(\s*)(\d+\.)\s+(.+)$/);
    if (orderedItem) {
      console.log(
        `${orderedItem[1]}${chalk.gray(orderedItem[2])} ${formatInlineMarkdownForConsole(
          orderedItem[3]
        )}`
      );
      continue;
    }

    const bulletItem = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (bulletItem) {
      console.log(
        `${bulletItem[1]}${chalk.gray('•')} ${formatInlineMarkdownForConsole(bulletItem[2])}`
      );
      continue;
    }

    const quoteItem = line.match(/^>\s?(.+)$/);
    if (quoteItem) {
      console.log(`${chalk.gray('│')} ${formatInlineMarkdownForConsole(quoteItem[1])}`);
      continue;
    }

    console.log(formatInlineMarkdownForConsole(line));
  }
}

function formatPhaseLabel(phase: string): string {
  return phase.replace(/_/g, ' ').toUpperCase();
}

function parseLambdaName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const marker = 'function:';
  const idx = trimmed.indexOf(marker);
  if (idx !== -1) {
    return trimmed.slice(idx + marker.length);
  }
  return trimmed;
}

function formatParamValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(',');
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function formatQueryParameterPreview(parameters: Record<string, unknown>): string {
  const preferredOrder = [
    'query',
    'services',
    'state',
    'action',
    'log_group',
    'filter_pattern',
    'minutes_back',
    'region',
  ];

  const entries: string[] = [];
  for (const key of preferredOrder) {
    if (!(key in parameters)) {
      continue;
    }
    entries.push(`${key}=${formatParamValue(parameters[key])}`);
  }

  if (entries.length === 0) {
    const fallback = Object.entries(parameters).slice(0, 4);
    for (const [key, value] of fallback) {
      entries.push(`${key}=${formatParamValue(value)}`);
    }
  }

  return entries.join(' | ');
}

function summarizeInvestigationQueryResult(result: unknown): string[] {
  if (result === null || result === undefined) {
    return ['No result returned'];
  }

  if (typeof result !== 'object') {
    return [String(result).slice(0, 180)];
  }

  const obj = result as Record<string, unknown>;
  const lines: string[] = [];

  if (typeof obj.error === 'string' && obj.error.trim()) {
    lines.push(`Error: ${obj.error}`);
  }

  if (typeof obj.count === 'number') {
    lines.push(`Count: ${obj.count}`);
  }

  if (typeof obj.totalResources === 'number') {
    const servicesQueried =
      typeof obj.servicesQueried === 'number' ? obj.servicesQueried : undefined;
    lines.push(
      servicesQueried !== undefined
        ? `AWS resources: ${obj.totalResources} across ${servicesQueried} services`
        : `AWS resources: ${obj.totalResources}`
    );
  }

  if (Array.isArray(obj.alarms)) {
    const alarmNames = obj.alarms
      .slice(0, 3)
      .map((alarm) =>
        alarm && typeof alarm === 'object' ? (alarm as Record<string, unknown>).alarmName : null
      )
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
    if (alarmNames.length > 0) {
      lines.push(`Alarms: ${alarmNames.join(', ')}`);
    }
  }

  if (Array.isArray(obj.events)) {
    const messages = obj.events
      .slice(0, 2)
      .map((event) =>
        event && typeof event === 'object' ? (event as Record<string, unknown>).message : null
      )
      .filter((message): message is string => typeof message === 'string' && message.length > 0)
      .map((message) => message.replace(/\s+/g, ' ').slice(0, 140));
    if (messages.length > 0) {
      lines.push(`Log samples: ${messages.join(' | ')}`);
    }
  }

  if (obj.results && typeof obj.results === 'object') {
    const serviceCounts = Object.entries(obj.results as Record<string, unknown>)
      .slice(0, 4)
      .map(([serviceId, data]) => {
        if (!data || typeof data !== 'object') {
          return null;
        }
        const count = (data as Record<string, unknown>).count;
        if (typeof count !== 'number') {
          return null;
        }
        return `${serviceId}=${count}`;
      })
      .filter((entry): entry is string => Boolean(entry));

    if (serviceCounts.length > 0) {
      lines.push(`Service counts: ${serviceCounts.join(', ')}`);
    }

    const lambda = (obj.results as Record<string, unknown>).lambda;
    if (lambda && typeof lambda === 'object') {
      const resources = (lambda as Record<string, unknown>).resources;
      if (Array.isArray(resources)) {
        const names = resources
          .slice(0, 3)
          .map((resource) => {
            if (!resource || typeof resource !== 'object') {
              return null;
            }
            const item = resource as Record<string, unknown>;
            return (
              parseLambdaName(item.name) ||
              parseLambdaName(item.functionName) ||
              parseLambdaName(item.FunctionName) ||
              parseLambdaName(item.id)
            );
          })
          .filter((name): name is string => Boolean(name));
        if (names.length > 0) {
          lines.push(`Lambda: ${names.join(', ')}`);
        }
      }
    }
  }

  if (Array.isArray(obj.triggeredMonitors)) {
    const monitorNames = obj.triggeredMonitors
      .slice(0, 3)
      .map((monitor) =>
        monitor && typeof monitor === 'object' ? (monitor as Record<string, unknown>).name : null
      )
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
    if (monitorNames.length > 0) {
      lines.push(`Triggered monitors: ${monitorNames.join(', ')}`);
    }
  }

  if (lines.length === 0) {
    lines.push(`Result keys: ${Object.keys(obj).slice(0, 6).join(', ') || 'none'}`);
  }

  return lines.slice(0, 6);
}

async function promptYesNo(question: string, defaultYes: boolean = false): Promise<boolean> {
  const { createInterface } = await import('readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultYes ? ' [Y/n]: ' : ' [y/N]: ';

  try {
    const answer = (await rl.question(question + suffix)).trim().toLowerCase();
    if (!answer) {
      return defaultYes;
    }
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

async function approveRemediationStepInteractive(step: RemediationStep): Promise<boolean> {
  console.log();
  console.log(chalk.yellow('Remediation approval required'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(chalk.cyan(`Action: ${step.action}`));
  console.log(chalk.gray(`Description: ${step.description}`));
  console.log(chalk.gray(`Risk: ${step.riskLevel}`));
  if (step.matchingSkill) {
    console.log(chalk.gray(`Skill: ${step.matchingSkill}`));
  }
  if (step.command) {
    console.log(chalk.gray(`Command: ${step.command}`));
  }
  if (step.rollbackCommand) {
    console.log(chalk.gray(`Rollback: ${step.rollbackCommand}`));
  }

  return promptYesNo('Execute this remediation step?', false);
}

/**
 * Structured investigation mode for incident command.
 * Uses the dedicated investigation state machine + orchestrator pipeline.
 */
async function runStructuredInvestigation(
  incidentId: string,
  verbose: boolean,
  autoRemediate: boolean,
  learn: boolean,
  applyRunbookUpdates: boolean
) {
  console.log(chalk.cyan('Runbook Investigation'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`Incident: ${incidentId}`);
  if (autoRemediate) {
    console.log(
      chalk.yellow('Auto-remediation enabled (steps execute via skills when available).')
    );
  }
  console.log();

  const config = await loadConfig();
  const configErrors = validateConfig(config);
  if (configErrors.length > 0) {
    console.error(chalk.red('Configuration errors:'));
    configErrors.forEach((e) => console.error(chalk.red(`  - ${e}`)));
    process.exit(1);
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
  const shouldPromptForRemediation = !autoRemediate && process.stdin.isTTY && process.stdout.isTTY;
  const learningEvents: LearningEvent[] = [];

  const recordLearningEvent = (
    type: LearningEvent['type'],
    summary: string,
    phase?: string,
    details?: Record<string, unknown>
  ) => {
    if (!learn) {
      return;
    }
    learningEvents.push({
      timestamp: new Date().toISOString(),
      type,
      summary,
      phase,
      details,
    });
  };

  const orchestrator = createOrchestrator(
    {
      complete: async (prompt: string) => {
        const response = await llm.chat(
          'You are an SRE investigator. Return only valid JSON matching the requested schema.',
          prompt
        );
        return response.content;
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
      maxIterations: config.agent.maxIterations,
      autoApproveRemediation: autoRemediate,
      approveRemediationStep: shouldPromptForRemediation
        ? (step: RemediationStep) => approveRemediationStepInteractive(step)
        : undefined,
      availableTools: runtimeTools.map((tool) => tool.name),
      availableSkills: runtimeSkills,
      fetchRelevantRunbooks: async (context: RemediationContext) => {
        const retriever = createRetriever();
        try {
          const searchQuery = [context.rootCause, ...context.affectedServices].join(' ').trim();
          const results = await retriever.search(
            searchQuery || context.incidentId || 'incident remediation',
            {
              typeFilter: ['runbook'],
              serviceFilter:
                context.affectedServices.length > 0 ? context.affectedServices : undefined,
              limit: 12,
            }
          );

          return Array.from(
            new Set(results.runbooks.map((runbook) => runbook.title).filter(Boolean))
          ).slice(0, 8);
        } finally {
          retriever.close();
        }
      },
    }
  );

  let phaseCounter = 0;
  let queryCounter = 0;

  orchestrator.on((event: InvestigationEvent) => {
    switch (event.type) {
      case 'phase_change':
        phaseCounter++;
        recordLearningEvent(
          'phase_change',
          `${formatPhaseLabel(event.phase)}: ${event.reason}`,
          event.phase
        );
        console.log();
        console.log(chalk.blue(`Step ${phaseCounter}: ${formatPhaseLabel(event.phase)}`));
        console.log(chalk.gray(`  ${event.reason}`));
        break;
      case 'triage_complete':
        recordLearningEvent('triage_complete', event.result.summary, 'triage', {
          severity: event.result.severity,
          affectedServices: event.result.affectedServices,
          symptoms: event.result.symptoms,
        });
        console.log(chalk.cyan(`  Triage summary: ${event.result.summary}`));
        if (event.result.affectedServices.length > 0) {
          console.log(
            chalk.gray(`  Affected services: ${event.result.affectedServices.join(', ')}`)
          );
        }
        if (event.result.symptoms.length > 0) {
          console.log(chalk.gray(`  Symptoms: ${event.result.symptoms.slice(0, 3).join(' | ')}`));
        }
        if (verbose && event.result.errorMessages.length > 0) {
          console.log(
            chalk.gray(`  Error hints: ${event.result.errorMessages.slice(0, 3).join(' | ')}`)
          );
        }
        break;
      case 'hypothesis_created':
        recordLearningEvent(
          'hypothesis_created',
          `${event.hypothesis.id}: ${event.hypothesis.statement}`,
          'hypothesize',
          {
            priority: event.hypothesis.priority,
            category: event.hypothesis.category,
          }
        );
        console.log(
          chalk.magenta(
            `  Hypothesis ${event.hypothesis.id} [P${event.hypothesis.priority}] (${event.hypothesis.category}): ${event.hypothesis.statement}`
          )
        );
        break;
      case 'hypothesis_updated':
        recordLearningEvent(
          'hypothesis_updated',
          `${event.hypothesis.id}: ${event.hypothesis.status} (${event.hypothesis.evidenceStrength})`,
          'evaluate',
          {
            confidence: event.hypothesis.confidence,
          }
        );
        if (verbose) {
          console.log(
            chalk.gray(
              `  Hypothesis ${event.hypothesis.id} -> ${event.hypothesis.status} (${event.hypothesis.evidenceStrength}, confidence ${event.hypothesis.confidence}%)`
            )
          );
        }
        break;
      case 'query_executing':
        queryCounter++;
        recordLearningEvent(
          'query_executing',
          `${event.query.tool} ${event.query.queryType}`,
          'investigate',
          {
            parameters: event.query.parameters,
          }
        );
        console.log(
          chalk.gray(`  Query ${queryCounter}: ${event.query.tool} (${event.query.queryType})`)
        );
        console.log(
          chalk.gray(`    Params: ${formatQueryParameterPreview(event.query.parameters)}`)
        );
        if (verbose && event.query.expectedOutcome) {
          console.log(chalk.gray(`    Expected: ${event.query.expectedOutcome}`));
        }
        break;
      case 'query_complete':
        {
          const summaryLines = summarizeInvestigationQueryResult(event.result);
          recordLearningEvent(
            'query_complete',
            summaryLines[0] || `Completed ${event.query.tool} query`,
            'investigate',
            {
              tool: event.query.tool,
              highlights: summaryLines.slice(0, 3),
            }
          );
          if (summaryLines.length > 0) {
            console.log(chalk.green(`    ✓ ${summaryLines[0]}`));
            for (const line of summaryLines.slice(1)) {
              console.log(chalk.gray(`      ${line}`));
            }
          } else {
            console.log(
              chalk.green(`    ✓ Query complete: ${event.query.tool} (${event.query.queryType})`)
            );
          }
        }
        break;
      case 'evidence_evaluated':
        recordLearningEvent(
          'evidence_evaluated',
          `${event.evaluation.hypothesisId}: ${event.evaluation.action} (${event.evaluation.evidenceStrength})`,
          'evaluate',
          {
            confidence: event.evaluation.confidence,
            findings: event.evaluation.findings.slice(0, 3),
          }
        );
        console.log(
          chalk.yellow(
            `  Evidence on ${event.evaluation.hypothesisId}: ${event.evaluation.evidenceStrength} (${event.evaluation.confidence}%) -> ${event.evaluation.action.toUpperCase()}`
          )
        );
        if (event.evaluation.findings.length > 0) {
          console.log(
            chalk.gray(`    Findings: ${event.evaluation.findings.slice(0, 3).join(' | ')}`)
          );
        }
        break;
      case 'conclusion_reached':
        recordLearningEvent(
          'conclusion_reached',
          event.conclusion.rootCause,
          'conclude',
          {
            confidence: event.conclusion.confidence,
            affectedServices: event.conclusion.affectedServices || [],
          }
        );
        console.log(chalk.green(`  Candidate root cause: ${event.conclusion.rootCause}`));
        console.log(chalk.gray(`  Confidence: ${event.conclusion.confidence}`));
        if (event.conclusion.affectedServices && event.conclusion.affectedServices.length > 0) {
          console.log(chalk.gray(`  Scope: ${event.conclusion.affectedServices.join(', ')}`));
        }
        if (verbose && event.conclusion.unknowns.length > 0) {
          console.log(chalk.gray(`  Unknowns: ${event.conclusion.unknowns.join(' | ')}`));
        }
        break;
      case 'error':
        recordLearningEvent('error', `${event.phase}: ${event.error.message}`, event.phase);
        console.log(chalk.red(`✗ ${event.phase}: ${event.error.message}`));
        break;
      case 'remediation_step':
        {
          recordLearningEvent(
            'remediation_step',
            `${event.step.action} [${event.status}]`,
            'remediate',
            {
              riskLevel: event.step.riskLevel,
              requiresApproval: event.step.requiresApproval,
              matchingSkill: event.step.matchingSkill,
            }
          );
          const symbol = event.status === 'completed' ? '✓' : event.status === 'failed' ? '✗' : '→';
          console.log(
            chalk.magenta(`  ${symbol} Remediation: ${event.step.action} [${event.status}]`)
          );
          if (verbose) {
            const details = [
              `risk=${event.step.riskLevel}`,
              `approval=${event.step.requiresApproval ? 'required' : 'not required'}`,
            ];
            if (event.step.matchingSkill) {
              details.push(`skill=${event.step.matchingSkill}`);
            }
            console.log(chalk.gray(`    ${details.join(' | ')}`));
            if (event.step.error) {
              console.log(chalk.red(`    Error: ${event.step.error}`));
            }
          }
        }
        break;
    }
  });

  const query = `Investigate incident ${incidentId}. Identify the root cause with supporting evidence.`;
  const result = await orchestrator.investigate(query);

  console.log();
  console.log(chalk.green('Investigation Complete'));
  console.log(chalk.green('─'.repeat(40)));
  console.log(chalk.gray(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`));
  if (result.rootCause) {
    console.log(chalk.green(`Root Cause: ${result.rootCause}`));
  } else {
    console.log(chalk.yellow('Root Cause: not determined'));
  }
  if (result.confidence) {
    console.log(chalk.gray(`Confidence: ${result.confidence}`));
  }
  if (result.affectedServices && result.affectedServices.length > 0) {
    console.log(chalk.gray(`Affected Services: ${result.affectedServices.join(', ')}`));
  }

  if (result.remediationPlan?.steps?.length) {
    console.log();
    console.log(chalk.cyan('Remediation Plan:'));
    result.remediationPlan.steps.forEach((step, index) => {
      console.log(chalk.cyan(`  ${index + 1}. ${step.action}`));
      console.log(chalk.gray(`     Description: ${step.description}`));
      console.log(
        chalk.gray(
          `     Risk: ${step.riskLevel} | Approval: ${step.requiresApproval ? 'required' : 'not required'}`
        )
      );
      if (step.matchingSkill) {
        console.log(chalk.gray(`     Skill: ${step.matchingSkill}`));
      }
      if (step.matchingRunbook) {
        console.log(chalk.gray(`     Runbook: ${step.matchingRunbook}`));
      }
      if (step.command) {
        console.log(chalk.gray(`     Command: ${step.command}`));
      }
      if (step.rollbackCommand) {
        console.log(chalk.gray(`     Rollback: ${step.rollbackCommand}`));
      }
      if (step.error) {
        console.log(chalk.yellow(`     Status: ${step.status} (${step.error})`));
      } else if (step.status && step.status !== 'pending') {
        console.log(chalk.gray(`     Status: ${step.status}`));
      }
    });
  }

  if (verbose) {
    console.log();
    console.log(chalk.cyan('Detailed Summary:'));
    printMarkdownToConsole(result.summary);
  }

  if (learn) {
    console.log();
    console.log(chalk.cyan('Learning Loop'));
    console.log(chalk.gray('─'.repeat(40)));

    try {
      const learning = await runLearningLoop({
        result,
        incidentId,
        query,
        events: learningEvents,
        applyRunbookUpdates,
        complete: async (prompt: string) => {
          const response = await llm.chat(
            'You are an SRE postmortem and runbook improvement assistant. Return only valid JSON.',
            prompt
          );
          return response.content;
        },
      });

      console.log(chalk.green(`Artifacts: ${learning.artifactDir}`));
      console.log(chalk.gray(`Postmortem draft: ${learning.postmortemPath}`));
      console.log(chalk.gray(`Suggestions: ${learning.suggestionsPath}`));
      if (learning.appliedRunbookUpdates.length > 0) {
        console.log(
          chalk.green(`Applied runbook updates: ${learning.appliedRunbookUpdates.length}`)
        );
      }
      if (learning.proposedRunbookUpdates.length > 0) {
        console.log(
          chalk.yellow(`Proposed updates/docs: ${learning.proposedRunbookUpdates.length}`)
        );
      }

      if (applyRunbookUpdates && learning.appliedRunbookUpdates.length > 0) {
        const retriever = createRetriever();
        try {
          await retriever.sync();
          console.log(chalk.gray('Knowledge index refreshed after runbook updates.'));
        } finally {
          retriever.close();
        }
      }
    } catch (error) {
      console.log(
        chalk.red(
          `Learning loop failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }
}

// CLI Program
program
  .name('runbook')
  .description('AI-powered SRE assistant for incident investigation and cloud operations')
  .version(VERSION);

// Ask command - general queries
program
  .command('ask <query...>')
  .description('Ask a question about your infrastructure')
  .option('-v, --verbose', 'Show detailed output')
  .action(async (queryParts: string[], options: { verbose?: boolean }) => {
    const query = queryParts.join(' ');

    if (process.stdout.isTTY) {
      render(<AgentUI query={query} verbose={options.verbose || false} />);
    } else {
      await runSimple(query);
    }
  });

// Chat command - interactive conversation
program
  .command('chat')
  .description('Start an interactive chat session')
  .action(async () => {
    if (process.stdout.isTTY) {
      render(<ChatInterface />);
    } else {
      console.log(chalk.red('Chat mode requires an interactive terminal (TTY).'));
      console.log(chalk.yellow('Use `runbook ask "your question"` for non-interactive mode.'));
      process.exit(1);
    }
  });

// Investigate command - incident investigation
program
  .command('investigate <incident-id>')
  .description('Investigate a PagerDuty/OpsGenie incident')
  .option('-v, --verbose', 'Show detailed output')
  .option('--auto-remediate', 'Attempt to execute remediation steps through runtime skills')
  .option(
    '--learn',
    'Generate postmortem draft + runbook knowledge suggestions from investigation output'
  )
  .option(
    '--apply-runbook-updates',
    'Apply generated runbook updates/new runbooks into .runbook/runbooks (requires --learn)'
  )
  .action(
    async (
      incidentId: string,
      options: {
        verbose?: boolean;
        autoRemediate?: boolean;
        learn?: boolean;
        applyRunbookUpdates?: boolean;
      }
    ) => {
      if (options.applyRunbookUpdates && !options.learn) {
        console.error(chalk.red('--apply-runbook-updates requires --learn'));
        process.exit(1);
      }

      try {
        await runStructuredInvestigation(
          incidentId,
          options.verbose || false,
          options.autoRemediate || false,
          options.learn || false,
          options.applyRunbookUpdates || false
        );
      } catch (error) {
        console.error(
          chalk.red(
            `Structured investigation failed: ${error instanceof Error ? error.message : error}`
          )
        );
        console.log(chalk.yellow('Falling back to standard agent investigation...'));
        const fallbackQuery = `Investigate incident ${incidentId}. Identify the root cause using hypothesis-driven investigation.`;
        if (process.stdout.isTTY) {
          render(
            <AgentUI
              query={fallbackQuery}
              incidentId={incidentId}
              verbose={options.verbose || options.autoRemediate || options.learn || false}
            />
          );
        } else {
          await runSimple(fallbackQuery, incidentId);
        }
      }
    }
  );

// Status command - quick infrastructure overview
program
  .command('status')
  .description('Get a quick status overview of your infrastructure')
  .action(async () => {
    const query =
      'Give me a quick status overview of the infrastructure. What services are running? Any issues?';

    if (process.stdout.isTTY) {
      render(<AgentUI query={query} verbose={false} />);
    } else {
      await runSimple(query);
    }
  });

// Init command - setup wizard
program
  .command('init')
  .description('Initialize Runbook with a quick setup wizard')
  .option('-t, --template <template>', 'Use a template: ecs-rds, serverless, enterprise')
  .option('-r, --regions <regions>', 'AWS regions (comma-separated)', 'us-east-1')
  .action(async (options: { template?: string; regions?: string }) => {
    const template = options.template as 'ecs-rds' | 'serverless' | 'enterprise' | undefined;
    const regions = options.regions?.split(',').map((r) => r.trim()) || ['us-east-1'];

    if (template) {
      // Use template-based quick setup
      console.log(chalk.cyan(ONBOARDING_PROMPTS.welcome));
      console.log(chalk.blue(`Using template: ${template}`));
      console.log(chalk.blue(`Regions: ${regions.join(', ')}`));

      const configPath = await quickSetup(template, regions);
      console.log(chalk.green(`\nConfiguration saved to ${configPath}`));
      console.log(chalk.cyan(ONBOARDING_PROMPTS.complete));
    } else if (process.stdout.isTTY) {
      // Interactive setup wizard
      render(<SetupWizard />);
    } else {
      // Non-interactive fallback
      console.log(chalk.cyan(ONBOARDING_PROMPTS.welcome));
      console.log(chalk.yellow('Interactive mode requires a TTY. Use --template:'));
      console.log('  runbook init --template ecs-rds');
      console.log('  runbook init --template serverless');
      console.log('  runbook init --template enterprise --regions us-east-1,us-west-2');
    }
  });

// Knowledge commands
const knowledge = program.command('knowledge').description('Manage knowledge base');

knowledge
  .command('sync')
  .description('Sync knowledge from all configured sources')
  .action(async () => {
    console.log(chalk.blue('Syncing knowledge from configured sources...'));
    try {
      const retriever = createRetriever();
      const { added, updated } = await retriever.sync();
      console.log(chalk.green(`Sync complete: ${added} added, ${updated} updated`));
      console.log(chalk.green(`Total documents: ${retriever.getDocumentCount()}`));
      retriever.close();
    } catch (error) {
      console.error(chalk.red(`Sync failed: ${error instanceof Error ? error.message : error}`));
    }
  });

knowledge
  .command('search <query...>')
  .description('Search the knowledge base')
  .option('--type <type>', 'Filter by type: runbook, postmortem, architecture, known_issue')
  .option('--service <service>', 'Filter by service name')
  .action(async (queryParts: string[], options: { type?: string; service?: string }) => {
    const query = queryParts.join(' ');
    console.log(chalk.blue(`Searching for: "${query}"`));
    try {
      const retriever = createRetriever();
      const results = await retriever.search(query, {
        limit: 10,
        typeFilter: options.type
          ? [options.type as 'runbook' | 'postmortem' | 'architecture' | 'known_issue']
          : undefined,
        serviceFilter: options.service ? [options.service] : undefined,
      });
      const total =
        results.runbooks.length +
        results.postmortems.length +
        results.knownIssues.length +
        results.architecture.length;

      if (total === 0) {
        console.log(chalk.yellow('No matching documents found.'));
      } else {
        console.log(chalk.green(`Found ${total} results:\n`));
        for (const doc of [
          ...results.runbooks,
          ...results.postmortems,
          ...results.knownIssues,
          ...results.architecture,
        ]) {
          console.log(chalk.cyan(`[${doc.type}] ${doc.title}`));
          console.log(chalk.gray(doc.content.slice(0, 200) + '...\n'));
        }
      }
      retriever.close();
    } catch (error) {
      console.error(chalk.red(`Search failed: ${error instanceof Error ? error.message : error}`));
    }
  });

knowledge
  .command('add <file>')
  .description('Add a file to the knowledge base')
  .option('--type <type>', 'Document type: runbook, postmortem, architecture, known_issue')
  .action(async (file: string, options: { type?: string }) => {
    const { existsSync } = await import('fs');
    const { readFile } = await import('fs/promises');
    const { join, resolve, basename, extname } = await import('path');
    const { parse: parseYaml } = await import('yaml');
    const matter = (await import('gray-matter')).default;

    const filePath = resolve(file);

    if (!existsSync(filePath)) {
      console.error(chalk.red(`File not found: ${filePath}`));
      process.exit(1);
    }

    console.log(chalk.blue(`Adding ${basename(filePath)} to knowledge base...`));

    try {
      const content = await readFile(filePath, 'utf-8');
      const ext = extname(filePath).toLowerCase();

      // Parse the file
      let title: string;
      let docType = options.type || 'runbook';
      let services: string[] = [];

      if (ext === '.md' || ext === '.markdown') {
        const { data: frontmatter } = matter(content);
        title = frontmatter.title || basename(filePath, ext);
        docType = frontmatter.type || options.type || 'runbook';
        services = frontmatter.services || [];
      } else if (ext === '.yaml' || ext === '.yml') {
        const data = parseYaml(content);
        title = data.title || basename(filePath, ext);
        docType = data.type || options.type || 'runbook';
        services = data.services || [];
      } else {
        title = basename(filePath, ext);
      }

      // Copy to .runbook/runbooks/
      const { mkdir, copyFile } = await import('fs/promises');
      const destDir = join('.runbook', 'runbooks');
      await mkdir(destDir, { recursive: true });
      const destPath = join(destDir, basename(filePath));
      await copyFile(filePath, destPath);

      // Sync to update the index
      const retriever = createRetriever();
      await retriever.sync();

      console.log(chalk.green(`Added: ${title}`));
      console.log(chalk.gray(`  Type: ${docType}`));
      console.log(chalk.gray(`  Services: ${services.length > 0 ? services.join(', ') : 'none'}`));
      console.log(chalk.gray(`  Location: ${destPath}`));

      retriever.close();
    } catch (error) {
      console.error(
        chalk.red(`Failed to add file: ${error instanceof Error ? error.message : error}`)
      );
    }
  });

knowledge
  .command('validate')
  .description('Check for stale or outdated knowledge')
  .option('--days <days>', 'Days before considering content stale', '90')
  .action(async (options: { days: string }) => {
    const staleDays = parseInt(options.days, 10);
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - staleDays);

    console.log(chalk.blue(`Checking for content older than ${staleDays} days...`));

    try {
      const retriever = createRetriever();
      await retriever.sync();

      // Get all documents directly from the store for accurate counts.
      const allDocs = retriever.getAllDocuments();

      const stale: Array<{ title: string; type: string; age: number }> = [];
      const fresh: Array<{ title: string; type: string }> = [];

      for (const doc of allDocs) {
        const referenceDate = doc.lastValidated || doc.updatedAt || doc.createdAt;
        const parsedReference = referenceDate ? new Date(referenceDate) : null;

        if (
          parsedReference &&
          !Number.isNaN(parsedReference.getTime()) &&
          parsedReference < staleDate
        ) {
          const age = Math.floor((Date.now() - parsedReference.getTime()) / (1000 * 60 * 60 * 24));
          stale.push({ title: doc.title, type: doc.type, age });
          continue;
        }

        fresh.push({ title: doc.title, type: doc.type });
      }

      console.log(chalk.green(`\nKnowledge Base Status:`));
      console.log(chalk.gray(`  Total documents: ${allDocs.length}`));

      if (stale.length > 0) {
        console.log(chalk.yellow(`\nStale documents (>${staleDays} days):`));
        for (const doc of stale) {
          console.log(chalk.yellow(`  - [${doc.type}] ${doc.title} (${doc.age} days old)`));
        }
      } else {
        console.log(chalk.green(`\nNo stale documents found.`));
      }

      console.log(
        chalk.gray(`\nTip: Add 'lastValidated' to frontmatter to track validation dates.`)
      );

      retriever.close();
    } catch (error) {
      console.error(
        chalk.red(`Validation failed: ${error instanceof Error ? error.message : error}`)
      );
    }
  });

knowledge
  .command('stats')
  .description('Show knowledge base statistics')
  .action(async () => {
    console.log(chalk.blue('Knowledge Base Statistics:'));

    try {
      const retriever = createRetriever();
      await retriever.sync();

      const counts = retriever.getDocumentCountsByType();

      console.log(chalk.cyan(`  Runbooks: ${counts.runbook}`));
      console.log(chalk.cyan(`  Post-mortems: ${counts.postmortem}`));
      console.log(chalk.cyan(`  Architecture docs: ${counts.architecture}`));
      console.log(chalk.cyan(`  Known issues: ${counts.known_issue}`));
      console.log(chalk.green(`  Total: ${retriever.getDocumentCount()} documents`));

      retriever.close();
    } catch (error) {
      console.error(
        chalk.red(`Failed to get stats: ${error instanceof Error ? error.message : error}`)
      );
    }
  });

// Auth subcommand for knowledge sources
const auth = knowledge.command('auth').description('Authenticate with knowledge sources');

auth
  .command('google')
  .description('Authenticate with Google Drive for knowledge sync')
  .option('--client-id <id>', 'Google OAuth client ID (or set GOOGLE_CLIENT_ID)')
  .option('--client-secret <secret>', 'Google OAuth client secret (or set GOOGLE_CLIENT_SECRET)')
  .action(async (options: { clientId?: string; clientSecret?: string }) => {
    const { completeOAuthFlow } = await import('./knowledge/sources/google-auth');
    const { readFile, writeFile, mkdir } = await import('fs/promises');
    const { parse: parseYaml, stringify: stringifyYaml } = await import('yaml');
    const { existsSync } = await import('fs');

    const clientId = options.clientId || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = options.clientSecret || process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.error(chalk.red('Error: Google OAuth credentials required.'));
      console.log(chalk.yellow('\nProvide credentials via:'));
      console.log(chalk.gray('  --client-id and --client-secret options, or'));
      console.log(chalk.gray('  GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables'));
      console.log(chalk.yellow('\nTo obtain credentials:'));
      console.log(chalk.gray('  1. Go to Google Cloud Console: https://console.cloud.google.com'));
      console.log(chalk.gray('  2. Create or select a project'));
      console.log(chalk.gray('  3. Enable Google Drive API and Google Docs API'));
      console.log(chalk.gray('  4. Create OAuth 2.0 credentials (Desktop app type)'));
      console.log(chalk.gray('  5. Add http://localhost:8085/oauth/callback as redirect URI'));
      process.exit(1);
    }

    console.log(chalk.cyan('Starting Google Drive authentication...'));

    try {
      const tokens = await completeOAuthFlow(clientId, clientSecret);

      // Save refresh token to config
      const configPath = '.runbook/config.yaml';
      let config: Record<string, unknown> = {};

      if (existsSync(configPath)) {
        const content = await readFile(configPath, 'utf-8');
        config = parseYaml(content) || {};
      }

      // Initialize knowledge.sources if needed
      if (!config.knowledge) {
        config.knowledge = {};
      }
      const knowledgeConfig = config.knowledge as Record<string, unknown>;
      if (!knowledgeConfig.sources) {
        knowledgeConfig.sources = [];
      }

      // Find or create google_drive source
      const sources = knowledgeConfig.sources as Array<Record<string, unknown>>;
      let googleSource = sources.find((s) => s.type === 'google_drive');

      if (!googleSource) {
        googleSource = {
          type: 'google_drive',
          folderIds: [],
          clientId: '${GOOGLE_CLIENT_ID}',
          clientSecret: '${GOOGLE_CLIENT_SECRET}',
          refreshToken: tokens.refreshToken,
          includeSubfolders: true,
        };
        sources.push(googleSource);
      } else {
        googleSource.refreshToken = tokens.refreshToken;
      }

      await mkdir('.runbook', { recursive: true });
      await writeFile(configPath, stringifyYaml(config));

      console.log(chalk.green('\nGoogle Drive authentication successful!'));
      console.log(chalk.gray(`Refresh token saved to ${configPath}`));
      console.log(chalk.yellow('\nNext steps:'));
      console.log(chalk.gray('  1. Add folder IDs to your config:'));
      console.log(chalk.gray('     knowledge.sources[].folderIds: ["your-folder-id"]'));
      console.log(chalk.gray('  2. Run "runbook knowledge sync" to sync documents'));
    } catch (error) {
      console.error(
        chalk.red(`Authentication failed: ${error instanceof Error ? error.message : error}`)
      );
      process.exit(1);
    }
  });

// Deploy command
program
  .command('deploy <service>')
  .description('Deploy a service using the deploy-service skill')
  .option('-e, --environment <env>', 'Target environment', 'production')
  .option('--version <version>', 'Version to deploy')
  .option('--dry-run', 'Show what would be deployed without executing')
  .action(
    async (
      service: string,
      options: { environment: string; version?: string; dryRun?: boolean }
    ) => {
      const { environment, version, dryRun } = options;

      const query = dryRun
        ? `Show me what would happen if I deploy ${service} to ${environment}${version ? ` version ${version}` : ''}. Do not execute, just explain the steps.`
        : `Deploy ${service} to ${environment}${version ? ` version ${version}` : ''} using the deploy-service skill. Perform all pre-deployment checks first.`;

      console.log(chalk.cyan(`Deploying ${service} to ${environment}...`));
      if (version) console.log(chalk.gray(`Version: ${version}`));
      if (dryRun) console.log(chalk.yellow('(Dry run mode - no changes will be made)'));
      console.log();

      if (process.stdout.isTTY) {
        render(<AgentUI query={query} verbose={true} />);
      } else {
        await runSimple(query);
      }
    }
  );

// Config set command
program
  .command('config')
  .description('Show or modify configuration')
  .option('--services', 'Show services configuration')
  .option('--set <key=value>', 'Set a configuration value')
  .action(async (options: { services?: boolean; set?: string }) => {
    if (options.set) {
      const [key, ...valueParts] = options.set.split('=');
      const value = valueParts.join('=');

      if (!key || !value) {
        console.error(chalk.red('Invalid format. Use: --set key=value'));
        process.exit(1);
      }

      console.log(chalk.blue(`Setting ${key} = ${value}`));

      try {
        const { readFile, writeFile, mkdir } = await import('fs/promises');
        const { parse: parseYaml, stringify: stringifyYaml } = await import('yaml');
        const { existsSync } = await import('fs');

        const configPath = '.runbook/config.yaml';

        let config: Record<string, unknown> = {};
        if (existsSync(configPath)) {
          const content = await readFile(configPath, 'utf-8');
          config = parseYaml(content) || {};
        }

        // Handle nested keys (e.g., llm.model)
        const keys = key.split('.');
        let current: Record<string, unknown> = config;
        for (let i = 0; i < keys.length - 1; i++) {
          if (!current[keys[i]] || typeof current[keys[i]] !== 'object') {
            current[keys[i]] = {};
          }
          current = current[keys[i]] as Record<string, unknown>;
        }

        // Parse value (try JSON, then boolean, then number, then string)
        let parsedValue: unknown = value;
        if (value === 'true') parsedValue = true;
        else if (value === 'false') parsedValue = false;
        else if (!isNaN(Number(value))) parsedValue = Number(value);
        else {
          try {
            parsedValue = JSON.parse(value);
          } catch {
            parsedValue = value;
          }
        }

        current[keys[keys.length - 1]] = parsedValue;

        await mkdir('.runbook', { recursive: true });
        await writeFile(configPath, stringifyYaml(config));

        console.log(chalk.green(`Configuration updated: ${key} = ${JSON.stringify(parsedValue)}`));
      } catch (error) {
        console.error(
          chalk.red(`Failed to set config: ${error instanceof Error ? error.message : error}`)
        );
      }
    } else if (options.services) {
      const serviceConfig = await loadServiceConfig();
      if (serviceConfig) {
        console.log(chalk.cyan('Services Configuration:'));
        console.log(JSON.stringify(serviceConfig, null, 2));
      } else {
        console.log(chalk.yellow('No services configured. Run "runbook init" to set up.'));
      }
    } else {
      const config = await loadConfig();
      console.log(chalk.cyan('Current Configuration:'));
      console.log(JSON.stringify(config, null, 2));
    }
  });

// Webhook server command
program
  .command('webhook')
  .description('Start the Slack webhook server for handling approval button clicks')
  .option('-p, --port <port>', 'Port to listen on', '3000')
  .option('--pending-dir <dir>', 'Directory for pending approval files')
  .action(async (options: { port: string; pendingDir?: string }) => {
    const { startWebhookServer, getWebhookConfigFromEnv } =
      await import('./webhooks/slack-webhook');

    const envConfig = getWebhookConfigFromEnv();
    const signingSecret = envConfig?.signingSecret || process.env.SLACK_SIGNING_SECRET;

    if (!signingSecret) {
      console.error(chalk.red('Error: SLACK_SIGNING_SECRET environment variable is required'));
      console.log(chalk.yellow('Set it in your environment or .env file'));
      console.log(
        chalk.gray('You can find this in your Slack app settings under "Signing Secret"')
      );
      process.exit(1);
    }

    const port = parseInt(options.port, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      console.error(chalk.red('Error: Invalid port number'));
      process.exit(1);
    }

    console.log(chalk.cyan('Starting Slack webhook server...'));
    console.log(chalk.gray(`Port: ${port}`));
    console.log(chalk.gray(`Pending dir: ${options.pendingDir || '.runbook/pending'}`));

    try {
      await startWebhookServer({
        port,
        signingSecret,
        pendingDir: options.pendingDir,
      });

      console.log('');
      console.log(chalk.green('Webhook server is running!'));
      console.log('');
      console.log(chalk.cyan('Configure your Slack app:'));
      console.log(chalk.gray('1. Go to your Slack app settings'));
      console.log(chalk.gray('2. Navigate to "Interactivity & Shortcuts"'));
      console.log(chalk.gray(`3. Set Request URL to: https://your-domain.com/slack/interactions`));
      console.log('');
      console.log(chalk.yellow('Press Ctrl+C to stop'));
    } catch (error) {
      console.error(
        chalk.red(
          `Failed to start webhook server: ${error instanceof Error ? error.message : error}`
        )
      );
      process.exit(1);
    }
  });

// Slack events gateway command
program
  .command('slack-gateway')
  .description('Start Slack events gateway for @runbookAI mentions in alert channels')
  .option('--mode <mode>', 'Gateway mode: http or socket')
  .option('-p, --port <port>', 'HTTP mode listen port')
  .option('--channels <channels>', 'Comma-separated Slack channel IDs to allow')
  .option('--allowed-users <users>', 'Comma-separated Slack user IDs allowed to invoke commands')
  .option('--require-threaded', 'Only respond to mentions in threads')
  .action(
    async (options: {
      mode?: string;
      port?: string;
      channels?: string;
      allowedUsers?: string;
      requireThreaded?: boolean;
    }) => {
      const config = await loadConfig();
      const slackConfig = config.incident.slack;
      const eventsConfig = slackConfig.events;

      const mode = (options.mode || eventsConfig.mode) as 'http' | 'socket';
      const port = options.port ? parseInt(options.port, 10) : eventsConfig.port;
      const alertChannels = options.channels
        ? options.channels
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : eventsConfig.alertChannels;
      const allowedUsers = options.allowedUsers
        ? options.allowedUsers
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : eventsConfig.allowedUsers;
      const requireThreadedMentions =
        options.requireThreaded !== undefined
          ? options.requireThreaded
          : eventsConfig.requireThreadedMentions;

      const botToken = slackConfig.botToken || process.env.SLACK_BOT_TOKEN;
      const signingSecret = slackConfig.signingSecret || process.env.SLACK_SIGNING_SECRET;
      const appToken = slackConfig.appToken || process.env.SLACK_APP_TOKEN;

      if (!botToken) {
        console.error(
          chalk.red(
            'Error: Slack bot token is required (incident.slack.botToken or SLACK_BOT_TOKEN).'
          )
        );
        process.exit(1);
      }

      if (mode === 'http' && !signingSecret) {
        console.error(
          chalk.red(
            'Error: Slack signing secret is required for HTTP mode (incident.slack.signingSecret or SLACK_SIGNING_SECRET).'
          )
        );
        process.exit(1);
      }

      if (mode === 'socket' && !appToken) {
        console.error(
          chalk.red(
            'Error: Slack app token is required for socket mode (incident.slack.appToken or SLACK_APP_TOKEN).'
          )
        );
        process.exit(1);
      }

      if (mode === 'http' && (isNaN(port) || port < 1 || port > 65535)) {
        console.error(chalk.red('Error: Invalid port number.'));
        process.exit(1);
      }

      console.log(chalk.cyan('Starting Slack events gateway...'));
      console.log(chalk.gray(`Mode: ${mode}`));
      if (mode === 'http') {
        console.log(chalk.gray(`Port: ${port}`));
      }
      console.log(
        chalk.gray(
          `Allowed channels: ${alertChannels.length > 0 ? alertChannels.join(', ') : 'all'}`
        )
      );
      console.log(
        chalk.gray(`Allowed users: ${allowedUsers.length > 0 ? allowedUsers.join(', ') : 'all'}`)
      );
      console.log(
        chalk.gray(`Require threaded mentions: ${requireThreadedMentions ? 'yes' : 'no'}`)
      );

      try {
        await startSlackGateway({
          mode,
          port,
          botToken,
          signingSecret,
          appToken,
          alertChannels,
          allowedUsers,
          requireThreadedMentions,
          executeRequest: executeSlackRequestWithRuntime,
        });

        console.log(chalk.green('Slack events gateway is running.'));
        if (mode === 'http') {
          console.log(
            chalk.gray(`Set Slack Events Request URL to: https://your-domain.com/slack/events`)
          );
        } else {
          console.log(chalk.gray('Ensure Socket Mode is enabled in your Slack app settings.'));
        }
        console.log(chalk.yellow('Press Ctrl+C to stop'));
      } catch (error) {
        console.error(
          chalk.red(
            `Failed to start Slack events gateway: ${error instanceof Error ? error.message : error}`
          )
        );
        process.exit(1);
      }
    }
  );

// Parse and run
program.parse();
