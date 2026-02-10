import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { createHmac, timingSafeEqual } from 'crypto';
import { Agent } from '../agent/agent';
import { createLLMClient } from '../model/llm';
import { toolRegistry } from '../tools/registry';
import { skillRegistry } from '../skills/registry';
import { createRetriever } from '../knowledge/retriever';
import { loadConfig, type Config } from '../utils/config';
import { getRuntimeTools } from '../cli/runtime-tools';
import { configure as configureSlack, postMessage } from '../tools/incident/slack';

export type SlackGatewayCommand = 'infra' | 'knowledge' | 'deploy' | 'investigate';

interface SlackEventPayload {
  type: string;
  text?: string;
  user?: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
  subtype?: string;
  bot_id?: string;
}

interface SlackEnvelope {
  envelope_id?: string;
  type?: string;
  payload?: {
    event_id?: string;
    event?: SlackEventPayload;
  };
}

interface SlackEventsBody {
  type: string;
  challenge?: string;
  event_id?: string;
  event?: SlackEventPayload;
}

export interface ParsedMentionCommand {
  command: SlackGatewayCommand;
  args: string;
}

export interface RoutedSlackRequest {
  command: SlackGatewayCommand;
  args: string;
  query: string;
  incidentId?: string;
  channel: string;
  user: string;
  threadTs?: string;
  eventTs?: string;
}

export interface SlackGatewayOptions {
  mode: 'http' | 'socket';
  botToken: string;
  signingSecret?: string;
  appToken?: string;
  port?: number;
  botUserId?: string;
  alertChannels?: string[];
  allowedUsers?: string[];
  requireThreadedMentions?: boolean;
  executeRequest: (request: RoutedSlackRequest) => Promise<string>;
}

export class EventDedupeCache {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs = 5 * 60 * 1000) {}

  has(eventId: string): boolean {
    this.cleanup();
    return this.seen.has(eventId);
  }

  add(eventId: string): void {
    this.cleanup();
    this.seen.set(eventId, Date.now());
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, timestamp] of this.seen.entries()) {
      if (timestamp < cutoff) {
        this.seen.delete(id);
      }
    }
  }
}

export function parseSlackMentionCommand(text: string): ParsedMentionCommand | null {
  const withoutMentions = text
    .replace(/<@[^>]+>/g, ' ')
    .replace(/@runbookai/gi, ' ')
    .trim();

  if (!withoutMentions) {
    return null;
  }

  const [rawCommand, ...rest] = withoutMentions.split(/\s+/);
  const command = rawCommand.toLowerCase();

  if (
    command !== 'infra' &&
    command !== 'knowledge' &&
    command !== 'deploy' &&
    command !== 'investigate'
  ) {
    return null;
  }

  return {
    command,
    args: rest.join(' ').trim(),
  };
}

export function buildSlackRequest(
  command: ParsedMentionCommand,
  event: SlackEventPayload
): RoutedSlackRequest {
  const args = command.args;

  if (!event.channel || !event.user) {
    throw new Error('Slack event missing channel or user');
  }

  if (command.command === 'knowledge') {
    return {
      command: command.command,
      args,
      query: args
        ? `Search the knowledge base for: ${args}. Include the most relevant runbook guidance.`
        : 'Search the knowledge base for current incident handling guidance.',
      channel: event.channel,
      user: event.user,
      threadTs: event.thread_ts || event.ts,
      eventTs: event.ts,
    };
  }

  if (command.command === 'deploy') {
    return {
      command: command.command,
      args,
      query: args
        ? `Deploy ${args} using the deploy-service skill. Perform pre-deployment checks and require approval for mutations.`
        : 'Show deployment options and required checks. Do not execute without explicit approval.',
      channel: event.channel,
      user: event.user,
      threadTs: event.thread_ts || event.ts,
      eventTs: event.ts,
    };
  }

  if (command.command === 'investigate') {
    const incidentId = args.split(/\s+/)[0];
    return {
      command: command.command,
      args,
      incidentId,
      query: args
        ? `Investigate incident ${args}. Identify likely root cause and next actions.`
        : 'Investigate this alert context and identify likely root cause and next actions.',
      channel: event.channel,
      user: event.user,
      threadTs: event.thread_ts || event.ts,
      eventTs: event.ts,
    };
  }

  return {
    command: command.command,
    args,
    query: args
      ? `Answer this infrastructure request: ${args}`
      : 'Give a concise infrastructure status summary for this environment.',
    channel: event.channel,
    user: event.user,
    threadTs: event.thread_ts || event.ts,
    eventTs: event.ts,
  };
}

