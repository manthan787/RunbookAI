/**
 * DynamoDB Tools
 */

import {
  DynamoDBClient,
  ListTablesCommand,
  DescribeTableCommand,
  ScanCommand,
} from '@aws-sdk/client-dynamodb';
import { getClient } from '../../providers/aws/client';

export interface DynamoDBTable {
  tableName: string;
  tableStatus: string;
  itemCount: number;
  tableSizeBytes: number;
  keySchema: Array<{ attributeName: string; keyType: string }>;
  provisionedThroughput?: {
    readCapacityUnits: number;
    writeCapacityUnits: number;
  };
  billingMode: string;
  createdAt?: Date;
}

export interface DynamoDBTableMetrics {
  tableName: string;
  consumedReadCapacity?: number;
  consumedWriteCapacity?: number;
  throttledRequests?: number;
}

/**
 * List all DynamoDB tables
 */
export async function listTables(accountName?: string, region?: string): Promise<string[]> {
  const client = await getClient(DynamoDBClient, { accountName, region });
  const tables: string[] = [];
  let lastEvaluatedTableName: string | undefined;

  do {
    const command = new ListTablesCommand({
      ExclusiveStartTableName: lastEvaluatedTableName,
      Limit: 100,
    });
    const response = await client.send(command);
    tables.push(...(response.TableNames || []));
    lastEvaluatedTableName = response.LastEvaluatedTableName;
  } while (lastEvaluatedTableName);

  return tables;
}

/**
 * Describe a specific DynamoDB table
 */
export async function describeTable(
  tableName: string,
  accountName?: string,
  region?: string
): Promise<DynamoDBTable | null> {
  const client = await getClient(DynamoDBClient, { accountName, region });
  const command = new DescribeTableCommand({ TableName: tableName });

  try {
    const response = await client.send(command);
    const table = response.Table;

    if (!table) return null;

    return {
      tableName: table.TableName || tableName,
      tableStatus: table.TableStatus || 'UNKNOWN',
      itemCount: table.ItemCount || 0,
      tableSizeBytes: table.TableSizeBytes || 0,
      keySchema: (table.KeySchema || []).map((k) => ({
        attributeName: k.AttributeName || '',
        keyType: k.KeyType || '',
      })),
      provisionedThroughput: table.ProvisionedThroughput
        ? {
            readCapacityUnits: table.ProvisionedThroughput.ReadCapacityUnits || 0,
            writeCapacityUnits: table.ProvisionedThroughput.WriteCapacityUnits || 0,
          }
        : undefined,
      billingMode: table.BillingModeSummary?.BillingMode || 'PROVISIONED',
      createdAt: table.CreationDateTime,
    };
  } catch (error) {
    if ((error as Error).name === 'ResourceNotFoundException') {
      return null;
    }
    throw error;
  }
}

/**
 * Describe multiple DynamoDB tables
 */
export async function describeTables(
  tableNames?: string[],
  accountName?: string,
  region?: string
): Promise<DynamoDBTable[]> {
  // If no table names provided, list all tables first
  const names = tableNames || (await listTables(accountName, region));
  const tables: DynamoDBTable[] = [];

  for (const name of names) {
    const table = await describeTable(name, accountName, region);
    if (table) {
      tables.push(table);
    }
  }

  return tables;
}

/**
 * Get approximate item count for a table (uses table description, not scan)
 */
export async function getTableItemCount(
  tableName: string,
  accountName?: string,
  region?: string
): Promise<number> {
  const table = await describeTable(tableName, accountName, region);
  return table?.itemCount || 0;
}

/**
 * Check table health based on status and throttling
 */
export async function checkTableHealth(
  tableName: string,
  accountName?: string,
  region?: string
): Promise<{ healthy: boolean; issues: string[] }> {
  const issues: string[] = [];
  const table = await describeTable(tableName, accountName, region);

  if (!table) {
    return { healthy: false, issues: ['Table not found'] };
  }

  if (table.tableStatus !== 'ACTIVE') {
    issues.push(`Table status is ${table.tableStatus}`);
  }

  // Check if table size is very large (might need optimization)
  const sizeGB = table.tableSizeBytes / (1024 * 1024 * 1024);
  if (sizeGB > 100) {
    issues.push(`Table size is ${sizeGB.toFixed(2)} GB - consider archiving old data`);
  }

  return { healthy: issues.length === 0, issues };
}
