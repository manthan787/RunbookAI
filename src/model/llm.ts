/**
 * LLM Client
 *
 * Provides a unified interface for calling language models with tool support.
 * Supports Anthropic Claude with prompt caching.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Tool } from '../agent/types';
import type { LLMClient, LLMResponse, ToolCall } from '../agent/agent';

export interface LLMConfig {
  provider: 'anthropic' | 'openai';
  model: string;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
}

const DEFAULT_CONFIG: LLMConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  maxTokens: 4096,
  temperature: 0,
};

/**
 * Create an LLM client based on configuration
 */
export function createLLMClient(config: Partial<LLMConfig> = {}): LLMClient {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };

  if (fullConfig.provider === 'anthropic') {
    return new AnthropicClient(fullConfig);
  }

  throw new Error(`Unsupported LLM provider: ${fullConfig.provider}`);
}

/**
 * Anthropic Claude client with tool support
 */
class AnthropicClient implements LLMClient {
  private client: Anthropic;
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  async chat(
    systemPrompt: string,
    userPrompt: string,
    tools?: Tool[]
  ): Promise<LLMResponse> {
    // Convert tools to Anthropic format
    const anthropicTools = tools?.map((t) => this.convertTool(t));

    // Build messages with cache control for system prompt
    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: this.config.maxTokens || 4096,
      temperature: this.config.temperature || 0,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      tools: anthropicTools,
    });

    // Parse response
    return this.parseResponse(response);
  }

  /**
   * Convert our tool format to Anthropic's format
   */
  private convertTool(tool: Tool): Anthropic.Tool {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object',
        properties: this.convertProperties(tool.parameters.properties),
        required: tool.parameters.required || [],
      },
    };
  }

  /**
   * Convert property definitions
   */
  private convertProperties(
    properties: Record<string, { type: string; description: string; enum?: string[]; items?: { type: string; enum?: string[] } }>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(properties)) {
      const prop: Record<string, unknown> = {
        type: value.type,
        description: value.description,
      };

      if (value.enum) {
        prop.enum = value.enum;
      }

      if (value.items) {
        prop.items = value.items;
      }

      result[key] = prop;
    }

    return result;
  }

  /**
   * Parse Anthropic response into our format
   */
  private parseResponse(response: Anthropic.Message): LLMResponse {
    let content = '';
    const toolCalls: ToolCall[] = [];
    let thinking: string | undefined;

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          args: block.input as Record<string, unknown>,
        });
      } else if (block.type === 'thinking') {
        thinking = (block as { type: 'thinking'; thinking: string }).thinking;
      }
    }

    return { content, toolCalls, thinking };
  }
}

/**
 * Mock LLM client for testing
 */
export class MockLLMClient implements LLMClient {
  private responses: LLMResponse[] = [];
  private callIndex = 0;

  addResponse(response: LLMResponse): void {
    this.responses.push(response);
  }

  async chat(
    _systemPrompt: string,
    _userPrompt: string,
    _tools?: Tool[]
  ): Promise<LLMResponse> {
    if (this.callIndex >= this.responses.length) {
      return { content: 'No more mock responses', toolCalls: [] };
    }
    return this.responses[this.callIndex++];
  }

  reset(): void {
    this.callIndex = 0;
  }
}
