/**
 * CloudWatch Tools
 *
 * Provides access to CloudWatch metrics, logs, and alarms for observability.
 */

import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
  DescribeAlarmsCommand,
  type Statistic,
} from '@aws-sdk/client-cloudwatch';
import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
  DescribeLogGroupsCommand,
} from '@aws-sdk/client-cloudwatch-logs';

let cwClient: CloudWatchClient | null = null;
let logsClient: CloudWatchLogsClient | null = null;

function getCloudWatchClient(region?: string): CloudWatchClient {
  if (!cwClient || region) {
    cwClient = new CloudWatchClient({ region: region || process.env.AWS_REGION || 'us-east-1' });
  }
  return cwClient;
}

function getLogsClient(region?: string): CloudWatchLogsClient {
  if (!logsClient || region) {
    logsClient = new CloudWatchLogsClient({
      region: region || process.env.AWS_REGION || 'us-east-1',
    });
  }
  return logsClient;
}

export interface MetricDatapoint {
  timestamp: Date;
  value: number;
  unit: string;
}

export interface AlarmInfo {
  alarmName: string;
  alarmArn: string;
  stateValue: string;
  stateReason: string;
  metricName: string;
  namespace: string;
  threshold: number;
  comparisonOperator: string;
  updatedTimestamp: Date | undefined;
  dimensions: Array<{
    name: string;
    value: string;
  }>;
}

export interface LogEvent {
  timestamp: number;
  message: string;
  logStreamName: string;
}

/**
 * Get metric statistics for a given metric
 */
export async function getMetricStatistics(
  namespace: string,
  metricName: string,
  dimensions: { name: string; value: string }[],
  startTime: Date,
  endTime: Date,
  period: number = 300,
  statistics: Statistic[] = ['Average'],
  region?: string
): Promise<MetricDatapoint[]> {
  const cw = getCloudWatchClient(region);

  const command = new GetMetricStatisticsCommand({
    Namespace: namespace,
    MetricName: metricName,
    Dimensions: dimensions.map((d) => ({ Name: d.name, Value: d.value })),
    StartTime: startTime,
    EndTime: endTime,
    Period: period,
    Statistics: statistics,
  });

  const response = await cw.send(command);

  return (response.Datapoints || [])
    .map((dp) => ({
      timestamp: dp.Timestamp!,
      value: dp.Average || dp.Sum || dp.Maximum || dp.Minimum || 0,
      unit: dp.Unit || 'None',
    }))
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

/**
 * Get all alarms or filter by state
 */
export async function describeAlarms(
  stateValue?: 'OK' | 'ALARM' | 'INSUFFICIENT_DATA',
  alarmNamePrefix?: string,
  region?: string
): Promise<AlarmInfo[]> {
  const cw = getCloudWatchClient(region);

  const command = new DescribeAlarmsCommand({
    StateValue: stateValue,
    AlarmNamePrefix: alarmNamePrefix,
  });

  const response = await cw.send(command);

  return (response.MetricAlarms || []).map((alarm) => ({
    alarmName: alarm.AlarmName || '',
    alarmArn: alarm.AlarmArn || '',
    stateValue: alarm.StateValue || 'INSUFFICIENT_DATA',
    stateReason: alarm.StateReason || '',
    metricName: alarm.MetricName || '',
    namespace: alarm.Namespace || '',
    threshold: alarm.Threshold || 0,
    comparisonOperator: alarm.ComparisonOperator || '',
    updatedTimestamp: alarm.StateUpdatedTimestamp,
    dimensions: (alarm.Dimensions || []).map((dimension) => ({
      name: dimension.Name || '',
      value: dimension.Value || '',
    })),
  }));
}

/**
 * Get alarms that are currently in ALARM state
 */
export async function getActiveAlarms(region?: string): Promise<AlarmInfo[]> {
  return describeAlarms('ALARM', undefined, region);
}

/**
 * List log groups
 */
export async function listLogGroups(
  prefix?: string,
  region?: string
): Promise<{ logGroupName: string; storedBytes: number; retentionDays: number | undefined }[]> {
  const logs = getLogsClient(region);

  const command = new DescribeLogGroupsCommand({
    logGroupNamePrefix: prefix,
  });

  const response = await logs.send(command);

  return (response.logGroups || []).map((lg) => ({
    logGroupName: lg.logGroupName || '',
    storedBytes: lg.storedBytes || 0,
    retentionDays: lg.retentionInDays,
  }));
}

/**
 * Filter log events by pattern
 */
export async function filterLogEvents(
  logGroupName: string,
  filterPattern: string,
  startTime: Date,
  endTime: Date,
  limit: number = 100,
  region?: string
): Promise<LogEvent[]> {
  const logs = getLogsClient(region);

  const command = new FilterLogEventsCommand({
    logGroupName,
    filterPattern,
    startTime: startTime.getTime(),
    endTime: endTime.getTime(),
    limit,
  });

  const response = await logs.send(command);

  return (response.events || []).map((event) => ({
    timestamp: event.timestamp || 0,
    message: event.message || '',
    logStreamName: event.logStreamName || '',
  }));
}

/**
 * Search logs for errors in the last N minutes
 */
export async function searchRecentErrors(
  logGroupName: string,
  minutesBack: number = 15,
  region?: string
): Promise<LogEvent[]> {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - minutesBack * 60 * 1000);

  return filterLogEvents(
    logGroupName,
    '?ERROR ?Error ?error ?FATAL ?Fatal ?fatal ?Exception ?exception',
    startTime,
    endTime,
    50,
    region
  );
}

/**
 * Get common service metrics
 */
export async function getServiceMetrics(
  serviceName: string,
  clusterName: string,
  minutesBack: number = 60,
  region?: string
): Promise<{
  cpuUtilization: MetricDatapoint[];
  memoryUtilization: MetricDatapoint[];
}> {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - minutesBack * 60 * 1000);

  const dimensions = [
    { name: 'ClusterName', value: clusterName },
    { name: 'ServiceName', value: serviceName },
  ];

  const [cpu, memory] = await Promise.all([
    getMetricStatistics(
      'AWS/ECS',
      'CPUUtilization',
      dimensions,
      startTime,
      endTime,
      300,
      ['Average'],
      region
    ),
    getMetricStatistics(
      'AWS/ECS',
      'MemoryUtilization',
      dimensions,
      startTime,
      endTime,
      300,
      ['Average'],
      region
    ),
  ]);

  return {
    cpuUtilization: cpu,
    memoryUtilization: memory,
  };
}
