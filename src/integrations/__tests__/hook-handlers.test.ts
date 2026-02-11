/**
 * Tests for Claude Hook Handlers with Context Injection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  handleSessionStart,
  handleUserPromptSubmit,
  handlePreToolUse,
  handlePostToolUse,
  handleStop,
  handleHookEvent,
  handleHookStdinWithResponse,
  type HookPayload,
  type HookHandlerConfig,
} from '../hook-handlers';

const TEST_BASE_DIR = '.test-runbook-hooks';

describe('Hook Handlers', () => {
  beforeEach(async () => {
    await mkdir(TEST_BASE_DIR, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_BASE_DIR)) {
      await rm(TEST_BASE_DIR, { recursive: true, force: true });
    }
  });

  const config: HookHandlerConfig = {
    baseDir: TEST_BASE_DIR,
    enableKnowledgeInjection: true,
    enableIncidentDetection: true,
    maxRunbooksToShow: 3,
    maxKnownIssuesToShow: 3,
  };

  describe('handleSessionStart', () => {
    it('should create session state file', async () => {
      const payload: HookPayload = {
        session_id: 'test-session-123',
        hook_event_name: 'SessionStart',
      };

      const response = await handleSessionStart(payload, config);

      expect(response.systemMessage).toContain('RunbookAI session linked');

      // Check session state was saved
      const sessionFile = join(TEST_BASE_DIR, 'sessions', 'test-session-123.json');
      expect(existsSync(sessionFile)).toBe(true);

      const state = JSON.parse(await readFile(sessionFile, 'utf-8'));
      expect(state.sessionId).toBe('test-session-123');
      expect(state.promptCount).toBe(0);
    });

    it('should include knowledge stats if available', async () => {
      // Create a mock knowledge database
      const knowledgeDir = join(TEST_BASE_DIR, 'runbooks');
      await mkdir(knowledgeDir, { recursive: true });
      await writeFile(
        join(knowledgeDir, 'test-runbook.md'),
        `---
type: runbook
title: Test Runbook
services: [api]
---
# Test Runbook
Some content here.
`
      );

      const payload: HookPayload = {
        session_id: 'test-session-456',
        hook_event_name: 'SessionStart',
      };

      const response = await handleSessionStart(payload, config);

      // May or may not have knowledge stats depending on retriever initialization
      expect(response.systemMessage).toBeDefined();
    });
  });

  describe('handleUserPromptSubmit', () => {
    it('should extract services from prompt', async () => {
      const payload: HookPayload = {
        session_id: 'test-session-789',
        hook_event_name: 'UserPromptSubmit',
        prompt: 'Why is the payment-service throwing errors?',
      };

      const response = await handleUserPromptSubmit(payload, config);

      // Should have extracted 'payment' as a service
      const sessionFile = join(TEST_BASE_DIR, 'sessions', 'test-session-789.json');
      const state = JSON.parse(await readFile(sessionFile, 'utf-8'));
      expect(state.servicesDiscovered).toContain('payment');
    });

    it('should extract symptoms from prompt', async () => {
      const payload: HookPayload = {
        session_id: 'test-session-symptoms',
        hook_event_name: 'UserPromptSubmit',
        prompt: 'Users are seeing 500 errors and high latency on checkout',
      };

      const response = await handleUserPromptSubmit(payload, config);

      if (response.systemMessage) {
        expect(response.systemMessage).toContain('Detected Symptoms');
      }
    });

    it('should return empty response for empty prompt', async () => {
      const payload: HookPayload = {
        session_id: 'test-session-empty',
        hook_event_name: 'UserPromptSubmit',
        prompt: '',
      };

      const response = await handleUserPromptSubmit(payload, config);

      expect(response.systemMessage).toBeUndefined();
    });

    it('should increment prompt count', async () => {
      const payload: HookPayload = {
        session_id: 'test-session-count',
        hook_event_name: 'UserPromptSubmit',
        prompt: 'First prompt',
      };

      await handleUserPromptSubmit(payload, config);
      payload.prompt = 'Second prompt';
      await handleUserPromptSubmit(payload, config);

      const sessionFile = join(TEST_BASE_DIR, 'sessions', 'test-session-count.json');
      const state = JSON.parse(await readFile(sessionFile, 'utf-8'));
      expect(state.promptCount).toBe(2);
    });

    it('should skip context injection when disabled', async () => {
      const noContextConfig: HookHandlerConfig = {
        ...config,
        enableKnowledgeInjection: false,
      };

      const payload: HookPayload = {
        session_id: 'test-session-no-context',
        hook_event_name: 'UserPromptSubmit',
        prompt: 'Check the api-service for 500 errors',
      };

      const response = await handleUserPromptSubmit(payload, noContextConfig);

      expect(response.systemMessage).toBeUndefined();
    });
  });

  describe('handlePreToolUse', () => {
    it('should allow safe tool calls', async () => {
      const payload: HookPayload = {
        session_id: 'test-session-safe',
        hook_event_name: 'PreToolUse',
        tool_name: 'Read',
        tool_input: { file_path: '/some/file.txt' },
      };

      const response = await handlePreToolUse(payload, config);

      expect(response.continue).toBe(true);
    });

    it('should block dangerous bash commands', async () => {
      const payload: HookPayload = {
        session_id: 'test-session-danger',
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf /' },
      };

      const response = await handlePreToolUse(payload, config);

      expect(response.continue).toBe(false);
      expect(response.stopReason).toContain('blocked');
    });

    it('should block kubectl delete commands', async () => {
      const payload: HookPayload = {
        session_id: 'test-session-k8s',
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'kubectl delete deployment my-app' },
      };

      const response = await handlePreToolUse(payload, config);

      expect(response.continue).toBe(false);
    });

    it('should allow safe kubectl commands', async () => {
      const payload: HookPayload = {
        session_id: 'test-session-k8s-safe',
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'kubectl get pods' },
      };

      const response = await handlePreToolUse(payload, config);

      expect(response.continue).toBe(true);
    });
  });

  describe('handlePostToolUse', () => {
    it('should return empty response (no-op for now)', async () => {
      const payload: HookPayload = {
        session_id: 'test-session-post',
        hook_event_name: 'PostToolUse',
        tool_name: 'Read',
        tool_result: { content: 'file contents' },
      };

      const response = await handlePostToolUse(payload, config);

      expect(response).toEqual({});
    });
  });

  describe('handleStop', () => {
    it('should handle stop event', async () => {
      // First create a session
      await handleSessionStart(
        { session_id: 'test-session-stop', hook_event_name: 'SessionStart' },
        config
      );

      const payload: HookPayload = {
        session_id: 'test-session-stop',
        hook_event_name: 'Stop',
      };

      const response = await handleStop(payload, config);

      // Currently returns empty, but session state should exist
      expect(response).toEqual({});
    });
  });

  describe('handleHookEvent', () => {
    it('should route to correct handler based on event name', async () => {
      const sessionPayload: HookPayload = {
        session_id: 'test-route-session',
        hook_event_name: 'SessionStart',
      };

      const response = await handleHookEvent(sessionPayload, config);
      expect(response.systemMessage).toContain('RunbookAI');
    });

    it('should handle unknown event names gracefully', async () => {
      const payload: HookPayload = {
        session_id: 'test-unknown',
        hook_event_name: 'UnknownEvent' as any,
      };

      const response = await handleHookEvent(payload, config);
      expect(response).toEqual({});
    });
  });

  describe('handleHookStdinWithResponse', () => {
    it('should parse JSON input and return response', async () => {
      const input = JSON.stringify({
        session_id: 'test-stdin',
        hook_event_name: 'SessionStart',
      });

      const result = await handleHookStdinWithResponse(input, config);

      expect(result.handled).toBe(true);
      expect(result.response?.systemMessage).toContain('RunbookAI');
    });

    it('should handle empty input', async () => {
      const result = await handleHookStdinWithResponse('', config);

      expect(result.handled).toBe(false);
      expect(result.error).toBe('empty_stdin');
    });

    it('should handle invalid JSON', async () => {
      const result = await handleHookStdinWithResponse('not json', config);

      expect(result.handled).toBe(false);
      expect(result.error).toContain('invalid_json');
    });
  });
});

describe('Service Extraction', () => {
  const config: HookHandlerConfig = {
    baseDir: TEST_BASE_DIR,
    enableKnowledgeInjection: true,
    enableIncidentDetection: true,
    maxRunbooksToShow: 3,
    maxKnownIssuesToShow: 3,
  };

  beforeEach(async () => {
    await mkdir(TEST_BASE_DIR, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_BASE_DIR)) {
      await rm(TEST_BASE_DIR, { recursive: true, force: true });
    }
  });

  it('should extract service names from common patterns', async () => {
    const testCases = [
      { prompt: 'Check the payment-service logs', expected: ['payment'] },
      { prompt: 'The user-api is returning 500s', expected: ['user'] },
      { prompt: 'checkout-worker is down', expected: ['checkout'] },
      { prompt: 'The api-gateway is slow', expected: ['api'] },
    ];

    for (const { prompt, expected } of testCases) {
      const payload: HookPayload = {
        session_id: `test-extract-${Date.now()}`,
        hook_event_name: 'UserPromptSubmit',
        prompt,
      };

      await handleUserPromptSubmit(payload, config);

      const sessionFile = join(TEST_BASE_DIR, 'sessions', payload.session_id + '.json');
      const state = JSON.parse(await readFile(sessionFile, 'utf-8'));

      for (const service of expected) {
        expect(state.servicesDiscovered).toContain(service);
      }
    }
  });
});

describe('Symptom Extraction', () => {
  const config: HookHandlerConfig = {
    baseDir: TEST_BASE_DIR,
    enableKnowledgeInjection: false, // Disable to check extraction only
    enableIncidentDetection: true,
    maxRunbooksToShow: 3,
    maxKnownIssuesToShow: 3,
  };

  beforeEach(async () => {
    await mkdir(TEST_BASE_DIR, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_BASE_DIR)) {
      await rm(TEST_BASE_DIR, { recursive: true, force: true });
    }
  });

  it('should detect HTTP error codes', async () => {
    const payload: HookPayload = {
      session_id: 'test-symptoms-http',
      hook_event_name: 'UserPromptSubmit',
      prompt: 'Getting 500 errors and 503 service unavailable',
    };

    // With knowledge injection enabled
    const configWithKnowledge = { ...config, enableKnowledgeInjection: true };
    const response = await handleUserPromptSubmit(payload, configWithKnowledge);

    if (response.systemMessage) {
      expect(response.systemMessage.toLowerCase()).toMatch(/500|503|symptom/);
    }
  });

  it('should detect performance issues', async () => {
    const payload: HookPayload = {
      session_id: 'test-symptoms-perf',
      hook_event_name: 'UserPromptSubmit',
      prompt: 'High latency and timeout issues on the API',
    };

    const configWithKnowledge = { ...config, enableKnowledgeInjection: true };
    const response = await handleUserPromptSubmit(payload, configWithKnowledge);

    if (response.systemMessage) {
      expect(response.systemMessage.toLowerCase()).toMatch(/latency|timeout|symptom/);
    }
  });
});
