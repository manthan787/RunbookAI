/**
 * AWS Service Definitions
 *
 * Declarative definitions for AWS services that can be dynamically loaded.
 * Each service defines its SDK client, common operations, and result formatting.
 */

export interface AWSOperation {
  name: string;
  description: string;
  command: string;
  // Parameters to pass to the command
  params?: Record<string, unknown>;
  // How to extract results from response
  resultPath?: string;
  // Pagination config
  pagination?: {
    tokenParam: string;
    tokenPath: string;
    resultsPath: string;
  };
}

export interface AWSServiceDefinition {
  id: string;
  name: string;
  description: string;
  category: 'compute' | 'database' | 'storage' | 'networking' | 'security' | 'analytics' | 'integration' | 'devtools' | 'ml' | 'management';
  sdkPackage: string;
  clientClass: string;
  // Primary list operation to discover resources
  listOperation: AWSOperation;
  // Describe operation to get details
  describeOperation?: AWSOperation;
  // How to format each resource for display
  resourceFormatter: {
    idField: string;
    nameField?: string;
    statusField?: string;
    additionalFields?: string[];
  };
}

/**
 * Popular AWS Service Definitions (~40 services)
 */
export const AWS_SERVICES: AWSServiceDefinition[] = [
  // ═══════════════════════════════════════════════════════════════
  // COMPUTE
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'ec2',
    name: 'EC2',
    description: 'Elastic Compute Cloud - Virtual machines',
    category: 'compute',
    sdkPackage: '@aws-sdk/client-ec2',
    clientClass: 'EC2Client',
    listOperation: {
      name: 'describeInstances',
      description: 'List EC2 instances',
      command: 'DescribeInstancesCommand',
      resultPath: 'Reservations',
    },
    resourceFormatter: {
      idField: 'InstanceId',
      nameField: 'Tags.Name',
      statusField: 'State.Name',
      additionalFields: ['InstanceType', 'PrivateIpAddress', 'PublicIpAddress'],
    },
  },
  {
    id: 'ecs',
    name: 'ECS',
    description: 'Elastic Container Service',
    category: 'compute',
    sdkPackage: '@aws-sdk/client-ecs',
    clientClass: 'ECSClient',
    listOperation: {
      name: 'listClusters',
      description: 'List ECS clusters',
      command: 'ListClustersCommand',
      resultPath: 'clusterArns',
      pagination: { tokenParam: 'nextToken', tokenPath: 'nextToken', resultsPath: 'clusterArns' },
    },
    resourceFormatter: {
      idField: 'clusterArn',
      nameField: 'clusterName',
      statusField: 'status',
    },
  },
  {
    id: 'eks',
    name: 'EKS',
    description: 'Elastic Kubernetes Service',
    category: 'compute',
    sdkPackage: '@aws-sdk/client-eks',
    clientClass: 'EKSClient',
    listOperation: {
      name: 'listClusters',
      description: 'List EKS clusters',
      command: 'ListClustersCommand',
      resultPath: 'clusters',
      pagination: { tokenParam: 'nextToken', tokenPath: 'nextToken', resultsPath: 'clusters' },
    },
    resourceFormatter: {
      idField: 'name',
      statusField: 'status',
      additionalFields: ['version', 'endpoint'],
    },
  },
  {
    id: 'lambda',
    name: 'Lambda',
    description: 'Serverless functions',
    category: 'compute',
    sdkPackage: '@aws-sdk/client-lambda',
    clientClass: 'LambdaClient',
    listOperation: {
      name: 'listFunctions',
      description: 'List Lambda functions',
      command: 'ListFunctionsCommand',
      resultPath: 'Functions',
      pagination: { tokenParam: 'Marker', tokenPath: 'NextMarker', resultsPath: 'Functions' },
    },
    resourceFormatter: {
      idField: 'FunctionArn',
      nameField: 'FunctionName',
      statusField: 'State',
      additionalFields: ['Runtime', 'MemorySize', 'Timeout'],
    },
  },
  {
    id: 'lightsail',
    name: 'Lightsail',
    description: 'Simple virtual private servers',
    category: 'compute',
    sdkPackage: '@aws-sdk/client-lightsail',
    clientClass: 'LightsailClient',
    listOperation: {
      name: 'getInstances',
      description: 'List Lightsail instances',
      command: 'GetInstancesCommand',
      resultPath: 'instances',
    },
    resourceFormatter: {
      idField: 'arn',
      nameField: 'name',
      statusField: 'state.name',
      additionalFields: ['blueprintId', 'bundleId', 'publicIpAddress'],
    },
  },
  {
    id: 'apprunner',
    name: 'App Runner',
    description: 'Managed container service',
    category: 'compute',
    sdkPackage: '@aws-sdk/client-apprunner',
    clientClass: 'AppRunnerClient',
    listOperation: {
      name: 'listServices',
      description: 'List App Runner services',
      command: 'ListServicesCommand',
      resultPath: 'ServiceSummaryList',
      pagination: { tokenParam: 'NextToken', tokenPath: 'NextToken', resultsPath: 'ServiceSummaryList' },
    },
    resourceFormatter: {
      idField: 'ServiceArn',
      nameField: 'ServiceName',
      statusField: 'Status',
      additionalFields: ['ServiceUrl'],
    },
  },
  {
    id: 'amplify',
    name: 'Amplify',
    description: 'Full-stack web and mobile apps',
    category: 'compute',
    sdkPackage: '@aws-sdk/client-amplify',
    clientClass: 'AmplifyClient',
    listOperation: {
      name: 'listApps',
      description: 'List Amplify apps',
      command: 'ListAppsCommand',
      resultPath: 'apps',
      pagination: { tokenParam: 'nextToken', tokenPath: 'nextToken', resultsPath: 'apps' },
    },
    resourceFormatter: {
      idField: 'appId',
      nameField: 'name',
      additionalFields: ['repository', 'platform', 'defaultDomain'],
    },
  },
  {
    id: 'batch',
    name: 'Batch',
    description: 'Batch computing',
    category: 'compute',
    sdkPackage: '@aws-sdk/client-batch',
    clientClass: 'BatchClient',
    listOperation: {
      name: 'describeComputeEnvironments',
      description: 'List Batch compute environments',
      command: 'DescribeComputeEnvironmentsCommand',
      resultPath: 'computeEnvironments',
    },
    resourceFormatter: {
      idField: 'computeEnvironmentArn',
      nameField: 'computeEnvironmentName',
      statusField: 'status',
      additionalFields: ['state', 'type'],
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // CONTAINERS
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'ecr',
    name: 'ECR',
    description: 'Elastic Container Registry',
    category: 'compute',
    sdkPackage: '@aws-sdk/client-ecr',
    clientClass: 'ECRClient',
    listOperation: {
      name: 'describeRepositories',
      description: 'List ECR repositories',
      command: 'DescribeRepositoriesCommand',
      resultPath: 'repositories',
      pagination: { tokenParam: 'nextToken', tokenPath: 'nextToken', resultsPath: 'repositories' },
    },
    resourceFormatter: {
      idField: 'repositoryArn',
      nameField: 'repositoryName',
      additionalFields: ['repositoryUri', 'createdAt'],
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // DATABASE
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'rds',
    name: 'RDS',
    description: 'Relational Database Service',
    category: 'database',
    sdkPackage: '@aws-sdk/client-rds',
    clientClass: 'RDSClient',
    listOperation: {
      name: 'describeDBInstances',
      description: 'List RDS instances',
      command: 'DescribeDBInstancesCommand',
      resultPath: 'DBInstances',
      pagination: { tokenParam: 'Marker', tokenPath: 'Marker', resultsPath: 'DBInstances' },
    },
    resourceFormatter: {
      idField: 'DBInstanceIdentifier',
      statusField: 'DBInstanceStatus',
      additionalFields: ['Engine', 'EngineVersion', 'DBInstanceClass', 'MultiAZ'],
    },
  },
  {
    id: 'dynamodb',
    name: 'DynamoDB',
    description: 'NoSQL key-value database',
    category: 'database',
    sdkPackage: '@aws-sdk/client-dynamodb',
    clientClass: 'DynamoDBClient',
    listOperation: {
      name: 'listTables',
      description: 'List DynamoDB tables',
      command: 'ListTablesCommand',
      resultPath: 'TableNames',
      pagination: { tokenParam: 'ExclusiveStartTableName', tokenPath: 'LastEvaluatedTableName', resultsPath: 'TableNames' },
    },
    resourceFormatter: {
      idField: 'TableName',
      statusField: 'TableStatus',
      additionalFields: ['ItemCount', 'TableSizeBytes'],
    },
  },
  {
    id: 'elasticache',
    name: 'ElastiCache',
    description: 'In-memory caching (Redis/Memcached)',
    category: 'database',
    sdkPackage: '@aws-sdk/client-elasticache',
    clientClass: 'ElastiCacheClient',
    listOperation: {
      name: 'describeCacheClusters',
      description: 'List ElastiCache clusters',
      command: 'DescribeCacheClustersCommand',
      resultPath: 'CacheClusters',
      pagination: { tokenParam: 'Marker', tokenPath: 'Marker', resultsPath: 'CacheClusters' },
    },
    resourceFormatter: {
      idField: 'CacheClusterId',
      statusField: 'CacheClusterStatus',
      additionalFields: ['Engine', 'EngineVersion', 'CacheNodeType', 'NumCacheNodes'],
    },
  },
  {
    id: 'docdb',
    name: 'DocumentDB',
    description: 'MongoDB-compatible database',
    category: 'database',
    sdkPackage: '@aws-sdk/client-docdb',
    clientClass: 'DocDBClient',
    listOperation: {
      name: 'describeDBClusters',
      description: 'List DocumentDB clusters',
      command: 'DescribeDBClustersCommand',
      resultPath: 'DBClusters',
    },
    resourceFormatter: {
      idField: 'DBClusterIdentifier',
      statusField: 'Status',
      additionalFields: ['Engine', 'EngineVersion'],
    },
  },
  {
    id: 'neptune',
    name: 'Neptune',
    description: 'Graph database',
    category: 'database',
    sdkPackage: '@aws-sdk/client-neptune',
    clientClass: 'NeptuneClient',
    listOperation: {
      name: 'describeDBClusters',
      description: 'List Neptune clusters',
      command: 'DescribeDBClustersCommand',
      resultPath: 'DBClusters',
    },
    resourceFormatter: {
      idField: 'DBClusterIdentifier',
      statusField: 'Status',
      additionalFields: ['Engine', 'EngineVersion'],
    },
  },
  {
    id: 'redshift',
    name: 'Redshift',
    description: 'Data warehouse',
    category: 'database',
    sdkPackage: '@aws-sdk/client-redshift',
    clientClass: 'RedshiftClient',
    listOperation: {
      name: 'describeClusters',
      description: 'List Redshift clusters',
      command: 'DescribeClustersCommand',
      resultPath: 'Clusters',
    },
    resourceFormatter: {
      idField: 'ClusterIdentifier',
      statusField: 'ClusterStatus',
      additionalFields: ['NodeType', 'NumberOfNodes', 'DBName'],
    },
  },
  {
    id: 'memorydb',
    name: 'MemoryDB',
    description: 'Redis-compatible in-memory database',
    category: 'database',
    sdkPackage: '@aws-sdk/client-memorydb',
    clientClass: 'MemoryDBClient',
    listOperation: {
      name: 'describeClusters',
      description: 'List MemoryDB clusters',
      command: 'DescribeClustersCommand',
      resultPath: 'Clusters',
    },
    resourceFormatter: {
      idField: 'ARN',
      nameField: 'Name',
      statusField: 'Status',
      additionalFields: ['NodeType', 'NumberOfShards'],
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // STORAGE
  // ═══════════════════════════════════════════════════════════════
  {
    id: 's3',
    name: 'S3',
    description: 'Simple Storage Service',
    category: 'storage',
    sdkPackage: '@aws-sdk/client-s3',
    clientClass: 'S3Client',
    listOperation: {
      name: 'listBuckets',
      description: 'List S3 buckets',
      command: 'ListBucketsCommand',
      resultPath: 'Buckets',
    },
    resourceFormatter: {
      idField: 'Name',
      additionalFields: ['CreationDate'],
    },
  },
  {
    id: 'efs',
    name: 'EFS',
    description: 'Elastic File System',
    category: 'storage',
    sdkPackage: '@aws-sdk/client-efs',
    clientClass: 'EFSClient',
    listOperation: {
      name: 'describeFileSystems',
      description: 'List EFS file systems',
      command: 'DescribeFileSystemsCommand',
      resultPath: 'FileSystems',
    },
    resourceFormatter: {
      idField: 'FileSystemId',
      nameField: 'Name',
      statusField: 'LifeCycleState',
      additionalFields: ['SizeInBytes.Value', 'NumberOfMountTargets'],
    },
  },
  {
    id: 'fsx',
    name: 'FSx',
    description: 'Managed file systems',
    category: 'storage',
    sdkPackage: '@aws-sdk/client-fsx',
    clientClass: 'FSxClient',
    listOperation: {
      name: 'describeFileSystems',
      description: 'List FSx file systems',
      command: 'DescribeFileSystemsCommand',
      resultPath: 'FileSystems',
    },
    resourceFormatter: {
      idField: 'FileSystemId',
      statusField: 'Lifecycle',
      additionalFields: ['FileSystemType', 'StorageCapacity'],
    },
  },
  {
    id: 'backup',
    name: 'Backup',
    description: 'Centralized backup service',
    category: 'storage',
    sdkPackage: '@aws-sdk/client-backup',
    clientClass: 'BackupClient',
    listOperation: {
      name: 'listBackupVaults',
      description: 'List backup vaults',
      command: 'ListBackupVaultsCommand',
      resultPath: 'BackupVaultList',
    },
    resourceFormatter: {
      idField: 'BackupVaultArn',
      nameField: 'BackupVaultName',
      additionalFields: ['NumberOfRecoveryPoints', 'CreationDate'],
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // NETWORKING
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'vpc',
    name: 'VPC',
    description: 'Virtual Private Cloud',
    category: 'networking',
    sdkPackage: '@aws-sdk/client-ec2',
    clientClass: 'EC2Client',
    listOperation: {
      name: 'describeVpcs',
      description: 'List VPCs',
      command: 'DescribeVpcsCommand',
      resultPath: 'Vpcs',
    },
    resourceFormatter: {
      idField: 'VpcId',
      nameField: 'Tags.Name',
      statusField: 'State',
      additionalFields: ['CidrBlock', 'IsDefault'],
    },
  },
  {
    id: 'elb',
    name: 'ELB',
    description: 'Elastic Load Balancing (ALB/NLB)',
    category: 'networking',
    sdkPackage: '@aws-sdk/client-elastic-load-balancing-v2',
    clientClass: 'ElasticLoadBalancingV2Client',
    listOperation: {
      name: 'describeLoadBalancers',
      description: 'List load balancers',
      command: 'DescribeLoadBalancersCommand',
      resultPath: 'LoadBalancers',
    },
    resourceFormatter: {
      idField: 'LoadBalancerArn',
      nameField: 'LoadBalancerName',
      statusField: 'State.Code',
      additionalFields: ['Type', 'Scheme', 'DNSName'],
    },
  },
  {
    id: 'cloudfront',
    name: 'CloudFront',
    description: 'Content Delivery Network',
    category: 'networking',
    sdkPackage: '@aws-sdk/client-cloudfront',
    clientClass: 'CloudFrontClient',
    listOperation: {
      name: 'listDistributions',
      description: 'List CloudFront distributions',
      command: 'ListDistributionsCommand',
      resultPath: 'DistributionList.Items',
    },
    resourceFormatter: {
      idField: 'Id',
      nameField: 'DomainName',
      statusField: 'Status',
      additionalFields: ['Enabled', 'Origins.Items'],
    },
  },
  {
    id: 'route53',
    name: 'Route 53',
    description: 'DNS service',
    category: 'networking',
    sdkPackage: '@aws-sdk/client-route-53',
    clientClass: 'Route53Client',
    listOperation: {
      name: 'listHostedZones',
      description: 'List Route 53 hosted zones',
      command: 'ListHostedZonesCommand',
      resultPath: 'HostedZones',
    },
    resourceFormatter: {
      idField: 'Id',
      nameField: 'Name',
      additionalFields: ['ResourceRecordSetCount', 'Config.PrivateZone'],
    },
  },
  {
    id: 'apigateway',
    name: 'API Gateway',
    description: 'API management',
    category: 'networking',
    sdkPackage: '@aws-sdk/client-api-gateway',
    clientClass: 'APIGatewayClient',
    listOperation: {
      name: 'getRestApis',
      description: 'List REST APIs',
      command: 'GetRestApisCommand',
      resultPath: 'items',
    },
    resourceFormatter: {
      idField: 'id',
      nameField: 'name',
      additionalFields: ['description', 'createdDate'],
    },
  },
  {
    id: 'apigwv2',
    name: 'API Gateway V2',
    description: 'HTTP and WebSocket APIs',
    category: 'networking',
    sdkPackage: '@aws-sdk/client-apigatewayv2',
    clientClass: 'ApiGatewayV2Client',
    listOperation: {
      name: 'getApis',
      description: 'List HTTP/WebSocket APIs',
      command: 'GetApisCommand',
      resultPath: 'Items',
    },
    resourceFormatter: {
      idField: 'ApiId',
      nameField: 'Name',
      additionalFields: ['ProtocolType', 'ApiEndpoint'],
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // SECURITY
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'iam',
    name: 'IAM',
    description: 'Identity and Access Management',
    category: 'security',
    sdkPackage: '@aws-sdk/client-iam',
    clientClass: 'IAMClient',
    listOperation: {
      name: 'listRoles',
      description: 'List IAM roles',
      command: 'ListRolesCommand',
      resultPath: 'Roles',
      pagination: { tokenParam: 'Marker', tokenPath: 'Marker', resultsPath: 'Roles' },
    },
    resourceFormatter: {
      idField: 'Arn',
      nameField: 'RoleName',
      additionalFields: ['CreateDate', 'Description'],
    },
  },
  {
    id: 'secretsmanager',
    name: 'Secrets Manager',
    description: 'Secrets management',
    category: 'security',
    sdkPackage: '@aws-sdk/client-secrets-manager',
    clientClass: 'SecretsManagerClient',
    listOperation: {
      name: 'listSecrets',
      description: 'List secrets',
      command: 'ListSecretsCommand',
      resultPath: 'SecretList',
      pagination: { tokenParam: 'NextToken', tokenPath: 'NextToken', resultsPath: 'SecretList' },
    },
    resourceFormatter: {
      idField: 'ARN',
      nameField: 'Name',
      additionalFields: ['LastChangedDate', 'LastRotatedDate'],
    },
  },
  {
    id: 'kms',
    name: 'KMS',
    description: 'Key Management Service',
    category: 'security',
    sdkPackage: '@aws-sdk/client-kms',
    clientClass: 'KMSClient',
    listOperation: {
      name: 'listKeys',
      description: 'List KMS keys',
      command: 'ListKeysCommand',
      resultPath: 'Keys',
      pagination: { tokenParam: 'Marker', tokenPath: 'NextMarker', resultsPath: 'Keys' },
    },
    resourceFormatter: {
      idField: 'KeyId',
      nameField: 'KeyArn',
    },
  },
  {
    id: 'acm',
    name: 'ACM',
    description: 'Certificate Manager',
    category: 'security',
    sdkPackage: '@aws-sdk/client-acm',
    clientClass: 'ACMClient',
    listOperation: {
      name: 'listCertificates',
      description: 'List certificates',
      command: 'ListCertificatesCommand',
      resultPath: 'CertificateSummaryList',
      pagination: { tokenParam: 'NextToken', tokenPath: 'NextToken', resultsPath: 'CertificateSummaryList' },
    },
    resourceFormatter: {
      idField: 'CertificateArn',
      nameField: 'DomainName',
      statusField: 'Status',
    },
  },
  {
    id: 'waf',
    name: 'WAF',
    description: 'Web Application Firewall',
    category: 'security',
    sdkPackage: '@aws-sdk/client-wafv2',
    clientClass: 'WAFV2Client',
    listOperation: {
      name: 'listWebACLs',
      description: 'List Web ACLs',
      command: 'ListWebACLsCommand',
      params: { Scope: 'REGIONAL' },
      resultPath: 'WebACLs',
    },
    resourceFormatter: {
      idField: 'Id',
      nameField: 'Name',
      additionalFields: ['Description', 'ARN'],
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // INTEGRATION & MESSAGING
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'sqs',
    name: 'SQS',
    description: 'Simple Queue Service',
    category: 'integration',
    sdkPackage: '@aws-sdk/client-sqs',
    clientClass: 'SQSClient',
    listOperation: {
      name: 'listQueues',
      description: 'List SQS queues',
      command: 'ListQueuesCommand',
      resultPath: 'QueueUrls',
    },
    resourceFormatter: {
      idField: 'QueueUrl',
    },
  },
  {
    id: 'sns',
    name: 'SNS',
    description: 'Simple Notification Service',
    category: 'integration',
    sdkPackage: '@aws-sdk/client-sns',
    clientClass: 'SNSClient',
    listOperation: {
      name: 'listTopics',
      description: 'List SNS topics',
      command: 'ListTopicsCommand',
      resultPath: 'Topics',
      pagination: { tokenParam: 'NextToken', tokenPath: 'NextToken', resultsPath: 'Topics' },
    },
    resourceFormatter: {
      idField: 'TopicArn',
    },
  },
  {
    id: 'eventbridge',
    name: 'EventBridge',
    description: 'Event bus for serverless',
    category: 'integration',
    sdkPackage: '@aws-sdk/client-eventbridge',
    clientClass: 'EventBridgeClient',
    listOperation: {
      name: 'listEventBuses',
      description: 'List event buses',
      command: 'ListEventBusesCommand',
      resultPath: 'EventBuses',
    },
    resourceFormatter: {
      idField: 'Arn',
      nameField: 'Name',
    },
  },
  {
    id: 'stepfunctions',
    name: 'Step Functions',
    description: 'Workflow orchestration',
    category: 'integration',
    sdkPackage: '@aws-sdk/client-sfn',
    clientClass: 'SFNClient',
    listOperation: {
      name: 'listStateMachines',
      description: 'List state machines',
      command: 'ListStateMachinesCommand',
      resultPath: 'stateMachines',
      pagination: { tokenParam: 'nextToken', tokenPath: 'nextToken', resultsPath: 'stateMachines' },
    },
    resourceFormatter: {
      idField: 'stateMachineArn',
      nameField: 'name',
      additionalFields: ['type', 'creationDate'],
    },
  },
  {
    id: 'kinesis',
    name: 'Kinesis',
    description: 'Real-time data streaming',
    category: 'integration',
    sdkPackage: '@aws-sdk/client-kinesis',
    clientClass: 'KinesisClient',
    listOperation: {
      name: 'listStreams',
      description: 'List Kinesis streams',
      command: 'ListStreamsCommand',
      resultPath: 'StreamNames',
    },
    resourceFormatter: {
      idField: 'StreamName',
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // MANAGEMENT & MONITORING
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'cloudwatch',
    name: 'CloudWatch',
    description: 'Monitoring and observability',
    category: 'management',
    sdkPackage: '@aws-sdk/client-cloudwatch',
    clientClass: 'CloudWatchClient',
    listOperation: {
      name: 'describeAlarms',
      description: 'List CloudWatch alarms',
      command: 'DescribeAlarmsCommand',
      resultPath: 'MetricAlarms',
    },
    resourceFormatter: {
      idField: 'AlarmArn',
      nameField: 'AlarmName',
      statusField: 'StateValue',
      additionalFields: ['MetricName', 'Namespace'],
    },
  },
  {
    id: 'logs',
    name: 'CloudWatch Logs',
    description: 'Log management',
    category: 'management',
    sdkPackage: '@aws-sdk/client-cloudwatch-logs',
    clientClass: 'CloudWatchLogsClient',
    listOperation: {
      name: 'describeLogGroups',
      description: 'List log groups',
      command: 'DescribeLogGroupsCommand',
      resultPath: 'logGroups',
      pagination: { tokenParam: 'nextToken', tokenPath: 'nextToken', resultsPath: 'logGroups' },
    },
    resourceFormatter: {
      idField: 'arn',
      nameField: 'logGroupName',
      additionalFields: ['storedBytes', 'retentionInDays'],
    },
  },
  {
    id: 'ssm',
    name: 'Systems Manager',
    description: 'Operations management',
    category: 'management',
    sdkPackage: '@aws-sdk/client-ssm',
    clientClass: 'SSMClient',
    listOperation: {
      name: 'describeInstanceInformation',
      description: 'List managed instances',
      command: 'DescribeInstanceInformationCommand',
      resultPath: 'InstanceInformationList',
    },
    resourceFormatter: {
      idField: 'InstanceId',
      nameField: 'Name',
      statusField: 'PingStatus',
      additionalFields: ['PlatformType', 'PlatformName'],
    },
  },
  {
    id: 'cloudformation',
    name: 'CloudFormation',
    description: 'Infrastructure as Code',
    category: 'management',
    sdkPackage: '@aws-sdk/client-cloudformation',
    clientClass: 'CloudFormationClient',
    listOperation: {
      name: 'listStacks',
      description: 'List CloudFormation stacks',
      command: 'ListStacksCommand',
      resultPath: 'StackSummaries',
    },
    resourceFormatter: {
      idField: 'StackId',
      nameField: 'StackName',
      statusField: 'StackStatus',
      additionalFields: ['CreationTime', 'LastUpdatedTime'],
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // DEVTOOLS
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'codepipeline',
    name: 'CodePipeline',
    description: 'CI/CD pipeline service',
    category: 'devtools',
    sdkPackage: '@aws-sdk/client-codepipeline',
    clientClass: 'CodePipelineClient',
    listOperation: {
      name: 'listPipelines',
      description: 'List pipelines',
      command: 'ListPipelinesCommand',
      resultPath: 'pipelines',
    },
    resourceFormatter: {
      idField: 'name',
      additionalFields: ['version', 'created', 'updated'],
    },
  },
  {
    id: 'codebuild',
    name: 'CodeBuild',
    description: 'Build service',
    category: 'devtools',
    sdkPackage: '@aws-sdk/client-codebuild',
    clientClass: 'CodeBuildClient',
    listOperation: {
      name: 'listProjects',
      description: 'List build projects',
      command: 'ListProjectsCommand',
      resultPath: 'projects',
    },
    resourceFormatter: {
      idField: 'name',
    },
  },
  {
    id: 'codecommit',
    name: 'CodeCommit',
    description: 'Git repositories',
    category: 'devtools',
    sdkPackage: '@aws-sdk/client-codecommit',
    clientClass: 'CodeCommitClient',
    listOperation: {
      name: 'listRepositories',
      description: 'List repositories',
      command: 'ListRepositoriesCommand',
      resultPath: 'repositories',
    },
    resourceFormatter: {
      idField: 'repositoryId',
      nameField: 'repositoryName',
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // ANALYTICS
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'athena',
    name: 'Athena',
    description: 'Interactive query service',
    category: 'analytics',
    sdkPackage: '@aws-sdk/client-athena',
    clientClass: 'AthenaClient',
    listOperation: {
      name: 'listWorkGroups',
      description: 'List Athena workgroups',
      command: 'ListWorkGroupsCommand',
      resultPath: 'WorkGroups',
    },
    resourceFormatter: {
      idField: 'Name',
      statusField: 'State',
    },
  },
  {
    id: 'glue',
    name: 'Glue',
    description: 'ETL service',
    category: 'analytics',
    sdkPackage: '@aws-sdk/client-glue',
    clientClass: 'GlueClient',
    listOperation: {
      name: 'getDatabases',
      description: 'List Glue databases',
      command: 'GetDatabasesCommand',
      resultPath: 'DatabaseList',
    },
    resourceFormatter: {
      idField: 'Name',
      additionalFields: ['Description', 'CreateTime'],
    },
  },
  {
    id: 'opensearch',
    name: 'OpenSearch',
    description: 'Search and analytics',
    category: 'analytics',
    sdkPackage: '@aws-sdk/client-opensearch',
    clientClass: 'OpenSearchClient',
    listOperation: {
      name: 'listDomainNames',
      description: 'List OpenSearch domains',
      command: 'ListDomainNamesCommand',
      resultPath: 'DomainNames',
    },
    resourceFormatter: {
      idField: 'DomainName',
      additionalFields: ['EngineType'],
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // ML & AI
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'sagemaker',
    name: 'SageMaker',
    description: 'Machine learning platform',
    category: 'ml',
    sdkPackage: '@aws-sdk/client-sagemaker',
    clientClass: 'SageMakerClient',
    listOperation: {
      name: 'listEndpoints',
      description: 'List SageMaker endpoints',
      command: 'ListEndpointsCommand',
      resultPath: 'Endpoints',
    },
    resourceFormatter: {
      idField: 'EndpointArn',
      nameField: 'EndpointName',
      statusField: 'EndpointStatus',
      additionalFields: ['CreationTime', 'LastModifiedTime'],
    },
  },
  {
    id: 'bedrock',
    name: 'Bedrock',
    description: 'Foundation models',
    category: 'ml',
    sdkPackage: '@aws-sdk/client-bedrock',
    clientClass: 'BedrockClient',
    listOperation: {
      name: 'listFoundationModels',
      description: 'List foundation models',
      command: 'ListFoundationModelsCommand',
      resultPath: 'modelSummaries',
    },
    resourceFormatter: {
      idField: 'modelId',
      nameField: 'modelName',
      additionalFields: ['providerName', 'modelArn'],
    },
  },
  {
    id: 'comprehend',
    name: 'Comprehend',
    description: 'Natural language processing',
    category: 'ml',
    sdkPackage: '@aws-sdk/client-comprehend',
    clientClass: 'ComprehendClient',
    listOperation: {
      name: 'listEndpoints',
      description: 'List Comprehend endpoints',
      command: 'ListEndpointsCommand',
      resultPath: 'EndpointPropertiesList',
    },
    resourceFormatter: {
      idField: 'EndpointArn',
      statusField: 'Status',
      additionalFields: ['DesiredInferenceUnits', 'CurrentInferenceUnits'],
    },
  },
];

/**
 * Get service by ID
 */
export function getServiceById(id: string): AWSServiceDefinition | undefined {
  return AWS_SERVICES.find((s) => s.id === id);
}

/**
 * Get services by category
 */
export function getServicesByCategory(category: AWSServiceDefinition['category']): AWSServiceDefinition[] {
  return AWS_SERVICES.filter((s) => s.category === category);
}

/**
 * Get all service IDs
 */
export function getAllServiceIds(): string[] {
  return AWS_SERVICES.map((s) => s.id);
}

/**
 * Service category descriptions
 */
export const CATEGORY_DESCRIPTIONS: Record<AWSServiceDefinition['category'], string> = {
  compute: 'Compute resources (EC2, ECS, Lambda, etc.)',
  database: 'Database services (RDS, DynamoDB, etc.)',
  storage: 'Storage services (S3, EFS, etc.)',
  networking: 'Networking (VPC, Load Balancers, CDN)',
  security: 'Security services (IAM, Secrets, KMS)',
  analytics: 'Analytics and data processing',
  integration: 'Application integration (SQS, SNS, etc.)',
  devtools: 'Developer tools (CI/CD, repositories)',
  ml: 'Machine learning and AI',
  management: 'Management and monitoring',
};
