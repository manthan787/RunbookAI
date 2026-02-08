---
title: Multi-Provider LLM
description: Using different LLM providers
---

Runbook supports 20+ LLM providers through the pi-ai abstraction layer.

## Supported Providers

| Provider | Models | Best For |
|----------|--------|----------|
| **Anthropic** | Claude Opus 4.5, Claude Sonnet 4, Claude Haiku | Best overall, recommended |
| **OpenAI** | GPT-4o, GPT-4 Turbo, GPT-3.5 | Good alternative |
| **Google** | Gemini Pro, Gemini Ultra | Long context |
| **Mistral** | Mistral Large, Mistral Medium | Fast, cost-effective |
| **Groq** | Llama 3.1 70B, Mixtral 8x7B | Very fast inference |
| **xAI** | Grok-2 | Alternative reasoning |

## Configuration

### Anthropic (Recommended)

```yaml
llm:
  provider: anthropic
  model: claude-opus-4-5-20251101
  apiKey: ${ANTHROPIC_API_KEY}
```

### OpenAI

```yaml
llm:
  provider: openai
  model: gpt-4o
  apiKey: ${OPENAI_API_KEY}
```

### Google

```yaml
llm:
  provider: google
  model: gemini-pro
  apiKey: ${GOOGLE_API_KEY}
```

### Mistral

```yaml
llm:
  provider: mistral
  model: mistral-large-latest
  apiKey: ${MISTRAL_API_KEY}
```

### Groq

```yaml
llm:
  provider: groq
  model: llama-3.1-70b-versatile
  apiKey: ${GROQ_API_KEY}
```

## Model Selection

### Capability Requirements

Runbook requires models that:
- Support tool/function calling
- Handle complex multi-turn conversations
- Have good reasoning abilities
- Provide consistent JSON outputs

### Recommended Models

| Use Case | Model | Provider |
|----------|-------|----------|
| Production | Claude Opus 4.5 | Anthropic |
| Balanced | Claude Sonnet 4 | Anthropic |
| Fast/Cheap | Claude Haiku | Anthropic |
| Alternative | GPT-4o | OpenAI |
| Speed Priority | Llama 3.1 70B | Groq |

## Advanced Settings

### Temperature

Control response randomness:

```yaml
llm:
  provider: anthropic
  model: claude-opus-4-5-20251101
  temperature: 0.1  # Lower = more deterministic
```

For investigations, lower temperature (0.0-0.2) is recommended.

### Max Tokens

Limit response length:

```yaml
llm:
  maxTokens: 4096  # Max response tokens
```

### Timeout

```yaml
llm:
  timeoutMs: 60000  # 60 seconds
```

## Cost Optimization

### Model Tiers

Use different models for different tasks:

```yaml
llm:
  default:
    provider: anthropic
    model: claude-sonnet-4-20250514  # Default

  investigation:
    provider: anthropic
    model: claude-opus-4-5-20251101  # Best for complex investigations

  simple:
    provider: anthropic
    model: claude-3-haiku-20240307   # Quick queries
```

### Token Usage

Monitor token usage:

```bash
runbook stats --tokens

Token Usage (Last 30 days):
  Total: 2,345,678 tokens
  Input: 1,234,567 (53%)
  Output: 1,111,111 (47%)

  By Operation:
    Investigations: 1,500,000 (64%)
    Queries: 500,000 (21%)
    Chat: 345,678 (15%)

  Estimated Cost: $47.89
```

## Fallback Configuration

Configure fallback providers:

```yaml
llm:
  primary:
    provider: anthropic
    model: claude-opus-4-5-20251101

  fallback:
    provider: openai
    model: gpt-4o
    triggerOn:
      - rate_limit
      - timeout
      - server_error
```

## Custom Endpoints

Use custom API endpoints:

```yaml
llm:
  provider: openai
  model: custom-model
  baseUrl: https://your-proxy.com/v1
  apiKey: ${CUSTOM_API_KEY}
```

### Azure OpenAI

```yaml
llm:
  provider: azure
  model: gpt-4
  apiKey: ${AZURE_OPENAI_KEY}
  baseUrl: https://your-resource.openai.azure.com
  apiVersion: "2024-02-15-preview"
  deployment: your-deployment-name
```

## Environment Variables

| Variable | Provider |
|----------|----------|
| `ANTHROPIC_API_KEY` | Anthropic |
| `OPENAI_API_KEY` | OpenAI |
| `GOOGLE_API_KEY` | Google |
| `MISTRAL_API_KEY` | Mistral |
| `GROQ_API_KEY` | Groq |
| `XAI_API_KEY` | xAI |

## Troubleshooting

### Rate Limits

```
Error: Rate limit exceeded

Options:
1. Wait and retry (automatic with backoff)
2. Use fallback provider
3. Upgrade API tier
```

### Model Not Available

```
Error: Model 'claude-opus-4-5-20251101' not available

Check:
1. Model name is correct
2. API key has access to model
3. Model is available in your region
```
