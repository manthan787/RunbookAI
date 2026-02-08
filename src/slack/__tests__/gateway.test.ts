import { describe, it, expect } from 'vitest';
import {
  parseSlackMentionCommand,
  buildSlackRequest,
  isAuthorizedSlackEvent,
  EventDedupeCache,
} from '../gateway';

describe('Slack gateway command parsing', () => {
  it('parses app mention command text', () => {
    const parsed = parseSlackMentionCommand('<@U123> infra check ecs service status');

    expect(parsed).toEqual({
      command: 'infra',
      args: 'check ecs service status',
    });
  });

  it('parses @runbookAI command text', () => {
    const parsed = parseSlackMentionCommand('@runbookAI investigate PD-12345');

    expect(parsed).toEqual({
      command: 'investigate',
      args: 'PD-12345',
    });
  });

  it('returns null for unsupported commands', () => {
    const parsed = parseSlackMentionCommand('<@U123> hello there');
    expect(parsed).toBeNull();
  });
});

describe('Slack gateway request routing', () => {
  it('builds deploy request query', () => {
    const request = buildSlackRequest(
      { command: 'deploy', args: 'checkout-api to production' },
      {
        type: 'app_mention',
        channel: 'C123',
        user: 'U123',
        ts: '123.4',
        text: '<@Ubot> deploy checkout-api to production',
      }
    );

    expect(request.command).toBe('deploy');
    expect(request.query).toContain('Deploy checkout-api to production');
    expect(request.threadTs).toBe('123.4');
  });

  it('captures incident id for investigate', () => {
    const request = buildSlackRequest(
      { command: 'investigate', args: 'PD-777 redis latency spike' },
      {
        type: 'app_mention',
        channel: 'C123',
        user: 'U123',
        thread_ts: '100.2',
        ts: '123.4',
        text: '<@Ubot> investigate PD-777 redis latency spike',
      }
    );

    expect(request.incidentId).toBe('PD-777');
    expect(request.threadTs).toBe('100.2');
  });
});

describe('Slack gateway authorization', () => {
  const baseEvent = {
    type: 'app_mention',
    text: '<@UBOT> infra show status',
    channel: 'CALERTS',
    user: 'UONCALL',
    ts: '100.01',
    thread_ts: '100.01',
  };

  it('accepts valid mentioned events', () => {
    const allowed = isAuthorizedSlackEvent(baseEvent, {
      botUserId: 'UBOT',
      alertChannels: ['CALERTS'],
      allowedUsers: ['UONCALL'],
      requireThreadedMentions: true,
    });

    expect(allowed).toBe(true);
  });

  it('rejects events outside allowed channels', () => {
    const allowed = isAuthorizedSlackEvent(
      { ...baseEvent, channel: 'CRANDOM' },
      {
        botUserId: 'UBOT',
        alertChannels: ['CALERTS'],
      }
    );

    expect(allowed).toBe(false);
  });

  it('rejects non-thread mentions when thread is required', () => {
    const allowed = isAuthorizedSlackEvent(
      { ...baseEvent, thread_ts: undefined },
      {
        botUserId: 'UBOT',
        requireThreadedMentions: true,
      }
    );

    expect(allowed).toBe(false);
  });
});

describe('Slack gateway dedupe cache', () => {
  it('deduplicates known event ids', () => {
    const cache = new EventDedupeCache(60_000);

    expect(cache.has('evt_1')).toBe(false);
    cache.add('evt_1');
    expect(cache.has('evt_1')).toBe(true);
  });
});