export function isAuthorizedSlackEvent(
  event: SlackEventPayload,
  options: {
    botUserId?: string;
    alertChannels?: string[];
    allowedUsers?: string[];
    requireThreadedMentions?: boolean;
  }
): boolean {
  if (!event.text || !event.channel || !event.user) {
    return false;
  }

  if (event.subtype || event.bot_id) {
    return false;
  }

  const mentionsBot = options.botUserId
    ? event.text.includes(`<@${options.botUserId}>`) || /@runbookai/i.test(event.text)
    : /@runbookai/i.test(event.text) || /<@[^>]+>/.test(event.text);

  if (!mentionsBot) {
    return false;
  }

  if (options.requireThreadedMentions && !event.thread_ts) {
    return false;
  }

  if (options.alertChannels && options.alertChannels.length > 0) {
    if (!options.alertChannels.includes(event.channel)) {
      return false;
    }
  }

  if (options.allowedUsers && options.allowedUsers.length > 0) {
    if (!options.allowedUsers.includes(event.user)) {
      return false;
    }
  }

  return true;
}

function verifySlackSignature(
  signingSecret: string,
  signature: string | undefined,
  timestamp: string | undefined,
  body: string
): boolean {
  if (!signature || !timestamp) {
    return false;
  }

  const requestTimestamp = parseInt(timestamp, 10);
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - requestTimestamp) > 300) {
    return false;
  }

  const sigBaseString = `v0:${timestamp}:${body}`;
  const expected = 'v0=' + createHmac('sha256', signingSecret).update(sigBaseString).digest('hex');

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

function createAgentKnowledgeRetriever() {
  const retriever = createRetriever();

  return {
    retrieve: async (context: {
      query?: string;
      incidentId?: string;
      services: string[];
      symptoms: string[];
      errorMessages: string[];
    }) => {
      const queryParts = [
        context.query,
        context.incidentId,
        ...context.services,
        ...context.symptoms,
        ...context.errorMessages,
      ].filter(Boolean) as string[];

      const query = queryParts.join(' ').trim() || 'production incident investigation runbook';
      return retriever.search(query, {
        limit: 20,
        serviceFilter: context.services.length > 0 ? context.services : undefined,
      });
    },
  };
}

async function createRuntimeAgent(config: Config): Promise<Agent> {
  const llm = createLLMClient({
    provider: config.llm.provider,
    model: config.llm.model,
    apiKey: config.llm.apiKey,
  });

  await skillRegistry.loadUserSkills();
  const runtimeSkills = skillRegistry.getAll().map((skill) => skill.id);
  const runtimeTools = await getRuntimeTools(config, toolRegistry.getAll());

  return new Agent({
    llm,
    tools: runtimeTools,
    skills: runtimeSkills,
    knowledgeRetriever: createAgentKnowledgeRetriever(),
    config: {
      maxIterations: config.agent.maxIterations,
      maxHypothesisDepth: config.agent.maxHypothesisDepth,
      contextThresholdTokens: config.agent.contextThresholdTokens,
    },
  });
}

export async function executeSlackRequestWithRuntime(request: RoutedSlackRequest): Promise<string> {
  const config = await loadConfig();
  const agent = await createRuntimeAgent(config);

  let finalAnswer = '';
  for await (const event of agent.run(request.query, request.incidentId)) {
    if (event.type === 'done') {
      finalAnswer = event.answer;
    }
  }

  return finalAnswer || 'No result generated.';
}

async function getBotUserId(botToken: string): Promise<string> {
  const response = await fetch('https://slack.com/api/auth.test', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${botToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({}),
  });

  const data = (await response.json()) as { ok: boolean; user_id?: string; error?: string };
  if (!data.ok || !data.user_id) {
    throw new Error(`Slack auth.test failed: ${data.error || 'unknown error'}`);
  }

  return data.user_id;
}

async function processSlackEvent(
  event: SlackEventPayload,
  opts: SlackGatewayOptions & { botUserId: string }
): Promise<void> {
  if (
    !isAuthorizedSlackEvent(event, {
      botUserId: opts.botUserId,
      alertChannels: opts.alertChannels,
      allowedUsers: opts.allowedUsers,
      requireThreadedMentions: opts.requireThreadedMentions,
    })
  ) {
    return;
  }

  const parsed = parseSlackMentionCommand(event.text || '');
  if (!parsed) {
    if (event.channel && event.user) {
      await postMessage(
        event.channel,
        'Use `@runbookAI <infra|knowledge|deploy|investigate> <request>` to run a command.',
        { threadTs: event.thread_ts || event.ts }
      );
    }
    return;
  }

  const request = buildSlackRequest(parsed, event);

  await postMessage(request.channel, `Running *${request.command}* request...`, {
    threadTs: request.threadTs,
  });

  const result = await opts.executeRequest(request);
  const maxLen = 3000;
  const response = result.length > maxLen ? `${result.slice(0, maxLen)}\n\n_[truncated]_` : result;

  await postMessage(request.channel, response, { threadTs: request.threadTs });
}

