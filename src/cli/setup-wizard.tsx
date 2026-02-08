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
  loadServiceConfig,
  type OnboardingAnswers,
} from '../config/onboarding';
import type { AWSAccount } from '../config/services';
import { loadConfig } from '../utils/config';
import { existsSync } from 'fs';
import { join } from 'path';

type Step =
  | 'welcome'
  | 'llm_provider'
  | 'llm_key'
  | 'account'
  | 'regions'
  | 'compute'
  | 'database'
  | 'observability'
  | 'kubernetes'
  | 'incident'
  | 'slack_gateway'
  | 'slack_mode'
  | 'slack_channels'
  | 'slack_users'
  | 'slack_threads'
  | 'saving'
  | 'done';

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
  const [isLoadingExisting, setIsLoadingExisting] = useState(true);
  const [hasExistingProfile, setHasExistingProfile] = useState(false);

  // Answers
  const [llmProvider, setLlmProvider] = useState<'anthropic' | 'openai' | 'ollama'>('anthropic');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [accountSetup, setAccountSetup] = useState<'single' | 'multi' | 'skip'>('single');
  const [regions, setRegions] = useState('us-east-1');
  const [computeServices, setComputeServices] = useState<string[]>([]);
  const [databaseServices, setDatabaseServices] = useState<string[]>([]);
  const [useCloudWatch, setUseCloudWatch] = useState(true);
  const [useKubernetes, setUseKubernetes] = useState(false);
  const [incidentProvider, setIncidentProvider] = useState<'pagerduty' | 'opsgenie' | 'none'>('none');
  const [useSlackGateway, setUseSlackGateway] = useState(false);
  const [slackMode, setSlackMode] = useState<'http' | 'socket'>('socket');
  const [slackAlertChannels, setSlackAlertChannels] = useState('');
  const [slackAllowedUsers, setSlackAllowedUsers] = useState('');
  const [slackRequireThreadedMentions, setSlackRequireThreadedMentions] = useState(false);

  const getDefaultFocusForStep = (targetStep: Step): number => {
    switch (targetStep) {
      case 'llm_provider':
        return llmProvider === 'anthropic' ? 0 : llmProvider === 'openai' ? 1 : 2;
      case 'account':
        return accountSetup === 'single' ? 0 : accountSetup === 'multi' ? 1 : 2;
      case 'observability':
        return useCloudWatch ? 0 : 1;
      case 'kubernetes':
        return useKubernetes ? 0 : 1;
      case 'incident':
        return incidentProvider === 'pagerduty' ? 0 : incidentProvider === 'opsgenie' ? 1 : 2;
      case 'slack_gateway':
        return useSlackGateway ? 0 : 1;
      case 'slack_mode':
        return slackMode === 'socket' ? 0 : 1;
      case 'slack_threads':
        return slackRequireThreadedMentions ? 0 : 1;
      default:
        return 0;
    }
  };

  const goToStep = (nextStep: Step) => {
    setStep(nextStep);
    setFocusedIndex(getDefaultFocusForStep(nextStep));
  };

  useEffect(() => {
    let mounted = true;

    const hydrateFromExistingProfile = async () => {
      try {
        const hasMainConfigFile =
          existsSync(join(configDir, 'config.yaml')) ||
          existsSync(join(configDir, 'config.yml'));
        const hasServicesConfigFile = existsSync(join(configDir, 'services.yaml'));

        if (!hasMainConfigFile && !hasServicesConfigFile) {
          setIsLoadingExisting(false);
          return;
        }

        const mainConfigPath = existsSync(join(configDir, 'config.yaml'))
          ? join(configDir, 'config.yaml')
          : join(configDir, 'config.yml');

        const [mainConfig, serviceConfig] = await Promise.all([
          loadConfig(hasMainConfigFile ? mainConfigPath : undefined),
          loadServiceConfig(configDir),
        ]);

        if (!mounted) return;

        setHasExistingProfile(true);

        // LLM
        if (mainConfig.llm.provider === 'anthropic' || mainConfig.llm.provider === 'openai' || mainConfig.llm.provider === 'ollama') {
          setLlmProvider(mainConfig.llm.provider);
        }
        if (mainConfig.llm.apiKey) {
          setLlmApiKey(mainConfig.llm.apiKey);
        }

        // Main provider config
        if (mainConfig.providers.aws.regions.length > 0) {
          setRegions(mainConfig.providers.aws.regions.join(','));
        }
        setUseKubernetes(mainConfig.providers.kubernetes.enabled);
        setUseSlackGateway(mainConfig.incident.slack.events.enabled);
        setSlackMode(mainConfig.incident.slack.events.mode);
        setSlackAlertChannels((mainConfig.incident.slack.events.alertChannels || []).join(','));
        setSlackAllowedUsers((mainConfig.incident.slack.events.allowedUsers || []).join(','));
        setSlackRequireThreadedMentions(mainConfig.incident.slack.events.requireThreadedMentions);

        // Service profile config
        if (serviceConfig) {
          if (serviceConfig.aws.accounts.length === 0) {
            setAccountSetup('skip');
          } else if (serviceConfig.aws.accounts.length === 1) {
            setAccountSetup('single');
          } else {
            setAccountSetup('multi');
          }

          const compute = serviceConfig.compute
            .filter((service) => service.enabled)
            .map((service) => service.type)
            .filter((type) =>
              ['ecs', 'ec2', 'lambda', 'eks', 'fargate', 'apprunner', 'amplify'].includes(type)
            );
          setComputeServices(compute);

          const databases = serviceConfig.databases
            .filter((service) => service.enabled)
            .map((service) => service.type)
            .filter((type) =>
              ['rds', 'dynamodb', 'elasticache', 'documentdb', 'aurora'].includes(type)
            );
          setDatabaseServices(databases);

          setUseCloudWatch(serviceConfig.observability.cloudwatch.enabled);

          if (serviceConfig.incidents.pagerduty.enabled) {
            setIncidentProvider('pagerduty');
          } else if (serviceConfig.incidents.opsgenie.enabled) {
            setIncidentProvider('opsgenie');
          } else {
            setIncidentProvider('none');
          }
        }
      } catch {
        // If loading existing settings fails, continue with defaults.
      } finally {
        if (mounted) {
          setIsLoadingExisting(false);
        }
      }
    };

    hydrateFromExistingProfile();

    return () => {
      mounted = false;
    };
  }, [configDir]);

  // Navigation
  useInput((input, key) => {
    if (step === 'welcome' && key.return) {
      goToStep('llm_provider');
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
      case 'llm_provider':
        return 2; // anthropic, openai, ollama
      case 'account':
        return ONBOARDING_PROMPTS.accountSetup.options.length - 1;
      case 'compute':
        return ONBOARDING_PROMPTS.computeServices.options.length - 1;
      case 'database':
        return ONBOARDING_PROMPTS.databaseServices.options.length - 1;
      case 'observability':
        return 1;
      case 'kubernetes':
        return 1;
      case 'incident':
        return ONBOARDING_PROMPTS.incidentProvider.options.length - 1;
      case 'slack_gateway':
        return ONBOARDING_PROMPTS.slackGateway.options.length - 1;
      case 'slack_mode':
        return ONBOARDING_PROMPTS.slackMode.options.length - 1;
      case 'slack_threads':
        return 1;
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
        useKubernetes,
        incidentProvider,
        llmProvider,
        llmApiKey: llmProvider !== 'ollama' ? llmApiKey : undefined,
      };

      const config = generateConfig(answers);
      await saveConfig(config, configDir, {
        provider: llmProvider,
        apiKey: llmApiKey || undefined,
      }, {
        enableKubernetes: useKubernetes,
        enableSlackGateway: useSlackGateway,
        slackMode,
        slackAlertChannels: slackAlertChannels
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
        slackAllowedUsers: slackAllowedUsers
          .split(',')
          .map((u) => u.trim())
          .filter(Boolean),
        slackRequireThreadedMentions,
      });
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  // Render based on step
  if (isLoadingExisting) {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text> Loading existing profile...</Text>
      </Box>
    );
  }

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
          {hasExistingProfile && (
            <Box marginTop={1}>
              <Text color="yellow">Existing profile found. Press Enter on each step to keep current values.</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text color="green">Press Enter to continue...</Text>
          </Box>
        </Box>
      );

    case 'llm_provider':
      return (
        <Box flexDirection="column">
          <Text bold color="yellow">Step 1: Choose your AI provider</Text>
          {hasExistingProfile && (
            <Text color="gray">Current: {llmProvider}</Text>
          )}
          <Box marginTop={1}>
            <SingleSelect
              options={[
                { value: 'anthropic', label: 'Anthropic (Claude)', description: 'Recommended - best for complex reasoning' },
                { value: 'openai', label: 'OpenAI (GPT-4)', description: 'Popular alternative with broad capabilities' },
                { value: 'ollama', label: 'Ollama (Local)', description: 'Run models locally - no API key required' },
              ]}
              focusedIndex={focusedIndex}
              onSelect={(value) => {
                setLlmProvider(value as 'anthropic' | 'openai' | 'ollama');
                if (value === 'ollama') {
                  // Skip API key for Ollama
                  goToStep('account');
                } else {
                  goToStep('llm_key');
                }
              }}
            />
          </Box>
        </Box>
      );

    case 'llm_key':
      return (
        <Box flexDirection="column">
          <Text bold color="yellow">Step 2: Enter your API key</Text>
          {hasExistingProfile && llmApiKey && (
            <Text color="gray">Current key is set. Press Enter to keep it.</Text>
          )}
          <Box marginTop={1} flexDirection="column">
            <Text color="gray">
              {llmProvider === 'anthropic'
                ? 'Get your API key from: https://console.anthropic.com/settings/keys'
                : 'Get your API key from: https://platform.openai.com/api-keys'}
            </Text>
            <Box marginTop={1}>
              <TextInput
                prompt={`Enter your ${llmProvider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key:`}
                value={llmApiKey}
                onChange={setLlmApiKey}
                onSubmit={() => {
                  if (llmApiKey.trim()) {
                    goToStep('account');
                  }
                }}
              />
            </Box>
            {!llmApiKey.trim() && (
              <Box marginTop={1}>
                <Text color="red">API key is required to continue</Text>
              </Box>
            )}
          </Box>
        </Box>
      );

    case 'account':
      return (
        <Box flexDirection="column">
          <Text bold color="yellow">Step 3: {ONBOARDING_PROMPTS.accountSetup.question}</Text>
          {hasExistingProfile && (
            <Text color="gray">Current: {accountSetup}</Text>
          )}
          <Box marginTop={1}>
            <SingleSelect
              options={ONBOARDING_PROMPTS.accountSetup.options}
              focusedIndex={focusedIndex}
              onSelect={(value) => {
                setAccountSetup(value as 'single' | 'multi' | 'skip');
                goToStep('regions');
              }}
            />
          </Box>
        </Box>
      );

    case 'regions':
      return (
        <Box flexDirection="column">
          <Text bold color="yellow">Step 4: AWS Regions</Text>
          {hasExistingProfile && (
            <Text color="gray">Current: {regions}</Text>
          )}
          <Box marginTop={1}>
            <TextInput
              prompt="Enter AWS regions (comma-separated, e.g., us-east-1,us-west-2):"
              value={regions}
              onChange={setRegions}
              onSubmit={() => {
                goToStep('compute');
              }}
            />
          </Box>
        </Box>
      );

    case 'compute':
      return (
        <Box flexDirection="column">
          <Text bold color="yellow">Step 5: {ONBOARDING_PROMPTS.computeServices.question}</Text>
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
                goToStep('database');
              }}
            />
          </Box>
        </Box>
      );

    case 'database':
      return (
        <Box flexDirection="column">
          <Text bold color="yellow">Step 6: {ONBOARDING_PROMPTS.databaseServices.question}</Text>
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
                goToStep('observability');
              }}
            />
          </Box>
        </Box>
      );

    case 'observability':
      return (
        <Box flexDirection="column">
          <Text bold color="yellow">Step 7: {ONBOARDING_PROMPTS.observability.question}</Text>
          {hasExistingProfile && (
            <Text color="gray">Current: {useCloudWatch ? 'Yes' : 'No'}</Text>
          )}
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
                goToStep('kubernetes');
              }}
            />
          </Box>
        </Box>
      );

    case 'kubernetes':
      return (
        <Box flexDirection="column">
          <Text bold color="yellow">Step 8: {ONBOARDING_PROMPTS.kubernetes.question}</Text>
          {hasExistingProfile && (
            <Text color="gray">Current: {useKubernetes ? 'Yes' : 'No'}</Text>
          )}
          <Box marginTop={1}>
            <SingleSelect
              options={ONBOARDING_PROMPTS.kubernetes.options.map((o) => ({
                value: String(o.value),
                label: o.label,
                description: o.description,
              }))}
              focusedIndex={focusedIndex}
              onSelect={(value) => {
                setUseKubernetes(value === 'true');
                goToStep('incident');
              }}
            />
          </Box>
        </Box>
      );

    case 'incident':
      return (
        <Box flexDirection="column">
          <Text bold color="yellow">Step 9: {ONBOARDING_PROMPTS.incidentProvider.question}</Text>
          {hasExistingProfile && (
            <Text color="gray">Current: {incidentProvider}</Text>
          )}
          <Box marginTop={1}>
            <SingleSelect
              options={ONBOARDING_PROMPTS.incidentProvider.options}
              focusedIndex={focusedIndex}
              onSelect={(value) => {
                setIncidentProvider(value as 'pagerduty' | 'opsgenie' | 'none');
                goToStep('slack_gateway');
              }}
            />
          </Box>
        </Box>
      );

    case 'slack_gateway':
      return (
        <Box flexDirection="column">
          <Text bold color="yellow">Step 10: {ONBOARDING_PROMPTS.slackGateway.question}</Text>
          {hasExistingProfile && (
            <Text color="gray">Current: {useSlackGateway ? 'Yes' : 'No'}</Text>
          )}
          <Box marginTop={1}>
            <SingleSelect
              options={ONBOARDING_PROMPTS.slackGateway.options.map((o) => ({
                value: String(o.value),
                label: o.label,
                description: o.description,
              }))}
              focusedIndex={focusedIndex}
              onSelect={(value) => {
                const enabled = value === 'true';
                setUseSlackGateway(enabled);
                if (!enabled) {
                  saveConfiguration();
                  return;
                }
                goToStep('slack_mode');
              }}
            />
          </Box>
        </Box>
      );

    case 'slack_mode':
      return (
        <Box flexDirection="column">
          <Text bold color="yellow">Step 11: {ONBOARDING_PROMPTS.slackMode.question}</Text>
          {hasExistingProfile && (
            <Text color="gray">Current: {slackMode}</Text>
          )}
          <Box marginTop={1}>
            <SingleSelect
              options={ONBOARDING_PROMPTS.slackMode.options}
              focusedIndex={focusedIndex}
              onSelect={(value) => {
                setSlackMode(value as 'http' | 'socket');
                goToStep('slack_channels');
              }}
            />
          </Box>
        </Box>
      );

    case 'slack_channels':
      return (
        <Box flexDirection="column">
          <Text bold color="yellow">Step 12: Slack Alert Channels</Text>
          {hasExistingProfile && slackAlertChannels && (
            <Text color="gray">Current: {slackAlertChannels}</Text>
          )}
          <Box marginTop={1}>
            <TextInput
              prompt="Enter channel IDs (comma-separated, e.g., C01234567,C08999999) or leave blank for all:"
              value={slackAlertChannels}
              onChange={setSlackAlertChannels}
              onSubmit={() => {
                goToStep('slack_users');
              }}
            />
          </Box>
        </Box>
      );

    case 'slack_users':
      return (
        <Box flexDirection="column">
          <Text bold color="yellow">Step 13: Slack Allowed Users</Text>
          {hasExistingProfile && slackAllowedUsers && (
            <Text color="gray">Current: {slackAllowedUsers}</Text>
          )}
          <Box marginTop={1}>
            <TextInput
              prompt="Enter user IDs allowed to invoke @runbookAI (comma-separated) or leave blank for all:"
              value={slackAllowedUsers}
              onChange={setSlackAllowedUsers}
              onSubmit={() => {
                goToStep('slack_threads');
              }}
            />
          </Box>
        </Box>
      );

    case 'slack_threads':
      return (
        <Box flexDirection="column">
          <Text bold color="yellow">Step 14: Require Threaded Mentions?</Text>
          {hasExistingProfile && (
            <Text color="gray">Current: {slackRequireThreadedMentions ? 'Yes' : 'No'}</Text>
          )}
          <Box marginTop={1}>
            <SingleSelect
              options={[
                { value: 'true', label: 'Yes', description: 'Only handle @runbookAI mentions in threads' },
                { value: 'false', label: 'No', description: 'Allow mentions in channel root and threads' },
              ]}
              focusedIndex={focusedIndex}
              onSelect={(value) => {
                setSlackRequireThreadedMentions(value === 'true');
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
                <Text>• AI Provider: {llmProvider}{llmApiKey ? ' (key configured)' : ''}</Text>
                <Text>• Regions: {regions}</Text>
                <Text>• Compute: {computeServices.length > 0 ? computeServices.join(', ') : 'none'}</Text>
                <Text>• Databases: {databaseServices.length > 0 ? databaseServices.join(', ') : 'none'}</Text>
                <Text>• CloudWatch: {useCloudWatch ? 'enabled' : 'disabled'}</Text>
                <Text>• Kubernetes tools: {useKubernetes ? 'enabled' : 'disabled'}</Text>
                <Text>• Incidents: {incidentProvider}</Text>
                <Text>• Slack gateway: {useSlackGateway ? `enabled (${slackMode})` : 'disabled'}</Text>
              </Box>
            </>
          )}
        </Box>
      );
  }
}
