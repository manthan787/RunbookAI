/**
 * PagerDuty Tools
 *
 * Provides integration with PagerDuty for incident management.
 */

const PAGERDUTY_API_BASE = 'https://api.pagerduty.com';

interface PagerDutyConfig {
  apiKey: string;
}

let config: PagerDutyConfig | null = null;

export function configure(apiKey: string): void {
  config = { apiKey: normalizeValue(apiKey) };
}

function normalizeValue(value: string): string {
  return value
    .trim()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/^['"]+|['"]+$/g, '')
    .trim();
}

function firstInvalidByteStringChar(value: string): { index: number; code: number } | null {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code > 255) {
      return { index: i, code };
    }
  }
  return null;
}

function sanitizeIdentifier(value: string, label: string): string {
  const sanitized = normalizeValue(value);
  if (!sanitized) {
    throw new Error(`PagerDuty ${label} is empty.`);
  }
  const invalid = firstInvalidByteStringChar(sanitized);
  if (invalid) {
    throw new Error(
      `PagerDuty ${label} contains invalid character at index ${invalid.index} (code ${invalid.code}).`
    );
  }
  return sanitized;
}

function getApiKey(): string {
  const raw = config?.apiKey || process.env.PAGERDUTY_API_KEY;
  if (!raw) {
    throw new Error(
      'PagerDuty API key not configured. Set PAGERDUTY_API_KEY environment variable.'
    );
  }
  return sanitizeIdentifier(raw, 'API key');
}

