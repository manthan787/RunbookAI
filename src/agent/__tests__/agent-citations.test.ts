import { describe, expect, it, vi } from 'vitest';
import { Agent, type LLMClient } from '../agent';
import type { RetrievedKnowledge } from '../types';

const emptyKnowledge: RetrievedKnowledge = {
  runbooks: [],
  postmortems: [],
  architecture: [],
  knownIssues: [],
};

async function runAndGetAnswer(agent: Agent, query: string): Promise<string> {
  let answer = '';
  for await (const event of agent.run(query)) {
    if (event.type === 'done') {
      answer = event.answer;
    }
  }
  return answer;
}

describe('Agent runbook citations', () => {
  it('adds deduplicated runbook references in knowledge-first responses', async () => {
    const llm: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        content: 'Use the documented remediation procedure.',
        toolCalls: [],
      }),
    };

    const knowledge: RetrievedKnowledge = {
      runbooks: [
        {
          id: 'chunk-1',
          documentId: 'rb-redis-timeout',
          title: 'Redis Timeout Runbook',
          content: 'Step 1: Verify pool saturation',
          type: 'runbook',
          services: ['redis'],
          score: 0.98,
        },
        {
          id: 'chunk-2',
          documentId: 'rb-redis-timeout',
          title: 'Redis Timeout Runbook',
          content: 'Step 2: Raise max clients',
          type: 'runbook',
          services: ['redis'],
          score: 0.91,
        },
      ],
      postmortems: [],
      architecture: [],
      knownIssues: [],
    };

    const agent = new Agent({
      llm,
      tools: [],
      skills: [],
      knowledgeRetriever: {
        retrieve: async () => knowledge,
      },
    });

    const answer = await runAndGetAnswer(
      agent,
      'What should I do when I see redis connection timeouts in prod?'
    );

    expect(answer).toContain('## Runbook References');
    expect(answer).toContain('1. Redis Timeout Runbook');
    const mentionCount = (answer.match(/Redis Timeout Runbook/g) || []).length;
    expect(mentionCount).toBe(1);
    expect((llm.chat as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('adds runbook references in normal final synthesis path', async () => {
    const llm: LLMClient = {
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          content: 'No further tools needed.',
          toolCalls: [],
        })
        .mockResolvedValueOnce({
          content: 'Common causes include pool saturation and network jitter.',
          toolCalls: [],
        }),
    };

    const knowledge: RetrievedKnowledge = {
      runbooks: [
        {
          id: 'rb-1',
          documentId: 'rb-redis-timeout',
          title: 'Redis Timeout Runbook',
          content: 'Procedure text',
          type: 'runbook',
          services: ['redis'],
          score: 0.88,
        },
      ],
      postmortems: [],
      architecture: [],
      knownIssues: [],
    };

    const agent = new Agent({
      llm,
      tools: [],
      skills: [],
      knowledgeRetriever: {
        retrieve: async () => knowledge,
      },
    });

    const answer = await runAndGetAnswer(agent, 'Summarize redis timeout incident patterns');

    expect(answer).toContain('Common causes include pool saturation and network jitter.');
    expect(answer).toContain('## Runbook References');
    expect(answer).toContain('1. Redis Timeout Runbook');
    expect((llm.chat as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it('does not add runbook references when no runbooks are retrieved', async () => {
    const llm: LLMClient = {
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          content: 'No tools needed.',
          toolCalls: [],
        })
        .mockResolvedValueOnce({
          content: 'No runbook context available.',
          toolCalls: [],
        }),
    };

    const agent = new Agent({
      llm,
      tools: [],
      skills: [],
      knowledgeRetriever: {
        retrieve: async () => emptyKnowledge,
      },
    });

    const answer = await runAndGetAnswer(agent, 'Summarize current redis error trends');

    expect(answer).not.toContain('## Runbook References');
  });
});
