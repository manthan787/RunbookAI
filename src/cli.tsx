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
import type { AgentEvent } from './agent/types';

// Version from package.json
const VERSION = '0.1.0';

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
      const llm = createLLMClient({
        provider: config.llm.provider,
        model: config.llm.model,
        apiKey: config.llm.apiKey,
      });

      const agent = new Agent({
        llm,
        tools: toolRegistry.getAll(),
        skills: ['investigate-incident', 'deploy-service', 'scale-service'],
        config: {
          maxIterations: config.agent.maxIterations,
          maxHypothesisDepth: config.agent.maxHypothesisDepth,
          contextThresholdTokens: config.agent.contextThresholdTokens,
        },
      });

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
            {verbose && event.type === 'tool_start' && (
              <Text color="blue">→ {event.tool}</Text>
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
          <Text>{answer}</Text>
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

    const llm = createLLMClient({
      provider: config.llm.provider,
      model: config.llm.model,
      apiKey: config.llm.apiKey,
    });

    const agent = new Agent({
      llm,
      tools: toolRegistry.getAll(),
      skills: ['investigate-incident', 'deploy-service', 'scale-service'],
    });

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
          console.log(event.answer);
          break;
      }
    }
  } catch (err) {
    console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
    process.exit(1);
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

// Investigate command - incident investigation
program
  .command('investigate <incident-id>')
  .description('Investigate a PagerDuty/OpsGenie incident')
  .option('-v, --verbose', 'Show detailed output')
  .action(async (incidentId: string, options: { verbose?: boolean }) => {
    const query = `Investigate incident ${incidentId}. Identify the root cause using hypothesis-driven investigation.`;

    if (process.stdout.isTTY) {
      render(<AgentUI query={query} incidentId={incidentId} verbose={options.verbose || false} />);
    } else {
      await runSimple(query, incidentId);
    }
  });

// Status command - quick infrastructure overview
program
  .command('status')
  .description('Get a quick status overview of your infrastructure')
  .action(async () => {
    const query = 'Give me a quick status overview of the infrastructure. What services are running? Any issues?';

    if (process.stdout.isTTY) {
      render(<AgentUI query={query} verbose={false} />);
    } else {
      await runSimple(query);
    }
  });

// Config command
program
  .command('config')
  .description('Show current configuration')
  .action(async () => {
    const config = await loadConfig();
    console.log(chalk.cyan('Current Configuration:'));
    console.log(JSON.stringify(config, null, 2));
  });

// Knowledge commands
const knowledge = program
  .command('knowledge')
  .description('Manage knowledge base');

knowledge
  .command('sync')
  .description('Sync knowledge from all configured sources')
  .action(async () => {
    console.log(chalk.yellow('Knowledge sync not yet implemented'));
  });

knowledge
  .command('search <query...>')
  .description('Search the knowledge base')
  .action(async (queryParts: string[]) => {
    const query = queryParts.join(' ');
    console.log(chalk.yellow(`Knowledge search for "${query}" not yet implemented`));
  });

// Parse and run
program.parse();