async function pdFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const apiKey = getApiKey();
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Token token=${apiKey}`);
  headers.set('Accept', 'application/vnd.pagerduty+json;version=2');
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${PAGERDUTY_API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`PagerDuty API error: ${response.status} ${error}`);
  }

  return response.json() as Promise<T>;
}

export interface PagerDutyIncident {
  id: string;
  incidentNumber: number;
  title: string;
  status: 'triggered' | 'acknowledged' | 'resolved';
  urgency: 'high' | 'low';
  createdAt: string;
  service: {
    id: string;
    name: string;
  };
  assignees: Array<{
    id: string;
    name: string;
    email: string;
  }>;
  lastStatusChangeAt: string;
  escalationPolicy: {
    id: string;
    name: string;
  };
  teams: Array<{
    id: string;
    name: string;
  }>;
}

export interface PagerDutyAlert {
  id: string;
  alertKey: string;
  status: string;
  severity: string;
  summary: string;
  createdAt: string;
  service: {
    id: string;
    name: string;
  };
  body?: {
    details?: Record<string, unknown>;
  };
}

export interface PagerDutyService {
  id: string;
  name: string;
  description: string;
  status: string;
  escalationPolicy: {
    id: string;
    name: string;
  };
  teams: Array<{
    id: string;
    name: string;
  }>;
}

/**
 * Get incident by ID
 */
export async function getIncident(incidentId: string): Promise<PagerDutyIncident> {
  const safeIncidentId = encodeURIComponent(sanitizeIdentifier(incidentId, 'incident ID'));
  const response = await pdFetch<{ incident: Record<string, unknown> }>(
    `/incidents/${safeIncidentId}`
  );
  return mapIncident(response.incident);
}

/**
 * List incidents with optional filters
 */
export async function listIncidents(
  options: {
    statuses?: Array<'triggered' | 'acknowledged' | 'resolved'>;
    since?: string;
    until?: string;
    serviceIds?: string[];
    limit?: number;
  } = {}
): Promise<PagerDutyIncident[]> {
  const params = new URLSearchParams();

  if (options.statuses) {
    options.statuses.forEach((s) => params.append('statuses[]', sanitizeIdentifier(s, 'status')));
  }
  if (options.since) params.set('since', sanitizeIdentifier(options.since, 'since timestamp'));
  if (options.until) params.set('until', sanitizeIdentifier(options.until, 'until timestamp'));
  if (options.serviceIds) {
    options.serviceIds.forEach((id) =>
      params.append('service_ids[]', sanitizeIdentifier(id, 'service ID'))
    );
  }
  if (options.limit) params.set('limit', options.limit.toString());

  const response = await pdFetch<{ incidents: Array<Record<string, unknown>> }>(
    `/incidents?${params.toString()}`
  );

  return response.incidents.map(mapIncident);
}

/**
 * Get alerts for an incident
 */
export async function getIncidentAlerts(incidentId: string): Promise<PagerDutyAlert[]> {
  const safeIncidentId = encodeURIComponent(sanitizeIdentifier(incidentId, 'incident ID'));
  const response = await pdFetch<{ alerts: Array<Record<string, unknown>> }>(
    `/incidents/${safeIncidentId}/alerts`
  );

  return response.alerts.map((alert) => ({
    id: alert.id as string,
    alertKey: alert.alert_key as string,
    status: alert.status as string,
    severity: (alert.severity as string) || 'info',
    summary: alert.summary as string,
    createdAt: alert.created_at as string,
    service: {
      id: (alert.service as Record<string, unknown>)?.id as string,
      name: (alert.service as Record<string, unknown>)?.summary as string,
    },
    body: alert.body as { details?: Record<string, unknown> } | undefined,
  }));
}

/**
 * Get service by ID
 */
export async function getService(serviceId: string): Promise<PagerDutyService> {
  const safeServiceId = encodeURIComponent(sanitizeIdentifier(serviceId, 'service ID'));
  const response = await pdFetch<{ service: Record<string, unknown> }>(
    `/services/${safeServiceId}`
  );
  return mapService(response.service);
}

/**
 * Add a note to an incident
 */
export async function addIncidentNote(
  incidentId: string,
  note: string,
  email: string
): Promise<{ id: string; content: string }> {
  const safeIncidentId = encodeURIComponent(sanitizeIdentifier(incidentId, 'incident ID'));
  const safeEmail = sanitizeIdentifier(email, 'email');
  const response = await pdFetch<{ note: Record<string, unknown> }>(
    `/incidents/${safeIncidentId}/notes`,
    {
      method: 'POST',
      headers: {
        From: safeEmail,
      },
      body: JSON.stringify({
        note: {
          content: note,
        },
      }),
    }
  );

  return {
    id: response.note.id as string,
    content: response.note.content as string,
  };
}

/**
 * Acknowledge an incident
 */
export async function acknowledgeIncident(
  incidentId: string,
  email: string
): Promise<PagerDutyIncident> {
  const safeIncidentId = encodeURIComponent(sanitizeIdentifier(incidentId, 'incident ID'));
  const safeEmail = sanitizeIdentifier(email, 'email');
  const response = await pdFetch<{ incident: Record<string, unknown> }>(
    `/incidents/${safeIncidentId}`,
    {
      method: 'PUT',
      headers: {
        From: safeEmail,
      },
      body: JSON.stringify({
        incident: {
          type: 'incident_reference',
          status: 'acknowledged',
        },
      }),
    }
  );

  return mapIncident(response.incident);
}

/**
 * Resolve an incident
 */
export async function resolveIncident(
  incidentId: string,
  email: string,
  resolution?: string
): Promise<PagerDutyIncident> {
  const safeIncidentId = encodeURIComponent(sanitizeIdentifier(incidentId, 'incident ID'));
  const safeEmail = sanitizeIdentifier(email, 'email');
  const response = await pdFetch<{ incident: Record<string, unknown> }>(
    `/incidents/${safeIncidentId}`,
    {
      method: 'PUT',
      headers: {
        From: safeEmail,
      },
      body: JSON.stringify({
        incident: {
          type: 'incident_reference',
          status: 'resolved',
          resolution: resolution,
        },
      }),
    }
  );

  return mapIncident(response.incident);
}

/**
 * Get active incidents (triggered or acknowledged)
 */
export async function getActiveIncidents(): Promise<PagerDutyIncident[]> {
  return listIncidents({
    statuses: ['triggered', 'acknowledged'],
    limit: 25,
  });
}

// Helper functions
function mapIncident(data: Record<string, unknown>): PagerDutyIncident {
  return {
    id: data.id as string,
    incidentNumber: data.incident_number as number,
    title: data.title as string,
    status: data.status as 'triggered' | 'acknowledged' | 'resolved',
    urgency: data.urgency as 'high' | 'low',
    createdAt: data.created_at as string,
    lastStatusChangeAt: data.last_status_change_at as string,
    service: {
      id: (data.service as Record<string, unknown>)?.id as string,
      name: (data.service as Record<string, unknown>)?.summary as string,
    },
    assignees: ((data.assignments as Array<Record<string, unknown>>) || []).map((a) => ({
      id: (a.assignee as Record<string, unknown>)?.id as string,
      name: (a.assignee as Record<string, unknown>)?.summary as string,
      email: (a.assignee as Record<string, unknown>)?.email as string,
    })),
    escalationPolicy: {
      id: (data.escalation_policy as Record<string, unknown>)?.id as string,
      name: (data.escalation_policy as Record<string, unknown>)?.summary as string,
    },
    teams: ((data.teams as Array<Record<string, unknown>>) || []).map((t) => ({
      id: t.id as string,
      name: t.summary as string,
    })),
  };
}

function mapService(data: Record<string, unknown>): PagerDutyService {
  return {
    id: data.id as string,
    name: data.name as string,
    description: data.description as string,
    status: data.status as string,
    escalationPolicy: {
      id: (data.escalation_policy as Record<string, unknown>)?.id as string,
      name: (data.escalation_policy as Record<string, unknown>)?.summary as string,
    },
    teams: ((data.teams as Array<Record<string, unknown>>) || []).map((t) => ({
      id: t.id as string,
      name: t.summary as string,
    })),
  };
}
