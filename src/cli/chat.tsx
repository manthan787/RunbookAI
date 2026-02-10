/**
 * Interactive Chat Interface
 *
 * Provides a conversational interface for ongoing interactions with Runbook.
 * Maintains conversation history and context across messages.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Text, Box, useInput, useApp, Static } from 'ink';
import Spinner from 'ink-spinner';
import { Agent } from '../agent/agent';
import { createLLMClient } from '../model/llm';
import { toolRegistry } from '../tools/registry';
import { loadConfig, validateConfig } from '../utils/config';
import type { AgentEvent } from '../agent/types';
import { MarkdownText } from './components/markdown';
import { skillRegistry } from '../skills/registry';
import { getRuntimeTools } from './runtime-tools';
import { createRetriever } from '../knowledge/retriever';
import { createMemory, type ConversationMemory } from '../agent/conversation-memory';

const LOGO = `
  ____              _                 _       _    ___
 |  _ \\ _   _ _ __ | |__   ___   ___ | | __  / \\  |_ _|
 | |_) | | | | '_ \\| '_ \\ / _ \\ / _ \\| |/ / / _ \\  | |
 |  _ <| |_| | | | | |_) | (_) | (_) |   < / ___ \\ | |
 |_| \\_\\\\__,_|_| |_|_.__/ \\___/ \\___/|_|\\_/_/   \\_\\___|

              AI-Powered SRE Assistant
`;

interface LoadedConfig {
  llmProvider: string;
  llmModel: string;
  awsRegions: string[];
  awsDefaultRegion: string;
  kubernetesEnabled: boolean;
}

interface Message {
  role: 'user' | 'assistant' | 'system' | 'header';
  content: string;
  timestamp: Date;
  toolCalls?: Array<{ tool: string; duration: number }>;
  config?: LoadedConfig;
}

interface ChatState {
  status: 'idle' | 'thinking' | 'tool' | 'error';
  currentTool: string | null;
  error: string | null;
}

export function ChatInterface() {
  const { exit } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [state, setState] = useState<ChatState>({
    status: 'idle',
    currentTool: null,
    error: null,
  });
  const [agent, setAgent] = useState<Agent | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const memoryRef = useRef<ConversationMemory>(createMemory({ summarizeAfterMessages: 16 }));

  // Initialize agent on mount
  useEffect(() => {
    initAgent();
  }, []);

  async function initAgent() {
    try {
      const config = await loadConfig();
      const configErrors = validateConfig(config);
      if (configErrors.length > 0) {
        setConfigError(configErrors.join('\n'));
        return;
      }

      // Extract AWS config
      const awsRegions = config.providers?.aws?.regions || ['us-east-1'];
      const awsDefaultRegion = awsRegions[0] || 'us-east-1';

      const llm = createLLMClient({
        provider: config.llm.provider,
        model: config.llm.model,
        apiKey: config.llm.apiKey,
      });

      await skillRegistry.loadUserSkills();
      const runtimeSkills = skillRegistry.getAll().map((skill) => skill.id);
      const runtimeTools = await getRuntimeTools(config, toolRegistry.getAll());
      const retriever = createRetriever();

      const newAgent = new Agent({
        llm,
        tools: runtimeTools,
        skills: runtimeSkills,
        knowledgeRetriever: {
          retrieve: async (context) => {
            const queryParts = [
              context.query,
              context.incidentId,
              ...context.services,
              ...context.symptoms,
              ...context.errorMessages,
            ].filter(Boolean) as string[];

            const query =
              queryParts.join(' ').trim() || 'production incident investigation runbook';
            return retriever.search(query, {
              limit: 20,
              serviceFilter: context.services.length > 0 ? context.services : undefined,
            });
          },
        },
        config: {
          maxIterations: config.agent.maxIterations,
          maxHypothesisDepth: config.agent.maxHypothesisDepth,
          contextThresholdTokens: config.agent.contextThresholdTokens,
        },
        promptConfig: {
          awsRegions,
          awsDefaultRegion,
        },
      });

      setAgent(newAgent);

      // Add header and welcome message
      setMessages([
        {
          role: 'header',
          content: LOGO,
          timestamp: new Date(),
          config: {
            llmProvider: config.llm.provider,
            llmModel: config.llm.model,
            awsRegions,
            awsDefaultRegion,
            kubernetesEnabled: config.providers.kubernetes.enabled,
          },
        },
        {
          role: 'system',
          content:
            'Ready! Ask me anything about your infrastructure.\nType /help for commands, /exit to quit.',
          timestamp: new Date(),
        },
      ]);
      memoryRef.current.addSystemMessage(
        'Chat initialized. Use memory context from prior conversation turns when relevant.'
      );
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : 'Failed to initialize');
    }
  }

  // Handle input
  useInput((char, key) => {
    if (state.status !== 'idle') return;

    if (key.return) {
      handleSubmit();
    } else if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
    } else if (key.ctrl && char === 'c') {
      exit();
    } else if (char && !key.ctrl && !key.meta) {
      setInput((prev) => prev + char);
    }
  });

  async function handleSubmit() {
    const trimmedInput = input.trim();
    if (!trimmedInput) return;

    // Handle commands
    if (trimmedInput.startsWith('/')) {
      handleCommand(trimmedInput);
      setInput('');
      return;
    }

    if (!agent) {
      setState({ ...state, error: 'Agent not initialized' });
      return;
    }
    const memoryContext = memoryRef.current.getContextForPrompt(12000);

    // Add user message
    const userMessage: Message = {
      role: 'user',
      content: trimmedInput,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    memoryRef.current.addUserMessage(trimmedInput);
    setInput('');

    // Process with agent
    setState({ status: 'thinking', currentTool: null, error: null });
    const toolCalls: Array<{ tool: string; duration: number }> = [];

    try {
      let answer = '';
      const promptWithContext = memoryContext
        ? `${memoryContext}\n\n## Current User Query\n${trimmedInput}`
        : trimmedInput;

      for await (const event of agent.run(promptWithContext)) {
        switch (event.type) {
          case 'thinking':
            setState({ status: 'thinking', currentTool: null, error: null });
            break;
          case 'tool_start':
            setState({ status: 'tool', currentTool: event.tool, error: null });
            break;
          case 'tool_end':
            toolCalls.push({ tool: event.tool, duration: event.durationMs });
            break;
          case 'done':
            answer = event.answer;
            break;
        }
      }

      // Add assistant message
      const assistantMessage: Message = {
        role: 'assistant',
        content: answer,
        timestamp: new Date(),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      memoryRef.current.addAssistantMessage(answer, {
        toolCalls: toolCalls.map((toolCall) => toolCall.tool),
      });
      setState({ status: 'idle', currentTool: null, error: null });
    } catch (err) {
      setState({
        status: 'error',
        currentTool: null,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  function handleCommand(cmd: string) {
    const parts = cmd.slice(1).split(' ');
    const command = parts[0].toLowerCase();

    switch (command) {
      case 'exit':
      case 'quit':
      case 'q':
        exit();
        break;

      case 'clear':
        memoryRef.current.clear();
        setMessages([
          {
            role: 'system',
            content: 'Chat cleared. How can I help?',
            timestamp: new Date(),
          },
        ]);
        break;

      case 'help':
        setMessages((prev) => [
          ...prev,
          {
            role: 'system',
            content: `Available commands:
  /help     - Show this help
  /clear    - Clear chat history
  /status   - Quick infrastructure status
  /exit     - Exit chat

Example queries:
  "What's running in production?"
  "Show me recent CloudWatch alarms"
  "List all Lambda functions"
  "Investigate high latency on the API"`,
            timestamp: new Date(),
          },
        ]);
        break;

      case 'status':
        // Trigger a status query
        setInput('Give me a quick status of my infrastructure');
        handleSubmit();
        break;

      default:
        setMessages((prev) => [
          ...prev,
          {
            role: 'system',
            content: `Unknown command: ${command}. Type /help for available commands.`,
            timestamp: new Date(),
          },
        ]);
    }
  }

  // Render config error
  if (configError) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red" bold>
          Configuration Error
        </Text>
        <Text color="yellow">{configError}</Text>
      </Box>
    );
  }

  // Render loading state
  if (!agent) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">{LOGO}</Text>
        <Box>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> Initializing...</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      {/* Message history (includes header as first item) */}
      <Static items={messages}>
        {(message, index) => (
          <Box key={index} flexDirection="column" marginBottom={1}>
            {message.role === 'header' && message.config && (
              <Box flexDirection="column">
                <Text color="cyan">{message.content}</Text>
                <Box flexDirection="column" marginBottom={1}>
                  <Box>
                    <Text color="gray">┌─ </Text>
                    <Text color="white" bold>
                      Configuration
                    </Text>
                    <Text color="gray"> ─────────────────────────</Text>
                  </Box>
                  <Box>
                    <Text color="gray">│ </Text>
                    <Text color="gray">AI Provider: </Text>
                    <Text color="green">{message.config.llmProvider}</Text>
                    <Text color="gray"> ({message.config.llmModel})</Text>
                  </Box>
                  <Box>
                    <Text color="gray">│ </Text>
                    <Text color="gray">AWS Region: </Text>
                    <Text color="green">{message.config.awsDefaultRegion}</Text>
                    {message.config.awsRegions.length > 1 && (
                      <Text color="gray"> (+{message.config.awsRegions.length - 1} more)</Text>
                    )}
                  </Box>
                  <Box>
                    <Text color="gray">│ </Text>
                    <Text color="gray">Kubernetes: </Text>
                    <Text color={message.config.kubernetesEnabled ? 'green' : 'yellow'}>
                      {message.config.kubernetesEnabled ? 'enabled' : 'disabled'}
                    </Text>
                  </Box>
                  <Box>
                    <Text color="gray">└─────────────────────────────────────────</Text>
                  </Box>
                </Box>
              </Box>
            )}
            {message.role === 'user' && (
              <Box>
                <Text color="green" bold>
                  {'❯ '}
                </Text>
                <Text>{message.content}</Text>
              </Box>
            )}
            {message.role === 'assistant' && (
              <Box flexDirection="column">
                <Box>
                  <Text color="cyan" bold>
                    {'◆ Runbook'}
                  </Text>
                </Box>
                {message.toolCalls && message.toolCalls.length > 0 && (
                  <Box marginLeft={2}>
                    <Text color="gray" dimColor>
                      ⚡ {message.toolCalls.map((t) => `${t.tool} (${t.duration}ms)`).join(' → ')}
                    </Text>
                  </Box>
                )}
                <Box marginLeft={2}>
                  <MarkdownText content={message.content} />
                </Box>
              </Box>
            )}
            {message.role === 'system' && (
              <Box>
                <Text color="yellow">
                  {'ℹ '}
                  {message.content}
                </Text>
              </Box>
            )}
          </Box>
        )}
      </Static>

      {/* Current status */}
      {state.status !== 'idle' && (
        <Box marginY={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text>
            {' '}
            {state.status === 'thinking' && 'Thinking...'}
            {state.status === 'tool' && `Running ${state.currentTool}...`}
          </Text>
        </Box>
      )}

      {/* Error */}
      {state.error && (
        <Box marginY={1}>
          <Text color="red">Error: {state.error}</Text>
        </Box>
      )}

      {/* Input */}
      {state.status === 'idle' && (
        <Box marginTop={1}>
          <Text color="green" bold>
            {'❯ '}
          </Text>
          <Text>{input}</Text>
          <Text color="cyan">▌</Text>
        </Box>
      )}
    </Box>
  );
}