function createHttpHandler(
  opts: SlackGatewayOptions & { botUserId: string; dedupe: EventDedupeCache }
) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', mode: 'http', timestamp: new Date().toISOString() }));
      return;
    }

    if (req.url !== '/slack/events' || req.method !== 'POST') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    if (!opts.signingSecret) {
      res.writeHead(500);
      res.end('Signing secret not configured');
      return;
    }

    const signature = req.headers['x-slack-signature'] as string | undefined;
    const timestamp = req.headers['x-slack-request-timestamp'] as string | undefined;

    if (!verifySlackSignature(opts.signingSecret, signature, timestamp, body)) {
      res.writeHead(401);
      res.end('Invalid signature');
      return;
    }

    const payload = JSON.parse(body) as SlackEventsBody;

    if (payload.type === 'url_verification') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ challenge: payload.challenge }));
      return;
    }

    if (payload.type !== 'event_callback' || !payload.event) {
      res.writeHead(200);
      res.end();
      return;
    }

    const eventId = payload.event_id;
    if (eventId) {
      if (opts.dedupe.has(eventId)) {
        res.writeHead(200);
        res.end();
        return;
      }
      opts.dedupe.add(eventId);
    }

    res.writeHead(200);
    res.end();

    try {
      await processSlackEvent(payload.event, opts);
    } catch (error) {
      console.error('Failed to process Slack event:', error);
    }
  };
}

async function openSocketModeUrl(appToken: string): Promise<string> {
  const response = await fetch('https://slack.com/api/apps.connections.open', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({}),
  });

  const data = (await response.json()) as { ok: boolean; url?: string; error?: string };
  if (!data.ok || !data.url) {
    throw new Error(`Slack apps.connections.open failed: ${data.error || 'unknown error'}`);
  }

  return data.url;
}

async function startSocketMode(
  opts: SlackGatewayOptions & { botUserId: string; dedupe: EventDedupeCache }
): Promise<void> {
  if (!opts.appToken) {
    throw new Error('Slack app token is required for socket mode');
  }

  const connect = async () => {
    const socketUrl = await openSocketModeUrl(opts.appToken!);
    const ws = new WebSocket(socketUrl);

    ws.onopen = () => {
      console.log('Slack Socket Mode connected');
    };

    ws.onmessage = async (event) => {
      try {
        const envelope = JSON.parse(String(event.data)) as SlackEnvelope;

        if (envelope.envelope_id) {
          ws.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
        }

        const eventId = envelope.payload?.event_id;
        const slackEvent = envelope.payload?.event;

        if (!slackEvent) {
          return;
        }

        if (eventId) {
          if (opts.dedupe.has(eventId)) {
            return;
          }
          opts.dedupe.add(eventId);
        }

        await processSlackEvent(slackEvent, opts);
      } catch (error) {
        console.error('Failed to process Slack Socket Mode event:', error);
      }
    };

    ws.onclose = () => {
      console.log('Slack Socket Mode disconnected, reconnecting in 3s...');
      setTimeout(() => {
        void connect();
      }, 3000);
    };

    ws.onerror = (error) => {
      console.error('Slack Socket Mode error:', error);
    };
  };

  await connect();
}

export async function startSlackGateway(options: SlackGatewayOptions): Promise<void> {
  configureSlack(options.botToken);

  const botUserId = options.botUserId || (await getBotUserId(options.botToken));
  const dedupe = new EventDedupeCache();
  const opts = {
    ...options,
    botUserId,
    dedupe,
  };

  if (options.mode === 'socket') {
    await startSocketMode(opts);
    return;
  }

  const port = options.port || 3001;
  const handler = createHttpHandler(opts);

  await new Promise<void>((resolve, reject) => {
    const server = createServer(handler);

    server.on('error', reject);
    server.listen(port, () => {
      console.log(`Slack events gateway listening on port ${port}`);
      console.log(`Endpoint: http://localhost:${port}/slack/events`);
      console.log(`Health: http://localhost:${port}/health`);
      resolve();
    });
  });
}
