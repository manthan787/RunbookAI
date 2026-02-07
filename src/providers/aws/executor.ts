/**
 * Dynamic AWS Service Executor
 *
 * Executes AWS operations based on declarative service definitions.
 * Dynamically imports SDK clients and runs operations.
 */

import type { AWSServiceDefinition, AWSOperation } from './services';
import { getClient } from './client';

// Cache for dynamically imported modules
const moduleCache = new Map<string, unknown>();

/**
 * Dynamically import an AWS SDK module
 */
async function importModule(packageName: string): Promise<unknown> {
  if (moduleCache.has(packageName)) {
    return moduleCache.get(packageName);
  }

  try {
    const module = await import(packageName);
    moduleCache.set(packageName, module);
    return module;
  } catch (error) {
    throw new Error(`Failed to import ${packageName}. Run: npm install ${packageName}`);
  }
}

/**
 * Get a value from a nested path in an object
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Format a resource based on the service formatter config
 */
function formatResource(
  resource: unknown,
  formatter: AWSServiceDefinition['resourceFormatter']
): Record<string, unknown> {
  if (typeof resource !== 'object' || resource === null) {
    return { id: String(resource) };
  }

  const result: Record<string, unknown> = {};
  const obj = resource as Record<string, unknown>;

  // ID field (required)
  result.id = getNestedValue(obj, formatter.idField);

  // Name field (optional)
  if (formatter.nameField) {
    const name = getNestedValue(obj, formatter.nameField);
    if (name !== undefined) {
      result.name = name;
    }
  }

  // Status field (optional)
  if (formatter.statusField) {
    const status = getNestedValue(obj, formatter.statusField);
    if (status !== undefined) {
      result.status = status;
    }
  }

  // Additional fields
  if (formatter.additionalFields) {
    for (const field of formatter.additionalFields) {
      const value = getNestedValue(obj, field);
      if (value !== undefined) {
        // Use the last part of the path as the key
        const key = field.split('.').pop() || field;
        result[key] = value;
      }
    }
  }

  return result;
}

/**
 * Execute a list operation for a service
 */
export async function executeListOperation(
  service: AWSServiceDefinition,
  options: {
    accountName?: string;
    region?: string;
    limit?: number;
  } = {}
): Promise<{
  resources: Record<string, unknown>[];
  count: number;
  service: string;
}> {
  const { accountName, region, limit } = options;
  const operation = service.listOperation;

  // Import the SDK module
  const module = await importModule(service.sdkPackage);
  const ClientClass = (module as Record<string, unknown>)[service.clientClass] as new (config: { region: string }) => unknown;
  const CommandClass = (module as Record<string, unknown>)[operation.command] as new (params: Record<string, unknown>) => unknown;

  if (!ClientClass || !CommandClass) {
    throw new Error(`Could not find ${service.clientClass} or ${operation.command} in ${service.sdkPackage}`);
  }

  // Get the client using our multi-account system
  const client = await getClient(ClientClass as new (config: { region: string }) => { send: (cmd: unknown) => Promise<unknown> }, { accountName, region });

  // Collect results with pagination
  const allResults: unknown[] = [];
  let nextToken: string | undefined;
  let iterations = 0;
  const maxIterations = limit ? Math.ceil(limit / 100) : 10;

  do {
    const params: Record<string, unknown> = {
      ...operation.params,
    };

    if (operation.pagination && nextToken) {
      params[operation.pagination.tokenParam] = nextToken;
    }

    const command = new CommandClass(params);
    const response = await (client as { send: (cmd: unknown) => Promise<unknown> }).send(command);

    // Extract results
    const resultPath = operation.resultPath;
    const results = resultPath ? getNestedValue(response, resultPath) : response;

    if (Array.isArray(results)) {
      allResults.push(...results);
    } else if (results !== undefined) {
      allResults.push(results);
    }

    // Handle pagination
    if (operation.pagination) {
      nextToken = getNestedValue(response, operation.pagination.tokenPath) as string | undefined;
    } else {
      nextToken = undefined;
    }

    iterations++;

    // Check limits
    if (limit && allResults.length >= limit) {
      break;
    }
  } while (nextToken && iterations < maxIterations);

  // Apply limit
  const limitedResults = limit ? allResults.slice(0, limit) : allResults;

  // Format resources
  const formattedResources = limitedResults.map((r) => formatResource(r, service.resourceFormatter));

  return {
    resources: formattedResources,
    count: formattedResources.length,
    service: service.id,
  };
}

/**
 * Execute list operations for multiple services in parallel
 */
export async function executeMultiServiceQuery(
  services: AWSServiceDefinition[],
  options: {
    accountName?: string;
    region?: string;
    limit?: number;
  } = {}
): Promise<Record<string, { resources: Record<string, unknown>[]; count: number; error?: string }>> {
  const results: Record<string, { resources: Record<string, unknown>[]; count: number; error?: string }> = {};

  await Promise.all(
    services.map(async (service) => {
      try {
        const result = await executeListOperation(service, options);
        results[service.id] = {
          resources: result.resources,
          count: result.count,
        };
      } catch (error) {
        results[service.id] = {
          resources: [],
          count: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })
  );

  return results;
}

/**
 * Check if an SDK package is installed
 */
export async function isServiceAvailable(service: AWSServiceDefinition): Promise<boolean> {
  try {
    await importModule(service.sdkPackage);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get list of installed services
 */
export async function getInstalledServices(services: AWSServiceDefinition[]): Promise<AWSServiceDefinition[]> {
  const installed: AWSServiceDefinition[] = [];

  for (const service of services) {
    if (await isServiceAvailable(service)) {
      installed.push(service);
    }
  }

  return installed;
}
