/**
 * Interactive Setup Wizard
 *
 * Uses Ink to walk users through service configuration.
 */

import React, { useState, useEffect } from 'react';
import { Text, Box, useInput, useApp } from 'ink';
import Spinner from 'ink-spinner';
import {
  ONBOARDING_PROMPTS,
  generateConfig,
  saveConfig,
  type OnboardingAnswers,
} from '../config/onboarding';
import type { AWSAccount } from '../config/services';

type Step = 'welcome' | 'account' | 'regions' | 'compute' | 'database' | 'observability' | 'incident' | 'saving' | 'done';

interface SelectOption {
  value: string;
  label: string;
  description: string;
}

interface MultiSelectProps {
  options: SelectOption[];
  selected: string[];
  onToggle: (value: string) => void;
  onSubmit: () => void;
  focusedIndex: number;
}

function MultiSelect({ options, selected, onToggle, onSubmit, focusedIndex }: MultiSelectProps) {
  useInput((input, key) => {
    if (key.return) {
      onSubmit();
    } else if (input === ' ') {
      onToggle(options[focusedIndex].value);
    }
  });

  return (
    <Box flexDirection="column">
      {options.map((opt, i) => (
        <Box key={opt.value}>
          <Text color={i === focusedIndex ? 'cyan' : undefined}>
            {i === focusedIndex ? '❯ ' : '  '}
            {selected.includes(opt.value) ? '[✓]' : '[ ]'} {opt.label}
          </Text>
          <Text color="gray"> - {opt.description}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color="gray">Space to toggle, Enter to continue</Text>
      </Box>
    </Box>
  );
}

interface SingleSelectProps {
  options: SelectOption[];
  onSelect: (value: string) => void;
  focusedIndex: number;
}

function SingleSelect({ options, onSelect, focusedIndex }: SingleSelectProps) {
  useInput((input, key) => {
    if (key.return) {
      onSelect(options[focusedIndex].value);
    }
  });

  return (
    <Box flexDirection="column">
      {options.map((opt, i) => (
        <Box key={opt.value}>
          <Text color={i === focusedIndex ? 'cyan' : undefined}>
            {i === focusedIndex ? '❯ ' : '  '} {opt.label}
          </Text>
          <Text color="gray"> - {opt.description}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color="gray">Enter to select</Text>
      </Box>
    </Box>
  );
}

interface TextInputProps {
  prompt: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

function TextInput({ prompt, value, onChange, onSubmit }: TextInputProps) {
  useInput((input, key) => {
    if (key.return) {
      onSubmit();
    } else if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
    } else if (input && !key.ctrl && !key.meta) {
      onChange(value + input);
    }
  });

  return (
    <Box flexDirection="column">
      <Text>{prompt}</Text>
      <Box>
        <Text color="cyan">{value || ' '}</Text>
        <Text color="gray">█</Text>
      </Box>
    </Box>
  );
}

export interface SetupWizardProps {
  configDir?: string;
}

export function SetupWizard({ configDir = '.runbook' }: SetupWizardProps) {
  const { exit } = useApp();
  const [step, setStep] = useState<Step>('welcome');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Answers
  const [accountSetup, setAccountSetup] = useState<'single' | 'multi' | 'skip'>('single');
  const [regions, setRegions] = useState('us-east-1');
  const [computeServices, setComputeServices] = useState<string[]>([]);
  const [databaseServices, setDatabaseServices] = useState<string[]>([]);
  const [useCloudWatch, setUseCloudWatch] = useState(true);
  const [incidentProvider, setIncidentProvider] = useState<'pagerduty' | 'opsgenie' | 'none'>('none');

  // Navigation
  useInput((input, key) => {
    if (step === 'welcome' && key.return) {
      setStep('account');
      setFocusedIndex(0);
      return;
    }

    if (key.upArrow) {
      setFocusedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      const maxIndex = getMaxIndex();
      setFocusedIndex((i) => Math.min(maxIndex, i + 1));
    }

    if (key.escape) {
      exit();
    }
  });

  function getMaxIndex(): number {
    switch (step) {
      case 'account':
        return ONBOARDING_PROMPTS.accountSetup.options.length - 1;
      case 'compute':
        return ONBOARDING_PROMPTS.computeServices.options.length - 1;
      case 'database':
        return ONBOARDING_PROMPTS.databaseServices.options.length - 1;
      case 'observability':
        return 1;
      case 'incident':
        return ONBOARDING_PROMPTS.incidentProvider.options.length - 1;
      default:
        return 0;
    }
  }

  async function saveConfiguration() {
    setStep('saving');

    try {
      const answers: OnboardingAnswers = {
        accountSetup,
        accounts: accountSetup !== 'skip' ? [{
          name: 'default',
          regions: regions.split(',').map((r) => r.trim()),
          isDefault: true,
        }] : undefined,
        computeServices: computeServices.length > 0 ? computeServices as OnboardingAnswers['computeServices'] : ['none'],
        databaseServices: databaseServices.length > 0 ? databaseServices as OnboardingAnswers['databaseServices'] : ['none'],
        useCloudWatch,
        incidentProvider,
      };

      const config = generateConfig(answers);
      await saveConfig(config, configDir);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  // Render based on step
  switch (step) {
    case 'welcome':
      return (
        <Box flexDirection="column">
          <Text color="cyan" bold>
            ═══════════════════════════════════════════
          </Text>
          <Text color="cyan" bold>
            {' '}Runbook Setup Wizard
          </Text>
          <Text color="cyan" bold>
            ═══════════════════════════════════════════
          </Text>
          <Text>{ONBOARDING_PROMPTS.welcome}</Text>
          <Box marginTop={1}>
            <Text color="green">Press Enter to continue...</Text>
          </Box>
        </Box>
      );

    case 'account':
      return (
        <Box flexDirection="column">
          <Text bold color="yellow">Step 1: {ONBOARDING_PROMPTS.accountSetup.question}</Text>
          <Box marginTop={1}>
            <SingleSelect
              options={ONBOARDING_PROMPTS.accountSetup.options}
              focusedIndex={focusedIndex}
              onSelect={(value) => {
                setAccountSetup(value as 'single' | 'multi' | 'skip');
                setStep('regions');
                setFocusedIndex(0);
              }}
            />
          </Box>
        </Box>
      );

    case 'regions':
      return (
        <Box flexDirection="column">
          <Text bold color="yellow">Step 2: AWS Regions</Text>
          <Box marginTop={1}>
            <TextInput
              prompt="Enter AWS regions (comma-separated, e.g., us-east-1,us-west-2):"
              value={regions}
              onChange={setRegions}
              onSubmit={() => {
                setStep('compute');
                setFocusedIndex(0);
              }}
            />
          </Box>
        </Box>
      );

    case 'compute':
      return (
        <Box flexDirection="column">
          <Text bold color="yellow">Step 3: {ONBOARDING_PROMPTS.computeServices.question}</Text>
          <Box marginTop={1}>
            <MultiSelect
              options={ONBOARDING_PROMPTS.computeServices.options}
              selected={computeServices}
              focusedIndex={focusedIndex}
              onToggle={(value) => {
                setComputeServices((prev) =>
                  prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
                );
              }}
              onSubmit={() => {
                setStep('database');
                setFocusedIndex(0);
              }}
            />
          </Box>
        </Box>
      );

    case 'database':
      return (
        <Box flexDirection="column">
          <Text bold color="yellow">Step 4: {ONBOARDING_PROMPTS.databaseServices.question}</Text>
          <Box marginTop={1}>
            <MultiSelect
              options={ONBOARDING_PROMPTS.databaseServices.options}
              selected={databaseServices}
              focusedIndex={focusedIndex}
              onToggle={(value) => {
                setDatabaseServices((prev) =>
                  prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
                );
              }}
              onSubmit={() => {
                setStep('observability');
                setFocusedIndex(0);
              }}
            />
          </Box>
        </Box>
      );

    case 'observability':
      return (
        <Box flexDirection="column">
          <Text bold color="yellow">Step 5: {ONBOARDING_PROMPTS.observability.question}</Text>
          <Box marginTop={1}>
            <SingleSelect
              options={ONBOARDING_PROMPTS.observability.options.map((o) => ({
                value: String(o.value),
                label: o.label,
                description: o.description,
              }))}
              focusedIndex={focusedIndex}
              onSelect={(value) => {
                setUseCloudWatch(value === 'true');
                setStep('incident');
                setFocusedIndex(0);
              }}
            />
          </Box>
        </Box>
      );

    case 'incident':
      return (
        <Box flexDirection="column">
          <Text bold color="yellow">Step 6: {ONBOARDING_PROMPTS.incidentProvider.question}</Text>
          <Box marginTop={1}>
            <SingleSelect
              options={ONBOARDING_PROMPTS.incidentProvider.options}
              focusedIndex={focusedIndex}
              onSelect={(value) => {
                setIncidentProvider(value as 'pagerduty' | 'opsgenie' | 'none');
                saveConfiguration();
              }}
            />
          </Box>
        </Box>
      );

    case 'saving':
      return (
        <Box>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> Saving configuration...</Text>
        </Box>
      );

    case 'done':
      return (
        <Box flexDirection="column">
          {error ? (
            <Text color="red">Error: {error}</Text>
          ) : (
            <>
              <Text color="green" bold>
                ═══════════════════════════════════════════
              </Text>
              <Text color="green" bold>
                {' '}Setup Complete!
              </Text>
              <Text color="green" bold>
                ═══════════════════════════════════════════
              </Text>
              <Text>{ONBOARDING_PROMPTS.complete}</Text>

              <Box marginTop={1} flexDirection="column">
                <Text bold>Your configuration:</Text>
                <Text>• Regions: {regions}</Text>
                <Text>• Compute: {computeServices.length > 0 ? computeServices.join(', ') : 'none'}</Text>
                <Text>• Databases: {databaseServices.length > 0 ? databaseServices.join(', ') : 'none'}</Text>
                <Text>• CloudWatch: {useCloudWatch ? 'enabled' : 'disabled'}</Text>
                <Text>• Incidents: {incidentProvider}</Text>
              </Box>
            </>
          )}
        </Box>
      );
  }
}
