/**
 * LLM Client
 *
 * Provides a unified interface for calling language models with tool support.
 * Uses @mariozechner/pi-ai for multi-provider support (20+ providers).
 */

import {
  getModel,
  complete,
  type Context,
  type Tool as PiTool,
  Type,
  type TSchema,
} from '@mariozechner/pi-ai';
import type { Tool } from '../agent/types';
import type { LLMClient, LLMResponse, ToolCall } from '../agent/agent';

// Re-export types for external use
export type { LLMClient, LLMResponse, ToolCall };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = any;

// Supported providers from pi-ai
export type Provider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'mistral'
  | 'groq'
  | 'xai'
  | 'openrouter'
  | 'bedrock'
  | 'azure'
  | 'vertex'
  | 'cerebras'
  | 'github'
  | 'ollama';

export interface LLMConfig {
  provider: Provider;
  model: string;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
}

const DEFAULT_CONFIG: LLMConfig = {
  provider: 'openai',
  model: 'gpt-4o',
  maxTokens: 4096,
  temperature: 0,
};

/**
 * Create an LLM client based on configuration
 */
export function createLLMClient(config: Partial<LLMConfig> = {}): LLMClient {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  return new PiAIClient(fullConfig);
}

/**
 * Unified LLM client using pi-ai
 */
class PiAIClient implements LLMClient {
  private model: AnyModel;
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;

    // Set API key in environment if provided
    if (config.apiKey) {
      const envKey = this.getEnvKeyName(config.provider);
      process.env[envKey] = config.apiKey;
    }

    // Get model from pi-ai
    // The getModel function is type-safe and provides autocomplete
    this.model = getModel(config.provider as 'openai', config.model as 'gpt-4o');

    // Validate that the model was found
    if (!this.model) {
      throw new Error(
        `Model "${config.model}" is not supported for provider "${config.provider}". ` +
          `Try using a different model name (e.g., gpt-4o for OpenAI, claude-sonnet-4-20250514 for Anthropic).`
      );
    }
  }

  private getEnvKeyName(provider: Provider): string {
    const envKeys: Record<Provider, string> = {
      openai: 'OPENAI_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
      google: 'GOOGLE_API_KEY',
      mistral: 'MISTRAL_API_KEY',
      groq: 'GROQ_API_KEY',
      xai: 'XAI_API_KEY',
      openrouter: 'OPENROUTER_API_KEY',
      bedrock: 'AWS_ACCESS_KEY_ID', // Bedrock uses AWS credentials
      azure: 'AZURE_OPENAI_API_KEY',
      vertex: 'GOOGLE_APPLICATION_CREDENTIALS',
      cerebras: 'CEREBRAS_API_KEY',
      github: 'GITHUB_TOKEN',
      ollama: '', // Ollama doesn't need an API key
    };
    return envKeys[provider] || '';
  }

  async chat(systemPrompt: string, userPrompt: string, tools?: Tool[]): Promise<LLMResponse> {
    // Convert tools to pi-ai format
    const piTools = tools?.map((t) => this.convertTool(t));

    // Build context
    const context: Context = {
      systemPrompt,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: userPrompt }],
          timestamp: Date.now(),
        },
      ],
      tools: piTools,
    };

    try {
      // Make completion request
      const response = await complete(this.model, context, {
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
      });

      // Parse response
      return this.parseResponse(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(
        `LLM API error (${this.config.provider}/${this.config.model}): ${errorMessage}`
      );
    }
  }

  /**
   * Convert our tool format to pi-ai's format
   */
  private convertTool(tool: Tool): PiTool {
    // Build TypeBox schema from our parameters
    const properties: Record<string, TSchema> = {};

    for (const [key, value] of Object.entries(tool.parameters.properties)) {
      if (value.type === 'string') {
        properties[key] = Type.String({ description: value.description });
      } else if (value.type === 'number') {
        properties[key] = Type.Number({ description: value.description });
      } else if (value.type === 'boolean') {
        properties[key] = Type.Boolean({ description: value.description });
      } else if (value.type === 'array') {
        properties[key] = Type.Array(Type.String(), { description: value.description });
      } else if (value.type === 'object') {
        properties[key] = Type.Record(Type.String(), Type.Unknown(), {
          description: value.description,
        });
      } else {
        properties[key] = Type.Unknown({ description: value.description });
      }
    }

    return {
      name: tool.name,
      description: tool.description,
      parameters: Type.Object(properties),
    };
  }

  /**
   * Parse pi-ai response into our format
   */
  private parseResponse(response: {
    content: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      arguments?: unknown;
    }>;
    stopReason?: string;
    errorMessage?: string;
  }): LLMResponse {
    if (response.stopReason === 'error') {
      throw new Error(response.errorMessage || 'Provider returned an unknown error');
    }

    let content = '';
    const toolCalls: ToolCall[] = [];
    let thinking: string | undefined;

    for (const block of response.content) {
      if (block.type === 'text' && block.text) {
        content += block.text;
      } else if (block.type === 'toolCall' && block.id && block.name) {
        toolCalls.push({
          id: block.id,
          name: block.name,
          args: (block.arguments as Record<string, unknown>) || {},
        });
      } else if (block.type === 'thinking' && block.text) {
        thinking = block.text;
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

  async chat(_systemPrompt: string, _userPrompt: string, _tools?: Tool[]): Promise<LLMResponse> {
    if (this.callIndex >= this.responses.length) {
      return { content: 'No more mock responses', toolCalls: [] };
    }
    return this.responses[this.callIndex++];
  }

  reset(): void {
    this.callIndex = 0;
  }
}
